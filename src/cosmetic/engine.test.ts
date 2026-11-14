import { describe, expect, test } from "vitest";
import { parseList } from "../parser/index.js";
import { T_ELEMHIDE, T_GENERICHIDE, T_SPECIFICHIDE } from "../parser/types.js";
import { PublicSuffixList } from "../psl/psl.js";
import { CosmeticEngine } from "./engine.js";

const psl = new PublicSuffixList("com\nexample\nco.example");

function build(lines: string[], trusted = false): CosmeticEngine {
  const list = parseList(lines.join("\n"), { trusted });
  expect(list.stats.invalid).toEqual({});
  const engine = new CosmeticEngine({ psl });
  engine.add(list);
  return engine;
}

const HIDE = "{display:none!important;}";
const css = (engine: CosmeticEngine, hostname: string, switches = 0) =>
  engine.forDocument(hostname, switches).css.split("\n").filter(Boolean);

describe("specific filters", () => {
  test("apply on their hostname and its subdomains", () => {
    const engine = build(["a.example,b.example##.ad", "other.example##.x"]);
    expect(css(engine, "a.example")).toEqual([`.ad${HIDE}`]);
    expect(css(engine, "www.a.example")).toEqual([`.ad${HIDE}`]);
    expect(css(engine, "b.example")).toEqual([`.ad${HIDE}`]);
    expect(css(engine, "nota.example")).toEqual([]);
    expect(engine.stats.specific).toBe(2);
  });

  test("an entity applies on every public suffix of its name", () => {
    const engine = build(["shop.*##.promo"]);
    expect(css(engine, "shop.com")).toEqual([`.promo${HIDE}`]);
    expect(css(engine, "www.shop.co.example")).toEqual([`.promo${HIDE}`]);
    expect(css(engine, "shop.evil.com")).toEqual([]);
  });

  test("a regular expression hostname is tried on each hostname", () => {
    const engine = build(["/^img\\d\\.example$/##.banner"]);
    expect(css(engine, "img7.example")).toEqual([`.banner${HIDE}`]);
    expect(css(engine, "www.img7.example")).toEqual([]);
  });

  test("a negated hostname is an exception there", () => {
    const engine = build(["a.example,~shop.a.example##.ad"]);
    expect(css(engine, "www.a.example")).toEqual([`.ad${HIDE}`]);
    expect(css(engine, "shop.a.example")).toEqual([]);
    expect(css(engine, "x.shop.a.example")).toEqual([]);
  });

  test("an exception lifts the filter with the same body", () => {
    const engine = build([
      "a.example##.ad",
      "a.example##.promo",
      "www.a.example#@#.ad",
      "#@#.promo",
    ]);
    expect(css(engine, "a.example")).toEqual([`.ad${HIDE}`]);
    expect(css(engine, "www.a.example")).toEqual([]);
  });

  test(":style() and :matches-media() become CSS of their own", () => {
    const engine = build([
      "a.example##.bar:style(top: 0 !important)",
      "a.example##.wide:matches-media((min-width: 900px))",
      "a.example##pre:matches-media(print):style(color: red)",
    ]);
    expect(css(engine, "a.example")).toEqual([
      ".bar{top: 0 !important}",
      `@media (min-width: 900px){.wide${HIDE}}`,
      "@media print{pre{color: red}}",
    ]);
  });

  test("the same selector from two lists is sent once", () => {
    const engine = build(["a.example##.ad", "a.example,b.example##.ad"]);
    expect(css(engine, "a.example")).toEqual([`.ad${HIDE}`]);
  });

  test("procedural filters go to the page as plans", () => {
    const engine = build([
      "a.example##div:has-text(Sponsored)",
      "a.example##.x:remove()",
      "a.example#@#.x:remove()",
    ]);
    expect(engine.forDocument("a.example")).toEqual({
      css: "",
      procedural: [{ selector: "div", tasks: [["has-text", "Sponsored"]] }],
      scriptlets: [],
      generic: true,
    });
    expect(engine.stats.procedural).toBe(2);
  });
});

describe("generic filters", () => {
  const engine = build([
    "##.ad-box",
    "###sponsor",
    "##div.promo > a",
    '##a[href^="https://ads.example/"]',
    "##.x, .y",
    "*##.everywhere",
    "b.example#@#.ad-box",
    "~c.example##.not-on-c",
  ]);

  test("the ones without a class or id to find them by go to every page", () => {
    expect(css(engine, "a.example")).toEqual([
      `.everywhere${HIDE}`,
      `a[href^="https://ads.example/"]${HIDE}`,
      `.x, .y${HIDE}`,
    ]);
    expect(engine.stats).toMatchObject({ genericAlways: 2, genericByName: 4 });
  });

  test("the others are given for the classes and ids a page uses", () => {
    expect(engine.genericFor("a.example", ["ad-box", "other"], [])).toBe(
      `.ad-box:not(html):not(body)${HIDE}`,
    );
    expect(engine.genericFor("a.example", ["promo"], ["sponsor", "x"])).toBe(
      `div.promo > a${HIDE}\n#sponsor:not(html):not(body)${HIDE}`,
    );
    expect(engine.genericFor("a.example", ["everywhere"], [])).toBe("");
  });

  test("an exception or a negated hostname lifts one for a site", () => {
    expect(engine.genericFor("www.b.example", ["ad-box"], [])).toBe("");
    expect(engine.genericFor("a.example", ["not-on-c"], [])).not.toBe("");
    expect(engine.genericFor("c.example", ["not-on-c"], [])).toBe("");
  });
});

describe("the cosmetic switches", () => {
  const engine = build([
    "a.example##.specific",
    "##[data-generic]",
    "*##.everywhere",
    "a.example##+js(set-constant, x, true)",
  ]);

  test("generichide keeps the specific filters", () => {
    const document = engine.forDocument("a.example", T_GENERICHIDE);
    expect(document.css).toBe(`.specific${HIDE}`);
    expect(document.generic).toBe(false);
  });

  test("specifichide keeps the generic ones, `*##` included", () => {
    expect(css(engine, "a.example", T_SPECIFICHIDE)).toEqual([
      `.everywhere${HIDE}`,
      `[data-generic]${HIDE}`,
    ]);
  });

  test("elemhide leaves only the scriptlets", () => {
    expect(engine.forDocument("a.example", T_ELEMHIDE)).toEqual({
      css: "",
      procedural: [],
      scriptlets: [{ name: "set-constant", args: ["x", "true"] }],
      generic: false,
    });
  });
});

describe("scriptlets", () => {
  test("a hostname gets its scriptlets under their own names, once each", () => {
    const engine = build([
      "a.example,shop.*##+js(set, ads, false)",
      "a.example##+js(set-constant.js, ads, false)",
      "a.example##+js(aopr, detector)",
      "*##+js(nostif, popup)",
    ]);
    expect(engine.forDocument("www.a.example").scriptlets).toEqual([
      { name: "prevent-setTimeout", args: ["popup"] },
      { name: "set-constant", args: ["ads", "false"] },
      { name: "abort-on-property-read", args: ["detector"] },
    ]);
    expect(engine.forDocument("shop.com").scriptlets).toEqual([
      { name: "prevent-setTimeout", args: ["popup"] },
      { name: "set-constant", args: ["ads", "false"] },
    ]);
    expect(engine.stats.scriptlets).toBe(4);
  });

  test("an exception lifts one call, or all of them", () => {
    const engine = build([
      "a.example,b.example,c.example##+js(aopr, detector)",
      "a.example,b.example,c.example##+js(set, ads, false)",
      // The alias names the same scriptlet.
      "a.example#@#+js(abort-on-property-read, detector)",
      "b.example#@#+js()",
      "#@#+js(set, ads, false)",
    ]);
    expect(engine.forDocument("a.example").scriptlets).toEqual([]);
    expect(engine.forDocument("b.example").scriptlets).toEqual([]);
    expect(engine.forDocument("c.example").scriptlets).toEqual([
      { name: "abort-on-property-read", args: ["detector"] },
    ]);
  });

  test("a negated hostname lifts the call there", () => {
    const engine = build(["a.example,~x.a.example##+js(aopr, detector)"]);
    expect(engine.forDocument("a.example").scriptlets).toHaveLength(1);
    expect(engine.forDocument("x.a.example").scriptlets).toEqual([]);
  });

  test("a trusted scriptlet only runs for a trusted list", () => {
    const lines = ["a.example##+js(trusted-set, x, anything)"];
    const untrusted = build(lines);
    expect(untrusted.forDocument("a.example").scriptlets).toEqual([]);
    expect(untrusted.stats.untrustedScriptlets).toBe(1);
    expect(build(lines, true).forDocument("a.example").scriptlets).toEqual([
      { name: "trusted-set-constant", args: ["x", "anything"] },
    ]);
  });

  test("an unknown scriptlet is counted and left out", () => {
    const engine = build([
      "a.example##+js(no-such-scriptlet, x)",
      "b.example##+js(no-such-scriptlet)",
    ]);
    expect(engine.forDocument("a.example").scriptlets).toEqual([]);
    expect(engine.stats.unknownScriptlets).toEqual({ "no-such-scriptlet": 2 });
  });
});

describe("response headers", () => {
  test("gives the headers to remove from a hostname's documents", () => {
    const engine = build([
      "a.example##^responseheader(refresh)",
      "a.example,b.example##^responseheader(set-cookie)",
      "www.a.example#@#^responseheader(refresh)",
    ]);
    expect(engine.headersToRemove("a.example")).toEqual([
      "refresh",
      "set-cookie",
    ]);
    expect(engine.headersToRemove("www.a.example")).toEqual(["set-cookie"]);
    expect(engine.headersToRemove("c.example")).toEqual([]);
  });
});

describe("the cache", () => {
  test("the same hostname gets the same object until rules are added", () => {
    const engine = build(["a.example##.ad"]);
    const first = engine.forDocument("a.example");
    expect(engine.forDocument("a.example")).toBe(first);
    expect(engine.forDocument("a.example", T_GENERICHIDE)).not.toBe(first);
    engine.add(parseList("a.example##.more"));
    expect(css(engine, "a.example")).toEqual([`.ad${HIDE}`, `.more${HIDE}`]);
  });
});

describe("war: resources", () => {
  test("a scriptlet that names a redirect resource gets its text", () => {
    const engine = build([
      "a.example##+js(no-fetch-if, ads.js, war:noop.json)",
      "a.example##+js(no-xhr-if, ads.js, war:no-such-resource)",
      "a.example##+js(no-fetch-if, pixel, war:1x1.gif)",
    ]);
    expect(engine.forDocument("a.example").scriptlets).toEqual([
      {
        name: "prevent-fetch",
        args: ["ads.js", "war:noop.json"],
        resources: { "noop.json": "{}" },
      },
      { name: "prevent-xhr", args: ["ads.js", "war:no-such-resource"] },
      // Bytes can't be the text of an answer.
      { name: "prevent-fetch", args: ["pixel", "war:1x1.gif"] },
    ]);
  });
});

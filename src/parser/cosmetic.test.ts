import { describe, expect, test } from "vitest";
import { parseScriptletArgs } from "./cosmetic.js";
import { parseLine } from "./index.js";
import { selectorKey } from "./selector.js";
import type { CosmeticRule, ParsedLine, ScriptletRule } from "./types.js";

function parse(line: string, trusted = false): ParsedLine[] {
  const parsed: ParsedLine[] = [];
  parseLine(line, { trusted }, (one) => parsed.push(one));
  return parsed;
}

function cosmetic(line: string): CosmeticRule {
  const [parsed, ...more] = parse(line);
  if (parsed?.kind !== "cosmetic" || more.length > 0) {
    throw new Error(`${line}: ${JSON.stringify([parsed, ...more])}`);
  }
  return parsed;
}

function scriptlet(line: string, trusted = false): ScriptletRule {
  const [parsed] = parse(line, trusted);
  if (parsed?.kind !== "scriptlet") {
    throw new Error(`${line}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function reason(line: string): string {
  const [parsed] = parse(line);
  if (parsed?.kind !== "invalid" && parsed?.kind !== "unsupported") {
    throw new Error(`${line}: ${JSON.stringify(parsed)}`);
  }
  return `${parsed.kind}: ${parsed.reason}`;
}

describe("cosmetic filters", () => {
  test("a generic filter", () => {
    expect(cosmetic("##.ad-box")).toEqual({
      kind: "cosmetic",
      raw: "##.ad-box",
      exception: false,
      hosts: { include: [], exclude: [] },
      key: ".ad-box",
      selector: ".ad-box",
      style: undefined,
      media: undefined,
      procedural: undefined,
    });
  });

  test("hostnames: specific, negated, entity, regex and everywhere", () => {
    expect(
      cosmetic("a.example,~b.a.example,shop.*,/^news\\d{1,2}\\./##.ad").hosts,
    ).toEqual({
      include: ["a.example", "shop.*", "/^news\\d{1,2}\\./"],
      exclude: ["b.a.example"],
    });
    expect(cosmetic("*##.ad").hosts.include).toEqual(["*"]);
    expect(cosmetic("~a.example##.ad").hosts).toEqual({
      include: [],
      exclude: ["a.example"],
    });
  });

  test("an exception", () => {
    expect(cosmetic("a.example#@#.ad-box")).toMatchObject({
      exception: true,
      key: ".ad-box",
    });
    expect(cosmetic("#@#.ad-box").exception).toBe(true);
  });

  test("selectors the browser matches itself stay plain", () => {
    for (const selector of [
      'a[href^="https://ads.example/"]',
      "div:has(> .ad)",
      "li:not(.keep):nth-child(2n+1)",
      ".a, .b > c",
      'a[title="1) (2"]',
      'div:has(a:not([href*="x)"]))',
    ]) {
      expect(cosmetic(`a.example##${selector}`)).toMatchObject({
        selector,
        procedural: undefined,
      });
    }
  });

  test("a broken selector is discarded", () => {
    expect(reason("##div[")).toBe("invalid: selector: unbalanced bracket");
    expect(reason('##a[href="x]')).toBe(
      "invalid: selector: unbalanced bracket",
    );
    expect(reason("##a 'x")).toBe("invalid: selector: unbalanced quote");
    expect(reason("##div:has(.a")).toBe(
      "invalid: selector: unbalanced parenthesis",
    );
    expect(reason("##.a)")).toBe("invalid: selector: unbalanced parenthesis");
    expect(reason("##.a/* x */")).toBe(
      "invalid: selector: comment in a selector",
    );
  });

  test(":style() on a plain selector needs no JavaScript", () => {
    expect(cosmetic("a.example##.bar:style(top: 0 !important)")).toMatchObject({
      selector: ".bar",
      style: "top: 0 !important",
      procedural: undefined,
    });
    // Both parts of a list are restyled.
    expect(cosmetic("a.example##.a, .b:style(margin: 0)")).toMatchObject({
      selector: ".a, .b",
      style: "margin: 0",
    });
  });

  test("AdGuard's CSS rules become :style() and :remove()", () => {
    expect(cosmetic("a.example#$#.bar { top: 0 !important; }")).toMatchObject({
      selector: ".bar",
      style: "top: 0 !important;",
    });
    expect(cosmetic("a.example##.bar {top:0}")).toMatchObject({
      selector: ".bar",
      style: "top:0",
    });
    expect(cosmetic("a.example#$#.bar { remove: true; }").procedural).toEqual({
      selector: ".bar",
      tasks: [],
      action: ["remove", ""],
    });
    expect(reason("a.example#$#abort-on-property-read ads")).toBe(
      "unsupported: Adblock Plus snippet",
    );
    expect(reason("a.example#%#window.ads = 1")).toBe(
      "unsupported: AdGuard JavaScript rule",
    );
  });

  test(":style() refuses what could load or hide something else", () => {
    for (const style of [
      "background: url(https://x.example/a.png)",
      "background: image-set('a.png' 1x)",
      "color: red /* x */",
      "content: '\\41'",
      "background: / /x",
    ]) {
      expect(reason(`a.example##.bar:style(${style})`)).toBe(
        "invalid: selector: forbidden value in :style()",
      );
    }
  });

  test(":matches-media() on a plain selector is a media query", () => {
    expect(
      cosmetic("a.example##.bar:matches-media((min-width: 800px))"),
    ).toMatchObject({
      selector: ".bar",
      media: "(min-width: 800px)",
      procedural: undefined,
    });
    expect(
      cosmetic("a.example##pre:matches-media(print):style(color: red)"),
    ).toMatchObject({ selector: "pre", media: "print", style: "color: red" });
  });

  test("generic procedural and :style() filters are discarded", () => {
    expect(reason("##div:has-text(Sponsored)")).toBe(
      "invalid: generic procedural or :style() filter",
    );
    expect(reason("~a.example##.bar:style(top: 0)")).toBe(
      "invalid: generic procedural or :style() filter",
    );
    // An exception to one is fine.
    expect(cosmetic("#@#div:has-text(Sponsored)").exception).toBe(true);
  });
});

describe("procedural filters", () => {
  const plan = (body: string) => cosmetic(`a.example##${body}`).procedural;

  test(":has-text() with a literal, a quoted literal and a regex", () => {
    expect(plan("div:has-text(Sponsored by)")).toEqual({
      selector: "div",
      tasks: [["has-text", "Sponsored by"]],
    });
    expect(plan('div:has-text("a) b")')).toEqual({
      selector: "div",
      tasks: [["has-text", "a) b"]],
    });
    expect(plan("div:has-text(/^Ad\\b/i)")).toEqual({
      selector: "div",
      tasks: [["has-text", ["^Ad\\b", "i"]]],
    });
    expect(plan('div:has-text("")')?.tasks).toEqual([["has-text", ""]]);
    // A regex may hold a parenthesis of its own.
    expect(plan("div:has-text(/\\(ad\\)/)")?.tasks).toEqual([
      ["has-text", ["\\(ad\\)", ""]],
    ]);
  });

  test("what follows an operator continues from its elements", () => {
    expect(plan("div:has-text(Ad) > span.x:upward(2)")).toEqual({
      selector: "div",
      tasks: [
        ["has-text", "Ad"],
        ["spath", " > span.x"],
        ["upward", 2],
      ],
    });
    expect(plan("div:has-text(Ad).wide")?.tasks).toEqual([
      ["has-text", "Ad"],
      ["spath", ".wide"],
    ]);
  });

  test(":has() and :not() are procedural when their argument is", () => {
    expect(plan("div:has(span:has-text(Ad))")).toEqual({
      selector: "div",
      tasks: [
        [
          "has",
          {
            selector: "",
            tasks: [
              ["spath", " span"],
              ["has-text", "Ad"],
            ],
          },
        ],
      ],
    });
    expect(plan("div:not(:has-text(Keep))")?.tasks).toEqual([
      ["not", { selector: "", tasks: [["has-text", "Keep"]] }],
    ]);
    expect(plan("div:has(> a:has-text(Ad))")?.tasks).toEqual([
      [
        "has",
        {
          selector: "",
          tasks: [
            ["spath", "> a"],
            ["has-text", "Ad"],
          ],
        },
      ],
    ]);
  });

  test("#?# keeps :has() and :not() procedural", () => {
    const rule = cosmetic("a.example#?#div:has(.ad, .promo):not(.keep)");
    expect(rule.procedural).toEqual({
      selector: "div",
      tasks: [
        ["has", { selector: "", tasks: [["spath", " :is(.ad, .promo)"]] }],
        ["not", { selector: "", tasks: [["spath", ".keep"]] }],
      ],
    });
    expect(cosmetic("a.example#@?#div:has(.ad)").exception).toBe(true);
  });

  test("Adblock Plus's and older names", () => {
    expect(plan("div:-abp-contains(Ad)")?.tasks).toEqual([["has-text", "Ad"]]);
    expect(plan("div:-abp-has(a:contains(Ad))")?.tasks[0]?.[0]).toBe("has");
    expect(plan("b:has-text(x):nth-ancestor(3)")?.tasks[1]).toEqual([
      "upward",
      3,
    ]);
  });

  test("the matching operators", () => {
    expect(plan('a:matches-attr("/^data-[a-z]{4}$/"="/ad/i")')?.tasks).toEqual([
      ["matches-attr", { name: ["^data-[a-z]{4}$", ""], value: ["ad", "i"] }],
    ]);
    expect(plan("a:matches-attr(data-ad)")?.tasks).toEqual([
      ["matches-attr", { name: "data-ad" }],
    ]);
    expect(plan('button:matches-attr(class="/[\\w]{7}/")')?.tasks).toEqual([
      ["matches-attr", { name: "class", value: ["[\\w]{7}", ""] }],
    ]);
    expect(plan("div:matches-css(position: fixed)")?.tasks).toEqual([
      ["matches-css", { name: "position", pseudo: "", value: "fixed" }],
    ]);
    expect(
      plan('div:matches-css-before(content: /^"Ad\\(s\\)"/)')?.tasks,
    ).toEqual([
      [
        "matches-css",
        { name: "content", pseudo: "::before", value: ['^"Ad\\(s\\)"', ""] },
      ],
    ]);
    expect(plan("img:matches-prop(naturalWidth=160)")?.tasks).toEqual([
      ["matches-prop", { name: "naturalWidth", value: "160" }],
    ]);
    expect(plan("div:min-text-length(200)")?.tasks).toEqual([
      ["min-text-length", 200],
    ]);
    expect(plan("#main:others()")?.tasks).toEqual([["others", ""]]);
    expect(plan("b:has-text(x):upward(.card)")?.tasks[1]).toEqual([
      "upward",
      ".card",
    ]);
    expect(plan("div:watch-attr(class, id):has-text(x)")?.tasks[0]).toEqual([
      "watch-attr",
      ["class", "id"],
    ]);
  });

  test("a filter can start with an operator", () => {
    expect(plan(":matches-path(/shop/item) p.promo")).toEqual({
      selector: "",
      tasks: [
        ["matches-path", "/shop/item"],
        ["spath", " p.promo"],
      ],
    });
    expect(plan(":matches-path(/^\\/$/) .hero")?.tasks[0]).toEqual([
      "matches-path",
      ["^\\/$", ""],
    ]);
    expect(plan(':xpath(//div[@id="a"]/..)')).toEqual({
      selector: "",
      tasks: [["xpath", '//div[@id="a"]/..']],
    });
  });

  test("the action operators", () => {
    expect(plan(".ad:remove()")).toEqual({
      selector: ".ad",
      tasks: [],
      action: ["remove", ""],
    });
    expect(plan("[onclick]:remove-attr(onclick)")?.action).toEqual([
      "remove-attr",
      "onclick",
    ]);
    expect(plan("html:remove-class(/^no-scroll/)")?.action).toEqual([
      "remove-class",
      "/^no-scroll/",
    ]);
    expect(plan("div:has-text(Ad):style(opacity: 0)")).toEqual({
      selector: "div",
      tasks: [["has-text", "Ad"]],
      action: ["style", "opacity: 0"],
    });
    expect(reason("a.example##.ad:remove():has-text(x)")).toBe(
      "invalid: selector: operator after an action operator",
    );
    expect(reason("a.example##.ad:remove(now)")).toBe(
      "invalid: selector: bad :remove() argument",
    );
  });

  test("a list with procedural parts gives a rule per part", () => {
    const rules = parse("a.example##.x, .y, .z:has-text(Ad)");
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({
      selector: ".x, .y",
      procedural: undefined,
      key: ".x, .y, .z:has-text(Ad)",
    });
    expect(rules[1]).toMatchObject({
      procedural: { selector: ".z", tasks: [["has-text", "Ad"]] },
    });
  });

  test("bad arguments are discarded", () => {
    expect(reason("a.example##div:has-text(/[/)")).toMatch(/has-text/);
    expect(reason("a.example##b:has-text(x):upward(0)")).toMatch(/upward/);
    expect(reason("a.example##div:min-text-length(many)")).toMatch(/min-text/);
    expect(reason("a.example##div:matches-css(fixed)")).toMatch(/matches-css/);
    expect(reason("a.example##div:is(a:has-text(x))")).toBe(
      "invalid: selector: procedural operator inside :is()",
    );
  });
});

describe("scriptlets", () => {
  test("a name and its arguments", () => {
    expect(
      scriptlet("a.example,b.*##+js(set-constant.js, ads.enabled, false)"),
    ).toEqual({
      kind: "scriptlet",
      raw: "a.example,b.*##+js(set-constant.js, ads.enabled, false)",
      exception: false,
      hosts: { include: ["a.example", "b.*"], exclude: [] },
      name: "set-constant",
      args: ["ads.enabled", "false"],
      trusted: false,
    });
    expect(scriptlet("a.example##+js(nowoif)", true)).toMatchObject({
      name: "nowoif",
      args: [],
      trusted: true,
    });
  });

  test("AdGuard's scriptlet syntax", () => {
    expect(
      scriptlet("a.example#%#//scriptlet('set-constant', 'ads.on', 'false')"),
    ).toMatchObject({ name: "set-constant", args: ["ads.on", "false"] });
    expect(scriptlet("a.example#@%#//scriptlet('nowoif')").exception).toBe(
      true,
    );
  });

  test("empty arguments keep their place", () => {
    expect(parseScriptletArgs("nano-sib, , ,0.02")).toEqual([
      "nano-sib",
      "",
      "",
      "0.02",
    ]);
  });

  test("a comma is escaped or quoted", () => {
    expect(parseScriptletArgs("rmnt, script, /a\\,b/")).toEqual([
      "rmnt",
      "script",
      "/a,b/",
    ]);
    expect(
      parseScriptletArgs("spoof-css, 'a[href=\"x\"], .ads', clip-path, none"),
    ).toEqual(["spoof-css", 'a[href="x"], .ads', "clip-path", "none"]);
    expect(parseScriptletArgs('set, x, "a, b"')).toEqual(["set", "x", "a, b"]);
    expect(parseScriptletArgs("set, x, `a, 'b'`")).toEqual([
      "set",
      "x",
      "a, 'b'",
    ]);
    expect(parseScriptletArgs("x, 'it\\'s, fine'")).toEqual([
      "x",
      "it's, fine",
    ]);
    // A quote that doesn't close the argument is only a character.
    expect(parseScriptletArgs('aeld, click, return"x"')).toEqual([
      "aeld",
      "click",
      'return"x"',
    ]);
  });

  test("exceptions, for one scriptlet or all of them", () => {
    expect(scriptlet("a.example#@#+js(nowoif)")).toMatchObject({
      exception: true,
      name: "nowoif",
    });
    expect(scriptlet("a.example#@#+js()")).toMatchObject({
      exception: true,
      name: "",
      args: [],
    });
    expect(scriptlet("#@#+js()").hosts.include).toEqual([]);
  });

  test("a scriptlet needs a name and a hostname", () => {
    expect(reason("a.example##+js()")).toBe(
      "invalid: scriptlet without a name",
    );
    expect(reason("##+js(nowoif)")).toBe("invalid: generic scriptlet");
    expect(scriptlet("*##+js(nowoif)").hosts.include).toEqual(["*"]);
  });
});

describe("HTML filters", () => {
  test("responseheader() removes a response header", () => {
    expect(parse("a.example##^responseheader(Refresh)")).toEqual([
      {
        kind: "responseheader",
        raw: "a.example##^responseheader(Refresh)",
        exception: false,
        hosts: { include: ["a.example"], exclude: [] },
        header: "refresh",
      },
    ]);
    expect(reason("a.example##^responseheader(content-security-policy)")).toBe(
      "invalid: responseheader() of a header that can't be removed",
    );
    expect(reason("##^responseheader(refresh)")).toBe(
      "invalid: generic responseheader()",
    );
  });

  test("removing elements from the response is unsupported", () => {
    expect(reason("a.example##^script:has-text(adblock)")).toMatch(
      /^unsupported: HTML filter/,
    );
  });
});

describe("selectorKey", () => {
  test("gives a class or id the selector can't match without", () => {
    expect(selectorKey(".ad-box")).toBe(".ad-box");
    expect(selectorKey("div#ad_top > a")).toBe("#ad_top");
    expect(selectorKey("ul > li.promo[data-x]")).toBe(".promo");
    expect(selectorKey('a[href*=".ads."] .label')).toBe(".label");
  });

  test("gives nothing when no class or id is required", () => {
    expect(selectorKey('a[href^="https://ads.example/"]')).toBeUndefined();
    expect(selectorKey(".a, .b")).toBeUndefined();
    expect(selectorKey("div:not(.keep)")).toBeUndefined();
    expect(selectorKey(".a\\:b")).toBeUndefined();
    expect(selectorKey("amp-ad")).toBeUndefined();
  });
});

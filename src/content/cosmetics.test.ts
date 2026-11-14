// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseLine } from "../parser/index.js";
import type { ProceduralPlan } from "../parser/types.js";
import { startCosmetics, type CosmeticsHost } from "./cosmetics.js";
import { compileFilter } from "./procedural.js";

/** The plan the parser makes of `example.com##<body>`. */
function plan(body: string): ProceduralPlan {
  let found: ProceduralPlan | undefined;
  parseLine(`a.example##${body}`, { trusted: false }, (parsed) => {
    if (parsed.kind === "cosmetic") found = parsed.procedural;
  });
  if (found === undefined) throw new Error(`not procedural: ${body}`);
  return found;
}

/** The ids of the elements a procedural filter selects. */
function select(body: string): string[] {
  return compileFilter(plan(body))
    .select()
    .map((element) => element.id || element.tagName.toLowerCase());
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("procedural operators", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="card1" class="card"><span class="label">Sponsored</span><a href="/x">Buy</a></div>
      <div id="card2" class="card wide"><span class="label">News</span><p id="p2">Some long text here</p></div>
      <div id="card3" class="card" data-ad-slot="7" style="position: fixed"><b id="b3">Promoted by X</b></div>
      <section id="side"><div id="inner"><i id="deep">x</i></div></section>
    `;
  });

  test(":has-text() with text and with a regular expression", () => {
    expect(select(".card:has-text(Sponsored)")).toEqual(["card1"]);
    expect(select(".card:has-text(/^\\s*(?:news|promoted)/i)")).toEqual([
      "card2",
      "card3",
    ]);
    expect(select('.card:has-text("")')).toHaveLength(3);
  });

  test(":has() and :not() with procedural arguments", () => {
    expect(select(".card:has(span:has-text(News))")).toEqual(["card2"]);
    expect(select(".card:has(> b:has-text(Promoted))")).toEqual(["card3"]);
    expect(select(".card:not(:has-text(Sponsored))")).toEqual([
      "card2",
      "card3",
    ]);
    expect(select(".card:not(.wide:has-text(News))")).toEqual([
      "card1",
      "card3",
    ]);
  });

  test("CSS after an operator continues from what it kept", () => {
    expect(select(".card:has-text(News) > p")).toEqual(["p2"]);
    expect(select(".card:has-text(News) p")).toEqual(["p2"]);
    expect(select(".card:has-text(Sponsored) + .card")).toEqual(["card2"]);
    expect(select(".card:has-text(Sponsored) ~ .card")).toEqual([
      "card2",
      "card3",
    ]);
    expect(select(".card:has-text(e).wide")).toEqual(["card2"]);
    expect(select(".card:has-text(e).wide > p")).toEqual(["p2"]);
  });

  test(":upward() by a count and by a selector", () => {
    expect(select("#deep:has-text(x):upward(2)")).toEqual(["side"]);
    expect(select("#deep:upward(section)")).toEqual(["side"]);
    expect(select("#deep:upward(.card)")).toEqual([]);
    expect(select("b:has-text(Promoted):upward(1)")).toEqual(["card3"]);
  });

  test(":matches-attr(), :matches-css() and :matches-prop()", () => {
    expect(select('div:matches-attr("/^data-ad/"="/^\\d$/")')).toEqual([
      "card3",
    ]);
    expect(select("div:matches-attr(data-ad-slot)")).toEqual(["card3"]);
    expect(select("div:matches-attr(data-ad-slot=8)")).toEqual([]);
    expect(select("div:matches-css(position: fixed)")).toEqual(["card3"]);
    expect(select("div:matches-css(position: /^fix/)")).toEqual(["card3"]);
    expect(select("div:matches-prop(dataset.adSlot=7)")).toEqual(["card3"]);
    expect(select("div:matches-prop(dataset.adSlot)")).toEqual(["card3"]);
    expect(select("a:matches-prop(pathname=/^\\/x/)")).toEqual(["a"]);
  });

  test(":min-text-length()", () => {
    expect(select("p:min-text-length(10)")).toEqual(["p2"]);
    expect(select("p:min-text-length(100)")).toEqual([]);
  });

  test(":others() selects everything outside the elements", () => {
    expect(select("#inner:others()").sort()).toEqual([
      "card1",
      "card2",
      "card3",
      "head",
    ]);
  });

  test(":xpath(), alone and from elements", () => {
    expect(select(':xpath(//div[@id="inner"]/..)')).toEqual(["side"]);
    expect(select("#deep:xpath(../..)")).toEqual(["side"]);
  });

  test(":matches-path() lets a filter through on some pages only", () => {
    history.replaceState(null, "", "/shop/item?id=3");
    expect(select(":matches-path(/shop/) .card.wide")).toEqual(["card2"]);
    expect(select(":matches-path(/^\\/shop\\/item\\?id=\\d$/) #deep")).toEqual([
      "deep",
    ]);
    expect(select(":matches-path(/blog/) .card")).toEqual([]);
  });

  test(":matches-media() follows the media query", () => {
    const matches = vi.fn((query: string) => ({ matches: query === "print" }));
    vi.stubGlobal("matchMedia", matches);
    expect(select(".card:matches-media(print):has-text(News)")).toEqual([
      "card2",
    ]);
    expect(select(".card:matches-media(screen):has-text(News)")).toEqual([]);
  });

  test("a selector the browser refuses selects nothing", () => {
    expect(select(".card:has-text(News) > :no-such-pseudo")).toEqual([]);
    expect(select("b:has-text(Promoted):upward(:no-such-pseudo)")).toEqual([]);
  });
});

describe("startCosmetics", () => {
  let stop: () => void = () => {};
  const inserted: string[] = [];
  const asked: [string[], string[]][] = [];
  const host: CosmeticsHost = {
    insertCSS: (css) => void inserted.push(css),
    generic: async (classes, ids) => {
      asked.push([classes, ids]);
      return classes.includes("ad-box") ? ".ad-box{display:none}" : "";
    },
  };
  const start = (
    filters: string[] = [],
    config: { css?: string; generic?: boolean } = {},
  ) => {
    stop = startCosmetics(
      {
        css: config.css ?? "",
        procedural: filters.map(plan),
        generic: config.generic ?? false,
      },
      host,
    );
  };
  /** The attribute procedural filters mark an element with, if any. */
  const markOf = (id: string) =>
    document
      .getElementById(id)
      ?.getAttributeNames()
      .find((name) => /^x[a-z0-9]+\d$/.test(name));

  afterEach(() => {
    stop();
    inserted.length = 0;
    asked.length = 0;
  });

  test("inserts the document's stylesheet", () => {
    start([], { css: ".ad{display:none!important;}" });
    expect(inserted).toEqual([".ad{display:none!important;}"]);
  });

  test("with nothing to watch, does nothing more", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    start();
    expect(observe).not.toHaveBeenCalled();
  });

  test("hides what a procedural filter selects, now and later", async () => {
    document.body.innerHTML = '<p id="one">Sponsored</p><p id="two">Fine</p>';
    start(["p:has-text(Sponsored)"]);
    const mark = markOf("one");
    expect(mark).toBeDefined();
    expect(markOf("two")).toBeUndefined();
    expect(inserted).toEqual([`[${mark}]{display:none!important;}`]);

    document.body.insertAdjacentHTML(
      "beforeend",
      '<p id="three">Sponsored</p>',
    );
    document.getElementById("one")!.textContent = "Now fine";
    await settle();
    expect(markOf("three")).toBe(mark);
    // What the filter no longer selects is shown again.
    expect(markOf("one")).toBeUndefined();
    expect(inserted).toHaveLength(1);
  });

  test(":style() marks with an attribute of its own", () => {
    document.body.innerHTML = '<p id="one">Sponsored</p><p id="two">Promo</p>';
    start(["p:has-text(Sponsored):style(opacity: 0)", "p:has-text(Promo)"]);
    expect(inserted).toEqual([
      `[${markOf("one")}]{opacity: 0}`,
      `[${markOf("two")}]{display:none!important;}`,
    ]);
    expect(markOf("one")).not.toBe(markOf("two"));
  });

  test(":remove(), :remove-attr() and :remove-class()", async () => {
    document.body.innerHTML = `
      <p id="gone">Sponsored</p>
      <a id="link" onclick="x()" onmouseover="y()" href="/">link</a>
      <div id="box" class="no-scroll no-select keep">box</div>
    `;
    start([
      "p:has-text(Sponsored):remove()",
      "#link:remove-attr(/^on/)",
      "#box:remove-class(no-scroll)",
    ]);
    expect(document.getElementById("gone")).toBeNull();
    expect(document.getElementById("link")?.getAttributeNames().sort()).toEqual(
      ["href", "id"],
    );
    expect(document.getElementById("box")?.className).toBe("no-select keep");

    document.body.insertAdjacentHTML("beforeend", "<p id=late>Sponsored</p>");
    await settle();
    expect(document.getElementById("late")).toBeNull();
  });

  test(":watch-attr() reruns a filter when the attribute changes", async () => {
    document.body.innerHTML = '<div id="player" class="idle">x</div>';
    start([
      '#player:watch-attr(class):matches-attr(class="/\\bad-playing\\b/")',
    ]);
    expect(markOf("player")).toBeUndefined();
    document.getElementById("player")!.className = "ad-playing";
    await settle();
    expect(markOf("player")).toBeDefined();
    document.getElementById("player")!.className = "idle";
    await settle();
    expect(markOf("player")).toBeUndefined();
  });

  test("an attribute change alone doesn't rerun the other filters", async () => {
    document.body.innerHTML = '<div id="player" class="idle">x</div>';
    start(['#player:matches-attr(class="ad-playing")']);
    document.getElementById("player")!.className = "ad-playing";
    await settle();
    expect(markOf("player")).toBeUndefined();
  });

  test("asks for generic filters by the classes and ids the page uses, once", async () => {
    document.body.innerHTML =
      '<div id="top" class="ad-box wide"><span class="wide">x</span></div>';
    start([], { generic: true });
    await settle();
    expect(asked).toEqual([[["ad-box", "wide"], ["top"]]]);
    expect(inserted).toEqual([".ad-box{display:none}"]);

    document.body.insertAdjacentHTML(
      "beforeend",
      '<p id="late" class="wide promo">y</p>',
    );
    document.getElementById("top")!.classList.add("sticky");
    await settle();
    expect([asked[1]?.[0].sort(), asked[1]?.[1]]).toEqual([
      ["promo", "sticky"],
      ["late"],
    ]);
    // Nothing new: nothing asked.
    document.body.insertAdjacentHTML("beforeend", '<p class="promo">z</p>');
    await settle();
    expect(asked).toHaveLength(2);
  });

  test("stops when asked to", async () => {
    document.body.innerHTML = "<p id=one>Fine</p>";
    start(["p:has-text(Sponsored)"]);
    stop();
    document.getElementById("one")!.textContent = "Sponsored";
    await settle();
    expect(markOf("one")).toBeUndefined();
  });
});

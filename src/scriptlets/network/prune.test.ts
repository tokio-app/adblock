import { describe, expect, test } from "vitest";
import { dataUrl, stubFetch, xhr } from "../../../test/helpers/fakes.js";
import { pruner } from "./prune.js";
import { createPage, type TestPage } from "../../../test/helpers/page.js";

function pruned(prune: string, needle: string, data: unknown): unknown {
  pruner(prune, needle)(data);
  return data;
}

describe("the json-prune paths", () => {
  test("chains, [] and * as wildcards", () => {
    expect(pruned("a.b c", "", { a: { b: 1, x: 2 }, c: 3, d: 4 })).toEqual({
      a: { x: 2 },
      d: 4,
    });
    expect(
      pruned("playlist.[].adserver", "", {
        playlist: [{ adserver: 1, id: 1 }, { id: 2 }],
      }),
    ).toEqual({ playlist: [{ id: 1 }, { id: 2 }] });
    expect(
      pruned("playlist.*.adserver", "", {
        playlist: { r1: { adserver: 1 }, r2: { adserver: 2, k: 1 } },
      }),
    ).toEqual({ playlist: { r1: {}, r2: { k: 1 } } });
    expect(pruned("ads.[]", "", { ads: [1, 2, 3] })).toEqual({ ads: [] });
  });

  test("[-] and {-} remove the entries the rest of the path leads into", () => {
    expect(
      pruned("items.[-].advertiserId", "", {
        items: [{ id: 1 }, { advertiserId: 7 }, { id: 3 }],
      }),
    ).toEqual({ items: [{ id: 1 }, { id: 3 }] });
    expect(
      pruned("slots.{-}.ad.url", "", {
        slots: { a: { ad: { url: "x" } }, b: { ad: {} } },
      }),
    ).toEqual({ slots: { b: { ad: {} } } });
  });

  test("needles must all be there, or match the JSON as a regex", () => {
    expect(pruned("x", "a b.c", { x: 1, a: 1, b: { c: 1 } })).toEqual({
      a: 1,
      b: { c: 1 },
    });
    expect(pruned("x", "a b.c", { x: 1, a: 1, b: {} })).toEqual({
      x: 1,
      a: 1,
      b: {},
    });
    expect(
      pruned("x", "list.[].ad", { x: 1, list: [{}, { ad: 1 }] }),
    ).not.toHaveProperty("x");
    expect(pruned("*", "showTrkURL", { showTrkURL: 1, other: 2 })).toEqual({});
    expect(pruned("x", '/"kind":"ad"/', { x: 1, kind: "ad" })).toEqual({
      kind: "ad",
    });
    expect(
      pruned("x", '/"kind":"ad"/', { x: 1, kind: "video" }),
    ).toHaveProperty("x");
  });

  test("leaves what isn't an object", () => {
    expect(pruner("a", "")("text")).toBe(false);
    expect(pruner("a", "")(null)).toBe(false);
  });
});

describe("json-prune", () => {
  test("prunes what JSON.parse and Response.json give", async () => {
    const page = await createPage();
    stubFetch(page.window, () => '{"ads":[1],"content":"ok"}');
    page.inject("json-prune", "ads");
    expect(
      page.run(`JSON.stringify(JSON.parse('{"ads":1,"content":2}'))`),
    ).toBe('{"content":2}');
    await expect(
      page.run("fetch('/x').then((r) => r.json())"),
    ).resolves.toEqual({ content: "ok" });
    // Anything that isn't an object goes through.
    expect(page.run("JSON.parse('[1,2]')")).toEqual([1, 2]);
    expect(page.run("JSON.parse('\"ads\"')")).toBe("ads");
  });

  test("the stack argument, and two filters at once", async () => {
    const page = await createPage();
    page.inject("json-prune", "ads", "", "adLoader");
    page.inject("json-prune", "track");
    page.run(`
      window.adLoader = (text) => JSON.parse(text);
      window.reader = (text) => JSON.parse(text);
    `);
    const text = JSON.stringify({ ads: 1, track: 2, keep: 3 });
    expect(page.run(`adLoader(${JSON.stringify(text)})`)).toEqual({ keep: 3 });
    expect(page.run(`reader(${JSON.stringify(text)})`)).toEqual({
      ads: 1,
      keep: 3,
    });
  });

  test("without paths nothing changes", async () => {
    const page = await createPage();
    const before = page.run("JSON.parse");
    page.inject("json-prune");
    page.inject("json-prune", "", "needle");
    expect(page.run("JSON.parse")).toBe(before);
  });
});

/** Fetches from the page and gives the response's text. */
const fetchText = (page: TestPage, url: string, init = "{}") =>
  page.run(`fetch(${JSON.stringify(url)}, ${init}).then((r) => r.text())`);

describe("json-prune-fetch-response", () => {
  test("prunes the responses whose request matches", async () => {
    const page = await createPage();
    stubFetch(page.window, () => '{"avails":[1],"video":"v"}');
    page.inject(
      "json-prune-fetch-response",
      "avails",
      "",
      "propsToMatch",
      "cdn.example method:GET",
    );
    await expect(fetchText(page, "https://cdn.example/x")).resolves.toBe(
      '{"video":"v"}',
    );
    await expect(
      fetchText(page, "https://cdn.example/x", '{ method: "POST" }'),
    ).resolves.toBe('{"avails":[1],"video":"v"}');
    await expect(fetchText(page, "https://other.example/")).resolves.toBe(
      '{"avails":[1],"video":"v"}',
    );
  });

  test("the response keeps its status, headers and URL, and bad JSON passes", async () => {
    const page = await createPage();
    stubFetch(page.window, (url) =>
      url.includes("bad") ? "not json" : '{"a":1,"b":2}',
    );
    page.inject(
      "json-prune-fetch-response",
      "a",
      "",
      "stackToMatch",
      "!nothingLikeThis",
    );
    const response = page.run(`fetch("https://x.example/ok").then(async (r) =>
      [r.status, r.statusText, r.headers.get("content-type"), r.url, await r.text()])`);
    await expect(response).resolves.toEqual([
      200,
      "OK",
      "text/plain",
      "https://x.example/ok",
      '{"b":2}',
    ]);
    await expect(fetchText(page, "https://x.example/bad")).resolves.toBe(
      "not json",
    );
  });
});

describe("json-prune-xhr-response", () => {
  test("prunes text and json responses whose request matches", async () => {
    const page = await createPage();
    const url = dataUrl(
      '{"data":{"ads":[1],"video":2}}',
      "application/json;api",
    );
    page.inject(
      "json-prune-xhr-response",
      "data.ads",
      "",
      "propsToMatch",
      "api",
    );
    await expect(xhr(page, url)).resolves.toBe('{"data":{"video":2}}');
    await expect(xhr(page, url, "json")).resolves.toEqual({
      data: { video: 2 },
    });
    const other = dataUrl('{"data":{"ads":[1]}}', "application/json");
    await expect(xhr(page, other)).resolves.toBe('{"data":{"ads":[1]}}');
  });
});

describe("evaldata-prune", () => {
  test("prunes JSON given to eval, and lets code run", async () => {
    const page = await createPage();
    page.inject("evaldata-prune", "entity.commercial");
    expect(page.run(`eval('{"entity":{"commercial":1,"id":2}}')`)).toEqual({
      entity: { id: 2 },
    });
    expect(page.run("eval('1 + 1')")).toBe(2);
  });
});

describe("trusted-prune-inbound-object and trusted-prune-outbound-object", () => {
  test("prunes an argument, or a copy of it with dontOverwrite", async () => {
    const page = await createPage();
    page.inject(
      "trusted-prune-inbound-object",
      "JSON.stringify",
      "1",
      "title name",
    );
    page.inject(
      "trusted-prune-inbound-object",
      "Object.keys",
      "1",
      "status",
      "",
      "dontOverwrite",
      "1",
    );
    expect(page.run("JSON.stringify({ title: 1, name: 2, id: 3 })")).toBe(
      '{"id":3}',
    );
    expect(page.run("window.o = { status: 1, id: 2 }; Object.keys(o)")).toEqual(
      ["id"],
    );
    expect(page.run("o.status")).toBe(1);
  });

  test("prunes what a method returns", async () => {
    const page = await createPage();
    page.run("window.api = { config: () => ({ ads: true, id: 1 }) }");
    page.inject("trusted-prune-outbound-object", "api.config", "ads");
    expect(page.run("api.config()")).toEqual({ id: 1 });
  });
});

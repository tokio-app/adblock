import { describe, expect, test } from "vitest";
import { stubFetch } from "../../../test/helpers/fakes.js";
import { createPage } from "../../../test/helpers/page.js";

describe("prevent-fetch", () => {
  test("answers the fetches whose URL matches with an empty body", async () => {
    const page = await createPage();
    const requests = stubFetch(page.window);
    page.inject("no-fetch-if", "ads.example");
    const prevented = page.run(`
      fetch("https://ads.example/x").then(async (r) => [r.status, r.ok, r.statusText, r.url, await r.text()])
    `);
    await expect(prevented).resolves.toEqual([
      200,
      true,
      "OK",
      "https://ads.example/x",
      "",
    ]);
    const passed = page.run(`fetch("/api").then((r) => r.text())`);
    await expect(passed).resolves.toBe("body of https://www.site.example/api");
    expect(requests.map((one) => one.url)).toEqual([
      "https://www.site.example/api",
    ]);
  });

  test("conditions: all must match, name:value for init options, ! inverts the URL", async () => {
    const page = await createPage();
    const requests = stubFetch(page.window);
    page.inject("prevent-fetch", "/track/ method:/POST|HEAD/");
    page.inject("prevent-fetch", "!site.example method:PUT");
    page.run(`
      fetch("https://x.example/track", { method: "POST" });
      fetch("https://x.example/track");
      fetch(new Request("https://x.example/track", { method: "HEAD" }));
      fetch("https://x.example/other", { method: "PUT" });
      fetch("https://www.site.example/other", { method: "PUT" });
    `);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests.map((one) => `${one.method ?? "GET"} ${one.url}`)).toEqual([
      "GET https://x.example/track",
      "PUT https://www.site.example/other",
    ]);
  });

  test("the response body directives", async () => {
    const page = await createPage();
    stubFetch(page.window);
    page.inject("no-fetch-if", "obj", "emptyObj");
    page.inject("no-fetch-if", "arr", "emptyArr");
    page.inject("no-fetch-if", "str", "emptyStr");
    page.inject("no-fetch-if", "rnd", "true");
    page.inject("no-fetch-if", "len", "length:20-30");
    page.inject("no-fetch-if", "war", "war:noop.js");
    page.inject("no-fetch-if", "unknown", "some text");
    const bodies = page.run(`
      Promise.all(["obj", "arr", "str", "rnd", "len", "war", "unknown"].map((one) =>
        fetch("https://x.example/" + one).then((r) => r.text())))
    `);
    const [obj, arr, str, rnd, len, war, unknown] = (await bodies) as string[];
    expect([obj, arr, str, war, unknown]).toEqual(["{}", "[]", "", "", ""]);
    expect(rnd).toMatch(/^[a-z0-9]{10}$/);
    expect(len!.length).toBeGreaterThanOrEqual(20);
    expect(len!.length).toBeLessThanOrEqual(30);
  });

  test("the response type, as a word or JSON", async () => {
    const page = await createPage();
    stubFetch(page.window);
    page.inject("no-fetch-if", "one", "", "opaque");
    page.inject(
      "no-fetch-if",
      "two",
      "",
      '{"type":"cors","ok":false,"statusText":"Not Found"}',
    );
    page.inject(
      "no-fetch-if",
      "three",
      "",
      '{"type":"bogus","statusText":"Teapot"}',
    );
    const read = (url: string) =>
      page.run(`fetch("${url}").then((r) => [r.type, r.ok, r.statusText])`);
    await expect(read("https://x.example/one")).resolves.toEqual([
      "opaque",
      true,
      "OK",
    ]);
    await expect(read("https://x.example/two")).resolves.toEqual([
      "cors",
      false,
      "Not Found",
    ]);
    await expect(read("https://x.example/three")).resolves.toEqual([
      "default",
      true,
      "OK",
    ]);
  });

  test("without arguments nothing changes", async () => {
    const page = await createPage();
    stubFetch(page.window);
    const before = page.run("fetch");
    page.inject("prevent-fetch");
    expect(page.run("fetch")).toBe(before);
  });
});

describe("trusted-prevent-fetch", () => {
  test("an unknown directive is the body", async () => {
    const page = await createPage();
    stubFetch(page.window);
    page.inject("trusted-prevent-fetch", "ads", '{"ads":[]}');
    page.inject("trusted-prevent-fetch", "obj", "emptyObj");
    await expect(
      page.run(`fetch("https://ads.example/").then((r) => r.json())`),
    ).resolves.toEqual({
      ads: [],
    });
    await expect(
      page.run(`fetch("https://obj.example/").then((r) => r.text())`),
    ).resolves.toBe("{}");
  });
});

import { describe, expect, test } from "vitest";
import { dataUrl, stubFetch, xhr } from "../../../test/helpers/fakes.js";
import { createPage } from "../../../test/helpers/page.js";

describe("trusted-replace-fetch-response", () => {
  test("replaces text, a regex or everything, in the responses that match", async () => {
    const page = await createPage();
    stubFetch(page.window, (url) =>
      url.includes("m3u8")
        ? "#EXTM3U\n#EXT-X-VMAP-AD-BREAK x\n#EXTINF:1\nseg.ts"
        : "adb_detect:true adb_detect:true",
    );
    page.inject(
      "trusted-rpfr",
      "adb_detect:true",
      "adb_detect:false",
      "api.example",
    );
    page.inject(
      "trusted-replace-fetch-response",
      "/#EXT-X-VMAP-AD-BREAK[^\\n]*\\n/",
      "",
      "/\\.m3u8/ method:GET",
    );
    page.inject("trusted-replace-fetch-response", "*", "", "wipe.example");
    const text = (url: string) =>
      page.run(`fetch("${url}").then((r) => r.text())`);
    await expect(text("https://api.example/")).resolves.toBe(
      "adb_detect:false adb_detect:false",
    );
    await expect(text("https://cdn.example/a.m3u8")).resolves.toBe(
      "#EXTM3U\n#EXTINF:1\nseg.ts",
    );
    await expect(text("https://wipe.example/")).resolves.toBe("");
    await expect(text("https://other.example/")).resolves.toBe(
      "adb_detect:true adb_detect:true",
    );
  });

  test("includes: only responses whose text matches", async () => {
    const page = await createPage();
    stubFetch(page.window, (url) =>
      url.includes("one") ? "ads here" : "nothing",
    );
    page.inject(
      "trusted-replace-fetch-response",
      "/.*/s",
      "{}",
      "",
      "includes",
      "ads",
    );
    const text = (url: string) =>
      page.run(`fetch("${url}").then((r) => r.text())`);
    await expect(text("https://x.example/one")).resolves.toBe("{}");
    await expect(text("https://x.example/two")).resolves.toBe("nothing");
  });

  test("without a pattern nothing changes", async () => {
    const page = await createPage();
    stubFetch(page.window);
    const before = page.run("fetch");
    page.inject("trusted-replace-fetch-response");
    expect(page.run("fetch")).toBe(before);
  });
});

describe("trusted-replace-xhr-response", () => {
  test("replaces in the responses that match", async () => {
    const page = await createPage();
    page.inject("trusted-replace-xhr-response", "/.*/s", "", "adsbygoogle");
    page.inject(
      "trusted-replace-xhr-response",
      '"ads":true',
      '"ads":false',
      "api",
    );
    await expect(
      xhr(page, dataUrl("code", "text/javascript;adsbygoogle")),
    ).resolves.toBe("");
    await expect(
      xhr(page, dataUrl('{"ads":true}', "application/json;api"), "json"),
    ).resolves.toEqual({
      ads: false,
    });
    await expect(xhr(page, dataUrl("code"))).resolves.toBe("code");
    // A body that isn't text is left alone.
    const binary = await xhr(
      page,
      dataUrl("code", "text/javascript;adsbygoogle"),
      "arraybuffer",
    );
    expect((binary as ArrayBuffer).byteLength).toBe(4);
  });
});

describe("trusted-replace-outbound-text", () => {
  test("replaces in what a method returns, with json: and $1 replacements", async () => {
    const page = await createPage();
    page.inject(
      "trusted-replace-outbound-text",
      "JSON.stringify",
      '/"csrf_token":"[^"]+",/',
    );
    page.inject(
      "trusted-rpot",
      "JSON.stringify",
      '/("adblock":\\{"enabled":)true/',
      "/$1false/",
    );
    page.run("window.api = { name: () => 'ads:on ads:on' }");
    page.inject(
      "trusted-replace-outbound-text",
      "api.name",
      "ads:on",
      'json:"ads:off"',
      "condition",
      "ads",
    );
    expect(
      page.run(
        `JSON.stringify({ csrf_token: "abc", adblock: { enabled: true } })`,
      ),
    ).toBe('{"adblock":{"enabled":false}}');
    expect(page.run("api.name()")).toBe("ads:off ads:off");
  });

  test("condition and base64", async () => {
    const page = await createPage();
    page.run("window.decode = (text) => text");
    page.inject(
      "trusted-replace-outbound-text",
      "decode",
      "ads:true",
      "ads:false",
      "encoding",
      "base64",
    );
    page.inject(
      "trusted-replace-outbound-text",
      "atob",
      "x",
      "y",
      "condition",
      "only-this",
    );
    expect(page.run(`atob(decode(btoa("ads:true")))`)).toBe("ads:false");
    expect(page.run(`decode("not base64!")`)).toBe("not base64!");
    expect(page.run(`atob(btoa("x only-this"))`)).toBe("y only-this");
    expect(page.run(`atob(btoa("x"))`)).toBe("x");
  });

  test("without a pattern nothing changes", async () => {
    const page = await createPage();
    const before = page.run("JSON.stringify");
    page.inject("trusted-replace-outbound-text", "JSON.stringify");
    expect(page.run("JSON.stringify")).toBe(before);
  });
});

describe("trusted-replace-argument", () => {
  test("replaces an argument by position, with a safe constant or json:", async () => {
    const page = await createPage({
      html: "<!doctype html><body><p class=ad-zone>x</p></body>",
    });
    page.inject(
      "trusted-replace-argument",
      "document.querySelector",
      "0",
      'json:"body"',
      "condition",
      ".ad-zone",
    );
    page.inject("trusted-replace-argument", "api.call", "-1", "noopFunc");
    page.run("window.api = { call: (a, b) => [a, typeof b, b && b()] }");
    // api didn't exist yet when the filter ran: nothing is replaced.
    expect(page.run("api.call(1, () => 2)")).toEqual([1, "function", 2]);
    expect(page.run("document.querySelector('.ad-zone').tagName")).toBe("BODY");
    expect(page.run("document.querySelector('p').tagName")).toBe("P");
  });

  test("replaces this with repl:, and constructor arguments", async () => {
    const page = await createPage();
    page.inject(
      "trusted-replace-argument",
      "String.prototype.split",
      "this",
      "repl:/&ads=1/&ads=0/",
      "condition",
      "ads_enabled=true",
    );
    page.run(
      "window.Watcher = class { constructor(callback) { this.callback = callback } }",
    );
    page.inject("trusted-replace-argument", "Watcher", "0", "noopFunc");
    expect(page.run(`"ads_enabled=true&ads=1".split("&")`)).toEqual([
      "ads_enabled=true",
      "ads=0",
    ]);
    expect(page.run(`"a&ads=1".split("&")`)).toEqual(["a", "ads=1"]);
    expect(page.run("new Watcher(() => 5).callback()")).toBeUndefined();
  });

  test("an invalid value or no position changes nothing", async () => {
    const page = await createPage();
    const before = page.run("document.querySelector");
    page.inject("trusted-replace-argument", "document.querySelector");
    page.inject(
      "trusted-replace-argument",
      "document.querySelector",
      "0",
      "alert(1)",
    );
    page.inject(
      "trusted-replace-argument",
      "document.querySelector",
      "0",
      "json:{bad",
    );
    expect(page.run("document.querySelector")).toBe(before);
  });
});

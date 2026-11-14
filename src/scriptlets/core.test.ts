import { describe, expect, test } from "vitest";
import { createPage } from "../../test/helpers/page.js";
import { SCRIPTLETS, findScriptlet } from "./index.js";

describe("the registry", () => {
  test("finds a scriptlet by its name or an alias, with or without .js", () => {
    const scriptlet = findScriptlet("set-constant");
    expect(scriptlet?.name).toBe("set-constant");
    expect(findScriptlet("set")).toBe(scriptlet);
    expect(findScriptlet("set.js")).toBe(scriptlet);
    expect(findScriptlet("set-constant.js")).toBe(scriptlet);
    expect(findScriptlet("no-such-scriptlet")).toBeUndefined();
  });

  test("no name or alias is used twice", () => {
    const names = SCRIPTLETS.flatMap((scriptlet) => [
      scriptlet.name,
      ...(scriptlet.aliases ?? []),
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  test("a trusted scriptlet says so in its name", () => {
    for (const scriptlet of SCRIPTLETS) {
      if (scriptlet.name.startsWith("trusted-")) {
        expect(scriptlet.trusted, scriptlet.name).toBe(true);
      }
    }
  });
});

describe("the runner", () => {
  test("an unknown scriptlet or a failing one doesn't stop the rest", async () => {
    const page = await createPage();
    page.window.eval("Object.defineProperty(window, 'locked', { value: 1 })");
    page.inject("no-such-scriptlet", "x");
    page.inject("set-constant", "locked.inner", "true");
    page.inject("set-constant", "fine", "true");
    expect(page.run("fine")).toBe(true);
  });
});

describe("set-constant", () => {
  test("pins a property the page defines later", async () => {
    const page = await createPage();
    page.inject("set", "adsEnabled", "false");
    page.run("window.adsEnabled = true");
    expect(page.run("adsEnabled")).toBe(false);
  });

  test("sets each of the allowed values", async () => {
    const page = await createPage();
    const values: [string, string][] = [
      ["undefined", "v === undefined"],
      ["null", "v === null"],
      ["true", "v === true"],
      ["false", "v === false"],
      ["''", "v === ''"],
      ["0", "v === 0"],
      ["32767", "v === 32767"],
      ["[]", "Array.isArray(v) && v.length === 0"],
      ["{}", "typeof v === 'object' && Object.keys(v).length === 0"],
      ["noopFunc", "v() === undefined"],
      ["trueFunc", "v() === true"],
      ["falseFunc", "v() === false"],
    ];
    for (const [index, [value, check]] of values.entries()) {
      page.inject("set-constant", `c${index}`, value);
      expect(page.run(`(v => ${check})(window.c${index})`), value).toBe(true);
    }
    page.inject("set-constant", "thrower", "throwFunc");
    expect(() => page.run("thrower()")).toThrow();
  });

  test("ignores a value that isn't allowed", async () => {
    const page = await createPage();
    page.inject("set-constant", "a", "alert(1)");
    page.inject("set-constant", "b", "32768");
    page.inject("set-constant", "c", "-1");
    expect(page.run("'a' in window || 'b' in window || 'c' in window")).toBe(
      false,
    );
  });

  test("follows a chain as the page builds it", async () => {
    const page = await createPage();
    page.inject("set-constant", "app.config.ads", "false");
    page.run("window.app = { config: { ads: true, other: 1 } }");
    expect(page.run("app.config.ads")).toBe(false);
    expect(page.run("app.config.other")).toBe(1);
    // A new object in the chain is pinned too.
    page.run("app.config = { ads: true }");
    expect(page.run("app.config.ads")).toBe(false);
  });

  test("pins a property of an object that already exists", async () => {
    const page = await createPage();
    page.run("window.player = { autoplay: true }");
    page.inject("set-constant", "player.autoplay", "false");
    expect(page.run("player.autoplay")).toBe(false);
  });

  test("leaves a property that holds another kind of value", async () => {
    const page = await createPage();
    page.run("window.count = 5; window.name2 = 'x'");
    page.inject("set-constant", "count", "true");
    page.inject("set-constant", "name2", "undefined");
    expect(page.run("count")).toBe(5);
    expect(page.run("name2")).toBeUndefined();
  });

  test("the page can replace it only with another kind of value", async () => {
    const page = await createPage();
    page.inject("set-constant", "flag", "false");
    page.run("flag = true");
    expect(page.run("flag")).toBe(false);
    page.run("flag = null");
    expect(page.run("flag")).toBe(false);
    page.run("flag = 'text'");
    expect(page.run("flag")).toBe("text");
  });

  test("as: function, callback, resolved and rejected", async () => {
    const page = await createPage();
    page.inject("set-constant", "f", "true", "as", "function");
    page.inject("set-constant", "g", "1", "as", "callback");
    page.inject("set-constant", "p", "{}", "as", "resolved");
    page.inject("set-constant", "r", "false", "as", "rejected");
    expect(page.run("f()")).toBe(true);
    expect(page.run("g()()")).toBe(1);
    await expect(page.run("p")).resolves.toEqual({});
    await expect(page.run("r")).rejects.toBe(false);
  });

  test("runAt waits for the document", async () => {
    const page = await createPage();
    Object.defineProperty(page.window.document, "readyState", {
      configurable: true,
      value: "loading",
    });
    page.inject("set-constant", "late", "true", "runAt", "interactive");
    page.inject("set-constant", "legacy", "true", "3");
    expect(page.run("'late' in window || 'legacy' in window")).toBe(false);
    const reach = (state: string) => {
      Object.defineProperty(page.window.document, "readyState", {
        configurable: true,
        value: state,
      });
      page.window.document.dispatchEvent(
        new page.window.Event("readystatechange"),
      );
    };
    reach("interactive");
    expect(page.run("late")).toBe(true);
    expect(page.run("'legacy' in window")).toBe(false);
    reach("complete");
    expect(page.run("legacy")).toBe(true);
  });
});

describe("trusted-set-constant", () => {
  test("sets text, or JSON in { value } or after json:", async () => {
    const page = await createPage();
    page.inject("trusted-set", "a", "any text");
    page.inject("trusted-set", "b", '{ "value": [1, "two"] }');
    page.inject("trusted-set", "c", 'json:{"url":"about:blank"}');
    page.inject("trusted-set", "d", "{ not json }");
    page.inject("trusted-set-constant", "e", "true");
    expect(page.run("a")).toBe("any text");
    expect(page.run("JSON.stringify(b)")).toBe('[1,"two"]');
    expect(page.run("c.url")).toBe("about:blank");
    expect(page.run("d")).toBe("{ not json }");
    expect(page.run("e")).toBe(true);
  });
});

describe("abort-on-property-read", () => {
  test("throws a ReferenceError when the page reads the property", async () => {
    const page = await createPage();
    page.inject("aopr", "adblockDetector");
    page.run("window.adblockDetector = { run() {} }");
    expect(() => page.run("adblockDetector.run()")).toThrow(
      page.window.ReferenceError,
    );
  });

  test("follows a chain, and leaves the rest of the object alone", async () => {
    const page = await createPage();
    page.inject("abort-on-property-read", "site.ads.show");
    page.run("window.site = { ads: { show() {}, n: 1 }, ok: 2 }");
    expect(page.run("site.ok + site.ads.n")).toBe(3);
    expect(() => page.run("site.ads.show")).toThrow(page.window.ReferenceError);
  });
});

describe("abort-on-property-write", () => {
  test("throws when the page writes the property, not when it reads it", async () => {
    const page = await createPage();
    page.inject("aopw", "popunderConfig");
    expect(page.run("window.popunderConfig")).toBeUndefined();
    expect(() => page.run("window.popunderConfig = {}")).toThrow(
      page.window.ReferenceError,
    );
  });
});

describe("abort-current-script", () => {
  const html =
    "<!doctype html><html><head></head><body><p id=out></p></body></html>";

  test("aborts the inline script whose text matches", async () => {
    const page = await createPage({ html, scripts: true });
    page.inject("acs", "document.getElementById", "adblockNotice");
    page.script(
      "document.getElementById('out').textContent += 'a'; adblockNotice",
    );
    page.script("document.getElementById('out').textContent += 'b';");
    expect(page.window.document.getElementById("out")?.textContent).toBe("b");
  });

  test("with a regex, and without a needle", async () => {
    const page = await createPage({ html, scripts: true });
    page.inject("abort-current-inline-script", "Math.random", "/detect\\w+/");
    page.inject("acis", "trap");
    page.script("window.one = Math.random() < 2; // detectAdblock");
    page.script("window.two = Math.random() < 2;");
    page.script("window.three = 1; window.trap; window.four = 1;");
    expect(page.run("'one' in window")).toBe(false);
    expect(page.run("two")).toBe(true);
    expect(page.run("three")).toBe(1);
    expect(page.run("'four' in window")).toBe(false);
  });

  test("code outside a script element isn't aborted", async () => {
    const page = await createPage({ scripts: true });
    page.inject("acs", "marker");
    expect(page.run("window.marker = 1; marker")).toBe(1);
  });

  test("matches the script a data: URL holds", async () => {
    const page = await createPage({ html, scripts: true });
    page.inject("acs", "token", "", "evilPayload");
    page.script("", {
      src: `data:text/javascript;base64,${btoa("window.token; window.ran = 1; // evilPayload")}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(page.run("'ran' in window")).toBe(false);
  });
});

describe("abort-on-stack-trace", () => {
  test("aborts when the stack matches, and only then", async () => {
    const page = await createPage();
    page.inject("aost", "document.cookie2", "sneakyReader");
    page.run(`
      document.cookie2 = "x";
      window.sneakyReader = () => document.cookie2;
      window.honestReader = () => document.cookie2;
    `);
    expect(page.run("honestReader()")).toBe("x");
    expect(() => page.run("sneakyReader()")).toThrow(
      page.window.ReferenceError,
    );
  });

  test("! aborts when the stack doesn't match", async () => {
    const page = await createPage();
    page.run("window.secret = 1");
    page.inject("abort-on-stack-trace", "secret", "!trustedCaller");
    page.run(`
      window.trustedCaller = () => secret;
      window.other = () => secret;
    `);
    expect(page.run("trustedCaller()")).toBe(1);
    expect(() => page.run("other()")).toThrow(page.window.ReferenceError);
  });
});

describe("prevent-setTimeout and prevent-setInterval", () => {
  test("defuses the calls whose callback and delay match", async () => {
    const page = await createPage();
    page.inject("nostif", "showAd", "500-");
    page.run(`
      window.log = [];
      setTimeout(function showAd() { log.push("ad") }, 1000);
      setTimeout(function showAd() { log.push("quick ad") }, 10);
      setTimeout(function other() { log.push("other") }, 600);
    `);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(page.run("log.sort().join()")).toBe("other,quick ad");
  });

  test("! inverts the needle and the delay", async () => {
    const page = await createPage();
    page.inject("no-setTimeout-if", "!keep", "!20");
    page.run(`
      window.log = [];
      setTimeout(function keep() { log.push("kept by name") }, 5);
      setTimeout(function drop() { log.push("kept by delay") }, 20);
      setTimeout(function drop() { log.push("dropped") }, 5);
    `);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(page.run("log.sort().join()")).toBe("kept by delay,kept by name");
  });

  test("an interval that matches never runs", async () => {
    const page = await createPage();
    page.inject("nosiif", "/adCheck/");
    page.run(`
      window.count = 0;
      window.id = setInterval(function adCheck() { count++ }, 5);
    `);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(page.run("count")).toBe(0);
    // The page still gets an id it can clear.
    expect(page.run("typeof id")).toBe("number");
  });

  test("without arguments nothing changes", async () => {
    const page = await createPage();
    const before = page.run("setTimeout");
    page.inject("prevent-setTimeout");
    expect(page.run("setTimeout")).toBe(before);
  });

  test("the patched function still reads as the browser's", async () => {
    const page = await createPage();
    page.inject("nostif", "x");
    // In a browser that is what the real one reads as too.
    expect(page.run("setTimeout.toString()")).toBe(
      "function () { [native code] }",
    );
  });
});

describe("adjust-setTimeout and adjust-setInterval", () => {
  test("shortens the delay of the calls that match", async () => {
    const page = await createPage();
    page.inject("nano-stb", "countdown", "2000", "0.02");
    page.run(`
      window.log = [];
      setTimeout(function countdown() { log.push("fast") }, 2000);
      setTimeout(function countdown() { log.push("other delay") }, 3000);
      setTimeout(function unrelated() { log.push("other name") }, 2000);
    `);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(page.run("log.join()")).toBe("fast");
  });

  test("defaults: one second, twenty times faster, and * for any delay", async () => {
    const page = await createPage();
    page.inject("nano-sib");
    page.inject("adjust-setTimeout", "", "*");
    page.run(`
      window.ticks = 0;
      setInterval(() => ticks++, 1000);
      setTimeout(() => (window.any = true), 4000);
    `);
    await new Promise((resolve) => setTimeout(resolve, 280));
    expect(page.run("ticks")).toBeGreaterThanOrEqual(3);
    expect(page.run("any")).toBe(true);
  });
});

describe("addEventListener-defuser", () => {
  test("drops the listeners whose type and handler match", async () => {
    const page = await createPage();
    page.inject("aeld", "click", "openPopup");
    page.run(`
      window.log = [];
      document.addEventListener("click", function openPopup() { log.push("popup") });
      document.addEventListener("click", function fine() { log.push("fine") });
      document.addEventListener("keydown", function openPopup() { log.push("key") });
      document.dispatchEvent(new Event("click"));
      document.dispatchEvent(new Event("keydown"));
    `);
    expect(page.run("log.join()")).toBe("fine,key");
  });

  test("a regex type, an empty type, and an object listener", async () => {
    const page = await createPage();
    page.inject("aeld", "/^(?:mousedown|touchstart)$/");
    page.inject("prevent-addEventListener", "", "trackEverything");
    page.run(`
      window.log = [];
      window.addEventListener("mousedown", () => log.push("down"));
      window.addEventListener("scroll", { handleEvent() { trackEverything; log.push("scroll") } });
      window.addEventListener("scroll", () => log.push("fine"));
      window.dispatchEvent(new Event("mousedown"));
      window.dispatchEvent(new Event("scroll"));
    `);
    expect(page.run("log.join()")).toBe("fine");
  });

  test("elements limits it to what a selector, window or document names", async () => {
    const page = await createPage({
      html: "<!doctype html><a class=ad>x</a><a class=ok>y</a>",
    });
    page.inject("aeld", "click", "", "elements", "a.ad");
    page.inject("aeld", "load", "", "elements", "window");
    page.run(`
      window.log = [];
      for (const a of document.querySelectorAll("a")) {
        a.addEventListener("click", () => log.push(a.className));
        a.dispatchEvent(new Event("click"));
      }
      window.addEventListener("load", () => log.push("window load"));
      document.addEventListener("load", () => log.push("document load"));
      window.dispatchEvent(new Event("load"));
      document.dispatchEvent(new Event("load"));
    `);
    expect(page.run("log.join()")).toBe("ok,document load");
  });

  test("without arguments nothing changes", async () => {
    const page = await createPage();
    const before = page.run("EventTarget.prototype.addEventListener");
    page.inject("aeld");
    expect(page.run("EventTarget.prototype.addEventListener")).toBe(before);
  });
});

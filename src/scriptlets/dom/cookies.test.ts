import { describe, expect, test, vi } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

type Page = Awaited<ReturnType<typeof createPage>>;

/** Records what the page writes to `document.cookie`. */
function recordWrites(page: Page): string[] {
  const writes: string[] = [];
  const { Document } = page.window;
  const accessor = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "cookie",
  )!;
  Object.defineProperty(Document.prototype, "cookie", {
    configurable: true,
    get: accessor.get,
    set(text: string) {
      writes.push(text);
      accessor.set!.call(this, text);
    },
  });
  return writes;
}

/** Stands in for the reload, which jsdom can't do. */
function spyReload(page: Page) {
  const go = vi.fn();
  page.window.history.go = go;
  return go;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("remove-cookie", () => {
  test("removes the cookies whose name matches, on every path and domain", async () => {
    const page = await createPage();
    page.run(`
      document.cookie = "ad_id=1; path=/";
      document.cookie = "ad_path=2";
      document.cookie = "ad_parent=3; domain=site.example; path=/";
      document.cookie = "ad_host=4; domain=www.site.example; path=/path";
      document.cookie = "keep=5; path=/";
    `);
    page.inject("remove-cookie", "ad_");
    expect(page.run("document.cookie")).toBe("keep=5");
  });

  test("a regex, no name for all of them, and the alias", async () => {
    const page = await createPage();
    page.run(
      `document.cookie = "a1=1"; document.cookie = "b2=2"; document.cookie = "c=3"`,
    );
    page.inject("cookie-remover", "/^[ab]\\d$/");
    expect(page.run("document.cookie")).toBe("c=3");
    page.inject("remove-cookie");
    expect(page.run("document.cookie")).toBe("");
  });

  test("again on load and before unload", async () => {
    const page = await createPage();
    page.inject("remove-cookie", "late");
    page.run(`document.cookie = "late=1"; document.cookie = "other=1"`);
    page.window.dispatchEvent(new page.window.Event("beforeunload"));
    expect(page.run("document.cookie")).toBe("other=1");
    page.run(`document.cookie = "late=2"`);
    page.window.dispatchEvent(new page.window.Event("load"));
    expect(page.run("document.cookie")).toBe("other=1");
  });

  test("when, scroll: half a second after a scroll", async () => {
    const page = await createPage();
    // Past the load, when it removes them too.
    await wait(50);
    page.inject("remove-cookie", "scrolled", "when", "scroll");
    page.inject("remove-cookie", "typed", "when", "keydown");
    page.run(`document.cookie = "scrolled=1"; document.cookie = "typed=1"`);
    page.window.document.dispatchEvent(
      new page.window.Event("scroll", { bubbles: true }),
    );
    await wait(100);
    expect(page.run("document.cookie")).toBe("scrolled=1; typed=1");
    await wait(500);
    expect(page.run("document.cookie")).toBe("typed=1");
  });

  test("a __Secure- cookie is removed with Secure", async () => {
    const page = await createPage();
    page.run(`document.cookie = "__Secure-ad=1; secure; path=/"`);
    page.inject("remove-cookie", "__Secure-ad");
    expect(page.run("document.cookie")).toBe("");
  });
});

describe("set-cookie", () => {
  test("sets the allowed values, at the root path, for the session", async () => {
    const page = await createPage();
    const writes = recordWrites(page);
    const allowed = ["1", "-32767", "32767", "0", "accept", "OK", "Yes", "n"];
    for (const [index, value] of allowed.entries()) {
      page.inject("set-cookie", `c${index}`, value);
    }
    expect(writes).toEqual(
      allowed.map((value, index) => `c${index}=${value}; path=/`),
    );
  });

  test("ignores a value that isn't allowed", async () => {
    const page = await createPage();
    for (const value of ["32768", "-32768", "1.5", "", "alert(1)", "yess"]) {
      page.inject("set-cookie", "bad", value);
    }
    expect(page.run("document.cookie")).toBe("");
  });

  test("double quotes, no path, a path that isn't allowed, and encoding", async () => {
    const page = await createPage();
    const writes = recordWrites(page);
    page.inject("set-cookie", "quoted", '"accept"');
    page.inject("set-cookie", "nopath", "ok", "none");
    page.inject("set-cookie", "subpath", "ok", "/path");
    page.inject("set-cookie", "my cookie", "1");
    page.inject("set-cookie", "__Host-consent", "true");
    expect(writes).toEqual([
      'quoted="accept"; path=/',
      "nopath=ok",
      "my%20cookie=1; path=/",
      "__Host-consent=true; path=/; secure",
    ]);
  });

  test("dontOverwrite leaves a cookie that exists", async () => {
    const page = await createPage();
    page.run(`document.cookie = "consent=no; path=/"`);
    page.inject("set-cookie", "consent", "yes", "", "dontOverwrite", "1");
    page.inject("set-cookie", "fresh", "yes", "", "dontOverwrite", "1");
    expect(page.run("document.cookie")).toBe("consent=no; fresh=yes");
  });

  test("reload, 1 reloads only when the cookie wasn't set yet", async () => {
    const page = await createPage();
    const reload = spyReload(page);
    page.inject("set-cookie", "consent", "1", "", "reload", "1");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(0);
    // The reloaded page finds it.
    page.inject("set-cookie", "consent", "1", "", "reload", "1");
    expect(reload).toHaveBeenCalledTimes(1);
    // Another value is a change, so the page reloads.
    page.inject("set-cookie", "consent", "0", "", "reload", "1");
    expect(reload).toHaveBeenCalledTimes(2);
    page.inject("set-cookie", "other", "1");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test("set-cookie-reload is set-cookie with reload", async () => {
    const page = await createPage();
    const reload = spyReload(page);
    page.inject("set-cookie-reload", "consent", "accepted");
    page.inject("set-cookie-reload", "consent", "accepted");
    page.inject("set-cookie-reload", "bad", "nope");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(page.run("document.cookie")).toBe("consent=accepted");
  });
});

describe("trusted-set-cookie", () => {
  test("any value, with the date keywords anywhere", async () => {
    const page = await createPage();
    page.inject("trusted-set-cookie", "raw", '{"ok":true}');
    page.inject("trusted-set-cookie", "now", "t$now$");
    page.inject("trusted-set-cookie", "date", "$currentDate$");
    page.inject("trusted-set-cookie", "iso", "$currentISODate$");
    page.inject("trusted-set-cookie", "empty", "");
    const cookies = Object.fromEntries(
      String(page.run("document.cookie"))
        .split("; ")
        .map((pair) => pair.split(/=(.*)/s)),
    );
    expect(cookies.raw).toBe('{"ok":true}');
    expect(Number(cookies.now.slice(1))).toBeGreaterThan(Date.now() - 5000);
    expect(Number.isNaN(Date.parse(cookies.date))).toBe(false);
    expect(cookies.iso).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(cookies.empty).toBe("");
  });

  test("expiry offsets, path and domain", async () => {
    const page = await createPage();
    const writes = recordWrites(page);
    page.inject("trusted-set-cookie", "a", "1", "259200");
    page.inject("trusted-set-cookie", "b", "1", "1year", "none");
    page.inject("trusted-set-cookie", "c", "1", "1day");
    page.inject("trusted-set-cookie", "bad", "1", "soon");
    page.inject("trusted-set-cookie", "bad", "1", "", "/x");
    page.inject(
      "trusted-set-cookie",
      "d",
      "1",
      "",
      "",
      "domain",
      "site.example",
    );
    page.inject(
      "trusted-set-cookie",
      "e",
      "1",
      "",
      "",
      "domain",
      "/site\\..+$/",
    );
    page.inject(
      "trusted-set-cookie",
      "bad",
      "1",
      "",
      "",
      "domain",
      "/nomatch/",
    );
    expect(writes).toEqual([
      "a=1; path=/; max-age=259200",
      "b=1; max-age=31536000",
      "c=1; path=/; max-age=86400",
      "d=1; path=/; domain=site.example",
      "e=1; path=/; domain=site.example",
    ]);
  });

  test("reload and dontOverwrite, and no reload when the cookie doesn't stick", async () => {
    const page = await createPage();
    const reload = spyReload(page);
    page.run(`document.cookie = "kept=old"`);
    page.inject(
      "trusted-set-cookie",
      "kept",
      "new",
      "",
      "",
      "dontOverwrite",
      "1",
    );
    expect(page.run("document.cookie")).toBe("kept=old");
    page.inject("trusted-set-cookie", "x", "1", "", "", "reload", "1");
    expect(reload).toHaveBeenCalledTimes(1);
    // The browser refuses a domain that isn't the page's.
    page.inject(
      "trusted-set-cookie-reload",
      "y",
      "1",
      "",
      "",
      "domain",
      "other.example",
    );
    expect(reload).toHaveBeenCalledTimes(1);
    page.inject("trusted-set-cookie-reload", "z", "1");
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

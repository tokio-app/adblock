import { describe, expect, test } from "vitest";
import { wait } from "../../../test/helpers/fakes.js";
import { createPage, type TestPage } from "../../../test/helpers/page.js";

/** jsdom has no popups: `open` records its calls and returns a marker. */
function stubOpen(page: TestPage) {
  page.run(`
    window.opened = [];
    window.open = function open(...args) { opened.push(args.join(" ")); return { popup: true }; };
  `);
}

describe("prevent-window-open", () => {
  test("without arguments every call is prevented, and gets null", async () => {
    const page = await createPage();
    stubOpen(page);
    page.inject("nowoif");
    expect(page.run("window.open('https://ads.example/')")).toBeNull();
    expect(page.run("opened.length")).toBe(0);
  });

  test("prevents the calls whose arguments match, ! inverts", async () => {
    const page = await createPage();
    stubOpen(page);
    page.inject("no-window-open-if", "/pop(up|under)/");
    page.inject("window.open-defuser", "!site.example");
    expect(page.run("open('https://x.example/popunder')")).toBeNull();
    // The target is matched too: all arguments are joined.
    expect(page.run("open('https://x.example/', 'popup')")).toBeNull();
    expect(page.run("open('https://ads.example/')")).toBeNull();
    expect(page.run("open('https://www.site.example/help').popup")).toBe(true);
    expect(page.run("opened.join()")).toBe("https://www.site.example/help");
  });

  test("a delay gives a decoy window, gone after that many seconds", async () => {
    const page = await createPage();
    stubOpen(page);
    page.inject("prevent-window-open", "ads", "1");
    const decoy = page.run("window.decoy = open('https://ads.example/')");
    expect(decoy).toBeTruthy();
    expect(page.run("decoy === window")).toBe(false);
    expect(page.run("opened.length")).toBe(0);
    expect(page.run("document.querySelectorAll('iframe').length")).toBe(1);
    expect(
      page.run("getComputedStyle(document.querySelector('iframe')).display"),
    ).toBe("none");
    await wait(1050);
    expect(page.run("document.querySelectorAll('iframe').length")).toBe(0);
  });

  test("obj uses an object element as the decoy", async () => {
    const page = await createPage();
    stubOpen(page);
    page.inject("nowoif", "ads", "5", "obj");
    page.run("open('https://ads.example/')");
    expect(page.run("document.querySelectorAll('object').length")).toBe(1);
    expect(page.run("document.querySelectorAll('iframe').length")).toBe(0);
  });

  test("blank opens about:blank in place of the URL", async () => {
    const page = await createPage();
    stubOpen(page);
    page.inject("nowoif", "ads", "", "blank");
    expect(page.run("open('https://ads.example/', '_blank').popup")).toBe(true);
    expect(page.run("opened.join()")).toBe("about:blank _blank");
  });
});

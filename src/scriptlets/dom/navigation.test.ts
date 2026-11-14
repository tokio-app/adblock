import { describe, expect, test, vi } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("prevent-refresh", () => {
  test("stops the meta refresh just after its delay, once loaded", async () => {
    const page = await createPage({
      html: '<!doctype html><head><meta http-equiv="Refresh" content="0.03; url=/ad"></head>',
    });
    // jsdom has no navigation to stop.
    const stop = vi.fn();
    page.window.stop = stop;
    page.inject("prevent-refresh");
    // Not before the load completes.
    expect(page.window.document.readyState).toBe("interactive");
    await wait(60);
    expect(stop).not.toHaveBeenCalled();
    await wait(50);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("a delay of its own, with or without a meta tag; none without either", async () => {
    const page = await createPage();
    const stop = vi.fn();
    page.window.stop = stop;
    page.inject("refresh-defuser", "0.1");
    page.inject("prevent-refresh");
    await wait(100);
    expect(stop).not.toHaveBeenCalled();
    await wait(100);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("disable-newtab-links", () => {
  test("links that open a new tab do nothing, the others work", async () => {
    const page = await createPage({
      html:
        '<!doctype html><body><a id="blank" target="_blank" href="#a"><b>x</b></a>' +
        '<a id="named" target="popup" href="#b">y</a><a id="self" target="_self" href="#c">z</a>' +
        '<a id="plain" href="#d">w</a></body>',
    });
    page.inject("disable-newtab-links");
    page.run(`
      window.clicks = [];
      document.body.addEventListener("click", (event) => clicks.push(event.target.closest("a").id));
    `);
    const click = (selector: string) => {
      const event = new page.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      page.window.document.querySelector(selector)!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(click("#blank b")).toBe(true);
    expect(click("#named")).toBe(true);
    expect(click("#self")).toBe(false);
    expect(click("#plain")).toBe(false);
    expect(page.run("clicks.join()")).toBe("self,plain");
  });
});

describe("window.name-defuser", () => {
  test("clears window.name", async () => {
    const page = await createPage();
    page.run("window.name = 'tracking-id'");
    page.inject("window.name-defuser");
    expect(page.run("window.name")).toBe("");
  });
});

describe("close-window", () => {
  const html = "<!doctype html><html><head></head><body></body></html>";
  const url = "https://dl.site.example/plan/select?popup=noads";

  /** A page with a spy for `window.close`, opened by another page or not. */
  async function open(popup: boolean) {
    const page = await createPage({ html, url });
    page.run("window.closed2 = 0; window.close = () => { window.closed2++ }");
    if (popup) page.run("window.opener = {}");
    return page;
  }

  test("closes a window a page opened, when its address matches", async () => {
    const page = await open(true);
    page.inject("window-close-if", "/plan/select?popup=noads");
    page.inject("close-window", "/^https:\\/\\/dl\\.site\\.example\\//");
    page.inject("close-window");
    expect(page.run("closed2")).toBe(3);
    // Text is looked for in the path and query, a regex in the whole URL.
    page.inject("close-window", "dl.site.example");
    page.inject("close-window", "/^https:\\/\\/www\\./");
    page.inject("close-window", "/other");
    expect(page.run("closed2")).toBe(3);
  });

  test("never closes a window no page opened: it is the host app's", async () => {
    const page = await open(false);
    page.inject("close-window");
    page.inject("window-close-if", "/plan/select");
    expect(page.run("closed2")).toBe(0);
  });
});

import { describe, expect, test, vi } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageWithButtons() {
  const page = await createPage({
    html: '<!doctype html><body><button id="a">a</button><button id="b">b</button></body>',
  });
  page.run(`
    window.clicks = [];
    document.addEventListener("click", (event) => clicks.push(event.target.id));
  `);
  return page;
}

describe("trusted-click-element", () => {
  test("clicks the elements in turn, waiting for them and for the delays", async () => {
    const page = await pageWithButtons();
    page.inject("trusted-click-element", "#a, 50, #late, #b");
    expect(page.run("clicks.join()")).toBe("a");
    await wait(100);
    expect(page.run("clicks.join()")).toBe("a");
    page.run(
      "document.body.insertAdjacentHTML('beforeend', '<button id=late>l</button>')",
    );
    await wait(150);
    expect(page.run("clicks.join()")).toBe("a,late,b");
  });

  test("a delay before it starts, xpath:, and >>> into a shadow root", async () => {
    const page = await pageWithButtons();
    page.run(`
      const host = document.createElement("div");
      host.id = "host";
      host.attachShadow({ mode: "open" }).innerHTML = "<button id=inner>i</button>";
      document.body.append(host);
      host.shadowRoot.addEventListener("click", (event) => clicks.push(event.target.id));
    `);
    page.inject(
      "trusted-click-element",
      "xpath://button[text()='b'], div >>> #inner",
      "",
      "40",
    );
    expect(page.run("clicks.join()")).toBe("");
    await wait(70);
    expect(page.run("clicks.join()")).toBe("b,inner,host");
  });

  test("when-visible: waits until the element has a box", async () => {
    const page = await pageWithButtons();
    // jsdom has no layout: an element is visible once the test says so.
    page.run(
      "HTMLElement.prototype.getClientRects = function () { return this.dataset.shown ? [{}] : [] }",
    );
    page.inject("trusted-click-element", "when-visible:#a");
    await wait(30);
    expect(page.run("clicks.join()")).toBe("");
    page.run("document.querySelector('#a').dataset.shown = '1'");
    await wait(150);
    expect(page.run("clicks.join()")).toBe("a");
  });

  test("cookie and localStorage conditions, ! for none", async () => {
    const page = await pageWithButtons();
    page.run(
      `document.cookie = "cmpconsent=1"; localStorage.setItem("promo", "yes")`,
    );
    page.inject(
      "trusted-click-element",
      "#a",
      "cookie:cmpconsent, localStorage:promo=yes",
    );
    page.inject("trusted-click-element", "#b", "localStorage:promo=no");
    page.inject("trusted-click-element", "#b", "!cookie:/^gpt_ppid[^=]*=/");
    page.inject("trusted-click-element", "#a", "!cookie:cmpconsent");
    page.inject("trusted-click-element", "#a", "nonsense:x");
    expect(page.run("clicks.join()")).toBe("a,b");
  });

  test("gives up after ten seconds, and a bad selector stops it", async () => {
    const page = await pageWithButtons();
    const now = Date.now();
    page.inject("trusted-click-element", "#never, #a");
    page.run(
      "document.body.insertAdjacentHTML('beforeend', '<i id=never></i>')",
    );
    page.inject("trusted-click-element", "[[bad, #b");
    vi.spyOn(page.window.Date, "now").mockReturnValue(now + 11_000);
    await wait(150);
    expect(page.run("clicks.join()")).toBe("");
  });
});

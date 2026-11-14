import { describe, expect, test, vi } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("prevent-dialog", () => {
  test("closes the dialogs, now and when they open, narrowed by a selector", async () => {
    const page = await createPage({
      html:
        '<!doctype html><body><dialog id="cookie" open><p class="cookie-modal"></p></dialog>' +
        '<dialog id="other" open></dialog></body>',
    });
    // jsdom's dialogs have no close().
    page.run(
      "HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }",
    );
    page.inject("prevent-dialog", ":has(.cookie-modal)");
    const cookie = page.window.document.querySelector("#cookie")!;
    const other = page.window.document.querySelector("#other")!;
    expect(cookie.hasAttribute("open")).toBe(false);
    expect(other.hasAttribute("open")).toBe(true);
    cookie.setAttribute("open", "");
    await wait(0);
    expect(cookie.hasAttribute("open")).toBe(false);
    page.inject("prevent-dialog");
    expect(other.hasAttribute("open")).toBe(false);
  });
});

describe("alert-buster", () => {
  test("alert() goes to the console instead", async () => {
    const page = await createPage();
    const info = vi.fn();
    page.window.console.info = info;
    const alert = vi.fn();
    page.window.alert = alert;
    page.inject("alert-buster");
    page.run("alert('Disable your adblocker')");
    expect(alert).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("Disable your adblocker");
  });
});

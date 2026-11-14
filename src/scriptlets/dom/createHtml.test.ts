import { describe, expect, test } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("trusted-create-html", () => {
  test("adds the elements to the parent once the document is interactive", async () => {
    const page = await createPage({
      html: '<!doctype html><body><div id="slot"><p>kept</p></div></body>',
    });
    page.inject(
      "trusted-create-html",
      "#slot",
      '<i class="a">one</i><b>two</b>',
    );
    page.inject("trusted-create-HTML", "html", "<style>.x{}</style>");
    expect(page.window.document.querySelector("#slot")!.innerHTML).toBe(
      '<p>kept</p><i class="a">one</i><b>two</b>',
    );
    expect(
      page.window.document.documentElement.lastElementChild!.outerHTML,
    ).toBe("<style>.x{}</style>");
  });

  test("waits for the document, and removes them after duration ms", async () => {
    const page = await createPage();
    await new Promise((resolve) =>
      page.window.addEventListener("load", resolve),
    );
    Object.defineProperty(page.window.document, "readyState", {
      configurable: true,
      value: "loading",
    });
    page.inject(
      "trusted-create-html",
      "body",
      '<iframe src="about:blank"></iframe>',
      "50",
    );
    page.inject("trusted-create-html", "#missing", "<i></i>");
    page.inject("trusted-create-html", "body", "");
    expect(page.window.document.body.innerHTML).toBe("");
    Object.defineProperty(page.window.document, "readyState", {
      configurable: true,
      value: "interactive",
    });
    page.window.document.dispatchEvent(
      new page.window.Event("readystatechange"),
    );
    expect(page.window.document.body.innerHTML).toBe(
      '<iframe src="about:blank"></iframe>',
    );
    await wait(80);
    expect(page.window.document.body.innerHTML).toBe("");
  });

  test("its scripts don't run", async () => {
    const page = await createPage({ scripts: true });
    page.inject(
      "trusted-create-html",
      "body",
      "<script>window.ran = 1</script>",
    );
    expect(page.run("'ran' in window")).toBe(false);
    expect(page.window.document.body.innerHTML).toBe(
      "<script>window.ran = 1</script>",
    );
  });
});

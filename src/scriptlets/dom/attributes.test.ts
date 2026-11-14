import { describe, expect, test } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

type Page = Awaited<ReturnType<typeof createPage>>;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A page still loading, as scriptlets find it. */
async function loadingPage(html: string): Promise<Page> {
  const page = await createPage({ html });
  // jsdom's own DOMContentLoaded and load come first.
  await new Promise((resolve) => page.window.addEventListener("load", resolve));
  reach(page, "loading");
  return page;
}

function reach(page: Page, state: string): void {
  Object.defineProperty(page.window.document, "readyState", {
    configurable: true,
    value: state,
  });
  page.window.document.dispatchEvent(new page.window.Event("readystatechange"));
}

const body = (page: Page) => page.window.document.body.innerHTML;

describe("remove-attr", () => {
  test("once the document is interactive, from what the selector names", async () => {
    const page = await loadingPage(
      '<!doctype html><body><a class="btn" onclick="x" title="t">a</a><a onclick="y">b</a></body>',
    );
    page.inject("ra", "onclick|title", ".btn");
    expect(body(page)).toContain('onclick="x"');
    reach(page, "interactive");
    expect(body(page)).toBe('<a class="btn">a</a><a onclick="y">b</a>');
  });

  test("without a selector, from every element that has them; and only once", async () => {
    const page = await loadingPage(
      '<!doctype html><body><p oncontextmenu="no" id="p">a</p></body>',
    );
    page.inject("remove-attr", "oncontextmenu|onselectstart");
    reach(page, "interactive");
    expect(body(page)).toBe('<p id="p">a</p>');
    page.window.document.body.insertAdjacentHTML(
      "beforeend",
      '<i onselectstart="no">b</i>',
    );
    await wait(0);
    expect(body(page)).toBe('<p id="p">a</p><i onselectstart="no">b</i>');
  });

  test("stay keeps at it, asap starts now, complete waits for it", async () => {
    const page = await loadingPage("<!doctype html><body></body>");
    page.inject("ra", "data-ad", "", "asap stay");
    page.inject("ra", "data-late", "", "complete");
    page.window.document.body.innerHTML = '<i data-ad="1" data-late="1"></i>';
    await wait(0);
    expect(body(page)).toBe('<i data-late="1"></i>');
    reach(page, "interactive");
    expect(body(page)).toBe('<i data-late="1"></i>');
    reach(page, "complete");
    expect(body(page)).toBe("<i></i>");
    // stay also sees an attribute the page puts back.
    page.window.document.querySelector("i")!.setAttribute("data-ad", "2");
    await wait(0);
    expect(body(page)).toBe("<i></i>");
  });

  test("nothing without attributes, and a bad selector is ignored", async () => {
    const page = await createPage({
      html: '<!doctype html><body><i title="t"></i></body>',
    });
    page.inject("ra", "");
    page.inject("ra", "title", "[[bad");
    expect(body(page)).toBe('<i title="t"></i>');
  });
});

describe("remove-class", () => {
  test("from what the selector names, or from what has the classes", async () => {
    const page = await createPage({
      html: '<!doctype html><html class="cookie-open locked"><body><i class="ad x"></i><b class="ad"></b></body></html>',
    });
    page.inject("rc", "cookie-open|locked", "html");
    page.inject("remove-class", "ad", "i");
    expect(page.window.document.documentElement.className).toBe("");
    expect(body(page)).toBe('<i class="x"></i><b class="ad"></b>');
  });

  test("stay sees the class come back", async () => {
    const page = await loadingPage(
      '<!doctype html><body><div class="modal-open">x</div></body>',
    );
    page.inject("rc", "modal-open", "", "stay");
    reach(page, "interactive");
    const div = page.window.document.querySelector("div")!;
    expect(div.className).toBe("");
    div.className = "modal-open other";
    await wait(10);
    expect(div.className).toBe("other");
  });
});

describe("set-attr", () => {
  test("sets the allowed values, now and on elements added later", async () => {
    const page = await createPage({
      html: "<!doctype html><body><i></i></body>",
    });
    const values = ["", "''", "true", "false", "0", "32767"];
    for (const [index, value] of values.entries()) {
      page.inject("set-attr", "i", `a${index}`, value);
    }
    const expected = ["", "", "true", "false", "0", "32767"];
    const check = (element: Element) => {
      for (const [index, value] of expected.entries()) {
        expect(element.getAttribute(`a${index}`)).toBe(value);
      }
    };
    check(page.window.document.querySelector("i")!);
    page.window.document.body.insertAdjacentHTML("beforeend", "<p><i></i></p>");
    await wait(0);
    check(page.window.document.querySelector("p i")!);
  });

  test("ignores a value that isn't allowed, and event handlers", async () => {
    const page = await createPage({
      html: "<!doctype html><body><i></i></body>",
    });
    for (const value of ["32768", "-1", "yes", "TRUE", "1.5", "javascript:x"]) {
      page.inject("set-attr", "i", "data-x", value);
    }
    page.inject("set-attr", "i", "onclick", "true");
    page.inject("set-attr", "", "data-y", "1");
    expect(body(page)).toBe("<i></i>");
  });

  test("[other] copies another attribute, and follows it", async () => {
    const page = await createPage({
      html: '<!doctype html><body><img data-src="real.png" src="blank.gif"><img src="keep.gif"></body>',
    });
    page.inject("set-attr", "img", "src", "[data-src]");
    const [lazy, plain] = page.window.document.querySelectorAll("img");
    expect(lazy!.getAttribute("src")).toBe("real.png");
    expect(plain!.getAttribute("src")).toBe("keep.gif");
    lazy!.setAttribute("data-src", "next.png");
    await wait(0);
    expect(lazy!.getAttribute("src")).toBe("next.png");
  });

  test("the page can't put a value back", async () => {
    const page = await createPage({
      html: '<!doctype html><body><video autoplay="1"></video></body>',
    });
    page.inject("set-attr", "video", "autoplay", "false");
    const video = page.window.document.querySelector("video")!;
    video.setAttribute("autoplay", "1");
    await wait(10);
    expect(video.getAttribute("autoplay")).toBe("false");
  });
});

describe("trusted-set-attr", () => {
  test("sets any value, an event handler included", async () => {
    const page = await createPage({
      html: "<!doctype html><body><b></b></body>",
    });
    page.inject("trusted-set-attr", "body", "class", "some-class");
    page.inject("trusted-set-attr", "b", "test-attribute", "[true, true]");
    page.inject("trusted-set-attr", "b", "onclick", "void 0");
    page.inject("trusted-set-attr", "b", "empty");
    const b = page.window.document.querySelector("b")!;
    expect(page.window.document.body.className).toBe("some-class");
    expect(b.getAttribute("test-attribute")).toBe("[true, true]");
    expect(b.getAttribute("onclick")).toBe("void 0");
    expect(b.getAttribute("empty")).toBe("");
  });
});

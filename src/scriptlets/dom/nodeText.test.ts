import { describe, expect, test } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

type Page = Awaited<ReturnType<typeof createPage>>;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A page still loading, as scriptlets find it. */
async function loadingPage(): Promise<Page> {
  const page = await createPage();
  // jsdom's own DOMContentLoaded and load come first.
  await new Promise((resolve) => page.window.addEventListener("load", resolve));
  Object.defineProperty(page.window.document, "readyState", {
    configurable: true,
    value: "loading",
  });
  return page;
}

function domContentLoaded(page: Page): void {
  Object.defineProperty(page.window.document, "readyState", {
    configurable: true,
    value: "interactive",
  });
  page.window.document.dispatchEvent(new page.window.Event("DOMContentLoaded"));
}

/** Adds an element to the body, as the parser would, and lets the observers run. */
async function add(page: Page, html: string): Promise<void> {
  page.window.document.body.insertAdjacentHTML("beforeend", html);
  await wait(0);
}

const body = (page: Page) => page.window.document.body.innerHTML;

describe("remove-node-text", () => {
  test("empties the nodes whose text matches, as the document gets them", async () => {
    const page = await loadingPage();
    page.inject("rmnt", "script", "adblockDetected");
    await add(
      page,
      "<script>if (adblockDetected) nag()</script><script>app()</script>",
    );
    expect(body(page)).toBe("<script></script><script>app()</script>");
  });

  test("#text nodes, deep in what is added, and a regex", async () => {
    const page = await loadingPage();
    page.inject("remove-node-text", "#text", "/^Advert/");
    await add(page, "<div><p>Advertisement</p><p>Article</p></div>");
    expect(body(page)).toBe("<div><p></p><p>Article</p></div>");
  });

  test("a script's text added after the script", async () => {
    const page = await loadingPage();
    page.inject("rmnt", "script", "nag");
    const script = page.window.document.createElement("script");
    page.window.document.body.append(script);
    await wait(0);
    script.append("nag()");
    await wait(0);
    expect(script.textContent).toBe("");
  });

  test("what is already in the document", async () => {
    const page = await createPage({
      html: "<!doctype html><body><b>promo</b><b>news</b></body>",
    });
    page.inject("rmnt", "#text", "promo");
    expect(body(page)).toBe("<b></b><b>news</b>");
  });

  test("includes (or condition) and excludes", async () => {
    const page = await loadingPage();
    page.inject("rmnt", "#text", "ad", "includes", "banner");
    page.inject(
      "rmnt",
      "#text",
      "ad",
      "condition",
      "popup",
      "excludes",
      "keep",
    );
    await add(
      page,
      "<i>ad banner</i><i>ad</i><i>ad popup</i><i>ad popup keep</i>",
    );
    expect(body(page)).toBe("<i></i><i>ad</i><i></i><i>ad popup keep</i>");
  });

  test("quits at DOMContentLoaded, or quitAfter ms after it", async () => {
    const page = await loadingPage();
    page.inject("rmnt", "#text", "early");
    page.inject("rmnt", "#text", "later", "quitAfter", "50");
    domContentLoaded(page);
    await add(page, "<i>early</i><i>later</i>");
    expect(body(page)).toBe("<i>early</i><i></i>");
    await wait(80);
    await add(page, "<i>later</i>");
    expect(body(page)).toBe("<i>early</i><i></i><i>later</i>");
  });

  test("stay, 1 keeps at it; sedCount stops after so many", async () => {
    const page = await loadingPage();
    page.inject("rmnt", "#text", "forever", "stay", "1");
    page.inject("rmnt", "#text", "twice", "sedCount", "2", "stay", "1");
    domContentLoaded(page);
    await add(page, "<i>twice</i><i>twice</i><i>twice</i><i>forever</i>");
    await wait(20);
    await add(page, "<i>forever</i>");
    expect(body(page)).toBe("<i></i><i></i><i>twice</i><i></i><i></i>");
  });

  test("a page already loaded is only scanned once", async () => {
    const page = await createPage();
    page.inject("rmnt", "#text", "late");
    await add(page, "<i>late</i>");
    expect(body(page)).toBe("<i>late</i>");
  });
});

describe("trusted-replace-node-text", () => {
  test("replaces the text that matches, with every alias", async () => {
    const page = await loadingPage();
    page.inject("trusted-replace-node-text", "script", "detect()", "0");
    page.inject("trusted-rpnt", "#text", "/(\\d+) seconds/", "$1 s");
    page.inject("replace-node-text", "#text", "Sponsored", "");
    page.inject("rpnt", "#text", "/x/g", "y");
    await add(
      page,
      "<script>detect(); detect()</script><i>10 seconds</i><b>Sponsored post</b><u>xax</u>",
    );
    expect(body(page)).toBe(
      "<script>0; detect()</script><i>10 s</i><b> post</b><u>yay</u>",
    );
  });

  test("tokens, and nothing without a pattern", async () => {
    const page = await loadingPage();
    page.inject(
      "rpnt",
      "#text",
      "Example",
      "Changed",
      "includes",
      "Domain",
      "stay",
      "1",
    );
    page.inject("rpnt", "#text", "", "gone");
    domContentLoaded(page);
    await add(page, "<i>Example Domain</i><i>Example</i>");
    expect(body(page)).toBe("<i>Changed Domain</i><i>Example</i>");
  });

  test("a replacement that still matches doesn't loop", async () => {
    const page = await loadingPage();
    page.inject("rpnt", "script", "a", "aa");
    await add(page, "<script>a</script>");
    await wait(20);
    expect(body(page)).toBe("<script>aa</script>");
  });
});

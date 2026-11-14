import { describe, expect, test } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The hrefs after the scriptlet ran on these links. */
async function sanitize(links: string, ...args: string[]): Promise<string[]> {
  const page = await createPage({
    html: `<!doctype html><body>${links}</body>`,
  });
  page.inject("href-sanitizer", ...args);
  return [...page.window.document.querySelectorAll("[href]")].map((link) =>
    link.getAttribute("href")!,
  );
}

const encoded = encodeURIComponent;

describe("href-sanitizer", () => {
  test("uses the link's text, when it is an http(s) URL", async () => {
    expect(
      await sanitize(
        '<a href="/out?id=1">https://real.example/page</a>' +
          '<a href="/out?id=2"> http://plain.example/ </a>' +
          '<a href="/out?id=3">Click here</a>' +
          '<a href="/out?id=4">javascript:alert(1)</a>' +
          '<a href="/other">https://real.example/</a>',
        'a[href^="/out"]',
      ),
    ).toEqual([
      "https://real.example/page",
      "http://plain.example/",
      "/out?id=3",
      "/out?id=4",
      "/other",
    ]);
  });

  test("[name] uses an attribute", async () => {
    expect(
      await sanitize(
        '<a href="/go?to=x" title="https://real.example/">x</a><a href="/go" title="no url">y</a>',
        "a[title]",
        "[title]",
      ),
    ).toEqual(["https://real.example/", "/go"]);
  });

  test("?name uses a parameter of the href, and unwraps it again with ?a?b or ?a ?b", async () => {
    const inner = `https://middle.example/r?u=${encoded("https://real.example/x?y=1")}`;
    expect(
      await sanitize(
        `<a href="/away.php?to=${encoded("https://real.example/")}">a</a>` +
          `<a href="/away.php?r=${encoded(inner)}">b</a>` +
          `<a href="/away.php?other=1">c</a>`,
        "a",
        "?to",
      ),
    ).toEqual([
      "https://real.example/",
      `/away.php?r=${encoded(inner)}`,
      "/away.php?other=1",
    ]);
    for (const source of ["?r?u", "?r ?u"]) {
      expect(
        await sanitize(
          `<a href="/away.php?r=${encoded(inner)}">b</a>`,
          "a",
          source,
        ),
      ).toEqual(["https://real.example/x?y=1"]);
    }
  });

  test("the urlskip steps", async () => {
    const base64 = btoa("https://real.example/file.html");
    const safe = base64.replaceAll("+", "-").replaceAll("/", "_");
    const cases: [string, string, string][] = [
      [
        `/r?url=${encoded(base64)}`,
        "?url -base64",
        "https://real.example/file.html",
      ],
      [`/r?url=${safe}`, "?url -safebase64", "https://real.example/file.html"],
      ["/r?aff=real.example/p", "?aff +https", "https://real.example/p"],
      ["/r?u=http://real.example/", "?u +https", "https://real.example/"],
      [
        `/jump.php?${encoded("https://x.example/u")}`,
        "&1",
        "https://x.example/u",
      ],
      ["/r#https://real.example/h", "#", "https://real.example/h"],
      [
        `/CL0/${encoded("www.real.example/p")}%3Fq`,
        "/CL0\\/(.+?)%3F/ -uricomponent +https",
        "https://www.real.example/p",
      ],
      ["/r?url=bm90IGEgdXJs", "?url -base64", "/r?url=bm90IGEgdXJs"],
      ["/r?url=x", "?url ?missing", "/r?url=x"],
      ["/r?url=x", "-unknown", "/r?url=x"],
    ];
    for (const [href, steps, result] of cases) {
      expect(
        await sanitize(`<a href="${href}">t</a>`, "a", steps),
        steps,
      ).toEqual([result]);
    }
  });

  test("only links that have an href", async () => {
    expect(
      await sanitize(
        '<area href="/x" title="https://real.example/"><a title="https://real.example/">t</a>',
        "[title]",
        "[title]",
      ),
    ).toEqual(["/x"]);
  });

  test("links the page adds later, and two filters", async () => {
    const page = await createPage();
    page.inject("href-sanitizer", "a.one", "?u");
    page.inject("href-sanitizer", "a.two", "[data-url]");
    page.window.document.body.innerHTML =
      `<a class="one" href="/t?u=${encoded("https://one.example/")}">1</a>` +
      '<a class="two" href="/t" data-url="https://two.example/">2</a>' +
      `<a class="three" href="/t?u=${encoded("https://three.example/")}">3</a>`;
    await wait(0);
    expect(
      [...page.window.document.querySelectorAll("a")].map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual([
      "https://one.example/",
      "https://two.example/",
      `/t?u=${encoded("https://three.example/")}`,
    ]);
  });
});

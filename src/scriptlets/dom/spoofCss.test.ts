import { describe, expect, test } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

describe("spoof-css", () => {
  test("getComputedStyle reads the spoofed values, dashed or camel-cased", async () => {
    const page = await createPage({
      html: '<!doctype html><body><div class="ad" style="display: none"></div><div class="ok" style="display: none"></div></body>',
    });
    page.inject(
      "spoof-css",
      ".ad, .banner",
      "display",
      "block",
      "clip-path",
      "none",
    );
    page.run(`
      window.ad = getComputedStyle(document.querySelector(".ad"));
      window.ok = getComputedStyle(document.querySelector(".ok"));
    `);
    expect(page.run("ad.display")).toBe("block");
    expect(page.run("ad.getPropertyValue('display')")).toBe("block");
    expect(page.run("ad.clipPath")).toBe("none");
    expect(page.run("ad['clip-path']")).toBe("none");
    expect(page.run("ad.getPropertyValue('clip-path')")).toBe("none");
    // The rest is the real declaration.
    expect(page.run("ad.visibility")).toBe("visible");
    expect(page.run("ad instanceof CSSStyleDeclaration")).toBe(true);
    expect(page.run("ok.display")).toBe("none");
  });

  test("getBoundingClientRect: _rect* first, then width and height", async () => {
    const page = await createPage({
      html: '<!doctype html><body><i class="ad"></i><b class="ad2"></b><u></u></body>',
    });
    page.inject(
      "spoof-css",
      ".ad",
      "_rectx",
      "5",
      "_recty",
      "6",
      "_rectw",
      "300",
      "width",
      "1px",
      "height",
      "250px",
    );
    page.inject("spoof-css", ".ad2", "width", "40px");
    const rect = (selector: string) =>
      page.run(
        `(r => [r.x, r.y, r.width, r.height].join())(document.querySelector("${selector}").getBoundingClientRect())`,
      );
    expect(rect(".ad")).toBe("5,6,300,250");
    expect(rect(".ad2")).toBe("0,0,40,0");
    expect(rect("u")).toBe("0,0,0,0");
  });

  test("nothing without properties", async () => {
    const page = await createPage();
    const before = page.run("getComputedStyle");
    page.inject("spoof-css", ".ad");
    expect(page.run("getComputedStyle")).toBe(before);
  });
});

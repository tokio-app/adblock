import { describe, expect, test } from "vitest";
import { createPage, type TestPage } from "../../../test/helpers/page.js";

/** `page.run` goes through the page's eval: keep the browser's one to test with. */
function runner(page: TestPage): (code: string) => unknown {
  const evaluate = page.window.eval;
  return (code) => evaluate(code);
}

describe("noeval and noeval-silent", () => {
  test("eval runs nothing", async () => {
    const page = await createPage();
    const run = runner(page);
    page.inject("noeval");
    expect(run("eval('window.ran = 1; 2')")).toBeUndefined();
    expect(run("'ran' in window")).toBe(false);
    expect(run("typeof eval")).toBe("function");
  });

  test("noeval-silent does the same", async () => {
    const page = await createPage();
    const run = runner(page);
    page.inject("noeval-silent");
    expect(run("eval('3')")).toBeUndefined();
  });
});

describe("noeval-if", () => {
  test("only the payloads that match are dropped, the rest run", async () => {
    const page = await createPage();
    const run = runner(page);
    page.inject("noeval-if", "adblock");
    page.inject("prevent-eval-if", "/pop(up|under)/");
    expect(run("eval('window.a = 1; \"adblock\"')")).toBeUndefined();
    expect(run("eval('window.b = 1; \"popunder\"')")).toBeUndefined();
    expect(run("eval('window.c = 1; 4')")).toBe(4);
    expect(run("[typeof a, typeof b, c]")).toEqual([
      "undefined",
      "undefined",
      1,
    ]);
  });

  test("without a needle nothing changes", async () => {
    const page = await createPage();
    const before = page.window.eval;
    page.inject("noeval-if");
    expect(page.window.eval).toBe(before);
  });
});

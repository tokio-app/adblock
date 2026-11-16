import { describe, expect, test } from "vitest";
import { evaluateCondition, includesOf, preprocess } from "./preprocessor.js";

describe("evaluateCondition", () => {
  test("knows what an Electron host is", () => {
    expect(evaluateCondition("ext_ublock")).toBe(true);
    expect(evaluateCondition("env_chromium")).toBe(true);
    expect(evaluateCondition("env_firefox")).toBe(false);
    expect(evaluateCondition("env_mobile")).toBe(false);
    expect(evaluateCondition("env_mv3")).toBe(false);
    expect(evaluateCondition("ext_ubol")).toBe(false);
    expect(evaluateCondition("cap_html_filtering")).toBe(false);
    expect(evaluateCondition("cap_user_stylesheet")).toBe(true);
    expect(evaluateCondition("false")).toBe(false);
    expect(evaluateCondition("adguard")).toBe(false);
    expect(evaluateCondition("adguard_ext_chromium")).toBe(true);
  });

  test("negation, &&, || and parentheses", () => {
    expect(evaluateCondition("!env_firefox")).toBe(true);
    expect(evaluateCondition("!!env_firefox")).toBe(false);
    expect(evaluateCondition("ext_ublock && !env_mobile")).toBe(true);
    expect(evaluateCondition("(ext_ublock && env_mobile)")).toBe(false);
    expect(evaluateCondition("(ext_ublock || adguard)")).toBe(true);
    expect(evaluateCondition("env_firefox || env_safari")).toBe(false);
    expect(evaluateCondition("env_firefox || ext_ublock && env_chromium")).toBe(
      true,
    );
    expect(evaluateCondition("!(env_firefox || env_safari)")).toBe(true);
  });

  test("an unknown name or a broken condition is false", () => {
    expect(evaluateCondition("cap_something_new")).toBe(false);
    expect(evaluateCondition("!cap_something_new")).toBe(true);
    expect(evaluateCondition("")).toBe(false);
    expect(evaluateCondition("ext_ublock &&")).toBe(false);
    expect(evaluateCondition("(ext_ublock")).toBe(false);
    expect(evaluateCondition("ext_ublock env_chromium")).toBe(false);
    expect(evaluateCondition("ext_ublock & env_chromium")).toBe(false);
  });
});

describe("preprocess", () => {
  test("keeps the block whose condition holds", () => {
    expect(
      preprocess(
        [
          "a",
          "!#if env_firefox",
          "firefox only",
          "!#endif",
          "!#if env_chromium",
          "chromium only",
          "!#endif",
          "b",
        ].join("\n"),
      ),
    ).toEqual(["a", "chromium only", "b"]);
  });

  test("!#else takes the other branch", () => {
    const text = [
      "!#if cap_html_filtering",
      "a.example##^script:has-text(x)",
      "!#else",
      "a.example##+js(rmnt, script, x)",
      "!#endif",
    ].join("\r\n");
    expect(preprocess(text)).toEqual(["a.example##+js(rmnt, script, x)"]);
    expect(
      preprocess(text, { environment: { cap_html_filtering: true } }),
    ).toEqual(["a.example##^script:has-text(x)"]);
  });

  test("blocks nest", () => {
    const text = [
      "!#if env_chromium",
      "1",
      "!#if env_mobile",
      "2",
      "!#else",
      "3",
      "!#endif",
      "4",
      "!#else",
      "5",
      "!#if ext_ublock",
      "6",
      "!#endif",
      "!#endif",
      "7",
    ].join("\n");
    expect(preprocess(text)).toEqual(["1", "3", "4", "7"]);
  });

  test("a stray !#endif or !#else and unknown directives are dropped", () => {
    expect(preprocess("!#endif\na\n!#else\nb\n!#frob x\nc")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("!#include puts the sub-list where the directive was", () => {
    const included: Record<string, string> = {
      "more.txt": "m1\n!#if env_firefox\nm2\n!#endif\n!#include deep/er.txt",
      "deep/er.txt": "d1",
    };
    expect(
      preprocess("a\n!#include more.txt\nb", {
        include: (path) => included[path],
      }),
    ).toEqual(["a", "m1", "d1", "b"]);
    // Not available: the directive is dropped.
    expect(preprocess("a\n!#include more.txt\nb")).toEqual(["a", "b"]);
  });

  test("a sub-list must be in the list's own folder", () => {
    const asked: string[] = [];
    preprocess(
      [
        "!#include ../up.txt",
        "!#include /root.txt",
        "!#include https://x.example/y.txt",
        "!#include sub/../../up.txt",
        "!#include ok/fine.txt",
      ].join("\n"),
      {
        include: (path) => {
          asked.push(path);
          return undefined;
        },
      },
    );
    expect(asked).toEqual(["ok/fine.txt"]);
  });

  test("a sub-list that includes itself stops", () => {
    expect(
      preprocess("!#include loop.txt", {
        include: () => "x\n!#include loop.txt",
      }),
    ).toEqual(["x", "x", "x", "x"]);
  });
});

describe("includesOf", () => {
  test("lists the sub-lists of live blocks, once each", () => {
    expect(
      includesOf(
        [
          "!#include a.txt",
          "!#if env_mobile",
          "!#include mobile.txt",
          "!#endif",
          "!#include b.txt",
          "!#include a.txt",
        ].join("\n"),
      ),
    ).toEqual(["a.txt", "b.txt"]);
  });
});

describe("preprocess, line by line", () => {
  test("cuts lines where a split at \n or \r\n would", () => {
    const text = "a\r\nb\n\nc\r\n";
    expect(preprocess(text)).toEqual(text.split(/\r?\n/));
    // A \r that no \n follows stays in its line.
    expect(preprocess("a\rb\r")).toEqual(["a\rb\r"]);
    expect(preprocess("")).toEqual([""]);
  });

  test("a directive starts its line", () => {
    expect(
      preprocess("x !#if false\nkept\n!#if false\ndropped\n!#endif"),
    ).toEqual(["x !#if false", "kept"]);
  });
});

describe("includesOf, directives only", () => {
  test("reads only the lines a directive starts, live ones", () => {
    expect(
      includesOf(
        "! not !#include a.txt\n!#if false\n!#include b.txt\n!#endif\r\n" +
          "!#include c.txt\r\n||x.example^ !#include d.txt",
      ),
    ).toEqual(["c.txt"]);
    expect(includesOf("!#include first.txt\n||a.example^")).toEqual([
      "first.txt",
    ]);
  });
});

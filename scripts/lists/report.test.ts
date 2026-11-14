import { expect, test } from "vitest";
import { parseList } from "../../src/parser/index.js";
import { formatReport, mergeReasons } from "./report.js";

const reports = [
  {
    id: "first",
    stats: parseList(
      "||a.example^\n@@||a.example/x\n##.ad\na.example##^script\n||b.example^$frob",
    ).stats,
  },
  {
    id: "second-list",
    stats: parseList("a.example##+js(nowoif)\nb.example##^script\n! note")
      .stats,
  },
];

test("mergeReasons adds the lists' reasons together", () => {
  expect(mergeReasons(reports, "unsupported")).toEqual([
    ["HTML filter (Electron can't rewrite response bodies)", 2],
  ]);
  expect(mergeReasons(reports, "invalid")).toEqual([
    ["unknown option: frob", 1],
  ]);
});

test("formatReport prints a row per list, a total and the reasons", () => {
  expect(formatReport(reports).split("\n")).toEqual([
    "list         lines  network  exceptions  cosmetic  exceptions  procedural  scriptlets  exceptions  headers  unsupported  invalid",
    "first            5        1           1         1           0           0           0           0        0            1        1",
    "second-list      3        0           0         0           0           0           1           0        0            1        0",
    "total            8        1           1         1           0           0           1           0        0            2        1",
    "",
    "Unsupported: valid syntax the library can't apply",
    "       2  HTML filter (Electron can't rewrite response bodies)",
    "",
    "Invalid: malformed, or discarded as uBlock Origin documents",
    "       1  unknown option: frob",
  ]);
});

test("formatReport says when nothing was left out", () => {
  const clean = [{ id: "clean", stats: parseList("||a.example^").stats }];
  expect(formatReport(clean)).toContain(
    "Unsupported: valid syntax the library can't apply\n  none",
  );
});

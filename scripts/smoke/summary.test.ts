import { describe, expect, test } from "vitest";
import { failures, formatSummary, type SmokeReport } from "./summary.js";

const good: SmokeReport = {
  url: "https://site.example/",
  seconds: 15,
  electron: "45.0.0",
  loaded: true,
  finalUrl: "https://site.example/",
  listsReadyMs: 900,
  lists: { one: 10, two: 20 },
  counts: {
    blocked: 12,
    redirected: 3,
    rewritten: 1,
    responses: 2,
    documents: 2,
    scriptlets: 5,
  },
  requests: {
    total: 140,
    cancelled: 9,
    redirectedLoaded: ["noop.js", "noop.js", "1x1.gif"],
    redirectedFailed: [],
    otherErrors: {},
  },
  document: {
    cssRules: 600,
    procedural: 1,
    generic: true,
    scriptlets: ["set-constant", "set-constant", "json-prune"],
  },
  page: {
    title: "Site",
    readyState: "complete",
    google_ad_status: 1,
    elementsMatched: 4,
    elementsHidden: 4,
    consoleErrors: ["x"],
    preloadErrors: [],
  },
  blockerErrors: [],
};

describe("failures", () => {
  test("a run where everything worked has none", () => {
    expect(failures(good)).toEqual([]);
  });

  test("names each thing that went wrong", () => {
    expect(
      failures({
        ...good,
        loaded: false,
        failure: "timed out",
        lists: {},
        counts: { ...good.counts!, documents: 0 },
        requests: { ...good.requests!, redirectedFailed: ["noop.js"] },
        page: { ...good.page!, preloadErrors: ["preload.cjs: boom"] },
        blockerErrors: ["Couldn't download x"],
      }),
    ).toEqual([
      "timed out",
      "the page didn't load",
      "no list was loaded",
      "no document asked the blocker what it gets",
      "the preload failed: preload.cjs: boom",
      "a redirect resource didn't load: noop.js",
      "the blocker reported: Couldn't download x",
    ]);
  });

  test("a report cut short fails", () => {
    expect(
      failures({ url: "u", seconds: 1, electron: "45", loaded: false }),
    ).toEqual([
      "the page didn't load",
      "no list was loaded",
      "no document asked the blocker what it gets",
    ]);
  });
});

describe("formatSummary", () => {
  test("prints the numbers and the verdict", () => {
    expect(formatSummary(good).split("\n")).toEqual([
      "https://site.example/ in Electron 45.0.0, 15 s",
      "lists      2 loaded in 900 ms",
      "requests   140 seen: 12 blocked (3 of them redirected), 1 rewritten, 2 responses changed or blocked",
      "redirects  loaded: noop.js ×2, 1x1.gif ×1; failed: none",
      "scriptlets 5 given to 2 documents; the page's: set-constant ×2, json-prune ×1",
      "cosmetics  600 selectors and 1 procedural filters for the page; 4 of the 4 elements they match are hidden",
      'page       "Site" (complete), 1 console errors, google_ad_status 1',
      "PASSED",
    ]);
  });

  test("lists why a run failed", () => {
    const summary = formatSummary({ ...good, blockerErrors: ["boom"] });
    expect(summary).toContain("FAILED\n  the blocker reported: boom");
  });
});

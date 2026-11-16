import { describe, expect, test } from "vitest";
import { parseList } from "./index.js";
import { parseNetworkFilter } from "./network.js";
import { P_HOST, T_DOCUMENT, T_NETWORK } from "./types.js";

describe("parseList", () => {
  test("sorts the lines of a list into typed rules and counts them", () => {
    const list = parseList(
      [
        "[Adblock Plus 2.0]",
        "! Title: A hand-written list",
        "",
        "||ads.example^",
        "@@||ads.example/ok.js$script",
        "##.ad-box",
        "a.example#@#.ad-box",
        "a.example##div:has-text(Sponsored)",
        "a.example##+js(nowoif)",
        "a.example#@#+js(nowoif)",
        "a.example##^responseheader(refresh)",
        "a.example##^script:has-text(ads)",
        "||ads.example^$frobnicate",
      ].join("\r\n"),
    );
    expect(list.stats).toEqual({
      lines: 13,
      comments: 3,
      network: 1,
      networkExceptions: 1,
      cosmetic: 2,
      cosmeticExceptions: 1,
      procedural: 1,
      scriptlets: 1,
      scriptletExceptions: 1,
      responseHeaders: 1,
      unsupported: {
        "HTML filter (Electron can't rewrite response bodies)": 1,
      },
      invalid: { "unknown option: frobnicate": 1 },
    });
    expect(list.network).toHaveLength(2);
    expect(list.cosmetic).toHaveLength(3);
    expect(list.scriptlets).toHaveLength(2);
    expect(list.responseHeaders).toHaveLength(1);
  });

  test("comments: !, a header, and # that isn't a cosmetic filter", () => {
    const list = parseList(
      ["! comment", "# comment", "#", "#comment", "[uBlock Origin]"].join("\n"),
    );
    expect(list.stats.comments).toBe(5);
    expect(list.stats.lines).toBe(5);
  });

  test("hosts file lines give a host rule per hostname", () => {
    const list = parseList(
      [
        "127.0.0.1 localhost",
        "::1 ip6-localhost ip6-loopback",
        "0.0.0.0 ads.example",
        "127.0.0.1 a.ads.example b.ads.example # two on a line",
        "0.0.0.0 Tracker.Example",
      ].join("\n"),
    );
    expect(list.network.map((rule) => rule.pattern)).toEqual([
      "ads.example",
      "a.ads.example",
      "b.ads.example",
      "tracker.example",
    ]);
    expect(list.network[0]).toMatchObject({
      patternKind: P_HOST,
      flags: 0,
      types: T_NETWORK | T_DOCUMENT,
    });
    // The local names are comments, not rules.
    expect(list.stats.comments).toBe(3);
  });

  test("a line whose prefix isn't hostnames is a network filter", () => {
    const list = parseList("||a.example/page##anchor\n/path#$#x");
    expect(list.network.map((rule) => rule.pattern)).toEqual([
      "a.example/page##anchor",
      "/path#$#x",
    ]);
  });

  test("a trusted list keeps what an untrusted one loses", () => {
    const text =
      "||a.example/out?$urlskip=?url\na.example##+js(trusted-set, x, 1)";
    expect(parseList(text).network).toHaveLength(0);
    expect(parseList(text, { trusted: true }).network).toHaveLength(1);
    expect(parseList(text).scriptlets[0]?.trusted).toBe(false);
    expect(parseList(text, { trusted: true }).scriptlets[0]?.trusted).toBe(
      true,
    );
  });
});

describe("plain hostname filters", () => {
  test("parse as the whole parser parses them", () => {
    for (const line of [
      "||ads.example^",
      "@@||cdn.ads.example^",
      "||a-b_c.long-hostname.example^",
      // These take the whole parser: a capital, an option, a path, no dot.
      "||Ads.example^",
      "||ads.example^$script",
      "||ads.example/x^",
      "||localhost^",
    ]) {
      expect(parseList(line).network).toEqual([
        parseNetworkFilter(line, { trusted: false }),
      ]);
    }
  });
});

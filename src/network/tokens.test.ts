import { describe, expect, test } from "vitest";
import { parseNetworkFilter } from "../parser/network.js";
import { ruleTokens, urlTokens } from "./tokens.js";

function tokens(line: string): string[] {
  const rule = parseNetworkFilter(line, { trusted: false });
  if (rule.kind !== "network") throw new Error(`${line}: ${rule.reason}`);
  return ruleTokens(rule);
}

describe("urlTokens", () => {
  test("splits a URL into runs of letters, digits and %", () => {
    expect(
      urlTokens("https://cdn.example.com/ad-unit_1/x%20y.js?a=b&c"),
    ).toEqual([
      "https",
      "cdn",
      "example",
      "com",
      "ad",
      "unit",
      "1",
      "x%20y",
      "js",
      "a",
      "b",
      "c",
    ]);
    expect(urlTokens("")).toEqual([]);
  });

  test("a token cut by the length limit isn't one", () => {
    const long = `https://a.example/${"x".repeat(5000)}`;
    expect(urlTokens(long)).toEqual(["https", "a", "example"]);
  });
});

describe("ruleTokens", () => {
  test("takes the runs a matching URL must hold whole", () => {
    expect(tokens("/banner/ads.")).toEqual(["banner", "ads"]);
    expect(tokens("-advert-")).toEqual(["advert"]);
    expect(tokens("||cdn.example/ads/*.js^")).toEqual([
      "cdn",
      "example",
      "ads",
      "js",
    ]);
  });

  test("leaves out a run that could be part of a longer token", () => {
    // Nothing bounds the ends of an unanchored pattern.
    expect(tokens("adserver")).toEqual([]);
    expect(tokens("ads/banner")).toEqual([]);
    expect(tokens("/ads*banner/")).toEqual([]);
    expect(tokens("/x/ads*/banner/y")).toEqual(["x", "banner"]);
  });

  test("an anchor bounds the run next to it", () => {
    expect(tokens("|https://ads.")).toEqual(["https", "ads"]);
    expect(tokens("/track.gif|")).toEqual(["track", "gif"]);
    expect(tokens("||ads")).toEqual([]);
    expect(tokens("||ads-")).toEqual(["ads"]);
  });

  test("a host rule and a rule for every URL have none", () => {
    expect(tokens("||example.com^")).toEqual([]);
    expect(tokens("*$script,domain=a.example")).toEqual([]);
  });

  test("a regular expression gives its certain literal runs", () => {
    expect(tokens("/^https?:\\/\\/[a-z]+-tracker\\.example\\//")).toEqual([
      "tracker",
      "example",
    ]);
    expect(tokens("/\\/ads\\/banner-\\d+\\.gif$/")).toEqual([
      "ads",
      "banner",
      "gif",
    ]);
    expect(tokens("/\\.Example\\//")).toEqual(["example"]);
  });

  test("a regular expression gives nothing when nothing is certain", () => {
    // An alternation: either side may be absent.
    expect(tokens("/\\/ads\\/|\\/promo\\//")).toEqual([]);
    // Optional, repeated or wildcard neighbours.
    expect(tokens("/\\/ads?\\//")).toEqual([]);
    expect(tokens("/\\/banner\\.?gif\\//")).toEqual([]);
    expect(tokens("/x.ads.y/")).toEqual([]);
    expect(tokens("/\\wads\\//")).toEqual([]);
    // Inside a group or a class.
    expect(tokens("/\\/(ads)\\/[xyz]\\//")).toEqual([]);
  });
});

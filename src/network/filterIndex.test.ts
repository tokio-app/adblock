import { describe, expect, test } from "vitest";
import { parseNetworkFilter } from "../parser/network.js";
import type { NetworkRule } from "../parser/types.js";
import { PublicSuffixList } from "../psl/psl.js";
import { FilterIndex } from "./filterIndex.js";
import { Request, type RequestType } from "./request.js";

const psl = new PublicSuffixList("example");

function index(...lines: string[]): FilterIndex {
  const filed = new FilterIndex();
  for (const line of lines) {
    const rule = parseNetworkFilter(line, { trusted: true });
    if (rule.kind !== "network") throw new Error(`${line}: ${rule.reason}`);
    filed.add(rule);
  }
  filed.finalize();
  return filed;
}

function matches(
  filed: FilterIndex,
  url: string,
  type: RequestType = "script",
): string[] {
  const found: NetworkRule[] = [];
  filed.forEachMatch(
    new Request({ url, type, sourceUrl: "https://www.site.example/" }, psl),
    (rule) => {
      found.push(rule);
    },
  );
  return found.map((rule) => rule.raw).sort();
}

describe("packed paths", () => {
  test("every pattern the URL starts with is found, among many", () => {
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) {
      lines.push(`||files.example/user${i}/repo/bad${i}.exe^`);
    }
    lines.push(
      "||files.example/user7^",
      "||files.example/user7/repo/",
      "||files.example/user7/repo/bad7.exe",
      "||files.example/user77",
      "||files.example/zzz^",
    );
    const filed = index(...lines);
    expect(filed.size).toBe(2005);
    expect(matches(filed, "https://files.example/user7/repo/bad7.exe")).toEqual(
      [
        "||files.example/user7/repo/",
        "||files.example/user7/repo/bad7.exe",
        "||files.example/user7/repo/bad7.exe^",
        "||files.example/user7^",
      ],
    );
    expect(
      matches(filed, "https://files.example/user1999/repo/bad1999.exe"),
    ).toEqual(["||files.example/user1999/repo/bad1999.exe^"]);
    expect(matches(filed, "https://files.example/user777/x")).toEqual([
      "||files.example/user77",
    ]);
    expect(matches(filed, "https://files.example/")).toEqual([]);
    expect(matches(filed, "https://files.example/aaa")).toEqual([]);
    expect(matches(filed, "https://files.example/zzzz")).toEqual([]);
    expect(matches(filed, "https://other.example/user7/repo/")).toEqual([]);
  });

  test("^ wants a separator or the end, and | the end", () => {
    const filed = index(
      "||cdn.example/ad^",
      "||cdn.example/end.js|",
      "||cdn.example:8443/x",
    );
    expect(matches(filed, "https://cdn.example/ad")).toHaveLength(1);
    expect(matches(filed, "https://cdn.example/ad?x=1")).toHaveLength(1);
    expect(matches(filed, "https://cdn.example/ad/x")).toHaveLength(1);
    expect(matches(filed, "https://cdn.example/ads")).toEqual([]);
    expect(matches(filed, "https://cdn.example/ad-1")).toEqual([]);
    expect(matches(filed, "https://cdn.example/end.js")).toHaveLength(1);
    expect(matches(filed, "https://cdn.example/end.js?x")).toEqual([]);
    // A port is part of the URL the pattern is compared with.
    expect(matches(filed, "https://cdn.example:8443/x/y")).toHaveLength(1);
    expect(matches(filed, "https://cdn.example:8443/ad")).toEqual([]);
    expect(matches(filed, "https://cdn.example/x/y")).toEqual([]);
  });

  test("a subdomain's request finds its parents' patterns", () => {
    const filed = index("||cdn.example/ads/", "||a.cdn.example/ads/x");
    expect(matches(filed, "https://a.cdn.example/ads/x.js")).toEqual([
      "||a.cdn.example/ads/x",
      "||cdn.example/ads/",
    ]);
    expect(matches(filed, "https://user@b.cdn.example/ads/x.js")).toEqual([
      "||cdn.example/ads/",
    ]);
  });

  test("the same pattern twice keeps both sets of options", () => {
    const filed = index(
      "||cdn.example/lib.js$script",
      "||cdn.example/lib.js$image,third-party",
      "@@||cdn.example/lib.js$xhr",
      "||cdn.example/lib.js$script",
    );
    expect(matches(filed, "https://cdn.example/lib.js", "script")).toEqual([
      "||cdn.example/lib.js",
      "||cdn.example/lib.js",
    ]);
    expect(matches(filed, "https://cdn.example/lib.js", "image")).toEqual([
      "||cdn.example/lib.js",
    ]);
    expect(matches(filed, "https://cdn.example/lib.js", "xhr")).toEqual([
      "@@||cdn.example/lib.js",
    ]);
    expect(matches(filed, "https://cdn.example/lib.js", "font")).toEqual([]);
  });
});

describe("crowded hostnames", () => {
  test("many patterns with options under one hostname are filed by token", () => {
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) {
      lines.push(
        `||sdk.example/v${i}/player.js$script,domain=site${i}.example`,
      );
    }
    lines.push("||sdk.example^$image,domain=www.site.example");
    const filed = index(...lines);
    expect(filed.describe()).toContain("1 hosts (most 1)");
    expect(
      matches(filed, "https://sdk.example/v0/player.js", "script"),
    ).toEqual([]);
    expect(matches(filed, "https://sdk.example/x.png", "image")).toEqual([
      "||sdk.example^$image,domain=www.site.example",
    ]);
    const found: string[] = [];
    filed.forEachMatch(
      new Request(
        {
          url: "https://sdk.example/v9/player.js",
          type: "script",
          sourceUrl: "https://site9.example/",
        },
        psl,
      ),
      (rule) => {
        found.push(rule.raw);
      },
    );
    expect(found).toEqual([
      "||sdk.example/v9/player.js$script,domain=site9.example",
    ]);
  });
});

describe("visiting", () => {
  test("stops when the visitor says so", () => {
    const filed = index("||a.example^", "||a.example/x", "/x/y.");
    let visits = 0;
    filed.forEachMatch(
      new Request({ url: "https://a.example/x/y.js", type: "script" }, psl),
      () => {
        visits++;
        return true;
      },
    );
    expect(visits).toBe(1);
  });
});

import { describe, expect, test } from "vitest";
import { splitCosmetic } from "./cosmetic.js";
import { NO_HOSTS, parseHostList } from "./hosts.js";

describe("parseHostList", () => {
  test("splits included and excluded hostnames", () => {
    expect(parseHostList("a.example|~b.example|C.example", "|")).toEqual({
      include: ["a.example", "c.example"],
      exclude: ["b.example"],
    });
  });

  test("a side without hostnames shares one frozen empty list", () => {
    const list = parseHostList("a.example", "|")!;
    expect(list.exclude).toHaveLength(0);
    expect(Object.isFrozen(list.exclude)).toBe(true);
    expect(parseHostList("~a.example", "|")!.include).toBe(list.exclude);
    expect(splitCosmetic("##.ad")?.hosts).toBe(NO_HOSTS);
  });
});

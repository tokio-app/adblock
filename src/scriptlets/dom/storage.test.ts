import { describe, expect, test } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

describe("set-local-storage-item and set-session-storage-item", () => {
  test("sets the allowed values", async () => {
    const page = await createPage();
    const values: [string, string][] = [
      ["1", "1"],
      ["-32767", "-32767"],
      ["32767", "32767"],
      ["''", ""],
      ['""', '""'],
      ["undefined", "undefined"],
      ["null", "null"],
      ["true", "true"],
      ["off", "off"],
      ["accepted", "accepted"],
      ["denied", "denied"],
      ["dismissed", "dismissed"],
      ["{}", "{}"],
      ["[]", "[]"],
      ['"accept"', '"accept"'],
      // set-cookie's constants come in any case.
      ["Yes", "Yes"],
    ];
    for (const [index, [value]] of values.entries()) {
      page.inject("set-local-storage-item", `k${index}`, value);
    }
    for (const [index, [, stored]] of values.entries()) {
      expect(page.window.localStorage.getItem(`k${index}`), stored).toBe(
        stored,
      );
    }
  });

  test("ignores a value that isn't allowed", async () => {
    const page = await createPage();
    for (const value of [
      "32768",
      "-32768",
      "1.5",
      "",
      "Undefined",
      "x",
      "{a:1}",
    ]) {
      page.inject("set-local-storage-item", "bad", value);
    }
    page.inject("set-local-storage-item", "", "1");
    expect(page.window.localStorage.length).toBe(0);
  });

  test("$remove$ removes the item, and leaves the others", async () => {
    const page = await createPage();
    page.window.localStorage.setItem("ad", "1");
    page.window.localStorage.setItem("keep", "1");
    page.window.sessionStorage.setItem("ad", "1");
    page.inject("set-local-storage-item", "ad", "$remove$");
    expect(page.window.localStorage.getItem("ad")).toBeNull();
    expect(page.window.localStorage.getItem("keep")).toBe("1");
    expect(page.window.sessionStorage.getItem("ad")).toBe("1");
    page.inject("set-session-storage-item", "ad", "$remove$");
    expect(page.window.sessionStorage.getItem("ad")).toBeNull();
  });

  test("session storage, and two items", async () => {
    const page = await createPage();
    page.inject("set-session-storage-item", "muted", "false");
    page.inject("set-session-storage-item", "popup", "0");
    expect(page.window.sessionStorage.getItem("muted")).toBe("false");
    expect(page.window.sessionStorage.getItem("popup")).toBe("0");
    expect(page.window.localStorage.length).toBe(0);
  });

  test("a full storage doesn't reach the page", async () => {
    const page = await createPage();
    page.run(
      `Storage.prototype.setItem = () => { throw new DOMException("full", "QuotaExceededError") }`,
    );
    expect(() => page.inject("set-local-storage-item", "a", "1")).not.toThrow();
  });
});

describe("trusted-set-local-storage-item and trusted-set-session-storage-item", () => {
  test("any value, with the date keywords anywhere", async () => {
    const page = await createPage();
    page.inject("trusted-set-local-storage-item", "json", '{"a":3,"b":false}');
    page.inject("trusted-set-local-storage-item", "now", "$now$");
    page.inject("trusted-set-local-storage-item", "at", "at $currentISODate$");
    page.inject("trusted-set-local-storage-item", "date", "$currentDate$");
    page.inject("trusted-set-local-storage-item", "empty", "''");
    page.inject("trusted-set-session-storage-item", "rate", "1.4");
    const local = page.window.localStorage;
    expect(local.getItem("json")).toBe('{"a":3,"b":false}');
    expect(Number(local.getItem("now"))).toBeGreaterThan(Date.now() - 5000);
    expect(local.getItem("at")).toMatch(/^at \d{4}-\d\d-\d\dT[\d:.]+Z$/);
    expect(Number.isNaN(Date.parse(local.getItem("date")!))).toBe(false);
    expect(local.getItem("empty")).toBe("");
    expect(page.window.sessionStorage.getItem("rate")).toBe("1.4");
  });

  test("$remove$ too", async () => {
    const page = await createPage();
    page.window.localStorage.setItem("ad", "1");
    page.inject("trusted-set-local-storage-item", "ad", "$remove$");
    expect(page.window.localStorage.getItem("ad")).toBeNull();
  });
});

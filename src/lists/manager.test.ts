import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { fetchStub } from "../../test/helpers/fetchStub.js";
import { DEFAULT_LISTS } from "./defaults.js";
import {
  ListManager,
  expiresAfter,
  linesOf,
  type ListDefinition,
} from "./manager.js";
import { FileStorage, MemoryStorage } from "./storage.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAIN = "https://lists.example/filters/main.txt";
const MIRROR = "https://mirror.example/filters/main.min.txt";
const list: ListDefinition = {
  id: "main",
  urls: [MAIN, MIRROR],
  trusted: true,
};

function setup(routes: Parameters<typeof fetchStub>[0] = {}) {
  const storage = new MemoryStorage();
  const fetch = fetchStub(routes);
  const errors: string[] = [];
  const clock = { now: 1_000_000 };
  const manager = new ListManager({
    storage,
    fetch,
    now: () => clock.now,
    onError: (error) => errors.push(error.message),
  });
  return { storage, fetch, errors, clock, manager };
}

describe("expiresAfter", () => {
  test("reads days and hours", () => {
    expect(expiresAfter("! Title: x\n! Expires: 4 days\n")).toBe(4 * DAY);
    expect(expiresAfter("! Expires: 8 hours")).toBe(8 * HOUR);
    expect(expiresAfter("! Expires: 1 day (update frequency)")).toBe(DAY);
    expect(expiresAfter("! expires:12h")).toBe(12 * HOUR);
    expect(expiresAfter("# Expires: 2")).toBe(2 * DAY);
  });

  test("gives nothing without a usable header", () => {
    expect(expiresAfter("! Title: x\n||a.example^")).toBeUndefined();
    expect(expiresAfter("! Expires: soon")).toBeUndefined();
    expect(expiresAfter("! Expires: 0 days")).toBeUndefined();
  });
});

describe("ListManager", () => {
  test("downloads a list, stores it and applies its directives", async () => {
    const { manager, storage, fetch } = setup({
      [MAIN]: {
        body: "! Expires: 2 days\n||a.example^\n!#if env_firefox\n||b.example^\n!#endif",
        headers: {
          etag: '"v1"',
          "last-modified": "Sat, 01 Jan 2028 00:00:00 GMT",
        },
      },
    });
    const loaded = await manager.load(list);
    expect(loaded).toEqual({
      id: "main",
      trusted: true,
      lines: ["! Expires: 2 days", "||a.example^"],
      changed: true,
    });
    expect(fetch.requests).toEqual([{ url: MAIN, headers: {} }]);
    expect(storage.resources.get("main")).toMatchObject({
      url: MAIN,
      fetchedAt: 1_000_000,
      etag: '"v1"',
      lastModified: "Sat, 01 Jan 2028 00:00:00 GMT",
    });
    expect(manager.nextExpiry()).toBe(1_000_000 + 2 * DAY);
  });

  test("a fresh stored list isn't downloaded again", async () => {
    const { manager, fetch, clock } = setup({
      [MAIN]: { body: "! Expires: 2 days\n||a.example^" },
    });
    await manager.load(list);
    clock.now += 2 * DAY - 1;
    const loaded = await manager.load(list);
    expect(loaded.changed).toBe(false);
    expect(loaded.lines).toContain("||a.example^");
    expect(fetch.requests).toHaveLength(1);
  });

  test("an expired list is revalidated, and a 304 keeps the stored text", async () => {
    const { manager, fetch, clock, storage } = setup({
      [MAIN]: {
        body: "! Expires: 2 days\n||a.example^",
        headers: { etag: '"v1"', "last-modified": "then" },
      },
    });
    await manager.load(list);
    clock.now += 2 * DAY;
    fetch.routes[MAIN] = (headers) =>
      headers["If-None-Match"] === '"v1"' &&
      headers["If-Modified-Since"] === "then"
        ? { status: 304 }
        : { status: 500 };
    const loaded = await manager.load(list);
    expect(loaded.changed).toBe(false);
    expect(loaded.lines).toContain("||a.example^");
    expect(storage.resources.get("main")?.fetchedAt).toBe(clock.now);
    expect(manager.nextExpiry()).toBe(clock.now + 2 * DAY);
  });

  test("a changed list is reported as changed", async () => {
    const { manager, fetch, clock } = setup({
      [MAIN]: { body: "||a.example^" },
    });
    await manager.load(list);
    // No `! Expires:`: the default is five days.
    clock.now += 5 * DAY - 1;
    expect((await manager.load(list)).changed).toBe(false);
    clock.now += 1;
    fetch.routes[MAIN] = { body: "||b.example^" };
    expect(await manager.load(list)).toMatchObject({
      lines: ["||b.example^"],
      changed: true,
    });
  });

  test("force downloads a fresh list", async () => {
    const { manager, fetch } = setup({ [MAIN]: { body: "||a.example^" } });
    await manager.load(list);
    await manager.load(list, true);
    expect(fetch.requests).toHaveLength(2);
  });

  test("updateAfterDays replaces the default lifetime", async () => {
    const { manager, fetch, clock } = setup({
      [MAIN]: { body: "||a.example^" },
    });
    const slow = { ...list, updateAfterDays: 13 };
    await manager.load(slow);
    clock.now += 13 * DAY - 1;
    await manager.load(slow);
    expect(fetch.requests).toHaveLength(1);
  });

  test("falls back to a mirror, without the first URL's validators", async () => {
    const { manager, fetch, storage } = setup({
      [MAIN]: { status: 503 },
      [MIRROR]: { body: "||a.example^" },
    });
    expect((await manager.load(list)).lines).toEqual(["||a.example^"]);
    expect(storage.resources.get("main")?.url).toBe(MIRROR);
    expect(fetch.requests.map((request) => request.url)).toEqual([
      MAIN,
      MIRROR,
    ]);
  });

  test("an error page, an empty body or a network error isn't a list", async () => {
    for (const first of [
      { body: "<!DOCTYPE html><title>Oops</title>" },
      { body: "  \n" },
      { body: "\0\0\0" },
      new Error("getaddrinfo ENOTFOUND"),
    ]) {
      const { manager } = setup({
        [MAIN]: first,
        [MIRROR]: { body: "||a.example^" },
      });
      expect((await manager.load(list)).lines).toEqual(["||a.example^"]);
    }
  });

  test("a failed refresh keeps the stored list and is retried later", async () => {
    const { manager, fetch, clock, errors } = setup({
      [MAIN]: { body: "||a.example^" },
    });
    await manager.load(list);
    clock.now += 6 * DAY;
    fetch.routes[MAIN] = { status: 500 };
    const loaded = await manager.load(list);
    expect(loaded).toMatchObject({ lines: ["||a.example^"], changed: false });
    expect(errors).toEqual([
      `Couldn't download ${MAIN}: HTTP 500; ${MIRROR}: HTTP 404`,
    ]);
    expect(manager.nextExpiry()).toBe(clock.now + HOUR);
  });

  test("rejects when a list is neither stored nor downloadable", async () => {
    const { manager } = setup();
    await expect(manager.load(list)).rejects.toThrow(
      `Couldn't download ${MAIN}: HTTP 404; ${MIRROR}: HTTP 404`,
    );
  });

  test("sub-lists come from the folder of the URL that served the list", async () => {
    const { manager, fetch, storage } = setup({
      [MAIN]: { status: 500 },
      [MIRROR]: {
        body: "||a.example^\n!#include extra.txt\n!#if env_mobile\n!#include mobile.txt\n!#endif",
      },
      "https://mirror.example/filters/extra.txt": { body: "||b.example^" },
    });
    const loaded = await manager.load(list);
    expect(loaded.lines).toEqual(["||a.example^", "||b.example^"]);
    expect(fetch.requests.map((request) => request.url)).toEqual([
      MAIN,
      MIRROR,
      "https://mirror.example/filters/extra.txt",
    ]);
    expect(storage.resources.has("main/extra.txt")).toBe(true);
  });

  test("a sub-list that can't be downloaded is left out", async () => {
    const { manager, errors } = setup({
      [MAIN]: { body: "||a.example^\n!#include gone.txt" },
    });
    expect((await manager.load(list)).lines).toEqual(["||a.example^"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("https://lists.example/filters/gone.txt");
  });

  test("a changed sub-list changes the list", async () => {
    const SUB = "https://lists.example/filters/extra.txt";
    const { manager, fetch, clock } = setup({
      [MAIN]: { body: "!#include extra.txt", headers: { etag: "m" } },
      [SUB]: { body: "||a.example^" },
    });
    await manager.load(list);
    clock.now += 6 * DAY;
    fetch.routes[MAIN] = { status: 304 };
    fetch.routes[SUB] = { body: "||b.example^" };
    expect(await manager.load(list)).toMatchObject({
      lines: ["||b.example^"],
      changed: true,
    });
  });
});

describe("FileStorage", () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  test("keeps a list across instances, under a safe file name", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "adblock-"));
    const folder = path.join(directory, "lists");
    const resource = {
      text: "||a.example^\n",
      url: MAIN,
      fetchedAt: 42,
      etag: '"v1"',
      lastModified: undefined,
    };
    await new FileStorage(folder).write("main/sub list.txt", resource);
    expect((await fs.readdir(folder)).sort()).toEqual([
      "main_sub_list.txt.json",
      "main_sub_list.txt.txt",
    ]);
    expect(await new FileStorage(folder).read("main/sub list.txt")).toEqual(
      resource,
    );
  });

  test("gives nothing for a missing or damaged list", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "adblock-"));
    const storage = new FileStorage(directory);
    expect(await storage.read("main")).toBeUndefined();
    await fs.writeFile(path.join(directory, "main.txt"), "||a.example^");
    await fs.writeFile(path.join(directory, "main.json"), "{");
    expect(await storage.read("main")).toBeUndefined();
    await fs.writeFile(path.join(directory, "main.json"), '{"url":1}');
    expect(await storage.read("main")).toBeUndefined();
  });

  test("a stored text that isn't a list reads as missing", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "adblock-"));
    const storage = new FileStorage(directory);
    await storage.write("main", {
      text: "||a.example^",
      url: MAIN,
      fetchedAt: 1,
    });
    expect(await storage.read("main")).toBeDefined();
    // What a power cut can leave after the rename, and an error page.
    for (const text of ["\0".repeat(64), "", "<html><body>Oops"]) {
      await fs.writeFile(path.join(directory, "main.txt"), text);
      expect(await storage.read("main")).toBeUndefined();
    }
  });

  test("a write removes the temporary files an earlier run left", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "adblock-"));
    for (const name of [
      "main.txt.12.tmp",
      "main.json.345.tmp",
      "main.txt.txt.6.tmp",
    ]) {
      await fs.writeFile(path.join(directory, name), "partial");
    }
    await new FileStorage(directory).write("main", {
      text: "||a.example^",
      url: MAIN,
      fetchedAt: 1,
    });
    // The last one is key "main.txt"'s.
    expect((await fs.readdir(directory)).sort()).toEqual([
      "main.json",
      "main.txt",
      "main.txt.txt.6.tmp",
    ]);
  });

  test("a failed rename leaves no temporary file", async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "adblock-"));
    // A folder in the way: a file can't be renamed over it.
    await fs.mkdir(path.join(directory, "main.txt", "inside"), {
      recursive: true,
    });
    await expect(
      new FileStorage(directory).write("main", {
        text: "||a.example^",
        url: MAIN,
        fetchedAt: 1,
      }),
    ).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual(["main.txt"]);
  });
});

describe("DEFAULT_LISTS", () => {
  test("are the lists uBlock Origin enables by default", () => {
    expect(DEFAULT_LISTS.map((one) => one.id)).toEqual([
      "ublock-filters",
      "ublock-badware",
      "ublock-privacy",
      "ublock-unbreak",
      "ublock-quick-fixes",
      "easylist",
      "easyprivacy",
      "urlhaus-1",
      "plowe-0",
    ]);
  });

  test("only uBlock Origin's own lists are trusted", () => {
    for (const one of DEFAULT_LISTS) {
      expect(one.trusted === true).toBe(one.id.startsWith("ublock-"));
      expect(one.urls.length).toBeGreaterThan(0);
      for (const url of one.urls) expect(url).toMatch(/^https:\/\//);
    }
  });
});

describe("ListManager.get", () => {
  test("gives the texts load() reads, before their directives apply", async () => {
    const text = ["||a.example^", "!#include extra.txt"].join("\n");
    const { manager } = setup({
      [MAIN]: { body: text },
      "https://lists.example/filters/extra.txt": { body: "||b.example^" },
    });
    const fetched = await manager.get(list);
    expect(fetched.text).toBe(text);
    expect([...fetched.included]).toEqual([["extra.txt", "||b.example^"]]);
    expect(fetched.changed).toBe(true);
    expect(linesOf(fetched)).toEqual(["||a.example^", "||b.example^"]);
    expect(linesOf(fetched)).toEqual((await manager.load(list)).lines);
  });
});

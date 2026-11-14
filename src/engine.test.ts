import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchStub } from "../test/helpers/fetchStub.js";
import { Engine } from "./engine.js";
import { MemoryStorage } from "./lists/storage.js";

const A = "https://lists.example/a.txt";
const B = "https://lists.example/b.txt";
const lists = [
  { id: "a", urls: [A], trusted: true },
  { id: "b", urls: [B] },
];
const DAY = 24 * 3_600_000;

function setup(routes: Parameters<typeof fetchStub>[0]) {
  const fetch = fetchStub(routes);
  const errors: string[] = [];
  const clock = { now: 5_000_000 };
  const engine = new Engine({
    lists,
    storage: new MemoryStorage(),
    publicSuffixListUrls: [],
    fetch,
    now: () => clock.now,
    onError: (error) => errors.push(error.message),
  });
  return { engine, fetch, errors, clock };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Engine", () => {
  test("loads its lists and says what they hold", async () => {
    const { engine, errors } = setup({
      [A]: { body: "||a.example^\n##.ad\na.example##+js(nowoif)" },
      [B]: { body: "@@||b.example^\n! comment" },
    });
    await engine.ready;
    expect(errors).toEqual([]);
    expect(engine.stats.a).toMatchObject({
      lines: 3,
      network: 1,
      cosmetic: 1,
      scriptlets: 1,
    });
    expect(engine.stats.b).toMatchObject({ networkExceptions: 1, comments: 1 });
    engine.dispose();
  });

  test("a list that can't be loaded is reported and left out", async () => {
    const { engine, errors } = setup({ [A]: { body: "||a.example^" } });
    await engine.ready;
    expect(Object.keys(engine.stats)).toEqual(["a"]);
    expect(errors).toEqual([`Couldn't download ${B}: HTTP 404`]);
    engine.dispose();
  });

  test("update() says whether the rules changed", async () => {
    const { engine, fetch, clock } = setup({
      [A]: { body: "||a.example^" },
      [B]: { body: "||b.example^" },
    });
    await engine.ready;
    expect(await engine.update()).toBe(false);
    expect(fetch.requests).toHaveLength(2);
    // Fresh lists aren't downloaded, unless forced.
    fetch.routes[B] = { body: "||b.example^\n||c.example^" };
    expect(await engine.update()).toBe(false);
    expect(await engine.update(true)).toBe(true);
    expect(engine.stats.b?.network).toBe(2);
    // Expired lists are.
    clock.now += 5 * DAY;
    fetch.routes[A] = { body: "||a.example^\n##.ad" };
    expect(await engine.update()).toBe(true);
    expect(engine.stats.a?.cosmetic).toBe(1);
    engine.dispose();
  });

  test("looks for updates when the first list expires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { engine, fetch, clock } = setup({
      [A]: { body: "! Expires: 8 hours\n||a.example^" },
      [B]: { body: "||b.example^" },
    });
    await engine.ready;
    expect(fetch.requests).toHaveLength(2);
    fetch.routes[A] = {
      body: "! Expires: 8 hours\n||a.example^\n||x.example^",
    };
    clock.now += 8 * 3_600_000;
    vi.advanceTimersByTime(8 * 3_600_000 - 1);
    expect(fetch.requests).toHaveLength(2);
    vi.advanceTimersByTime(1);
    await vi.waitFor(() => expect(engine.stats.a?.network).toBe(2));
    // Only the expired list was asked for.
    expect(fetch.requests.map((request) => request.url)).toEqual([A, B, A]);
    engine.dispose();
  });

  test("autoUpdate: false and dispose() leave no timer behind", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetch = fetchStub({ [A]: { body: "||a.example^" } });
    const manual = new Engine({
      lists: [lists[0]!],
      publicSuffixListUrls: [],
      fetch,
      autoUpdate: false,
    });
    await manual.ready;
    expect(vi.getTimerCount()).toBe(0);

    const { engine } = setup({
      [A]: { body: "||a.example^" },
      [B]: { body: "x" },
    });
    await engine.ready;
    expect(vi.getTimerCount()).toBe(1);
    engine.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(await engine.update(true)).toBe(false);
  });
});

describe("Engine and requests", () => {
  const SUFFIXES = "https://suffixes.example/list.dat";
  const request = { url: "https://ads.example/x.js", type: "script" } as const;

  test("decides requests once ready, with the suffix list it downloaded", async () => {
    const engine = new Engine({
      lists: [lists[0]!],
      fetch: fetchStub({
        [A]: { body: "||ads.example^\n/3p.js$third-party" },
        [SUFFIXES]: { body: "example\nco.example" },
      }),
      publicSuffixListUrls: [SUFFIXES],
      autoUpdate: false,
    });
    // Nothing is blocked until the lists are in effect.
    const empty = engine.network;
    expect(empty.match(empty.request(request)).block).toBe(false);
    await engine.ready;
    const { network } = engine;
    expect(network).not.toBe(empty);
    expect(network.psl.loaded).toBe(true);
    expect(network.match(network.request(request)).block).toBe(true);
    // The list says a.co.example and b.co.example are different sites.
    expect(
      network.match(
        network.request({
          url: "https://b.co.example/3p.js",
          type: "script",
          sourceUrl: "https://a.co.example/",
        }),
      ).block,
    ).toBe(true);
  });

  test("without the suffix list it reports and guesses", async () => {
    const errors: string[] = [];
    const engine = new Engine({
      lists: [lists[0]!],
      fetch: fetchStub({ [A]: { body: "||ads.example^" } }),
      publicSuffixListUrls: [SUFFIXES],
      autoUpdate: false,
      onError: (error) => errors.push(error.message),
    });
    await engine.ready;
    expect(errors).toEqual([`Couldn't download ${SUFFIXES}: HTTP 404`]);
    expect(engine.network.psl.loaded).toBe(false);
    expect(engine.network.match(engine.network.request(request)).block).toBe(
      true,
    );
  });
});

describe("Engine and documents", () => {
  test("gives a document its cosmetics, with its exceptions applied", async () => {
    const engine = new Engine({
      lists: [lists[0]!],
      fetch: fetchStub({
        [A]: {
          body: [
            "a.example##.ad",
            "##[data-ad]",
            "a.example##+js(set, ads, false)",
            "@@||a.example/plain/$ghide",
          ].join("\n"),
        },
      }),
      publicSuffixListUrls: [],
      autoUpdate: false,
    });
    await engine.ready;
    expect(engine.document("https://www.a.example/page")).toEqual({
      css: ".ad{display:none!important;}\n[data-ad]{display:none!important;}",
      procedural: [],
      scriptlets: [{ name: "set-constant", args: ["ads", "false"] }],
      generic: true,
    });
    expect(engine.document("https://www.a.example/plain/x")).toMatchObject({
      css: ".ad{display:none!important;}",
      generic: false,
    });
    expect(engine.document("https://b.example/").scriptlets).toEqual([]);
  });
});

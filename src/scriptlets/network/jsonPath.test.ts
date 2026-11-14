import { describe, expect, test } from "vitest";
import { REMOVED, compileJsonPath } from "./jsonPath.js";

const store = () => ({
  store: {
    book: [
      {
        category: "reference",
        author: "Nigel Rees",
        title: "Sayings",
        price: 8.95,
      },
      {
        category: "fiction",
        author: "Evelyn Waugh",
        title: "Sword",
        price: 12.99,
      },
      {
        category: "fiction",
        author: "Herman Melville",
        title: "Moby Dick",
        isbn: "0-553",
        price: 8.99,
      },
      {
        category: "fiction",
        author: "J. R. R. Tolkien",
        title: "Rings",
        isbn: "0-395",
        price: 22.99,
      },
    ],
    bicycle: { color: "red", price: 399 },
  },
});

/** The data after a query, edited the way an untrusted filter can (removal). */
function edit(
  query: string,
  data: unknown = store(),
  trusted = false,
): unknown {
  const compiled = compileJsonPath(query, trusted);
  if (compiled === undefined) throw new Error(`invalid: ${query}`);
  return compiled(data)?.root ?? data;
}

const titles = (data: any) => data.store.book.map((book: any) => book.title);

describe("JSONPath selection (removes what it selects)", () => {
  test("dot and bracket names, quoted with escapes", () => {
    expect(edit("$.store.bicycle")).not.toHaveProperty("store.bicycle");
    expect(edit("$['store'][\"bicycle\"].color")).toHaveProperty(
      "store.bicycle",
      { price: 399 },
    );
    expect(edit(String.raw`$['j j']`, { "j j": 1, k: 2 })).toEqual({ k: 2 });
    expect(edit(String.raw`$["'"]["@"]`, { "'": { "@": 1, x: 2 } })).toEqual({
      "'": { x: 2 },
    });
    expect(edit(String.raw`$['A\n']`, { "A\n": 1 })).toEqual({});
  });

  test("index, negative index and several selectors", () => {
    expect(titles(edit("$.store.book[0]"))).toEqual([
      "Sword",
      "Moby Dick",
      "Rings",
    ]);
    expect(titles(edit("$..book[-1]"))).toEqual([
      "Sayings",
      "Sword",
      "Moby Dick",
    ]);
    expect(titles(edit("$.store.book[0, 2, 2]"))).toEqual(["Sword", "Rings"]);
    expect(titles(edit("$.store.book[9]"))).toHaveLength(4);
  });

  test("wildcards and descendants", () => {
    expect(edit("$.store.*")).toEqual({ store: {} });
    expect(edit("$[*]")).toEqual({});
    const data = edit("$..price") as any;
    expect(data.store.bicycle).toEqual({ color: "red" });
    expect(data.store.book.every((book: any) => !("price" in book))).toBe(true);
    expect(edit("$..*", { a: { b: 1 } })).toEqual({});
  });

  test("filters: comparisons, existence and its negation", () => {
    expect(titles(edit("$..book[?@.price<10]"))).toEqual(["Sword", "Rings"]);
    expect(titles(edit("$..book[?@.price >= 12.99]"))).toEqual([
      "Sayings",
      "Moby Dick",
    ]);
    expect(titles(edit("$..book[?@.isbn]"))).toEqual(["Sayings", "Sword"]);
    expect(titles(edit("$..book[?!@.isbn]"))).toEqual(["Moby Dick", "Rings"]);
    expect(titles(edit("$..book[?@.category=='fiction']"))).toEqual([
      "Sayings",
    ]);
    expect(titles(edit('$..book[?@.category!="fiction"]'))).toHaveLength(3);
    expect(
      titles(edit("$..book[?@.price > $.store.bicycle.price]")),
    ).toHaveLength(4);
    expect(edit("$.a[?@>3.5]", { a: [1, 4, "5", 3.5] })).toEqual({
      a: [1, "5", 3.5],
    });
    expect(edit("$.a[?@<='b']", { a: ["a", "b", "c", 1] })).toEqual({
      a: ["c", 1],
    });
    expect(edit("$.a[?@==null]", { a: [null, 0, false] })).toEqual({
      a: [0, false],
    });
    expect(edit("$.a[?@==true]", { a: [true, 1] })).toEqual({ a: [1] });
    // Comparisons of things that don't exist: nothing equals something.
    expect(
      edit("$.a[?@.x==@.y]", { a: [{}, { x: 1 }, { x: 1, y: 1 }] }),
    ).toEqual({ a: [{ x: 1 }] });
  });

  test("uBO's string operators and regexes", () => {
    expect(titles(edit('v2:$..book[?@.author^="E"]'))).toEqual([
      "Sayings",
      "Moby Dick",
      "Rings",
    ]);
    expect(titles(edit('v2:$..book[?@.author$="h"]'))).toEqual([
      "Sayings",
      "Moby Dick",
      "Rings",
    ]);
    expect(titles(edit('v2:$..book[?@.author*="Mel"]'))).toEqual([
      "Sayings",
      "Sword",
      "Rings",
    ]);
    expect(titles(edit("v2:$..book[?@.author=/^[EH]/]"))).toEqual([
      "Sayings",
      "Rings",
    ]);
    expect(titles(edit("v2:$..book[?@.price=/x/]"))).toHaveLength(4);
    const data = edit("v2:$../^b/..price") as any;
    expect(data.store.bicycle).toEqual({ color: "red" });
    expect(data.store.book[0]).not.toHaveProperty("price");
    expect(edit("v2:$..[/^ad/i]", { Ads: 1, x: { adSlot: 2, y: 3 } })).toEqual({
      x: { y: 3 },
    });
    expect(
      edit('v2:$.["onload","onerror"]', { onload: 1, onerror: 2, id: 3 }),
    ).toEqual({ id: 3 });
  });

  test("chaining with quantifiers", () => {
    expect(titles(edit("v2:$.store.bicycle{1,};$..book[?@.price<10]"))).toEqual(
      ["Sword", "Rings"],
    );
    expect(titles(edit("v2:$.store.bicycle;$..book[?@.price<10]"))).toEqual([
      "Sword",
      "Rings",
    ]);
    expect(
      titles(edit("v2:$.store.bicycle{0};$..book[?@.price<10]")),
    ).toHaveLength(4);
    expect(titles(edit("v2:$.store.car{0};$..book[0]"))).toHaveLength(3);
    expect(titles(edit("v2:$..book[?@.isbn]{2};$..book[0]"))).toHaveLength(3);
    expect(titles(edit("v2:$..book[?@.isbn]{3,};$..book[0]"))).toHaveLength(4);
    expect(titles(edit("v2:$..book[*]{,3};$..book[0]"))).toHaveLength(4);
    expect(titles(edit("v2:$..book[*]{1,4};$..book[0]"))).toHaveLength(3);
  });

  test("selecting the root removes it, and no match changes nothing", () => {
    expect(compileJsonPath("$", false)!({ a: 1 })).toEqual({ root: REMOVED });
    expect(compileJsonPath("v2:$.ad;$", false)!({ ad: 1 })).toEqual({
      root: REMOVED,
    });
    expect(compileJsonPath("$.nothing", false)!({ a: 1 })).toBeUndefined();
  });

  test("rejects what it doesn't support", () => {
    for (const query of [
      "",
      "store.book",
      ".store",
      "$.store.book[1:3]",
      "$..book[:2]",
      "$.o[?@<3, ?@>7]".replace(", ", " || "),
      "$.o[?@.u || @.x]",
      "$.o[?@>1 && @<4]",
      '$.a[?match(@.b, "[jk]")]',
      "$.a[?(@.b)]",
      "$.a-b",
      "$.a[",
      "$['open",
      "$..book[0]{1}",
      "$.a{};$.b",
      "$.a=1",
      "$.a+={}",
      "$.a[?!@.b==1]",
      "$.a[?1]",
      "$.a[?@.x==[1]]",
    ]) {
      expect(compileJsonPath(query, false), query).toBeUndefined();
    }
  });
});

describe("JSONPath assignments (trusted)", () => {
  test("a JSON value, to each node and to the root", () => {
    const data = edit("v2:$..book[?@.price>20].price=0", store(), true) as any;
    expect(data.store.book[3].price).toBe(0);
    expect(data.store.book[1].price).toBe(12.99);
    const objects = edit(
      '$.a[*].x={"n":[]}',
      { a: [{ x: 1 }, { x: 2 }, {}] },
      true,
    ) as any;
    expect(objects.a[0].x).toEqual({ n: [] });
    expect(objects.a[0].x).not.toBe(objects.a[1].x);
    // Only what the query looks up changes: nothing is created.
    expect(objects.a[2]).toEqual({});
    expect(edit('$="zero"', { a: 1 }, true)).toBe("zero");
  });

  test("+= adds properties", () => {
    expect(edit('$.a+={"b":1}', { a: { c: 2 }, d: 3 }, true)).toEqual({
      a: { b: 1, c: 2 },
      d: 3,
    });
  });

  test("repl with a pattern or a regex", () => {
    expect(
      edit(
        '$.u=repl({"pattern":"ads=1","replacement":"ads=0"})',
        { u: "x?ads=1&ads=1" },
        true,
      ),
    ).toEqual({ u: "x?ads=0&ads=0" });
    expect(
      edit(
        '$..u=repl({"regex":"\\\\d+","replacement":"#"})',
        { u: "a1b22", n: 5 },
        true,
      ),
    ).toEqual({
      u: "a#b#",
      n: 5,
    });
  });

  test("call, on the object or a global", () => {
    const calls: unknown[][] = [];
    const element = {
      onload: "x",
      removeAttribute(...args: unknown[]) {
        calls.push([this === element, ...args]);
      },
    };
    edit(
      'v2:$.["onload","onerror"]=call(["${obj}","removeAttribute","${key}","${val}"])',
      element,
      true,
    );
    expect(calls).toEqual([[true, "onload", "x"]]);
  });

  test("rejects a malformed value", () => {
    for (const query of [
      "$.a=",
      "$.a=nope",
      "$.a+=1",
      "$.a=repl({})",
      "$.a=call([1])",
    ]) {
      expect(compileJsonPath(query, true), query).toBeUndefined();
    }
  });
});

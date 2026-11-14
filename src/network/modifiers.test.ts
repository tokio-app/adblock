import { describe, expect, test } from "vitest";
import {
  paramNames,
  removeParams,
  skipsBlocked,
  uriTransform,
  urlSkip,
} from "./modifiers.js";

describe("removeParams", () => {
  const url = "https://x.example/p?a=1&utm_source=n&utm_medium=m&flag#frag";

  test("a name removes the parameter with that exact name", () => {
    expect(removeParams(url, ["utm_source"])).toBe(
      "https://x.example/p?a=1&utm_medium=m&flag#frag",
    );
    expect(removeParams(url, ["flag", "a"])).toBe(
      "https://x.example/p?utm_source=n&utm_medium=m#frag",
    );
    expect(removeParams(url, ["utm_"])).toBe(url);
  });

  test("a regex is tested against name=value", () => {
    expect(removeParams(url, ["/^utm_/"])).toBe(
      "https://x.example/p?a=1&flag#frag",
    );
    expect(removeParams(url, ["/=M$/i"])).toBe(
      "https://x.example/p?a=1&utm_source=n&flag#frag",
    );
  });

  test("~ removes what doesn't match", () => {
    expect(removeParams(url, ["~a"])).toBe("https://x.example/p?a=1#frag");
    expect(removeParams(url, ["~/^utm_/"])).toBe(
      "https://x.example/p?utm_source=n&utm_medium=m#frag",
    );
  });

  test("an empty value removes every parameter", () => {
    expect(removeParams(url, [""])).toBe("https://x.example/p#frag");
  });

  test("a URL without a query, or untouched, comes back as given", () => {
    expect(removeParams("https://x.example/p#a?b=1", ["b"])).toBe(
      "https://x.example/p#a?b=1",
    );
    expect(removeParams(url, [])).toBe(url);
    expect(removeParams(url, ["nope", "/[/"])).toBe(url);
  });

  test("paramNames lists the names as written", () => {
    expect(paramNames(url)).toEqual(["a", "utm_source", "utm_medium", "flag"]);
    expect(paramNames("https://x.example/p#a?b=1")).toEqual([]);
    expect(paramNames("https://x.example/p")).toEqual([]);
  });
});

describe("urlSkip", () => {
  test("?name takes a parameter's value, again and again", () => {
    expect(
      urlSkip(
        "https://t.example/r?u=https%3A%2F%2Fdest.example%2Fa%3Fb%3D1",
        "?u",
      ),
    ).toBe("https://dest.example/a?b=1");
    const inner = encodeURIComponent("https://dest.example/");
    const outer = encodeURIComponent(`https://mid.example/r?to=${inner}`);
    expect(urlSkip(`https://t.example/r?u=${outer}`, "?u ?to")).toBe(
      "https://dest.example/",
    );
    // Every step has to work.
    expect(urlSkip(`https://t.example/r?u=${inner}`, "?u ?to")).toBeUndefined();
  });

  test("&i takes the name of the i-th parameter", () => {
    expect(
      urlSkip("https://t.example/jump?https%3A%2F%2Fdest.example%2Fu", "&1"),
    ).toBe("https://dest.example/u");
    expect(urlSkip("https://t.example/jump?a=1", "&2")).toBeUndefined();
  });

  test("# takes the hash and a regex its first group", () => {
    expect(urlSkip("https://t.example/r#https://dest.example/", "#")).toBe(
      "https://dest.example/",
    );
    expect(
      urlSkip(
        "https://t.example/go/https:%2F%2Fdest.example%2Fa/1",
        "/\\/go\\/(.+?)\\/1$/ -uricomponent",
      ),
    ).toBe("https://dest.example/a");
  });

  test("+https adds or upgrades the scheme", () => {
    expect(urlSkip("https://t.example/r?u=dest.example/a", "?u +https")).toBe(
      "https://dest.example/a",
    );
    expect(
      urlSkip("https://t.example/r?u=http://dest.example/a", "?u +https"),
    ).toBe("https://dest.example/a");
  });

  test("-base64 and -safebase64 decode", () => {
    const encoded = btoa("https://dest.example/a?b=é".replace("é", "Ã©"));
    expect(urlSkip(`https://t.example/r?u=${encoded}`, "?u -base64")).toBe(
      "https://dest.example/a?b=é",
    );
    const safe = btoa("https://dest.example/a?>>>").replaceAll("+", "-");
    expect(urlSkip(`https://t.example/r?u=${safe}`, "?u -safebase64")).toBe(
      "https://dest.example/a?>>>",
    );
    expect(urlSkip("https://t.example/r?u=%%%", "?u -base64")).toBeUndefined();
  });

  test("the result must be an http(s) URL, and a new one", () => {
    expect(urlSkip("https://t.example/r?u=javascript:alert(1)", "?u")).toBe(
      undefined,
    );
    expect(urlSkip("https://t.example/r?u=not a url", "?u")).toBeUndefined();
    expect(
      urlSkip("https://t.example/r?u=x", "?u -frobnicate"),
    ).toBeUndefined();
    expect(urlSkip("https://t.example/r", "-blocked")).toBeUndefined();
  });

  test("-blocked marks steps that apply to a blocked request", () => {
    expect(skipsBlocked("-blocked ?url")).toBe(true);
    expect(skipsBlocked("?url")).toBe(false);
  });
});

describe("uriTransform", () => {
  test("replaces in the path, query and hash", () => {
    expect(
      uriTransform("https://x.example/a/ref=1/b?c#d", "/\\/ref=[^/]+//"),
    ).toBe("https://x.example/a/b?c#d");
    expect(
      uriTransform("https://x.example/A.HTML/x", "/\\.html\\/.*/.html/i"),
    ).toBe("https://x.example/A.html");
    expect(uriTransform("https://x.example/a?b=1", "/[?&]b=1//")).toBe(
      "https://x.example/a",
    );
  });

  test("a class may hold a slash", () => {
    expect(uriTransform("https://x.example/a-b", "/[/-]b/_c/")).toBe(
      "https://x.example/a_c",
    );
  });

  test("gives nothing when it can't apply", () => {
    expect(uriTransform("https://x.example/a", "/zzz/y/")).toBeUndefined();
    expect(uriTransform("https://x.example/a", "nope")).toBeUndefined();
    expect(uriTransform("https://x.example/a", "/a/")).toBeUndefined();
    expect(uriTransform("https://x.example/a", "/(/y/")).toBeUndefined();
    expect(uriTransform("not a url", "/a/b/")).toBeUndefined();
    // The result must still be a path.
    expect(uriTransform("https://x.example/a", "/^\\/a/evil.example/")).toBe(
      undefined,
    );
  });
});

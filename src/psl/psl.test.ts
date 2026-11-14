import { describe, expect, test } from "vitest";
import { PublicSuffixList } from "./psl.js";

// Written by hand in the list's format, not copied from it.
const LIST = `
// a comment
com
uk
co.uk
// a wildcard with an exception
*.ck
!www.ck
example.test
bücher.example  // trailing text isn't part of the rule
`;

describe("PublicSuffixList", () => {
  const psl = new PublicSuffixList(LIST);

  test("finds the public suffix and the registrable domain", () => {
    expect(psl.loaded).toBe(true);
    expect(psl.publicSuffix("www.example.com")).toBe("com");
    expect(psl.domain("www.example.com")).toBe("example.com");
    expect(psl.domain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(psl.domain("example.co.uk")).toBe("example.co.uk");
    expect(psl.domain("shop.example.test")).toBe("shop.example.test");
    expect(psl.domain("a.shop.example.test")).toBe("shop.example.test");
  });

  test("a wildcard rule and its exception", () => {
    expect(psl.publicSuffix("a.b.ck")).toBe("b.ck");
    expect(psl.domain("x.a.b.ck")).toBe("a.b.ck");
    expect(psl.publicSuffix("www.ck")).toBe("ck");
    expect(psl.domain("www.ck")).toBe("www.ck");
    expect(psl.domain("a.www.ck")).toBe("www.ck");
  });

  test("an unlisted suffix is its last label", () => {
    expect(psl.publicSuffix("a.b.unlisted")).toBe("unlisted");
    expect(psl.domain("a.b.unlisted")).toBe("b.unlisted");
  });

  test("a hostname with no name before its suffix is its own domain", () => {
    expect(psl.domain("co.uk")).toBe("co.uk");
    expect(psl.domain("localhost")).toBe("localhost");
    expect(psl.domain("192.168.1.20")).toBe("192.168.1.20");
    expect(psl.domain("[::1]")).toBe("[::1]");
    expect(psl.publicSuffix("192.168.1.20")).toBe("");
  });

  test("rules with non-ASCII labels match punycode hostnames", () => {
    expect(psl.domain("www.shop.xn--bcher-kva.example")).toBe(
      "shop.xn--bcher-kva.example",
    );
  });

  test("the entity is the hostname with its suffix as *", () => {
    expect(psl.entity("www.example.co.uk")).toBe("www.example.*");
    expect(psl.entity("example.com")).toBe("example.*");
    expect(psl.entity("co.uk")).toBe("");
    expect(psl.entity("10.0.0.1")).toBe("");
  });

  test("without the list it guesses", () => {
    const guess = new PublicSuffixList();
    expect(guess.loaded).toBe(false);
    expect(guess.domain("www.example.com")).toBe("example.com");
    expect(guess.domain("a.example.co.uk")).toBe("example.co.uk");
    expect(guess.domain("a.example.com.br")).toBe("example.com.br");
    // Not a country domain: `co` is a name here.
    expect(guess.domain("a.co.example")).toBe("co.example");
    expect(guess.domain("co.uk")).toBe("co.uk");
    expect(guess.entity("www.example.co.uk")).toBe("www.example.*");
  });
});

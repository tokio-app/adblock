import { describe, expect, test } from "vitest";
import { parseNetworkFilter } from "./network.js";
import {
  F_BADFILTER,
  F_EXCEPTION,
  F_FIRST_PARTY,
  F_HOST_ANCHOR,
  F_IMPORTANT,
  F_LEFT_ANCHOR,
  F_MATCH_CASE,
  F_RIGHT_ANCHOR,
  F_STRICT_FIRST_PARTY,
  F_STRICT_THIRD_PARTY,
  F_THIRD_PARTY,
  METHODS,
  P_ALL,
  P_HOST,
  P_PATTERN,
  P_REGEX,
  T_ALL,
  T_DOCUMENT,
  T_ELEMHIDE,
  T_GENERICHIDE,
  T_IMAGE,
  T_INLINE_SCRIPT,
  T_MEDIA,
  T_NETWORK,
  T_POPUP,
  T_SCRIPT,
  T_SPECIFICHIDE,
  T_STYLESHEET,
  T_SUBDOCUMENT,
  T_XHR,
  type NetworkRule,
} from "./types.js";

function rule(line: string, trusted = false): NetworkRule {
  const parsed = parseNetworkFilter(line, { trusted });
  if (parsed.kind !== "network") {
    throw new Error(`${line}: ${parsed.kind}: ${parsed.reason}`);
  }
  return parsed;
}

function reason(line: string, trusted = false): string {
  const parsed = parseNetworkFilter(line, { trusted });
  if (parsed.kind === "network") throw new Error(`${line}: parsed`);
  return `${parsed.kind}: ${parsed.reason}`;
}

describe("patterns", () => {
  test("a hostname with || and ^ is a host rule that blocks pages too", () => {
    expect(rule("||ads.example^")).toMatchObject({
      patternKind: P_HOST,
      pattern: "ads.example",
      flags: 0,
      types: T_NETWORK | T_DOCUMENT,
    });
    expect(rule("||ads.example").patternKind).toBe(P_HOST);
    expect(rule("||ADS.Example^|").pattern).toBe("ads.example");
  });

  test("a bare hostname is a host rule, as in a hosts file", () => {
    expect(rule("ads.example")).toMatchObject({
      patternKind: P_HOST,
      pattern: "ads.example",
    });
    // A wildcard, a path or a single label make it a pattern again.
    expect(rule("ads.example*")).toMatchObject({
      patternKind: P_PATTERN,
      pattern: "ads.example",
    });
    expect(rule("/ads.js").patternKind).toBe(P_PATTERN);
    expect(rule("adserver").patternKind).toBe(P_PATTERN);
  });

  test("a non-ASCII hostname becomes punycode", () => {
    expect(rule("||bücher.example^").pattern).toBe("xn--bcher-kva.example");
    expect(rule("||bücher.example/ads").pattern).toBe(
      "xn--bcher-kva.example/ads",
    );
  });

  test("anchors become flags and the pattern is lowercased", () => {
    expect(rule("||Example.com/Ads/*.js")).toMatchObject({
      patternKind: P_PATTERN,
      pattern: "example.com/ads/*.js",
      flags: F_HOST_ANCHOR,
      types: T_NETWORK,
    });
    expect(rule("|https://example.com/x|")).toMatchObject({
      pattern: "https://example.com/x",
      flags: F_LEFT_ANCHOR | F_RIGHT_ANCHOR,
    });
    expect(rule("/banner/*/img^")).toMatchObject({
      patternKind: P_PATTERN,
      pattern: "/banner/*/img^",
      flags: 0,
    });
  });

  test("a wildcard next to an anchor undoes it", () => {
    expect(rule("|*banner*|")).toMatchObject({ pattern: "banner", flags: 0 });
    expect(rule("||*.example/ads**x")).toMatchObject({
      pattern: ".example/ads*x",
      flags: 0,
    });
  });

  test("* and an empty pattern match every URL", () => {
    expect(rule("*$image").patternKind).toBe(P_ALL);
    expect(rule("$script,domain=a.example")).toMatchObject({
      patternKind: P_ALL,
      types: T_SCRIPT,
    });
  });

  test("slashes around the pattern make a regular expression", () => {
    expect(rule("/banner\\d+\\.gif$/")).toMatchObject({
      patternKind: P_REGEX,
      pattern: "banner\\d+\\.gif$",
    });
    expect(rule("/ads\\/[A-Z]{3}$/$script,match-case")).toMatchObject({
      patternKind: P_REGEX,
      pattern: "ads\\/[A-Z]{3}$",
      flags: F_MATCH_CASE,
      types: T_SCRIPT,
    });
    expect(reason("/ad(/")).toBe("invalid: bad regular expression");
    expect(reason("||example.com^$match-case")).toMatch(/match-case/);
  });
});

describe("options", () => {
  test("types, with their aliases", () => {
    expect(rule("||a.example^$script,image").types).toBe(T_SCRIPT | T_IMAGE);
    expect(rule("||a.example^$css,xhr,frame,doc").types).toBe(
      T_STYLESHEET | T_XHR | T_SUBDOCUMENT | T_DOCUMENT,
    );
    expect(rule("||a.example^$all").types).toBe(T_ALL);
    expect(rule("||a.example^$popup").types).toBe(T_POPUP);
    expect(rule("||a.example^$inline-script").types).toBe(T_INLINE_SCRIPT);
  });

  test("a negated type removes it from the default set", () => {
    expect(rule("||a.example^$~script").types).toBe(T_NETWORK & ~T_SCRIPT);
    expect(rule("/ads/$~image,~media").types).toBe(
      T_NETWORK & ~T_IMAGE & ~T_MEDIA,
    );
  });

  test("party options", () => {
    expect(rule("/ads/$third-party").flags).toBe(F_THIRD_PARTY);
    expect(rule("/ads/$3p").flags).toBe(F_THIRD_PARTY);
    expect(rule("/ads/$~third-party").flags).toBe(F_FIRST_PARTY);
    expect(rule("/ads/$first-party").flags).toBe(F_FIRST_PARTY);
    expect(rule("/ads/$1p,strict3p").flags).toBe(
      F_FIRST_PARTY | F_STRICT_THIRD_PARTY,
    );
    expect(rule("/ads/$strict1p").flags).toBe(F_STRICT_FIRST_PARTY);
  });

  test("exceptions, important and badfilter", () => {
    expect(rule("@@||a.example^$script").flags).toBe(F_EXCEPTION);
    expect(rule("||a.example^$important").flags).toBe(F_IMPORTANT);
    // important only means something on a block filter.
    expect(rule("@@||a.example^$important").flags).toBe(F_EXCEPTION);
    expect(rule("||a.example^$image,badfilter").flags).toBe(F_BADFILTER);
  });

  test("domain= and from= with negation, entities and regexes", () => {
    expect(
      rule("/ads/$domain=a.example|~b.a.example|shop.*|/^news\\d\\./").from,
    ).toEqual({
      include: ["a.example", "shop.*", "/^news\\d\\./"],
      exclude: ["b.a.example"],
    });
    expect(rule("/ads/$from=A.Example").from?.include).toEqual(["a.example"]);
    expect(reason("/ads/$domain=")).toBe("invalid: bad domain= value");
    expect(reason("/ads/$domain=a b")).toBe("invalid: bad domain= value");
  });

  test("to=, top= and denyallow=", () => {
    const parsed = rule(
      "*$script,3p,domain=a.example,denyallow=x.example|y.example,to=~cdn.*,top=a.example",
    );
    expect(parsed.extra).toEqual({
      denyallow: ["x.example", "y.example"],
      to: { include: [], exclude: ["cdn.*"] },
      top: { include: ["a.example"], exclude: [] },
    });
    expect(reason("*$script,denyallow=x.example")).toBe(
      "invalid: denyallow= without domain=",
    );
  });

  test("method=", () => {
    expect(rule("||a.example^$method=POST|get").extra).toEqual({
      methods: METHODS.post! | METHODS.get!,
    });
    expect(rule("||a.example^$method=~get").extra).toEqual({
      notMethods: METHODS.get,
    });
    expect(reason("||a.example^$method=fetch")).toBe(
      "invalid: bad method= value",
    );
  });

  test("header=", () => {
    expect(rule("*$script,header=via:1.1 proxy").extra?.header).toEqual({
      name: "via",
      value: "1.1 proxy",
      regex: false,
      regexFlags: "",
      negated: false,
    });
    expect(
      rule("*$script,header=X-Cache:~/hit\\, from edge/i").extra?.header,
    ).toEqual({
      name: "x-cache",
      value: "hit\\, from edge",
      regex: true,
      regexFlags: "i",
      negated: true,
    });
    expect(rule("||a.example^$header=set-cookie").extra?.header?.value).toBe(
      undefined,
    );
    expect(rule("@@*$script,header").extra?.header?.name).toBe("");
    expect(reason("*$script,header")).toBe("invalid: bad header= value");
  });

  test("ipaddress= keeps a regular expression's case", () => {
    expect(rule("*$doc,ipaddress=LAN").extra?.ipaddress).toBe("lan");
    expect(rule("*$doc,ipaddress=/^10\\.\\D/").extra?.ipaddress).toBe(
      "/^10\\.\\D/",
    );
  });

  test("the cosmetic switches need an exception", () => {
    expect(rule("@@||a.example^$ghide").types).toBe(T_GENERICHIDE);
    expect(rule("@@||a.example^$elemhide,shide").types).toBe(
      T_ELEMHIDE | T_SPECIFICHIDE,
    );
    expect(reason("||a.example^$generichide")).toMatch(/need an exception/);
  });

  test("the placeholder and reason= are ignored", () => {
    expect(rule("||a.example^$_,image,___").types).toBe(T_IMAGE);
    expect(rule('||a.example^$doc,reason="Scam, fake shop"').types).toBe(
      T_DOCUMENT,
    );
  });

  test("an unknown option discards the filter", () => {
    expect(reason("||a.example^$script,frobnicate")).toBe(
      "invalid: unknown option: frobnicate",
    );
    expect(reason("||a.example^$webrtc")).toBe(
      "invalid: unknown option: webrtc",
    );
    expect(reason("||a.example^$~important")).toMatch(/can't be negated/);
    expect(reason("@@||a.example^$genericblock")).toMatch(/genericblock/);
  });

  test("what Electron can't do is unsupported, not invalid", () => {
    expect(reason("@@||a.example^$cname")).toMatch(/^unsupported: cname/);
    expect(reason("||a.example^$popunder")).toMatch(/^unsupported: popunder/);
    expect(reason("||a.example/x$replace=/a/b/", true)).toMatch(
      /^unsupported: replace=/,
    );
    // With another type, the filter still does its other work.
    expect(rule("||a.example^$popup,popunder").types).toBe(T_POPUP);
  });
});

describe("where the options start", () => {
  test("a $ in the pattern isn't the options", () => {
    expect(rule("||a.example/pay$now/x$script")).toMatchObject({
      pattern: "a.example/pay$now/x",
      types: T_SCRIPT,
    });
    expect(rule("/price=\\d+$/")).toMatchObject({
      patternKind: P_REGEX,
      pattern: "price=\\d+$",
    });
    expect(rule("/price=\\d+$/$image")).toMatchObject({
      patternKind: P_REGEX,
      pattern: "price=\\d+$",
      types: T_IMAGE,
    });
  });

  test("a $ or a comma in a value isn't a separator", () => {
    expect(rule("||a.example^$removeparam=/^utm_$/,doc")).toMatchObject({
      modifier: { type: "removeparam", value: "/^utm_$/" },
      types: T_DOCUMENT,
    });
    expect(
      rule("@@*$ghide,domain=/img[a-z]{3,5}\\.example/").from?.include,
    ).toEqual(["/img[a-z]{3,5}\\.example/"]);
    expect(
      rule("||a.example^$csp=script-src 'self' data:,domain=b.example"),
    ).toMatchObject({
      modifier: { type: "csp", value: "script-src 'self' data:" },
      from: { include: ["b.example"] },
    });
  });

  test("a pattern between slashes before a regex value stays a pattern", () => {
    expect(rule("/ad-$removeparam=/^id=\\d$/,_")).toMatchObject({
      patternKind: P_PATTERN,
      pattern: "/ad-",
      modifier: { type: "removeparam", value: "/^id=\\d$/" },
    });
  });
});

describe("modifiers", () => {
  test("redirect= and redirect-rule=, with a priority", () => {
    expect(rule("||a.example/ad.js$script,redirect=noop.js")).toMatchObject({
      modifier: { type: "redirect", value: "noop.js", priority: 0 },
      types: T_SCRIPT,
    });
    expect(
      rule("||a.example/*.js$1p,script,redirect-rule=noopjs:100").modifier,
    ).toEqual({ type: "redirect-rule", value: "noopjs", priority: 100 });
    expect(
      rule("||a.example^$image,redirect=1x1.gif:-1").modifier?.priority,
    ).toBe(-1);
    // An exception only ever lifts the redirect, never the block.
    expect(rule("@@||a.example^$script,redirect=noop.js").modifier?.type).toBe(
      "redirect-rule",
    );
    expect(rule("@@||a.example^$script,redirect-rule").modifier).toEqual({
      type: "redirect-rule",
      value: "",
      priority: 0,
    });
    expect(reason("||a.example^$script,redirect-rule")).toMatch(/value/);
  });

  test("empty, mp4 and Adblock Plus's rewrite= are redirects", () => {
    expect(rule("||a.example/ad$empty").modifier).toMatchObject({
      type: "redirect",
      value: "empty",
    });
    expect(rule("||a.example/ad.mp4$mp4")).toMatchObject({
      modifier: { type: "redirect", value: "noopmp4-1s" },
      types: T_MEDIA,
    });
    expect(
      rule("||a.example/v.mp4$rewrite=abp-resource:blank-mp4").modifier?.value,
    ).toBe("blank-mp4");
    expect(reason("||a.example/x$rewrite=/y")).toBe(
      "invalid: bad rewrite= value",
    );
  });

  test("csp= and permissions= apply to documents", () => {
    expect(rule("||a.example^$csp=script-src 'none'")).toMatchObject({
      modifier: { type: "csp", value: "script-src 'none'" },
      types: T_DOCUMENT | T_SUBDOCUMENT,
    });
    expect(rule("||a.example^$doc,csp=worker-src 'none'").types).toBe(
      T_DOCUMENT,
    );
    expect(rule("@@||a.example^$csp").modifier?.value).toBe("");
    expect(reason("||a.example^$csp")).toMatch(/value/);
    expect(reason("||a.example^$script,csp=x")).toBe(
      "invalid: no request type left",
    );
    expect(
      reason("||a.example^$csp=default-src 'self'; report-uri /r"),
    ).toMatch(/report directive/);
    expect(
      rule("||a.example^$permissions=camera=()|microphone=()").modifier,
    ).toMatchObject({
      type: "permissions",
      value: "camera=(), microphone=()",
    });
  });

  test("removeparam= applies to pages and their requests", () => {
    expect(rule("*$removeparam=utm_source")).toMatchObject({
      patternKind: P_ALL,
      modifier: { type: "removeparam", value: "utm_source" },
      types: T_NETWORK | T_DOCUMENT,
    });
    expect(rule("||a.example^$removeparam").modifier?.value).toBe("");
    expect(rule("||a.example^$xhr,queryprune=id").types).toBe(T_XHR);
  });

  test("urlskip= and uritransform= need a trusted list", () => {
    expect(rule("||a.example/out?$urlskip=?url -base64", true)).toMatchObject({
      modifier: { type: "urlskip", value: "?url -base64" },
      types: T_NETWORK | T_DOCUMENT,
    });
    expect(
      rule("||a.example^$doc,uritransform=/\\/ref=[^/]+//", true).modifier,
    ).toMatchObject({ type: "uritransform", value: "/\\/ref=[^/]+//" });
    expect(reason("||a.example/out?$urlskip=?url")).toMatch(/untrusted/);
    expect(reason("||a.example^$uritransform=/a/b/")).toMatch(/untrusted/);
  });

  test("a filter has one modifier", () => {
    expect(reason("||a.example^$csp=x,removeparam=y")).toBe(
      "invalid: two modifiers",
    );
  });
});

import { describe, expect, test } from "vitest";
import { parseList } from "../parser/index.js";
import { T_ELEMHIDE, T_GENERICHIDE, T_SPECIFICHIDE } from "../parser/types.js";
import { PublicSuffixList } from "../psl/psl.js";
import { NetworkEngine } from "./engine.js";
import type { RequestInfo, RequestType } from "./request.js";

const psl = new PublicSuffixList("com\nexample\nco.example\nnet\norg");
const PAGE = "https://www.site.example/page";

function build(...lines: string[]): NetworkEngine {
  const list = parseList(lines.join("\n"), { trusted: true });
  expect(list.stats.invalid).toEqual({});
  expect(list.stats.unsupported).toEqual({});
  const engine = new NetworkEngine({
    psl,
    resource: (token) =>
      ({ "noop.js": "noop.js", noopjs: "noop.js", "1x1.gif": "1x1.gif" })[
        token
      ],
  });
  engine.add(list.network);
  engine.finalize();
  return engine;
}

function request(
  engine: NetworkEngine,
  url: string,
  type: RequestType = "script",
  more: Partial<RequestInfo> = {},
) {
  return engine.request({ url, type, sourceUrl: PAGE, ...more });
}

function blocks(
  engine: NetworkEngine,
  url: string,
  type: RequestType = "script",
  more: Partial<RequestInfo> = {},
): boolean {
  return engine.match(request(engine, url, type, more)).block;
}

describe("patterns", () => {
  test("a host rule blocks the hostname and its subdomains", () => {
    const engine = build("||ads.example^");
    expect(blocks(engine, "https://ads.example/x.js")).toBe(true);
    expect(blocks(engine, "https://a.b.ads.example/x.js")).toBe(true);
    expect(blocks(engine, "https://ads.example:8080/x.js")).toBe(true);
    expect(blocks(engine, "https://ads.example./x.js")).toBe(true);
    expect(blocks(engine, "https://badads.example/x.js")).toBe(false);
    expect(blocks(engine, "https://ads.example.org/x.js")).toBe(false);
    expect(blocks(engine, "https://site.example/ads.example/x.js")).toBe(false);
  });

  test("the decision names the filter", () => {
    const engine = build("||ads.example^", "@@||ads.example/ok.js");
    expect(engine.match(request(engine, "https://ads.example/x.js"))).toEqual({
      block: true,
      filter: "||ads.example^",
      redirect: undefined,
    });
    expect(engine.match(request(engine, "https://ads.example/ok.js"))).toEqual({
      block: false,
      filter: "@@||ads.example/ok.js",
      redirect: undefined,
    });
    expect(engine.match(request(engine, "https://other.example/x.js"))).toEqual(
      { block: false, filter: undefined, redirect: undefined },
    );
  });

  test("a plain pattern matches anywhere in the URL, in any case", () => {
    const engine = build("/Banner/ad_");
    expect(blocks(engine, "https://cdn.example/BANNER/ad_1.js")).toBe(true);
    expect(blocks(engine, "https://cdn.example/x?u=/banner/ad_")).toBe(true);
    expect(blocks(engine, "https://cdn.example/banner/ad-1.js")).toBe(false);
  });

  test("* is anything and ^ is a separator or the end", () => {
    const engine = build("/ads/*/img^", "^track^");
    expect(blocks(engine, "https://cdn.example/ads/2/img/a.png")).toBe(true);
    expect(blocks(engine, "https://cdn.example/ads/2/img?x=1")).toBe(true);
    expect(blocks(engine, "https://cdn.example/ads/2/img")).toBe(true);
    expect(blocks(engine, "https://cdn.example/ads/2/img.png")).toBe(false);
    expect(blocks(engine, "https://cdn.example/ads/2/img-1")).toBe(false);
    expect(blocks(engine, "https://cdn.example/a/track/b")).toBe(true);
    expect(blocks(engine, "https://cdn.example/a/track")).toBe(true);
    expect(blocks(engine, "https://cdn.example/a/tracker")).toBe(false);
    expect(blocks(engine, "https://cdn.example/a/track_b")).toBe(false);
  });

  test("|| anchors a pattern at a hostname label", () => {
    const engine = build("||cdn.example/ads/", "||banner.");
    expect(blocks(engine, "https://cdn.example/ads/x.js")).toBe(true);
    expect(blocks(engine, "http://a.cdn.example/ads/x.js")).toBe(true);
    expect(blocks(engine, "https://user:pw@cdn.example/ads/x.js")).toBe(true);
    expect(blocks(engine, "https://notcdn.example/ads/x.js")).toBe(false);
    expect(blocks(engine, "https://x.example/cdn.example/ads/x.js")).toBe(
      false,
    );
    expect(blocks(engine, "https://banner.x.example/y.js")).toBe(true);
    expect(blocks(engine, "https://a.banner.x.example/y.js")).toBe(true);
    expect(blocks(engine, "https://x.example/banner.js")).toBe(false);
  });

  test("|| with a wildcard or a separator", () => {
    const engine = build("||cdn.example^*/promo.", "||ads.*.example^");
    expect(blocks(engine, "https://cdn.example/a/b/promo.js")).toBe(true);
    expect(blocks(engine, "https://x.cdn.example/a/promo.js")).toBe(true);
    // The separator takes the slash: the pattern needs another one.
    expect(blocks(engine, "https://cdn.example/promo.js")).toBe(false);
    expect(blocks(engine, "https://cdn.example.org/a/promo.js")).toBe(false);
    expect(blocks(engine, "https://ads.eu.example/x.js")).toBe(true);
    expect(blocks(engine, "https://www.ads.eu.example/x.js")).toBe(true);
    expect(blocks(engine, "https://myads.eu.example/x.js")).toBe(false);
  });

  test("| anchors a pattern at the start or the end of the URL", () => {
    const engine = build("|http://", ".swf|", "|https://exact.example/a.js|");
    expect(blocks(engine, "http://x.example/a.js")).toBe(true);
    expect(blocks(engine, "https://x.example/?u=http://y")).toBe(false);
    expect(blocks(engine, "https://x.example/movie.swf")).toBe(true);
    expect(blocks(engine, "https://x.example/movie.swf?x")).toBe(false);
    expect(blocks(engine, "https://exact.example/a.js")).toBe(true);
    expect(blocks(engine, "https://exact.example/a.js?x")).toBe(false);
  });

  test("a regular expression, case-insensitive unless match-case", () => {
    const engine = build(
      "/\\/ad[0-9]{2}\\.js$/",
      "/\\/Track[A-Z]\\.gif/$image,match-case",
    );
    expect(blocks(engine, "https://x.example/AD42.js")).toBe(true);
    expect(blocks(engine, "https://x.example/ad4.js")).toBe(false);
    expect(blocks(engine, "https://x.example/TrackA.gif", "image")).toBe(true);
    expect(blocks(engine, "https://x.example/tracka.gif", "image")).toBe(false);
  });

  test("a rule for every URL needs its options to hold", () => {
    const engine = build("*$websocket,domain=site.example");
    expect(blocks(engine, "wss://any.example/socket", "websocket")).toBe(true);
    expect(blocks(engine, "https://any.example/a.js", "script")).toBe(false);
    expect(
      blocks(engine, "wss://any.example/socket", "websocket", {
        sourceUrl: "https://other.example/",
      }),
    ).toBe(false);
  });
});

describe("options", () => {
  test("a filter applies to its types only", () => {
    const engine = build("||ads.example^$script,image", "/pixel.$~image");
    expect(blocks(engine, "https://ads.example/a", "script")).toBe(true);
    expect(blocks(engine, "https://ads.example/a", "image")).toBe(true);
    expect(blocks(engine, "https://ads.example/a", "xhr")).toBe(false);
    expect(blocks(engine, "https://x.example/pixel.gif", "xhr")).toBe(true);
    expect(blocks(engine, "https://x.example/pixel.gif", "image")).toBe(false);
  });

  test("only a host rule or an explicit type blocks a page", () => {
    const engine = build("||bad.example^", "/landing/", "/popunder/$doc");
    expect(blocks(engine, "https://bad.example/", "document")).toBe(true);
    expect(blocks(engine, "https://x.example/landing/", "document")).toBe(
      false,
    );
    expect(blocks(engine, "https://x.example/landing/", "subdocument")).toBe(
      true,
    );
    expect(blocks(engine, "https://x.example/popunder/", "document")).toBe(
      true,
    );
  });

  test("third-party and first-party compare registrable domains", () => {
    const engine = build("/3p.js$third-party", "/1p.js$1p");
    const from = (sourceUrl: string, url: string) =>
      blocks(engine, url, "script", { sourceUrl });
    expect(from(PAGE, "https://cdn.other.example/3p.js")).toBe(true);
    expect(from(PAGE, "https://cdn.site.example/3p.js")).toBe(false);
    expect(from(PAGE, "https://cdn.site.example/1p.js")).toBe(true);
    expect(from(PAGE, "https://cdn.other.example/1p.js")).toBe(false);
    // co.example is a public suffix: its sites are strangers to each other.
    expect(from("https://a.co.example/", "https://b.co.example/3p.js")).toBe(
      true,
    );
    expect(
      from("https://www.a.co.example/", "https://cdn.a.co.example/3p.js"),
    ).toBe(false);
  });

  test("a page is first-party to itself, whatever opened it", () => {
    const engine = build(
      "||shop.example^$third-party",
      "||news.example^$1p,doc",
    );
    const navigate = (url: string) =>
      blocks(engine, url, "document", { sourceUrl: "https://other.example/" });
    expect(navigate("https://shop.example/")).toBe(false);
    expect(navigate("https://news.example/")).toBe(true);
  });

  test("strict1p and strict3p compare hostnames", () => {
    const engine = build("/s1.js$strict1p", "/s3.js$1p,strict3p");
    expect(blocks(engine, "https://www.site.example/s1.js")).toBe(true);
    expect(blocks(engine, "https://cdn.site.example/s1.js")).toBe(false);
    expect(blocks(engine, "https://cdn.site.example/s3.js")).toBe(true);
    expect(blocks(engine, "https://www.site.example/s3.js")).toBe(false);
    expect(blocks(engine, "https://cdn.other.example/s3.js")).toBe(false);
  });

  test("domain= limits a filter to pages, with negation", () => {
    const engine = build("/ads.js$domain=site.example|~shop.site.example");
    const from = (sourceUrl: string) =>
      blocks(engine, "https://cdn.example/ads.js", "script", { sourceUrl });
    expect(from("https://site.example/")).toBe(true);
    expect(from("https://www.site.example/")).toBe(true);
    expect(from("https://shop.site.example/")).toBe(false);
    expect(from("https://a.shop.site.example/")).toBe(false);
    expect(from("https://other.example/")).toBe(false);
    expect(from("https://notsite.example/")).toBe(false);
  });

  test("domain= with only negated entries applies everywhere else", () => {
    const engine = build("/ads.js$domain=~site.example");
    const from = (sourceUrl: string) =>
      blocks(engine, "https://cdn.example/ads.js", "script", { sourceUrl });
    expect(from("https://other.example/")).toBe(true);
    expect(from("https://www.site.example/")).toBe(false);
  });

  test("domain= with an entity and a regular expression", () => {
    const engine = build(
      "/e.js$domain=shop.*",
      "/r.js$domain=/^img[a-z]{2,3}\\.example$/",
    );
    const from = (sourceUrl: string, file: string) =>
      blocks(engine, `https://cdn.example/${file}`, "script", { sourceUrl });
    expect(from("https://shop.com/", "e.js")).toBe(true);
    expect(from("https://www.shop.co.example/", "e.js")).toBe(true);
    // The name before the suffix has to be the entity's.
    expect(from("https://shop.evil.com/", "e.js")).toBe(false);
    expect(from("https://imgab.example/", "r.js")).toBe(true);
    expect(from("https://img.example/", "r.js")).toBe(false);
  });

  test("to= limits a filter to request hostnames", () => {
    const engine = build("*$script,domain=site.example,to=cdn.*|~ok.cdn.com");
    expect(blocks(engine, "https://a.cdn.com/x.js")).toBe(true);
    expect(blocks(engine, "https://ok.cdn.com/x.js")).toBe(false);
    expect(blocks(engine, "https://other.com/x.js")).toBe(false);
  });

  test("denyallow= blocks everything but the hostnames it names", () => {
    const engine = build(
      "*$3p,script,denyallow=cdn.example|static.example,domain=site.example",
    );
    expect(blocks(engine, "https://evil.example/x.js")).toBe(true);
    expect(blocks(engine, "https://cdn.example/x.js")).toBe(false);
    expect(blocks(engine, "https://a.static.example/x.js")).toBe(false);
  });

  test("top= looks at the top document", () => {
    const engine = build("/widget.js$top=site.example");
    const frame = "https://frame.example/";
    expect(
      blocks(engine, "https://cdn.example/widget.js", "script", {
        sourceUrl: frame,
        topUrl: PAGE,
      }),
    ).toBe(true);
    expect(
      blocks(engine, "https://cdn.example/widget.js", "script", {
        sourceUrl: frame,
        topUrl: "https://other.example/",
      }),
    ).toBe(false);
  });

  test("method= limits a filter to HTTP methods", () => {
    const engine = build("||api.example^$method=post|put", "/log$method=~get");
    const send = (url: string, method?: string) =>
      blocks(engine, url, "xhr", { method });
    expect(send("https://api.example/x", "POST")).toBe(true);
    expect(send("https://api.example/x", "GET")).toBe(false);
    expect(send("https://api.example/x")).toBe(false);
    expect(send("https://x.example/log", "POST")).toBe(true);
    expect(send("https://x.example/log", "GET")).toBe(false);
  });

  test("ipaddress= matches a URL whose host is an address", () => {
    const engine = build(
      "*$script,ipaddress=203.0.113.9",
      "*$image,ipaddress=198.51.*",
      "*$xhr,ipaddress=lan",
      "*$font,ipaddress=loopback",
      "*$media,ipaddress=/^192\\.0\\.2\\.\\d$/",
    );
    expect(blocks(engine, "http://203.0.113.9/a.js", "script")).toBe(true);
    expect(blocks(engine, "http://203.0.113.90/a.js", "script")).toBe(false);
    expect(blocks(engine, "http://named.example/a.js", "script")).toBe(false);
    expect(blocks(engine, "http://198.51.100.7/a.png", "image")).toBe(true);
    expect(blocks(engine, "http://192.168.1.4/a", "xhr")).toBe(true);
    expect(blocks(engine, "http://172.20.0.1/a", "xhr")).toBe(true);
    expect(blocks(engine, "http://[fd00::1]/a", "xhr")).toBe(true);
    expect(blocks(engine, "http://172.32.0.1/a", "xhr")).toBe(false);
    expect(blocks(engine, "http://127.0.0.1:8080/a", "font")).toBe(true);
    expect(blocks(engine, "http://[::1]/a", "font")).toBe(true);
    expect(blocks(engine, "http://192.0.2.5/a", "media")).toBe(true);
    expect(blocks(engine, "http://192.0.2.55/a", "media")).toBe(false);
  });

  test("popup filters only answer for popups", () => {
    const engine = build("||pop.example^$popup", "||ads.example^");
    expect(blocks(engine, "https://pop.example/", "popup")).toBe(true);
    expect(blocks(engine, "https://pop.example/a.js", "script")).toBe(false);
    expect(blocks(engine, "https://ads.example/", "popup")).toBe(false);
  });
});

describe("precedence", () => {
  test("an exception lifts a block, and important ignores the exception", () => {
    const engine = build(
      "||ads.example^",
      "@@||ads.example/ok/",
      "||ads.example/ok/never.js$important",
    );
    expect(blocks(engine, "https://ads.example/x.js")).toBe(true);
    expect(blocks(engine, "https://ads.example/ok/x.js")).toBe(false);
    expect(blocks(engine, "https://ads.example/ok/never.js")).toBe(true);
  });

  test("a document exception lifts the block of a page", () => {
    const engine = build("||bad.example^", "@@||bad.example^$doc");
    expect(blocks(engine, "https://bad.example/", "document")).toBe(false);
    expect(blocks(engine, "https://bad.example/a.js", "script")).toBe(true);
  });

  test("badfilter removes the filter that reads the same", () => {
    const engine = build(
      "||ads.example^$script,third-party",
      "||ads.example^$3p,script,badfilter",
      "||keep.example^$script",
      "||keep.example^$image,badfilter",
      "@@||ok.example^",
      "@@||ok.example^$badfilter",
      "||ok.example^",
    );
    expect(engine.stats.badfiltered).toBe(2);
    expect(blocks(engine, "https://ads.example/x.js")).toBe(false);
    expect(blocks(engine, "https://keep.example/x.js")).toBe(true);
    expect(blocks(engine, "https://ok.example/x.js")).toBe(true);
  });

  test("badfilter can remove one site of a filter for every URL", () => {
    const engine = build(
      "*$image,domain=site.example|shop.example",
      "*$image,domain=shop.example,badfilter",
      "|https://$font,domain=one.example",
      "|https://$font,domain=one.example,badfilter",
    );
    const from = (sourceUrl: string, type: RequestType) =>
      blocks(engine, "https://cdn.example/x", type, { sourceUrl });
    expect(from("https://site.example/", "image")).toBe(true);
    expect(from("https://shop.example/", "image")).toBe(false);
    expect(from("https://one.example/", "font")).toBe(false);
    expect(engine.stats.badfiltered).toBe(1);
  });
});

describe("redirects", () => {
  test("redirect= blocks and names the resource to answer with", () => {
    const engine = build("||ads.example/lib.js$script,redirect=noopjs");
    expect(engine.match(request(engine, "https://ads.example/lib.js"))).toEqual(
      {
        block: true,
        filter: "||ads.example/lib.js$script,redirect=noopjs",
        redirect: "noop.js",
      },
    );
    expect(blocks(engine, "https://ads.example/lib.js", "image")).toBe(false);
  });

  test("redirect-rule= only redirects what something else blocks", () => {
    const alone = build("||ads.example/lib.js$script,redirect-rule=noop.js");
    expect(
      alone.match(request(alone, "https://ads.example/lib.js")),
    ).toMatchObject({ block: false, redirect: undefined });
    const both = build(
      "||ads.example/lib.js$script,redirect-rule=noop.js",
      "||ads.example^",
    );
    expect(both.match(request(both, "https://ads.example/lib.js"))).toEqual({
      block: true,
      filter: "||ads.example^",
      redirect: "noop.js",
    });
  });

  test("the highest priority wins, and important beats priority", () => {
    const engine = build(
      "||ads.example^$image,redirect=1x1.gif",
      "||ads.example/a$image,redirect-rule=noop.js:10",
      "||ads.example/a/b$image,redirect-rule=1x1.gif:5,important",
    );
    const redirect = (url: string) =>
      engine.match(request(engine, url, "image")).redirect;
    expect(redirect("https://ads.example/x")).toBe("1x1.gif");
    expect(redirect("https://ads.example/a")).toBe("noop.js");
    expect(redirect("https://ads.example/a/b")).toBe("1x1.gif");
  });

  test("an exception lifts one redirect or all of them, never the block", () => {
    const engine = build(
      "||ads.example^$script,redirect=noop.js",
      "@@||ads.example/one.js$script,redirect-rule=noopjs",
      "@@||ads.example/all.js$script,redirect-rule",
      "||ads.example/legacy.js$script,redirect=none",
    );
    const match = (url: string) => engine.match(request(engine, url));
    expect(match("https://ads.example/x.js").redirect).toBe("noop.js");
    for (const file of ["one.js", "all.js", "legacy.js"]) {
      expect(match(`https://ads.example/${file}`)).toMatchObject({
        block: true,
        redirect: undefined,
      });
    }
  });

  test("a filter naming a resource that doesn't exist is discarded", () => {
    const engine = build(
      "||ads.example^$script,redirect=no-such-thing.js",
      "||ads.example^$image,redirect-rule=no-such-thing.js",
    );
    expect(engine.stats.unknownResources).toEqual({ "no-such-thing.js": 2 });
    expect(engine.stats.rules).toBe(0);
    expect(blocks(engine, "https://ads.example/x.js")).toBe(false);
  });
});

describe("rewrites", () => {
  const rewrite = (
    engine: NetworkEngine,
    url: string,
    type: RequestType = "document",
  ) => engine.rewrite(request(engine, url, type));

  test("removeparam= removes parameters by name, regex or all", () => {
    const engine = build(
      "*$removeparam=utm_source",
      "||shop.example^$removeparam=/^ref_/",
      "||all.example^$removeparam",
    );
    expect(rewrite(engine, "https://x.example/p?a=1&utm_source=n&b=2#h")).toBe(
      "https://x.example/p?a=1&b=2#h",
    );
    expect(rewrite(engine, "https://x.example/p?utm_source=n")).toBe(
      "https://x.example/p",
    );
    expect(rewrite(engine, "https://shop.example/p?ref_a=1&ref=2")).toBe(
      "https://shop.example/p?ref=2",
    );
    expect(rewrite(engine, "https://all.example/p?a=1&b=2")).toBe(
      "https://all.example/p",
    );
    expect(rewrite(engine, "https://x.example/p?a=1")).toBeUndefined();
    expect(rewrite(engine, "https://x.example/utm_source")).toBeUndefined();
  });

  test("removeparam= honours types, sites and exceptions", () => {
    const engine = build(
      "*$xhr,removeparam=sid",
      "*$removeparam=gclid,domain=site.example",
      "*$removeparam=fbclid",
      "@@||keep.example^$removeparam=fbclid",
      "*$removeparam=mc_id",
      "@@||keepall.example^$removeparam",
      "||keepall.example^$removeparam=mc_id2,important",
    );
    expect(rewrite(engine, "https://x.example/?sid=1", "xhr")).toBe(
      "https://x.example/",
    );
    expect(
      rewrite(engine, "https://x.example/?sid=1", "image"),
    ).toBeUndefined();
    expect(rewrite(engine, "https://x.example/?gclid=1", "image")).toBe(
      "https://x.example/",
    );
    expect(
      engine.rewrite(
        request(engine, "https://x.example/?gclid=1", "image", {
          sourceUrl: "https://other.example/",
        }),
      ),
    ).toBeUndefined();
    expect(rewrite(engine, "https://keep.example/?fbclid=1&mc_id=2")).toBe(
      "https://keep.example/?fbclid=1",
    );
    expect(
      rewrite(engine, "https://keepall.example/?fbclid=1&mc_id=2&mc_id2=3"),
    ).toBe("https://keepall.example/?fbclid=1&mc_id=2");
  });

  test("urlskip= goes straight to the URL a link wraps", () => {
    const engine = build(
      "||out.example/go?$urlskip=?url",
      "||b64.example/r?$urlskip=?u -base64",
      "||blocked.example^",
      "||blocked.example/a?$urlskip=?to",
      "||blocked.example/b?$urlskip=-blocked ?to",
    );
    expect(
      rewrite(
        engine,
        "https://out.example/go?url=https%3A%2F%2Fdest.example%2Fp",
      ),
    ).toBe("https://dest.example/p");
    expect(rewrite(engine, "https://out.example/go?other=1")).toBeUndefined();
    expect(
      rewrite(
        engine,
        `https://b64.example/r?u=${btoa("https://dest.example/")}`,
      ),
    ).toBe("https://dest.example/");
    const blocked = (url: string) =>
      engine.rewrite(request(engine, url, "document"), true);
    expect(
      blocked("https://blocked.example/a?to=https://dest.example/"),
    ).toBeUndefined();
    expect(blocked("https://blocked.example/b?to=https://dest.example/")).toBe(
      "https://dest.example/",
    );
  });

  test("uritransform= rewrites the path", () => {
    const engine = build("||shop.example^$doc,uritransform=/\\/ref=[^/?#]+//");
    expect(rewrite(engine, "https://shop.example/item/ref=abc?x=1")).toBe(
      "https://shop.example/item?x=1",
    );
    expect(rewrite(engine, "https://shop.example/item")).toBeUndefined();
  });
});

describe("responses", () => {
  const respond = (
    engine: NetworkEngine,
    url: string,
    type: RequestType,
    headers: Record<string, string> = {},
  ) => engine.response(request(engine, url, type), (name) => headers[name]);

  test("csp= adds policies to documents, unless an exception lifts them", () => {
    const engine = build(
      "||site.example^$csp=script-src 'none'",
      "||site.example^$csp=worker-src 'none'",
      "@@||site.example/app/$csp=worker-src 'none'",
      "@@||site.example/free/$csp",
    );
    expect(respond(engine, "https://site.example/", "document").csp).toEqual([
      "script-src 'none'",
      "worker-src 'none'",
    ]);
    expect(
      respond(engine, "https://site.example/app/", "subdocument").csp,
    ).toEqual(["script-src 'none'"]);
    expect(
      respond(engine, "https://site.example/free/", "document").csp,
    ).toEqual([]);
    expect(respond(engine, "https://site.example/a.js", "script").csp).toEqual(
      [],
    );
  });

  test("permissions= adds a Permissions-Policy", () => {
    const engine = build(
      "||site.example^$permissions=camera=()|geolocation=()",
    );
    expect(respond(engine, "https://site.example/", "document")).toEqual({
      block: false,
      filter: undefined,
      csp: [],
      permissions: ["camera=(), geolocation=()"],
    });
  });

  test("inline-script and inline-font become policies", () => {
    const engine = build(
      "||site.example^$inline-script",
      "||fonts.example^$inline-font",
      "@@||site.example/ok/$inline-script",
    );
    expect(respond(engine, "https://site.example/", "document").csp).toEqual([
      "script-src 'unsafe-eval' * blob: data:",
    ]);
    expect(respond(engine, "https://site.example/ok/", "document").csp).toEqual(
      [],
    );
    expect(respond(engine, "https://fonts.example/", "document").csp).toEqual([
      "font-src *",
    ]);
  });

  test("header= blocks a response by its headers", () => {
    const engine = build(
      "*$script,header=via:1.1 proxy",
      "||re.example^$header=x-tag:/^ad-\\d+$/i",
      "||not.example^$header=x-tag:~clean",
      "||has.example^$header=x-ad",
    );
    const script = (url: string, headers: Record<string, string>) =>
      respond(engine, url, "script", headers).block;
    expect(script("https://x.example/a.js", { via: "1.1 proxy" })).toBe(true);
    expect(script("https://x.example/a.js", { via: "2.0 proxy" })).toBe(false);
    expect(script("https://x.example/a.js", {})).toBe(false);
    expect(script("https://re.example/a.js", { "x-tag": "AD-12" })).toBe(true);
    expect(script("https://re.example/a.js", { "x-tag": "ad" })).toBe(false);
    expect(script("https://not.example/a.js", { "x-tag": "dirty" })).toBe(true);
    expect(script("https://not.example/a.js", { "x-tag": "clean" })).toBe(
      false,
    );
    expect(script("https://has.example/a.js", { "x-ad": "" })).toBe(true);
    // A header= filter never blocks before the response.
    expect(blocks(engine, "https://has.example/a.js")).toBe(false);
  });

  test("an exception lifts a header= block", () => {
    const engine = build(
      "*$script,header=x-ad",
      "@@||any.example^$script,header",
      "@@||one.example^$script,header=x-ok",
      "@@||plain.example^",
      "||plain.example/must.js$script,header=x-ad,important",
    );
    const script = (url: string, headers: Record<string, string>) =>
      respond(engine, url, "script", headers).block;
    expect(script("https://x.example/a.js", { "x-ad": "1" })).toBe(true);
    expect(script("https://any.example/a.js", { "x-ad": "1" })).toBe(false);
    expect(script("https://one.example/a.js", { "x-ad": "1" })).toBe(true);
    expect(
      script("https://one.example/a.js", { "x-ad": "1", "x-ok": "1" }),
    ).toBe(false);
    expect(script("https://plain.example/a.js", { "x-ad": "1" })).toBe(false);
    expect(script("https://plain.example/must.js", { "x-ad": "1" })).toBe(true);
  });
});

describe("cosmeticSwitches", () => {
  test("exceptions switch cosmetic filtering off for a document", () => {
    const engine = build(
      "@@||site.example^$ghide",
      "@@||site.example/app/$shide",
      "@@*$ehide,domain=off.example",
      "@@||blocked.example^",
    );
    const switches = (url: string) =>
      engine.cosmeticSwitches(request(engine, url, "document"));
    expect(switches("https://site.example/")).toBe(T_GENERICHIDE);
    expect(switches("https://site.example/app/")).toBe(
      T_GENERICHIDE | T_SPECIFICHIDE,
    );
    expect(switches("https://off.example/x")).toBe(T_ELEMHIDE);
    expect(switches("https://blocked.example/")).toBe(0);
    // A switch isn't an exception for requests.
    const blocking = build("||site.example^", "@@||site.example^$ghide");
    expect(blocks(blocking, "https://site.example/a.js")).toBe(true);
  });
});

describe("the index", () => {
  test("finds each rule among many, however it is filed", () => {
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) {
      lines.push(
        `||host${i}.example^`,
        `||path${i}.example/ads/`,
        `/token${i}/banner.`,
        `*$font,domain=source${i}.example`,
        `*$media,domain=entity${i}.*`,
      );
    }
    lines.push("/\\/re[0-9]+x\\//", "*$ping,domain=/^regex\\d\\./");
    const engine = build(...lines);
    expect(engine.stats.rules).toBe(1502);
    for (const i of [0, 137, 299]) {
      expect(blocks(engine, `https://a.host${i}.example/x.js`)).toBe(true);
      expect(blocks(engine, `https://path${i}.example/ads/x.js`)).toBe(true);
      expect(blocks(engine, `https://path${i}.example/x.js`)).toBe(false);
      expect(blocks(engine, `https://x.example/token${i}/banner.png`)).toBe(
        true,
      );
      expect(blocks(engine, `https://x.example/token${i}x/banner.png`)).toBe(
        false,
      );
      expect(
        blocks(engine, "https://x.example/f.woff", "font", {
          sourceUrl: `https://www.source${i}.example/`,
        }),
      ).toBe(true);
      expect(
        blocks(engine, "https://x.example/v.mp4", "media", {
          sourceUrl: `https://www.entity${i}.co.example/`,
        }),
      ).toBe(true);
    }
    expect(blocks(engine, "https://host300.example/x.js")).toBe(false);
    expect(blocks(engine, "https://x.example/re42x/a.js")).toBe(true);
    expect(
      blocks(engine, "https://x.example/p", "ping", {
        sourceUrl: "https://regex1.example/",
      }),
    ).toBe(true);
    expect(
      blocks(engine, "https://x.example/f.woff", "font", {
        sourceUrl: "https://nosource.example/",
      }),
    ).toBe(false);
  });

  test("the same host rule from two lists is one decision", () => {
    const engine = build(
      "||ads.example^",
      "||ads.example^",
      "||ads.example^$third-party",
      "@@||ads.example^$image",
    );
    expect(blocks(engine, "https://ads.example/x.js")).toBe(true);
    expect(blocks(engine, "https://ads.example/x.png", "image")).toBe(false);
  });
});

describe("plain hostname filters and badfilter", () => {
  test("a badfilter removes them from any list, before or after it", () => {
    const engine = new NetworkEngine({ psl });
    const add = (...lines: string[]) =>
      engine.add(parseList(lines.join("\n")).network);
    add("||early.example^", "||kept.example^", "||twice.example^");
    add(
      "||early.example^$badfilter",
      "||late.example^$badfilter",
      "||twice.example^$badfilter",
    );
    add("||late.example^", "||twice.example^");
    engine.finalize();
    for (const host of ["early", "late", "twice"]) {
      expect(blocks(engine, `https://${host}.example/x.js`)).toBe(false);
    }
    expect(blocks(engine, "https://kept.example/x.js")).toBe(true);
    // Each filter removed counts: the one in two lists twice.
    expect(engine.stats.badfiltered).toBe(4);
    expect(engine.stats.rules).toBe(1);
  });
});

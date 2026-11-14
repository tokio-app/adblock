import { describe, expect, it } from "vitest";
import { DEFUSERS, RESOURCES, findResource } from "./index.js";

// What the default lists' `redirect=` values name, and the other names the
// wiki and Adblock Plus's documentation give.
const NAMES = [
  "noopjs",
  "google-ima.js",
  "1x1.gif",
  "noop.js",
  "noopmp3-0.1s",
  "nooptext",
  "fingerprint2.js",
  "noop.txt",
  "googletagmanager_gtm.js",
  "googletagservices_gpt.js",
  "2x2.png",
  "noopmp4-1s",
  "google-analytics.com/analytics.js",
  "noopframe",
  "fuckadblock.js-3.2.0",
  "noop.html",
  "noop-0.1s.mp3",
  "googletagmanager.com/gtm.js",
  "amazon_apstag.js",
  "32x32.png",
  "googlesyndication_adsbygoogle.js",
  "noop.css",
  "chartbeat.js",
  "noopjson",
  "hd-main.js",
  "popads.net.js",
  "google-analytics_analytics.js",
  "google-analytics.com/cx/api.js",
  "googletagservices.com/gpt.js",
  "scorecardresearch.com/beacon.js",
  "google-analytics.com/ga.js",
  "outbrain-widget.js",
  "fingerprint3.js",
  "amazon-adsystem.com/aax2/amzn_ads.js",
  "noop-1s.mp4",
  "prebid-ads.js",
  "google-ima3",
  "noop-vmap1.xml",
  "sensors-analytics.js",
  "empty",
  "3x2.png",
  "noop-0.5s.mp3",
  "noop.json",
  "noop-vast2.xml",
  "noop-vast3.xml",
  "noop-vast4.xml",
  "click2load.html",
  "amazon_ads.js",
  "google-analytics_ga.js",
  "google-analytics_inpage_linkid.js",
  "google-analytics_cx_api.js",
  "scorecardresearch_beacon.js",
  "ampproject_v0.js",
  "nobab.js",
  "nobab2.js",
  "nofab.js",
  "popads.js",
  "popads-dummy.js",
  "ligatus_angular-tag.js",
  "addthis_widget.js",
  "monkeybroker.js",
  "noopcss",
  "noopvmap-1.0",
  "noopvast-2.0",
  "noopvast-3.0",
  "noopvast-4.0",
  "nobab",
  "google-ima",
  "blank-text",
  "blank-css",
  "blank-js",
  "blank-html",
  "blank-mp3",
  "blank-mp4",
  "1x1-transparent-gif",
  "2x2-transparent-png",
  "3x2-transparent-png",
  "32x32-transparent-png",
];

describe("findResource", () => {
  it.each(NAMES)("resolves %s", (name) => {
    expect(findResource(name)).toBeDefined();
  });

  it("knows nothing else", () => {
    expect(findResource("none")).toBeUndefined();
    expect(findResource("noop.exe")).toBeUndefined();
    expect(findResource("")).toBeUndefined();
  });

  it("finds a name with or without its .js", () => {
    expect(findResource("nofab")?.name).toBe("nofab.js");
    expect(findResource("google-ima3.js")?.name).toBe("google-ima.js");
    expect(findResource("noopjs")?.name).toBe("noop.js");
  });

  it("maps the aliases to the right files", () => {
    expect(findResource("noopframe")?.name).toBe("noop.html");
    expect(findResource("empty")?.name).toBe("noop.txt");
    expect(findResource("noopmp4-1s")?.name).toBe("noop-1s.mp4");
    expect(findResource("blank-mp3")?.name).toBe("noop-0.1s.mp3");
  });
});

describe("RESOURCES", () => {
  it("claims every name once, with or without .js", () => {
    const seen = new Map<string, string>();
    for (const resource of RESOURCES) {
      for (const name of [resource.name, ...resource.aliases]) {
        for (const form of new Set([name, name.replace(/\.js$/, "")])) {
          expect(seen.get(form), form).toBeUndefined();
          seen.set(form, resource.name);
        }
        expect(findResource(name)).toBe(resource);
      }
    }
  });

  it("gives every resource a body of its type", () => {
    for (const { name, mime, body } of RESOURCES) {
      const binary = /^(image|audio|video)\//.test(mime);
      expect(body instanceof Uint8Array, name).toBe(binary);
    }
  });

  it("builds each body once", () => {
    const png = findResource("2x2.png")!;
    expect(png.body).toBe(png.body);
  });

  it("serves the empty files empty", () => {
    for (const name of ["noop.js", "noop.txt", "noop.css"]) {
      expect(findResource(name)!.body).toBe("");
    }
    expect(JSON.parse(findResource("noop.json")!.body as string)).toEqual({});
  });
});

describe("DEFUSERS", () => {
  it("offers each defuser as the function its resource runs", () => {
    expect(Object.keys(DEFUSERS).sort()).toEqual(
      [
        "ampproject_v0",
        "fingerprint2",
        "fingerprint3",
        "nobab",
        "nobab2",
        "nofab",
        "popads",
        "popads-dummy",
        "prebid-ads",
      ].sort(),
    );
    for (const [name, fn] of Object.entries(DEFUSERS)) {
      expect(findResource(`${name}.js`)!.body).toBe(`(${fn.toString()})();\n`);
    }
  });
});

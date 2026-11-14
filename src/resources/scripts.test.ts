import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { RESOURCES, findResource } from "./index.js";

function page(html = "<!doctype html><html><head></head><body></body></html>") {
  const dom = new JSDOM(html, {
    url: "https://www.site.example/",
    runScripts: "outside-only",
  });
  const window = dom.window as any;
  return {
    window,
    load: (name: string) => window.eval(findResource(name)!.body),
    run: (code: string): any => window.eval(code),
    /** Waits for the page's timers. */
    settle: () =>
      new Promise<void>((resolve) => window.setTimeout(resolve, 20)),
  };
}

const scripts = RESOURCES.filter(({ mime }) => mime === "text/javascript");

describe("every script", () => {
  it.each(scripts.map(({ name }) => name))(
    "%s runs, twice, without throwing",
    (name) => {
      const { load } = page();
      expect(() => load(name)).not.toThrow();
      expect(() => load(name)).not.toThrow();
    },
  );

  it.each(scripts.map(({ name }) => name))(
    "%s runs where the globals it touches are taken",
    (name) => {
      const { load, run } = page();
      run(`
        for (const key of ["google", "googletag", "dataLayer", "ga", "adsbygoogle", "apstag", "_gaq"])
          window[key] = 1;
      `);
      expect(() => load(name)).not.toThrow();
    },
  );
});

describe("google-ima.js", () => {
  // A small player, the way the IMA guides set one up.
  const PLAYER = `
    window.log = [];
    const ima = google.ima;
    const video = document.createElement("video");
    document.body.append(video);
    const container = new ima.AdDisplayContainer(document.body, video);
    container.initialize();
    const loader = new ima.AdsLoader(container);
    loader.getSettings().setLocale("en");
    loader.addEventListener(
      ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
      (event) => {
        const manager = event.getAdsManager(video, new ima.AdsRenderingSettings());
        manager.addEventListener(ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, () => log.push("pause"));
        manager.init(640, 360, ima.ViewMode.NORMAL);
        manager.start();
        log.push("ads");
      },
      false,
    );
    loader.addEventListener(
      ima.AdErrorEvent.Type.AD_ERROR,
      function (event) {
        const error = event.getError();
        log.push("content", error.getErrorCode(), error.getType(),
          event.getUserRequestContext().id, this.name);
      },
      false,
      { name: "scope" },
    );
    const request = new ima.AdsRequest();
    request.adTagUrl = "https://ads.example/vast.xml";
    request.linearAdSlotWidth = 640;
    request.setAdWillAutoPlay(true);
    loader.requestAds(request, { id: 7 });
    log.push("requested");
  `;

  it("answers every request with no ads, so the content plays", async () => {
    const { load, run, settle } = page();
    load("google-ima.js");
    run(PLAYER);
    await settle();
    expect(run("log")).toEqual([
      "requested",
      "content",
      1009,
      "adLoadError",
      7,
      "scope",
    ]);
  });

  it("exposes the documented enums and settings", () => {
    const { load, run } = page();
    load("google-ima.js");
    expect(run("google.ima.AdError.ErrorCode.VAST_EMPTY_RESPONSE")).toBe(1009);
    expect(run("google.ima.AdEvent.Type.ALL_ADS_COMPLETED")).toBe(
      "allAdsCompleted",
    );
    expect(run("google.ima.ViewMode.FULLSCREEN")).toBe("fullscreen");
    expect(run("google.ima.UiElements.COUNTDOWN")).toBe("countdown");
    expect(run("google.ima.OmidAccessMode.FULL")).toBe("full");
    expect(run("google.ima.ImaSdkSettings.VpaidMode.ENABLED")).toBe(1);
    run("google.ima.settings.setPlayerType('test')");
    expect(run("google.ima.settings.getPlayerType()")).toBe("test");
    expect(
      run("new google.ima.CompanionAdSelectionSettings() instanceof Object"),
    ).toBe(true);
    expect(run("typeof google.ima.VERSION")).toBe("string");
  });

  it("removes a listener", async () => {
    const { load, run, settle } = page();
    load("google-ima.js");
    run(`
      window.calls = 0;
      const loader = new google.ima.AdsLoader();
      const listener = () => calls++;
      loader.addEventListener("adError", listener);
      loader.removeEventListener("adError", listener);
      loader.requestAds(new google.ima.AdsRequest());
    `);
    await settle();
    expect(run("calls")).toBe(0);
  });

  it("keeps what else lives under google", () => {
    const { load, run } = page();
    run("window.google = { maps: 1 }");
    load("google-ima.js");
    expect(run("google.maps")).toBe(1);
    expect(run("typeof google.ima.AdsLoader")).toBe("function");
  });
});

describe("googletagservices_gpt.js", () => {
  it("runs queued and new commands, and every slot renders empty", async () => {
    const { load, run, settle } = page('<div id="ad-1"></div>');
    run(`
      window.log = [];
      window.googletag = window.googletag || { cmd: [] };
      googletag.cmd.push(() => {
        const slot = googletag
          .defineSlot("/1234/news", [[300, 250]], "ad-1")
          .addService(googletag.pubads())
          .setTargeting("section", "news");
        googletag.pubads()
          .setTargeting("lang", "en")
          .addEventListener("slotRenderEnded", (event) =>
            log.push(event.isEmpty, event.slot.getSlotElementId(), event.slot === slot));
        googletag.pubads().enableSingleRequest();
        googletag.enableServices();
        log.push("queued");
      });
    `);
    load("googletagservices_gpt.js");
    expect(run("log")).toEqual(["queued"]);
    expect(run("googletag.apiReady && googletag.pubadsReady")).toBe(true);
    run(`log.push(googletag.cmd.push(() => googletag.display("ad-1")))`);
    await settle();
    expect(run("log")).toEqual(["queued", 2, true, "ad-1", true]);
  });

  it("renders on refresh when the initial load is off", async () => {
    const { load, run, settle } = page();
    load("googletagservices_gpt.js");
    run(`
      window.ended = 0;
      const pubads = googletag.pubads();
      pubads.disableInitialLoad();
      pubads.addEventListener("slotRenderEnded", () => ended++);
      googletag.defineSlot("/1/a", [728, 90], "a").addService(pubads);
      googletag.display("a");
    `);
    await settle();
    expect(run("ended")).toBe(0);
    run("googletag.pubads().refresh()");
    await settle();
    expect(run("ended")).toBe(1);
    expect(run("googletag.sizeMapping().addSize([0, 0], []).build()")).toEqual(
      [],
    );
  });

  it("keeps a command's error from stopping the others", () => {
    const { load, run } = page();
    load("googletagservices_gpt.js");
    run(
      `window.ran = false; googletag.cmd.push(() => { throw new Error("x"); }, () => { ran = true; })`,
    );
    expect(run("ran")).toBe(true);
  });
});

describe("googletagmanager_gtm.js", () => {
  it("calls eventCallback for pushes before and after it loads", async () => {
    const { load, run, settle } = page();
    run(`
      window.called = [];
      window.dataLayer = [{ event: "a", eventCallback: () => called.push("a") }];
    `);
    load("googletagmanager_gtm.js");
    load("googletagmanager_gtm.js");
    run(`
      dataLayer.push({ event: "b", eventCallback: () => called.push("b") });
      function gtag() { dataLayer.push(arguments); }
      gtag("event", "c", { event_callback: () => called.push("c") });
    `);
    await settle();
    expect(run("called")).toEqual(["a", "b", "c"]);
    expect(run("dataLayer.length")).toBe(3);
    expect(run("google_tag_manager['GTM-ABC'].dataLayer.get('x')")).toBe(
      undefined,
    );
  });
});

describe("google-analytics_analytics.js", () => {
  it("replays the queue and calls hitCallback and ready callbacks", async () => {
    const { load, run, settle } = page();
    run(`
      window.called = [];
      window.GoogleAnalyticsObject = "ga";
      window.ga = function () { (ga.q = ga.q || []).push(arguments); };
      ga("create", "UA-1-1", "auto");
      ga("send", "pageview", { hitCallback: () => called.push("queued") });
    `);
    load("google-analytics_analytics.js");
    run(`
      ga("send", { hitType: "event", hitCallback: () => called.push("hit") });
      ga((tracker) => called.push(typeof tracker.get));
      ga.getAll()[0].send("event", { hitCallback: () => called.push("tracker") });
    `);
    await settle();
    expect(run("called")).toEqual(["queued", "hit", "function", "tracker"]);
    expect(run("ga.loaded")).toBe(true);
    expect(run("ga.getByName('t0') === ga.getAll()[0]")).toBe(true);
    expect(run("typeof ga.create('UA-2-1', 'auto', 'other').send")).toBe(
      "function",
    );
  });
});

describe("google-analytics_ga.js", () => {
  it("runs _gaq commands and gives trackers that do nothing", async () => {
    const { load, run, settle } = page();
    run(`
      window.called = [];
      window._gaq = [["_setAccount", "UA-1-1"], () => called.push("fn"),
        ["_set", "hitCallback", () => called.push("hit")]];
    `);
    load("google-analytics_ga.js");
    const tracker = "_gat._getTracker('UA-1-1')";
    expect(run(`${tracker}._trackPageview()`)).toBeUndefined();
    expect(run(`${tracker}._getLinkerUrl('https://a.example/')`)).toBe(
      "https://a.example/",
    );
    expect(run("_gaq.push(['_trackEvent', 'a', 'b'])")).toBe(0);
    await settle();
    expect(run("called")).toEqual(["fn", "hit"]);
  });
});

describe("the other surrogates", () => {
  it("google-analytics_cx_api.js always picks the original", () => {
    const { load, run } = page();
    load("google-analytics_cx_api.js");
    expect(run("cxApi.chooseVariation()")).toBe(
      run("cxApi.ORIGINAL_VARIATION"),
    );
  });

  it("googlesyndication_adsbygoogle.js marks each unit done and unfilled", () => {
    const { load, run } = page(
      '<ins class="adsbygoogle"></ins><ins class="adsbygoogle"></ins>',
    );
    run(`window.adsbygoogle = [{}]`);
    load("googlesyndication_adsbygoogle.js");
    load("googlesyndication_adsbygoogle.js");
    const statuses = () =>
      run(
        `[...document.querySelectorAll("ins")].map((ins) => [ins.dataset.adsbygoogleStatus, ins.dataset.adStatus])`,
      );
    expect(statuses()).toEqual([
      ["done", "unfilled"],
      [undefined, undefined],
    ]);
    run("(adsbygoogle = window.adsbygoogle || []).push({})");
    expect(statuses()[1]).toEqual(["done", "unfilled"]);
    expect(run("adsbygoogle.loaded")).toBe(true);
  });

  it("amazon_apstag.js answers queued and new bid requests with no bids", async () => {
    const { load, run, settle } = page();
    run(`
      window.bids = [];
      window.apstag = { _Q: [], init() { apstag._Q.push(["i", arguments]); },
        fetchBids() { apstag._Q.push(["f", arguments]); } };
      apstag.init({ pubID: "1", adServer: "googletag" });
      apstag.fetchBids({ slots: [] }, (found) => bids.push(found.length));
    `);
    load("amazon_apstag.js");
    run(
      "apstag.fetchBids({ slots: [] }, (found) => bids.push(found.length)); apstag.setDisplayBids()",
    );
    await settle();
    expect(run("bids")).toEqual([0, 0]);
    expect(run("apstag.targetingKeys()")).toEqual([]);
  });

  it("amazon_ads.js calls the page's callbacks", async () => {
    const { load, run, settle } = page();
    run(`
      window.called = [];
      window.amznads = { asyncParams: { id: "1", callbackFn: () => called.push("async") } };
    `);
    load("amazon_ads.js");
    run("amznads.getAdsCallback('1', () => called.push('cb'))");
    await settle();
    expect(run("called")).toEqual(["async", "cb"]);
    expect(run("amznads.hasAds()")).toBe(false);
  });

  it.each([
    ["scorecardresearch_beacon.js", "typeof COMSCORE.beacon"],
    ["outbrain-widget.js", "typeof OBR.extern.researchWidget"],
    ["chartbeat.js", "typeof pSUPERFLY.virtualPage"],
    ["addthis_widget.js", "typeof addthis.layers.refresh"],
    ["sensors-analytics.js", "typeof sensors.track"],
  ])("%s defines its API", (name, check) => {
    const { load, run } = page();
    load(name);
    expect(run(check)).toBe("function");
  });

  it("ligatus_angular-tag.js and doubleclick_instream_ad_status.js set their flags", () => {
    const { load, run } = page();
    load("ligatus_angular-tag.js");
    load("doubleclick_instream_ad_status.js");
    expect(run("[adProtect, uabpdl, uabDetect, google_ad_status]")).toEqual([
      true,
      true,
      true,
      1,
    ]);
  });
});

describe("defusers", () => {
  it("nofab: every detector reports nothing, and the real one can't replace it", async () => {
    const { load, run, settle } = page();
    load("nofab.js");
    run(`
      window.log = [];
      window.fuckAdBlock = { replaced: true };
      fuckAdBlock.onDetected(() => log.push("detected")).onNotDetected(() => log.push("fab"));
      blockAdBlock.on(true, () => log.push("detected")).on(false, () => log.push("bab"));
      new SniffAdBlock({ checkOnLoad: true }).onNotDetected(() => log.push("sab"));
    `);
    await settle();
    expect(run("log").sort()).toEqual(["bab", "fab", "sab"]);
    expect(run("fuckAdBlock.replaced")).toBeUndefined();
  });

  it("nobab: refuses eval() of code that names BlockAdblock", () => {
    const { load, run } = page();
    load("nobab.js");
    expect(run("eval('1 + 1')")).toBe(2);
    expect(run("eval('window.hit = \"BlockAdBlock\"; 3')")).toBeUndefined();
    expect(run("window.hit")).toBeUndefined();
  });

  it("nobab2: the same for Function()", () => {
    const { load, run } = page();
    load("nobab2.js");
    expect(run("Function('return 4')()")).toBe(4);
    expect(
      run("new Function('window.hit = \"blockadblock\"')()"),
    ).toBeUndefined();
    expect(run("window.hit")).toBeUndefined();
  });

  it("popads: aborts the script that writes PopAds", () => {
    const { load, run } = page();
    load("popads.js");
    expect(() => run("window.PopAds = {}")).toThrow("magic");
    expect(() => run("window.popns = 'x'")).toThrow("magic");
  });

  it("popads-dummy: PopAds is there and stays", () => {
    const { load, run } = page();
    load("popads-dummy.js");
    run("window.PopAds = 5");
    expect(run("typeof PopAds")).toBe("object");
  });

  it("fingerprint2 and fingerprint3 give a constant result", async () => {
    const { load, run, settle } = page();
    load("fingerprint2.js");
    load("fingerprint3.js");
    run(`
      window.out = [];
      Fingerprint2.get((components) => out.push(components.length));
      new Fingerprint2().get((hash) => out.push(hash.length));
      FingerprintJS.load().then((agent) => agent.get()).then((result) => out.push(result.visitorId.length));
    `);
    await settle();
    expect(run("out").sort()).toEqual([0, 32, 32]);
  });

  it("prebid-ads: ads can run", () => {
    const { load, run } = page();
    load("prebid-ads.js");
    expect(run("[canRunAds, isAdBlockActive]")).toEqual([true, false]);
  });

  it("ampproject_v0: cancels the body's -amp-start animation", () => {
    const { load, run } = page();
    load("ampproject_v0.js");
    load("ampproject_v0.js");
    const styles = run(
      "[...document.querySelectorAll('style')].map((s) => s.textContent)",
    );
    expect(styles).toHaveLength(1);
    expect(styles[0]).toContain("animation: none");
  });
});

describe("click2load.html", () => {
  const open = (query: string) => {
    const body = findResource("click2load.html")!.body as string;
    const dom = new JSDOM(body, {
      url: `https://blocked.example/click2load.html${query}`,
      runScripts: "dangerously",
    });
    return dom.window.document;
  };

  it("shows the frame's address and links to it", () => {
    const url = "https://video.example/embed/1?a=b";
    const document = open(`?url=${encodeURIComponent(url)}`);
    expect(document.getElementById("url")!.textContent).toBe(url);
    expect(document.querySelector("a")!.getAttribute("href")).toBe(url);
  });

  it("offers nothing to load for an address that isn't http(s)", () => {
    const document = open(`?url=${encodeURIComponent("javascript:alert(1)")}`);
    expect(document.querySelector("a")).toBeNull();
    expect(document.body.textContent).toContain("blocked");
  });
});

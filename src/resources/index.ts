import { gif, mp3, png } from "./binary.js";
import {
  ampprojectV0,
  fingerprint2,
  fingerprint3,
  nobab,
  nobab2,
  nofab,
  popads,
  popadsDummy,
  prebidAds,
} from "./defusers.js";
import { CLICK2LOAD, NOOP_HTML, VMAP, vast } from "./documents.js";
import { googleIma } from "./ima.js";
import {
  addthisWidget,
  amazonAds,
  amazonApstag,
  chartbeat,
  doubleclickInstreamAdStatus,
  googleAnalytics,
  googleAnalyticsCxApi,
  googleAnalyticsGa,
  googlesyndicationAdsbygoogle,
  googletagManager,
  googletagServices,
  ligatusAngularTag,
  outbrainWidget,
  scorecardresearchBeacon,
  sensorsAnalytics,
} from "./surrogates.js";

export interface RedirectResource {
  /** Its own name, as the wiki lists it: `noop.js`, `1x1.gif`, `google-ima.js`. */
  name: string;
  /** Other names filters use for it. */
  aliases: readonly string[];
  /** The Content-Type it is served with. */
  mime: string;
  /** Text, or bytes for an image, a sound or a video. */
  body: string | Uint8Array;
}

// Bodies are built on first read: the module loads at the host's startup.
function resource(
  name: string,
  aliases: readonly string[],
  mime: string,
  build: () => string | Uint8Array,
): RedirectResource {
  let body: string | Uint8Array | undefined;
  return {
    name,
    aliases,
    mime,
    get body() {
      return (body ??= build());
    },
  };
}

const JS = "text/javascript";
const script = (fn: () => void) => (): string => `(${fn.toString()})();\n`;
const empty = () => "";

export const RESOURCES: readonly RedirectResource[] = [
  resource("1x1.gif", ["1x1-transparent-gif"], "image/gif", gif),
  resource("2x2.png", ["2x2-transparent-png"], "image/png", () => png(2, 2)),
  resource("3x2.png", ["3x2-transparent-png"], "image/png", () => png(3, 2)),
  resource("32x32.png", ["32x32-transparent-png"], "image/png", () =>
    png(32, 32),
  ),
  resource("noop.css", ["noopcss", "blank-css"], "text/css", empty),
  resource(
    "noop.html",
    ["noopframe", "blank-html"],
    "text/html",
    () => NOOP_HTML,
  ),
  resource("noop.js", ["noopjs", "blank-js"], JS, empty),
  resource("noop.json", ["noopjson"], "application/json", () => "{}"),
  resource(
    "noop.txt",
    ["nooptext", "blank-text", "empty"],
    "text/plain",
    empty,
  ),
  resource("noop-0.1s.mp3", ["noopmp3-0.1s", "blank-mp3"], "audio/mpeg", () =>
    mp3(0.1),
  ),
  resource("noop-0.5s.mp3", ["noopmp3-0.5s"], "audio/mpeg", () => mp3(0.5)),
  // shortcut: an empty body, the element errors instead of playing; a real one-second file needs an encoder, generate one when a site needs it
  resource(
    "noop-1s.mp4",
    ["noopmp4-1s", "blank-mp4"],
    "video/mp4",
    () => new Uint8Array(),
  ),
  resource("noop-vast2.xml", ["noopvast-2.0"], "application/xml", () =>
    vast("2.0"),
  ),
  resource("noop-vast3.xml", ["noopvast-3.0"], "application/xml", () =>
    vast("3.0"),
  ),
  resource("noop-vast4.xml", ["noopvast-4.0"], "application/xml", () =>
    vast("4.0"),
  ),
  resource("noop-vmap1.xml", ["noopvmap-1.0"], "application/xml", () => VMAP),
  resource("click2load.html", [], "text/html", () => CLICK2LOAD),

  resource(
    "ampproject_v0.js",
    ["ampproject.org/v0.js"],
    JS,
    script(ampprojectV0),
  ),
  resource("fingerprint2.js", [], JS, script(fingerprint2)),
  resource("fingerprint3.js", [], JS, script(fingerprint3)),
  resource("nobab.js", ["bab-defuser.js"], JS, script(nobab)),
  resource("nobab2.js", [], JS, script(nobab2)),
  resource("nofab.js", ["fuckadblock.js-3.2.0"], JS, script(nofab)),
  resource("popads-dummy.js", [], JS, script(popadsDummy)),
  resource("popads.js", ["popads.net.js"], JS, script(popads)),
  resource("prebid-ads.js", [], JS, script(prebidAds)),

  resource(
    "amazon_ads.js",
    ["amazon-adsystem.com/aax2/amzn_ads.js"],
    JS,
    script(amazonAds),
  ),
  resource("amazon_apstag.js", [], JS, script(amazonApstag)),
  resource(
    "doubleclick_instream_ad_status.js",
    ["doubleclick.net/instream/ad_status.js"],
    JS,
    script(doubleclickInstreamAdStatus),
  ),
  resource(
    "google-analytics_ga.js",
    ["google-analytics.com/ga.js"],
    JS,
    script(googleAnalyticsGa),
  ),
  resource(
    "google-analytics_analytics.js",
    ["google-analytics.com/analytics.js"],
    JS,
    script(googleAnalytics),
  ),
  // A ga.js plugin that adds nothing a page calls.
  resource(
    "google-analytics_inpage_linkid.js",
    ["google-analytics.com/inpage_linkid.js"],
    JS,
    empty,
  ),
  resource(
    "google-analytics_cx_api.js",
    ["google-analytics.com/cx/api.js"],
    JS,
    script(googleAnalyticsCxApi),
  ),
  resource("google-ima.js", ["google-ima3"], JS, script(googleIma)),
  resource(
    "googletagservices_gpt.js",
    ["googletagservices.com/gpt.js"],
    JS,
    script(googletagServices),
  ),
  resource(
    "googletagmanager_gtm.js",
    ["googletagmanager.com/gtm.js"],
    JS,
    script(googletagManager),
  ),
  resource(
    "googlesyndication_adsbygoogle.js",
    ["googlesyndication.com/adsbygoogle.js"],
    JS,
    script(googlesyndicationAdsbygoogle),
  ),
  resource(
    "scorecardresearch_beacon.js",
    ["scorecardresearch.com/beacon.js"],
    JS,
    script(scorecardresearchBeacon),
  ),
  resource(
    "outbrain-widget.js",
    ["widgets.outbrain.com/outbrain.js"],
    JS,
    script(outbrainWidget),
  ),
  // No public documentation says what these define: an empty script.
  resource("hd-main.js", [], JS, empty),
  // In uBlock Origin's lists but not in its wiki: an empty script still
  // answers the request, where no resource would discard the filter.
  resource("adthrive_abd.js", [], JS, empty),
  resource("nitropay_ads.js", [], JS, empty),
  resource(
    "monkeybroker.js",
    ["d3pkae9owd2lcf.cloudfront.net/mb105.js"],
    JS,
    empty,
  ),
  resource(
    "chartbeat.js",
    ["static.chartbeat.com/chartbeat.js"],
    JS,
    script(chartbeat),
  ),
  resource(
    "ligatus_angular-tag.js",
    ["ligatus.com/*/angular-tag.js"],
    JS,
    script(ligatusAngularTag),
  ),
  resource(
    "addthis_widget.js",
    ["addthis.com/addthis_widget.js"],
    JS,
    script(addthisWidget),
  ),
  resource("sensors-analytics.js", [], JS, script(sensorsAnalytics)),
];

const byName = new Map<string, RedirectResource>();
for (const each of RESOURCES) {
  for (const name of [each.name, ...each.aliases]) byName.set(name, each);
}

/** The resource a `redirect=` value names, by its name or an alias, or undefined. */
export function findResource(token: string): RedirectResource | undefined {
  return (
    byName.get(token) ??
    byName.get(token.endsWith(".js") ? token.slice(0, -3) : `${token}.js`)
  );
}

export { DEFUSERS } from "./defusers.js";

---
paths:
  - "src/resources/**"
---

# Redirect resources

What a blocked request is answered with (`redirect=`, `redirect-rule=`, `empty`, `mp4`, Adblock Plus's `rewrite=abp-resource:`). `findResource(token)` takes a name or an alias, with or without `.js`.

- **The names come from the wiki's "Resources Library" page, never from uBlock Origin's files.** The old `domain.com/path.js` names it shows struck through are aliases. `none` isn't a resource: the network engine reads it as an exception.
- **A JavaScript resource is a function that runs in the page as `(${fn.toString()})();`**, so it must be self-contained: no imports, nothing from outside its own body but the page's globals. It runs on any site, possibly twice: it never throws, and loading it again changes nothing.
- **`defusers.ts` imports nothing.** Its functions are also scriptlets (`##+js(nofab)`), and the scriptlet bundle takes that file as it is. `index.ts` can't be bundled for a page: it reaches `node:zlib` through `binary.ts`.
- Bodies are built on first read (`resource()`): the module loads when the host app starts.
- **A surrogate exposes the documented public API of the script it stands in for, doing nothing**, written from that script's own public documentation (the IMA SDK for HTML5 and Google Publisher Tag references, `analytics.js`, `ga.js`, AdSense's `data-ad-status`, the Sensors Data web API). It reports "no ads" through the documented path: `google-ima.js` answers `requestAds` with an `adError` event (VAST empty response), GPT's `display()` with `slotRenderEnded` and `isEmpty: true`.
- Values no documentation gives are guesses: IMA's `OmidVerificationVendor` numbers and event type strings, GPT's `OutOfPageFormat` and `TrafficSource` numbers, `OB_releaseVer`, the Ligatus flags.
- `hd-main.js`, `monkeybroker.js` and `google-analytics_inpage_linkid.js` are empty scripts: nothing public says what they define. `adthrive_abd.js` and `nitropay_ads.js` are in the lists but not in the wiki: empty scripts too, since a name without a resource discards its filter, block included (the user's call).
- **The binary files are made by our own code from the format specifications**, never copied: the GIF byte by byte, the PNGs with a small encoder (`deflateSync`, `zlib.crc32`), the MP3s as silent MPEG-1 Layer III frames. `noop-1s.mp4` has an empty body until a site needs a real one (the user's call, `shortcut:` in `index.ts`): that needs a video encoder.
- `click2load.html` gets the frame's address as `?url=<encodeURIComponent(address)>` and loads it on a click. What serves it has to let that one navigation through, or the filter that redirected the frame blocks it again.

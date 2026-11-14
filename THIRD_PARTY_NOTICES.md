# Third-party notices

## Summary

`@tokioapp/adblock` is MIT ([`LICENSE`](LICENSE)). It is an independent implementation: no code from uBlock Origin or any other content blocker was copied into it, and it doesn't depend on them.

| What                                              | License                                           |
| ------------------------------------------------- | ------------------------------------------------- |
| This library's source code and its package        | MIT ([`LICENSE`](LICENSE))                        |
| Runtime dependencies                              | None                                              |
| The documentation the library was written from    | Credited below; no code is copied                 |
| The filter lists the library downloads at runtime | Their authors', listed below; not in this package |

## Documentation used as a reference

The filter syntax and the behavior of scriptlets and redirect resources come from public documentation. The library's code, including its parser, its matching engines, its scriptlets and its redirect resources, is written from scratch from that understanding. The source code of uBlock Origin, uBlock Origin Lite, Ghostery's adblocker, AdGuard's libraries and Brave's adblock-rust was not read.

- **uBlock Origin's wiki** (<https://github.com/gorhill/uBlock/wiki>), by Raymond Hill and contributors: "Static filter syntax", "Procedural cosmetic filters", "Resources Library", "uBO-flavored JSONPath", "Filter Performance", "Syntax quirks" and "Strict blocking".
- **Adblock Plus's filter documentation** (<https://help.adblockplus.org/hc/en-us/articles/360062733293-How-to-write-filters>).
- **AdGuard's filter documentation** (<https://adguard.com/kb/general/ad-filtering/create-own-filters/>), for the options uBlock Origin's wiki defers to it for.
- **MDN** and the **Electron** and **Chromium** documentation, for the web and Electron APIs.
- **The public developer documentation of the scripts the redirect resources stand in for**, for the names those scripts define: Google's IMA SDK for HTML5 reference (<https://developers.google.com/interactive-media-ads/docs/sdks/html5/client-side/reference/js/google.ima>), the Google Publisher Tag reference (<https://developers.google.com/publisher-tag/reference>), Google Analytics' `analytics.js` and `ga.js` references, AdSense's and Google Tag Manager's documentation, FingerprintJS's and FuckAdBlock's READMEs, the Sensors Data web API (<https://docs.sensorsdata.com>), and the file format specifications (GIF89a, PNG, MPEG audio, VAST, VMAP). Each stand-in is our own code that defines those names and does nothing; no code from those scripts is included.

The filter lists were also read as data, to measure which syntax, scriptlets and redirect resources real rules use. No line of a filter list is included in this repository or in the package.

## Development tools

Development tools (TypeScript, Vitest, oxlint, Prettier and the rest of `devDependencies`) aren't part of the published package.

## Services

The library downloads filter lists from these hosts when the host app asks it to. None of them is covered by this library's license. Each list belongs to its authors, is subject to its own license, and can change or stop being served at any time. The library downloads them on the user's machine and doesn't redistribute them.

It also downloads Mozilla's **Public Suffix List** (<https://publicsuffix.org>, MPL-2.0) from `publicsuffix.org`, to tell a site from its subdomains. The list is data read by this library's own code; it isn't included in the repository or in the package.

The default lists (`DEFAULT_LISTS`) are the ones uBlock Origin enables by default:

| List                                     | Authors                                                  | License                                            | Downloaded from                                                                            |
| ---------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| uBlock filters – Ads                     | Raymond Hill and contributors                            | GPL-3.0                                            | `ublockorigin.github.io`, then its mirrors `ublockorigin.pages.dev` and `cdn.jsdelivr.net` |
| uBlock filters – Badware risks           | Raymond Hill and contributors                            | GPL-3.0                                            | The same hosts                                                                             |
| uBlock filters – Privacy                 | Raymond Hill and contributors                            | GPL-3.0                                            | The same hosts                                                                             |
| uBlock filters – Unbreak                 | Raymond Hill and contributors                            | GPL-3.0                                            | The same hosts                                                                             |
| uBlock filters – Quick fixes             | Raymond Hill and contributors                            | GPL-3.0                                            | The same hosts                                                                             |
| EasyList                                 | The EasyList authors                                     | GPL-3.0 or CC BY-SA 3.0, at the recipient's choice | The same hosts (uBlock Origin's copy)                                                      |
| EasyPrivacy                              | The EasyList authors                                     | GPL-3.0 or CC BY-SA 3.0, at the recipient's choice | The same hosts (uBlock Origin's copy)                                                      |
| Online Malicious URL Blocklist           | The malware-filter project, from URLhaus (abuse.ch) data | CC0-1.0                                            | `malware-filter.gitlab.io`, then `curbengh.github.io`                                      |
| Peter Lowe's Ad and tracking server list | Peter Lowe                                               | McRae General Public License, non-commercial       | `pgl.yoyo.org`                                                                             |

The list of defaults and their URLs come from uBlock Origin's published asset index (`assets/assets.json`), read as data. A host app can pass its own lists instead; their licenses are then its concern. Peter Lowe's list is licensed for non-commercial use: an app that isn't should leave it out of the lists it passes.

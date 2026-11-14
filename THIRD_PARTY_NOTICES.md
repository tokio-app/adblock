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

The filter lists were also read as data, to measure which syntax, scriptlets and redirect resources real rules use. No line of a filter list is included in this repository or in the package.

## Development tools

Development tools (TypeScript, Vitest, oxlint, Prettier and the rest of `devDependencies`) aren't part of the published package.

## Services

The library downloads filter lists from these hosts when the host app asks it to. None of them is covered by this library's license. Each list belongs to its authors, is subject to its own license, and can change or stop being served at any time. The library downloads them on the user's machine and doesn't redistribute them.

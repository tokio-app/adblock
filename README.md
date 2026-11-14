# Tokio Adblock

A content blocker for Electron that applies [uBlock Origin](https://github.com/gorhill/uBlock)'s filter lists inside an Electron session: network filters, cosmetic and procedural cosmetic filters, scriptlet injection and redirect resources. It is written from scratch, MIT-licensed, and has no runtime dependency. It is the blocker behind [Tokio](https://tokio.ialfaro.com)'s music player.

## Status

In development. It isn't on npm yet, and the API can still change.

What works so far:

- Downloading uBlock Origin's default filter lists, with mirrors, `! Expires:`, HTTP caching and storage you provide, and keeping them up to date in the background.
- Parsing every line of them into typed rules: network filters with all their options, cosmetic and procedural cosmetic filters, scriptlets and the pre-parsing directives (`!#if`, `!#include`).

- Deciding what happens to a request: block, exception and `important` filters with all their options, `badfilter`, redirect directives, `removeparam`, `urlskip`, `uritransform`, `csp`, `permissions` and `header`. With uBlock Origin's nine default lists it decides about 110,000 requests a second and holds about 41 MB.

- The redirect resources filters name, written from scratch: empty scripts, images, sounds and documents, and stand-ins for the IMA SDK, Google Publisher Tag, Google Analytics, Tag Manager and the rest. `noop-1s.mp4` is still an empty file.

Not yet: cosmetic filtering, scriptlets and the Electron integration.

## License

MIT, see [`LICENSE`](LICENSE). The library is an independent implementation: it contains no code from uBlock Origin or any other content blocker. The filter lists it downloads at runtime belong to their authors and have their own licenses, see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

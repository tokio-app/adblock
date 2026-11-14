# Tokio Adblock

A content blocker for Electron that applies [uBlock Origin](https://github.com/gorhill/uBlock)'s filter lists inside an Electron session: network filters, cosmetic and procedural cosmetic filters, scriptlet injection and redirect resources. It is written from scratch, MIT-licensed, and has no runtime dependency. It is the blocker behind [Tokio](https://tokio.ialfaro.com)'s music player.

## Status

In development. It isn't on npm yet, and the API can still change.

What works so far:

- Downloading uBlock Origin's default filter lists, with mirrors, `! Expires:`, HTTP caching and storage you provide, and keeping them up to date in the background.
- Parsing every line of them into typed rules: network filters with all their options, cosmetic and procedural cosmetic filters, scriptlets and the pre-parsing directives (`!#if`, `!#include`).

Not yet: applying the rules. The network, cosmetic and scriptlet engines and the Electron integration come next.

## License

MIT, see [`LICENSE`](LICENSE). The library is an independent implementation: it contains no code from uBlock Origin or any other content blocker. The filter lists it downloads at runtime belong to their authors and have their own licenses, see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

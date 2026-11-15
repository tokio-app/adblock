# Tokio Adblock

A content blocker for Electron that applies [uBlock Origin](https://github.com/gorhill/uBlock)'s filter lists inside an Electron session: network filters, cosmetic and procedural cosmetic filters, scriptlet injection and redirect resources. It is written from scratch, MIT-licensed, and has no runtime dependency. It is made for [Tokio](https://tokio.ialfaro.com)'s music player.

## Status

In development: the API can still change.

## Use

```sh
yarn add @tokioapp/adblock
```

Electron 35 or later, Node 24 or later. The package is ESM only and ships its TypeScript types.

```ts
import path from "node:path";
import { app, ipcMain, protocol, session } from "electron";
import { ElectronBlocker, FileStorage, adblockScheme } from "@tokioapp/adblock";

// Once, before the app is ready, in the same call as your own schemes:
// Electron takes one call for the whole app.
protocol.registerSchemesAsPrivileged([adblockScheme]);

app.whenReady().then(async () => {
  const blocker = new ElectronBlocker({
    ipcMain,
    // Where the downloaded lists are kept between runs.
    storage: new FileStorage(path.join(app.getPath("userData"), "adblock")),
    onError: (error) => console.warn(error.message),
  });
  blocker.enable(session.fromPartition("persist:player"));
  await blocker.ready; // The lists are in effect.
});
```

- `enable(session)` starts filtering a session and `disable(session)` stops it. Both can be called again without harm, and `dispose()` stops everything.
- `ready` resolves once the lists are in effect. The first run downloads them; later runs read them from the storage, and the blocker looks for new versions as each list expires. `update()` looks right away.
- Nothing the blocker does can fail a page load: what goes wrong is passed to `onError`.
- By default it applies the lists uBlock Origin enables by default (`DEFAULT_LISTS`). Pass `lists` to choose: `DEFAULT_LISTS.filter((list) => list.id !== "urlhaus-1")` leaves out the largest one, which holds a third of the memory.
- `blocker.counts` says how many requests were blocked, redirected and rewritten, and how many scriptlets were given to documents.

What you need to know as the host app:

- **The blocker owns `webRequest.onBeforeRequest` and `webRequest.onHeadersReceived`** in the sessions it is enabled in: Electron keeps one listener per event per session. If you need one of your own, set it after `enable()` and call `blocker.onBeforeRequest(details, callback)` or `blocker.onHeadersReceived(details, callback)` from it for the requests you don't decide yourself.
- **Register `adblockScheme`**, as above. Without it the redirect resources don't load.
- The preload script ships in the package and is registered for you. If you bundle the package into your own main process code, pass `preloadPath: require.resolve("@tokioapp/adblock/preload")`.
- Frames only get scriptlets and cosmetic filters when the window has `nodeIntegrationInSubFrames`. Their requests are filtered either way.
- To apply `popup` filters, ask in your `setWindowOpenHandler`: `blocker.engine.blocksPopup(url, openerUrl)`.

## What it applies

- **Lists:** downloads with mirrors, `! Expires:`, `ETag` and `Last-Modified`, the pre-parsing directives (`!#if`, `!#else`, `!#include`) and hosts files. Any list in uBlock Origin's syntax works.
- **Network filters:** every pattern form and option uBlock Origin documents: types, `1p` and `3p`, `strict1p` and `strict3p`, `domain`, `to`, `top`, `denyallow`, `method`, `header`, `important`, `badfilter`, `match-case`, exceptions, and the modifiers `redirect`, `redirect-rule`, `removeparam`, `csp`, `permissions`, `urlskip`, `uritransform`, `inline-script` and `inline-font`.
- **Redirect resources:** empty scripts, styles and documents, transparent images, silent sounds, and stand-ins for the IMA SDK, Google Publisher Tag, Google Analytics, Tag Manager, AdSense and others.
- **Cosmetic filters:** specific, entity and generic filters, exceptions, `generichide`, `specifichide` and `elemhide`, `:style()`, and the procedural operators (`:has-text()`, `:upward()`, `:matches-css()`, `:matches-path()`, `:xpath()`, `:remove()`, `:remove-attr()` and the rest).
- **Scriptlets:** 95, every one uBlock Origin's default lists use but six that it doesn't document. `trusted-` scriptlets only run from trusted lists, which by default are uBlock Origin's own.

With the nine default lists (307,000 lines) it is ready about a second and a half after it finds them in the storage, holds about 63 MB, and decides between 55,000 and 110,000 requests a second, depending on what else the machine is doing.

## What it doesn't

- HTML filters (`##^`) and `replace=`: Electron can't rewrite a response's body. `##^responseheader()` is applied.
- `cname` and, mostly, `ipaddress`: Chromium doesn't tell what a name resolved to.
- `popunder`, which needs a browser's tabs.
- The page uBlock Origin shows in place of a blocked site: a blocked page just doesn't load.
- Six scriptlets that are in uBlock Origin's lists but not in its documentation, and `overlay-buster`.
- `noop-1s.mp4` is an empty file for now: a filter that redirects a video to it makes the video fail instead of playing a silent second.

## License

MIT, see [`LICENSE`](LICENSE). The library is an independent implementation: it contains no code from uBlock Origin or any other content blocker. The filter lists it downloads at runtime belong to their authors and have their own licenses, see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

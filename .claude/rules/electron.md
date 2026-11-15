---
paths:
  - "src/electron/**"
  - "src/content/preload.ts"
  - "src/content/mainWorld.ts"
  - "scripts/build/**"
  - "scripts/smoke/**"
  - "test/helpers/electron.ts"
---

# Electron integration

`ElectronBlocker` (`src/electron/blocker.ts`) puts the engines in a session. It never imports `electron` at run time: the host passes `ipcMain` and its sessions, and the types are `import type`. So the tests give it fakes (`test/helpers/electron.ts`) and Node can load the package.

## What `enable(session)` installs

- The preload, with `session.registerPreloadScript({ type: "frame" })` (Electron 35 or later).
- `webRequest.onBeforeRequest` and `webRequest.onHeadersReceived`. **Electron keeps one listener per event per session, so the blocker owns these two in the sessions it is enabled in.** An app that needs its own sets it after `enable()` and calls `blocker.onBeforeRequest` or `blocker.onHeadersReceived` from it for what it doesn't decide itself. `disable()` clears the event, the app's listener included.
- The handler of the `tokio-adblock` scheme, which serves the redirect resources.
- Nothing for popups: an app decides about new windows in its own `setWindowOpenHandler`, where it can ask `engine.blocksPopup(url, openerUrl)`.

## The scheme

- **The host app registers `adblockScheme` itself**, with its own schemes, in its one `protocol.registerSchemesAsPrivileged` call before `ready`: the call is app-wide and a second one replaces the first.
- **`NOTE: DO NOT CHANGE` its privileges without a `yarn smoke` run.** A redirect to a `data:` URL fails for subresources (`ERR_UNSAFE_REDIRECT`), and without `bypassCSP` a page's CSP blocks the redirected script.
- A resource's address holds a token made when the blocker is created, so a page can't ask for one to find out the blocker is there. An address without it gets a 404.
- A frame redirected to `click2load.html` then has the placeholder as its document: its next navigation isn't filtered (`decide`), or the filter that redirected it would block the click.

## The preload

- `dist/preload.cjs`, exported as `@tokioapp/adblock/preload`, is `src/content/preload.ts` bundled by `scripts/build` into one CommonJS file that requires only `electron`: a sandboxed preload can load nothing else. `bundle.test.ts` runs the built file with a `require` that refuses anything else.
- **The page's own world only gets a function's text** (`contextBridge.executeInMainWorld`), so the build replaces `src/content/mainWorld.ts` with the scriptlets bundled into one self-contained function. From source that file just calls the runner, which is what tests of the page-side code use.
- The preload asks main what the document gets with `ipcRenderer.sendSync`: the answer has to be there before the page's first script. Main answers from memory, and **always answers** (`event.returnValue`), even when it fails: a page waits for it.
- By default `preloadPath` is `../preload.cjs` from `dist/electron/blocker.js`, which works inside an asar archive. An app that bundles the library into its own main code passes `require.resolve("@tokioapp/adblock/preload")`.
- Electron only runs a preload in sub-frames when the window has `nodeIntegrationInSubFrames`: without it frames get their requests filtered, but no scriptlets or cosmetic filters.
- `ipcMain.handle` takes one handler per channel for the whole app: an app has one blocker.

## Requests

- Who asks is the frame's document; a frame's own navigation is asked about from its parent; a document without an address (`about:blank`, `srcdoc`) counts as the one that holds it; without a frame, the referrer. Reading a frame that is gone throws: `requestOf` falls back to the referrer.
- Only `http(s)` and `ws(s)` URLs are filtered. `cspReport` is the filters' `other`.
- A blocked document is cancelled (`ERR_BLOCKED_BY_CLIENT`). There is no page that explains it and offers to go on, as uBlock Origin has.
- **A failure never fails a page load:** each listener answers `{}` when it throws and tells `onError`.

## `yarn smoke`

Builds the package, launches Electron on a page (default `https://music.youtube.com`) with the default lists from `lists/`, and writes `reports/smoke.json`: requests blocked and redirected, the redirect resources that loaded, scriptlets and cosmetic filters given, elements hidden, console and preload errors. It passes when the page loaded, a document asked the blocker, every redirected resource loaded and nothing reported an error. `window.google_ad_status` being `1` shows that a redirected script ran in the page despite its CSP.

What launching Electron from a script taught:

- Electron exits at once with status 127 when the first argument after the script is a URL: the options go in a file.
- In an ES module entry, a top-level `await app.whenReady()` never resolves: Electron only becomes ready once the entry module has finished loading. Use `app.whenReady().then(…)`.
- VS Code's terminals set `ELECTRON_RUN_AS_NODE`, which makes Electron run as Node: the script removes it from the child's environment.
- Electron's console doesn't reach every shell: the Electron side writes its results to the report file, and how far it got (`stage`), so a run that hangs still says where.

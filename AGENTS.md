# AGENTS.md

## Project

`@tokioapp/adblock` is a content blocker for Electron. It applies uBlock Origin's filter lists inside an Electron session: network filters, cosmetic and procedural cosmetic filters, scriptlet injection and redirect resources. It is written from scratch (clean-room), MIT-licensed, ESM only, and has no runtime dependency. It will be published to npm as `@tokioapp/adblock`; repository `tokio-app/adblock`.

It will replace Ghostery's MPL-2.0 blocker in Tokio, the Electron app at `../tokio`, whose YouTube Music player needs ad blocking. That player is the first consumer and the first real-world test, but the engine handles every rule uBlock Origin's lists contain, not only YouTube's (the user's call). The swap is a separate change in the Tokio repo, not here.

Stack: Node >= 24, TypeScript 7, Vitest (on Vite 7) with jsdom, esbuild for the preload, Yarn 1. The host app runs Electron 35 or later (`session.registerPreloadScript`); `electron` is a peer dependency, used for its types only (the user's call).

## Commands

```sh
yarn build             # tsc -p tsconfig.build.json: dist/ (JS and .d.ts, no maps), then dist/preload.cjs
yarn clean             # delete dist/ and coverage/
yarn test              # vitest run (yarn test:watch to watch)
yarn test:coverage     # vitest with a coverage report in coverage/ (text + lcov)
yarn typecheck         # tsc --noEmit over src/, test/, scripts/ and vitest.config.ts
yarn lint              # oxlint --type-aware, fails on any warning
yarn format            # prettier --write . (yarn format:check only checks)
yarn lists             # download the default lists into lists/ and print what parses (opt-in, needs network)
yarn bench             # build the engine from lists/ and print its times, heap and requests per second
yarn smoke [url]       # build, launch Electron on a page with the default lists, write reports/smoke.json (opt-in, needs network)
```

Verify changes with `yarn test`, `yarn typecheck`, `yarn lint`, `yarn format:check` and `yarn build`. The `verify` skill says when the opt-in runs are needed too.

## Agent models

- **Planning:** Opus 5.5 at high effort. Be 90–95% confident in the plan before implementing or handing off; otherwise keep reading code or ask the user.
- **Implementation subagents:** Sonnet 5.5 at high effort for well-scoped changes that follow existing patterns. Otherwise Opus 5.5: medium effort for moderate tasks, high for complex or cross-cutting ones (architecture, IPC/schema changes across processes, concurrency, licensing-sensitive code).

## Layout

```
src/
  index.ts            public exports (the only entry point)
  engine.ts           Engine: loads the lists and the Public Suffix List, keeps them up to date, builds the engines
  util.ts             toError, tryRegex, ownString, compactBuckets, isRecord
  lists/              defaults.ts (DEFAULT_LISTS), manager.ts (ListManager: download, mirrors, expiry, HTTP validators,
                      sub-lists), storage.ts (ListStorage, FileStorage, MemoryStorage), preprocessor.ts (!#if, !#else,
                      !#endif, !#include and the environment they see)
  parser/             index.ts (parseLine, parseInto, parseList and the counts), network.ts (network filters and their
                      options), cosmetic.ts (cosmetic, scriptlet and HTML filters), selector.ts (selectors and procedural
                      operators), hosts.ts (hostname lists), types.ts (the rules and their flags)
  network/            engine.ts (NetworkEngine: block, redirect, rewrite and response decisions, badfilter),
                      filterIndex.ts (rules filed by hostname, token and site), tokens.ts, pattern.ts (matching a rule),
                      request.ts (what filters ask about a request), modifiers.ts (removeparam, urlskip, uritransform)
  psl/                psl.ts (PublicSuffixList: registrable domains and entities)
  cosmetic/           engine.ts (CosmeticEngine: a document's stylesheet, procedural filters, scriptlets and the
                      response headers to drop)
  content/            what runs in the page from the preload: preload.ts (the preload's entry), mainWorld.ts (the
                      scriptlets, for the page's own world), cosmetics.ts (applies a document's cosmetics and asks for
                      the generic ones), procedural.ts (runs procedural filters)
  scriptlets/         index.ts (SCRIPTLETS, findScriptlet), runner.ts (runs a page's scriptlets), helpers.ts (what they
                      share), types.ts, and the scriptlets by family: abort.ts, setConstant.ts, timers.ts, events.ts,
                      dom/ (the document, cookies, storage), network/ (requests, responses and the data they carry,
                      with jsonPath.ts)
  resources/          index.ts (RESOURCES, findResource), binary.ts (GIF, PNG, MP3), documents.ts (HTML, VAST, VMAP),
                      defusers.ts (stand-ins that are scriptlets too), ima.ts (the IMA SDK), surrogates.ts (the others)
  electron/           blocker.ts (ElectronBlocker: enable and disable a session, the webRequest listeners, the scheme's
                      handler, the IPC with the preload), channels.ts (the IPC channel names), scheme.ts (the scheme
                      entry host apps register)
test/
  setup.ts            runs before every test file
  helpers/            fetchStub.ts (a fetch that answers from a table and records requests), page.ts (a jsdom page that
                      gets the bundled scriptlets, as a real page does), fakes.ts (what jsdom lacks: fetch, an XHR
                      helper), electron.ts (fakes of Electron's session, protocol, webRequest and ipcMain)
scripts/
  lists/              yarn lists: index.ts (downloads and parses the default lists), report.ts (what it prints)
  bench/              yarn bench: index.ts
  build/              index.ts (writes dist/preload.cjs), bundle.ts (the scriptlets as one self-contained function, and
                      the preload as one CommonJS file)
  smoke/              yarn smoke: index.ts (launches Electron and prints the summary), main.mjs (what runs in
                      Electron), summary.ts (the summary and the verdict)
```

`THIRD_PARTY_NOTICES.md` credits the documentation the library was written from and lists the services it downloads from. `tsconfig.json` covers `src/`, `test/`, `scripts/` and `vitest.config.ts` for the typecheck and type-aware lint; `tsconfig.build.json` extends it to emit `src/` only (it holds `rootDir`, and leaves out the tests). Generated or downloaded, don't edit: `dist/`, `coverage/`, `lists/`, `reports/`. The package ships only `dist/`, `THIRD_PARTY_NOTICES.md`, `LICENSE`, `README.md` and `package.json` (`files` in `package.json`).

## Topic rules

Notes for one area live in `.claude/rules/<topic>.md`. Claude Code loads each one when it reads or edits a file its `paths` match; read one directly when planning across areas.

**Other agents:** these rules don't load on their own. Before you read or edit files a rule's `paths` match, read that rule.

- `lists-parser.md`: the default lists, downloads and expiry, `!#if`, and the parser's choices where the wiki is silent
- `network.md`: precedence, how rules are filed, the Public Suffix List, and what `yarn bench` should print
- `resources.md`: what a redirect resource must be, where each one's behavior comes from, and the ones that are guesses
- `cosmetic.md`: what a document gets, how the page applies it, and the operators' choices where the wiki is silent
- `scriptlets.md`: where scriptlets run and what that forbids, how to write and test one, and the ones not implemented
- `electron.md`: what `enable()` installs, the scheme, the preload, who a request comes from, and `yarn smoke`

A rule holds what its reader can't get quickly from the code: the user's calls, marked "(the user's call)"; gotchas, with the reason the obvious way breaks; contracts that other code or other repos depend on; and couplings between files. It leaves out what reading the code shows, history, and what AGENTS.md or another rule already says. When a change alters what a rule says, update the rule with it. A new area gets its own rule with `paths`.

## Skills

Procedures live in `.claude/skills/<name>/SKILL.md`. Claude Code offers each one as `/<name>` and loads it when a task matches its description.

**Other agents:** before doing one of these tasks, read its `SKILL.md`.

- `release`: publish a version to npm, only when the user asks
- `verify`: run the checks a change needs
- `add-dependency`: add, upgrade or remove a package, with the license checks

When a procedure changes, update its skill with it.

## Licensing

The library is MIT and must stay clean-room. Treat license compliance as part of every change.

- **The clean-room rule.** uBlock Origin (`gorhill/uBlock`, `uBlockOrigin/uAssets`, `uBlockOrigin/uBOL-home`) is GPL-3.0, Ghostery's `@ghostery/adblocker*` is MPL-2.0, and AdGuard's scriptlets and tsurlfilter and Brave's adblock-rust are GPL or MPL. Never read the source code of any of them, or of any other blocker's implementation, on GitHub, npm, unpkg or anywhere else. That includes uBlock Origin's `src/js/resources/*.js` and `src/web_accessible_resources/` (its scriptlets and redirect resources), the links to them in its wiki, `../tokio/node_modules/@ghostery` and the branch `feat/youtube-adblock` of `../tokio`. No code is copied or paraphrased.
- **Allowed references:** uBlock Origin's wiki documentation (<https://github.com/gorhill/uBlock/wiki>: "Static filter syntax", "Procedural cosmetic filters", "Resources Library", "uBO-flavored JSONPath", "Filter Performance", "Syntax quirks", "Strict blocking"), Adblock Plus's and AdGuard's public filter documentation, MDN, Chromium's and Electron's docs, and the filter lists themselves as data, to measure which syntax, scriptlets and resources real rules use. Read the docs to understand a behavior, then write the code yourself. Where the docs don't pin a behavior down, choose the sensible one, test it, and note it in the area's rule.
- **The filter lists are data under other licenses** (uBlock Origin's are GPL-3.0, EasyList's GPL-3.0 or CC BY-SA 3.0): never commit them or any line copied from them. The host app's machine downloads them at runtime; the package doesn't ship them. Tests use rules written by hand in the documented syntax. Downloaded copies for analysis go in `lists/` (gitignored).
- **Adding a runtime dependency needs the user's OK.** There is none. Check the license when adding or upgrading a dependency, even a minor bump, and ask before anything copyleft (GPL, AGPL, LGPL, MPL, EUPL, CC BY-SA), dev dependencies included. `vite` (Vitest's peer) stays on 7: Vite 8 depends on `lightningcss`, which is MPL-2.0. The `add-dependency` skill has the steps.
- Keep `THIRD_PARTY_NOTICES.md` in sync: the documentation credited, the Services list when the library downloads from a new host, and the default lists with their licenses.
- Keep `"license": "MIT"` in `package.json`.

## Design

What the Electron spike settled (Electron 45, against `https://music.youtube.com`):

- **Scripts run at page start through a session preload.** A preload registered with `session.registerPreloadScript({ type: "frame", filePath })` runs in a sandboxed renderer with `contextIsolation`, gets its data synchronously from main with `ipcRenderer.sendSync`, and runs code in the page's main world with `contextBridge.executeInMainWorld({ func, args })` before any page script. A sandboxed preload can only `require("electron")`, so the preload ships as one self-contained CommonJS file.
- **Redirect resources are served from a privileged custom scheme.** `webRequest.onBeforeRequest` answering `{ redirectURL: "data:..." }` fails for subresources (`ERR_UNSAFE_REDIRECT`). A redirect to a scheme registered with `standard`, `secure`, `supportFetchAPI`, `corsEnabled` and `bypassCSP` and served with `session.protocol.handle` loads. `bypassCSP` is required: without it a page's CSP blocks the redirected script.
- **The host app registers the scheme.** `protocol.registerSchemesAsPrivileged` is app-wide, replaces what an earlier call registered, and must run before `ready`. The library exports its scheme entry for the host to pass along with its own, and never calls it.
- **The library owns the `webRequest` listeners** of the sessions it blocks in: Electron keeps one listener per event per session, so a second `onBeforeRequest` replaces the first.

## Testing

- Vitest. Tests sit next to the code as `*.test.ts`; shared fakes and helpers live in `test/`.
- Tests never touch the network, and neither does CI. Rules in tests are written by hand in the documented syntax, never copied from a filter list.
- `restoreMocks` and `unstubGlobals` are on: mocks and stubbed globals reset after each test.
- `yarn test:coverage` has no thresholds: the scriptlets and the redirect resources run as text inside a jsdom page, where the coverage tool doesn't see them, so their numbers read low whatever the tests do.
- `yarn lists`, `yarn bench` and `yarn smoke` are opt-in and need the network (`yarn bench` only the lists `yarn lists` downloaded). The `verify` skill says when each is due.
- "Vitest failed to find the runner" in every suite means the working directory has a lowercase drive letter (`c:\`): run from `C:\…`.

## CI and releases

- `ci.yml` (pull requests and `main`): Prettier check (Linux), lint, typecheck, tests and build, on Linux and Windows with Node 24. Linux runs the tests with coverage and uploads `coverage/` as an artifact. On pull requests, `commitlint` checks every commit message against `.commitlintrc`.
- `publish.yml` runs on a `v<version>` tag matching `package.json`: format, lint, typecheck and tests, then `npm publish` through npm trusted publishing (no token; `prepublishOnly` builds) and a GitHub release with generated notes. Versions with a `-` (`0.2.0-beta.1`) publish under the `next` dist-tag and as a GitHub prerelease. A rerun skips what's already published.
- The user sets up npm trusted publishing (package `@tokioapp/adblock`, repository `tokio-app/adblock`, workflow `publish.yml`). Releases publish directly, as the connector's do, not through `npm stage publish` (the user's call). Never push without asking.

To release, use the `release` skill (`/release`).

## Conventions

- Run `yarn format` on files you touch, and fix lint warnings in code you touch. Files use LF line endings.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `feat!:`), enforced by a husky hook (commitlint, with lint-staged running oxlint and Prettier on staged files) and by CI on pull requests. Don't bypass hooks.
- No `Co-Authored-By` or "Generated with" lines in commits or PRs.
- Pull requests: a Conventional Commits title, which is their line in the release notes, and the sections of `.github/pull_request_template.md`. Merge them with a merge commit, not a squash or rebase.
- ESM with `NodeNext` resolution: relative imports end in `.js`. Type-only imports use `import type` (`verbatimModuleSyntax`).
- Logs and errors are in English.
- Respect inline `NOTE: DO NOT CHANGE` markers.
- Inside a folder with a barrel `index`, import sibling files directly, never through the barrel, to avoid import cycles.
- `npx fallow health` (also `dead-code`, `dupes`) reports import cycles, dead code and duplication. It reads `.fallowrc.json`.
- Never use `git stash`.

Keep these stable; host apps depend on them:

- the public API exported from `src/index.ts`. A breaking change is a `feat!:` and a new minor (0.x) or major version
- the scheme's name, `tokio-adblock`, and the `adblockScheme` entry: host apps register it by that name
- the preload's export path, `@tokioapp/adblock/preload` (`dist/preload.cjs`): host apps resolve it
- the ids of `DEFAULT_LISTS`: they name the lists in the host's storage, so a new id downloads the list again and leaves the old copy behind

## Writing the docs

- Check each fact against the code. Don't describe behavior you haven't confirmed.
- Give each fact one home, and have other docs point to it. Change an existing line before you add one.
- `AGENTS.md`, rules and skills are terse, with names and paths in backticks. `AGENTS.md` holds what crosses areas; one area's notes go in its rule. The README is plain English in the second person.
- No history ("renamed from", "an earlier version") unless it stops a revert.

## Milestones

| #   | Milestone                     | Status |
| --- | ----------------------------- | ------ |
| 0   | Scaffold                      | done   |
| 1   | Lists and parser              | done   |
| 2   | Network engine                | done   |
| 3   | Redirect resources            | done   |
| 4   | Cosmetic engine               | done   |
| 5   | Scriptlets                    | done   |
| 6   | Electron integration          | done   |
| 7   | Smoke run against a real page | done   |

What the library leaves out is in each area's rule: the redirect resources that are guesses and `noop-1s.mp4` (`resources.md`), the scriptlets that aren't documented (`scriptlets.md`), what Electron can't apply (`lists-parser.md`), and no page for a blocked document (`electron.md`).

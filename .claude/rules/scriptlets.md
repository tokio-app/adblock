---
paths:
  - "src/scriptlets/**"
  - "scripts/build/**"
  - "test/helpers/page.ts"
  - "test/helpers/fakes.ts"
---

# Scriptlets

A scriptlet (`example.com##+js(name, arg, …)`) is a function that runs in the page's own world before the page's scripts. Each one is our own implementation of what the wiki's "Resources Library" page documents: its names, aliases, parameters and behavior. **Never look at how uBlock Origin or AdGuard wrote one** (the clean-room rule in `AGENTS.md`).

## Where they run

- **`scripts/build/bundle.ts` bundles `runner.ts`, every scriptlet and what they import into the text of one function**, which the preload hands to the page. So a scriptlet file imports only from `src/scriptlets`, or a file that imports nothing itself (`src/resources/defusers.ts`): no Node, no Electron, no dependency.
- **A scriptlet file also loads in the main process**, which reads the registry for names, aliases and `trusted`. At the top of a file take JavaScript's own built-ins freely (`Reflect.apply`, `Object.defineProperty`), but a page's (`Document`, `Node`, `window`) only inside `run`, or behind `typeof Document === "undefined"`. `core.test.ts` imports the registry under Node and fails otherwise.
- The page's scripts run after a scriptlet and may replace anything: what a trap calls later is taken while it is still the browser's.

## Writing one

- A `Scriptlet` object (`types.ts`) added to its family's list, which `index.ts` gathers. Arguments arrive as text: the positional ones, then `name, value` pairs (`tokens()`). A "string or regular expression" parameter is read with `matcher()`: text to find, `/…/` a regex, nothing matches everything, and `!` inverts only where the wiki says so.
- **Used without arguments, many scriptlets only log to uBlock Origin's logger. There is no logger here: that call does nothing and leaves the page untouched.** `prevent-window-open` and `prevent-canvas` are the exceptions: the wiki says they act on everything.
- Put a function in front of a method with `wrapMethod()` (or `wrapCallable`, `wrapGetter`, `wrapSetter` in `network/util.ts`): a Proxy, so the method still reads as native. Calls that don't match keep their `this`, arguments and result. Two filters calling one scriptlet wrap twice, and that must work.
- **A method of `localStorage` or `sessionStorage` can't be wrapped by assigning to it**: the assignment stores an item named `setItem`. `onMethod()` wraps `Storage.prototype` for that one object instead.
- A scriptlet never throws into the page unless aborting is its job (`abort()`), and `runner.ts` catches what a broken page makes it throw.
- A `trusted-` scriptlet does what the filter says; the others pick from fixed behaviors. Keep it that way: `set-constant`, `set-cookie`, `set-local-storage-item` and `set-attr` only take the values the wiki lists, and `set-attr` refuses `on…` attributes, since filters of any list can call them.
- `war:<name>` in `prevent-fetch` and `prevent-xhr` names a redirect resource, which isn't in the page: `CosmeticEngine` sends its text with the call (`ScriptletCall.resources`), and the scriptlet reads it with `resourceText()` while it is set up, not later.
- `close-window` only closes a window a page opened (`window.opener`): a filter must never close the host app's own window.
- `set-cookie-reload` and the `reload` token reload with `history.go(0)`, once the cookie reads back, and only when it wasn't there before: a page that refuses the cookie doesn't reload forever.

## Not implemented

- In uBlock Origin's lists but not in its wiki, so there is nothing to write them from: `edit-object-on-setter`, `prevent-clipboard-write`, `mpegdash-prune`, `multiup`, `prevent-navigation`, `proxy-apply-config`. `yarn lists` prints the names without an implementation, with how many filters use each.
- `overlay-buster`: the wiki only says it "gets rid of overlay dialogs". A guess could hide a page's real content, and no default list uses it.
- The JSONPath of the `edit` suite (`network/jsonPath.ts`) reads RFC 9535 queries and the `v2:` prefix. It rejects the legacy syntax the wiki says to stop using, slices, `&&` and `||`, and function calls.

## Tests

- `createPage()` (`test/helpers/page.ts`) gives each test a jsdom page that gets the bundled scriptlets, as a real page does: a scriptlet that leans on something outside the bundle fails there. Its `inject` and `run` go through the page's `eval` as it was before any scriptlet wrapped it.
- jsdom has no `fetch`, `Response`, `RTCPeerConnection` or `HTMLDialogElement.close`: tests give the page a stand-in before injecting (`test/helpers/fakes.ts`), as a browser would have it. No test makes a real request.
- What jsdom can't show stays unchecked until `yarn smoke`: whether `prevent-refresh` stops a meta refresh at the right moment, and a text edit reaching a script before it runs.

---
paths:
  - "src/cosmetic/**"
  - "src/content/**"
---

# Cosmetic engine

`CosmeticEngine` (`src/cosmetic/engine.ts`, in the main process) decides what a document gets; `src/content/` applies it in the page, from the preload's isolated world.

## What a document gets

- `forDocument(hostname, switches)` gives the stylesheet, the procedural plans and the scriptlets. **Each selector is a CSS rule of its own**, so one the browser refuses only loses itself. That is also why the parser only checks a selector's balance, not that it is valid CSS.
- Filters are filed under their hostnames, their entities (`shop.*`) and `*`; a document looks under its hostname, each parent and the same as entities (`keys`). A hostname written as a regular expression is tried on every document.
- An exception lifts the filter with the same body (`CosmeticRule.key`). A negated hostname (`a.example,~b.a.example##.ad`) is filed as an exception for that hostname, as the wiki's "Syntax quirks" say.
- `*##selector` goes to every page like a generic filter: `generichide` lifts it, `specifichide` doesn't.
- `elemhide` leaves only the scriptlets: they aren't cosmetic filtering.
- A generic filter with a class or an id in it (`selectorKey`) is only sent when the page uses that class or id (`genericFor`); the page asks about each one once. The others (575 with the default lists, 36 kB of CSS) go to every document. A filter that is only a class or an id gets `:not(html):not(body)`, so it never hides the page itself.
- A scriptlet is known by its own name: an exception written with an alias lifts it. `#@#+js()` lifts every scriptlet of a hostname. A `trusted-` scriptlet from an untrusted list is dropped and counted (`stats.untrustedScriptlets`), and so is a name without an implementation (`stats.unknownScriptlets`).
- With the nine default lists the cosmetic and scriptlet filters hold about 22 MB.

## In the page

- **`src/content/` is bundled into the preload**: it imports types only from outside its folder. It takes what it needs from where it runs through `CosmeticsHost`, so tests run it in jsdom with a fake.
- A procedural filter marks its elements with an attribute no page uses (a random prefix), and a stylesheet rule hides or restyles what carries it. An element a filter no longer selects loses the mark. `:style()` gets an attribute of its own per declaration block.
- One `MutationObserver` serves the procedural filters and the survey of classes and ids. Changes gather for `DELAY` ms. **An attribute change only reruns the filters that say `:watch-attr()`**, as the wiki describes; a change of the page's tree reruns them all. The marks' own attribute changes are skipped, or the observer would answer itself forever.
- `:matches-path()` is checked at every run, not once: a page that navigates without loading (a single-page app) changes path under a running filter.

## Operators: choices where the wiki is silent

- `:has(arg)` looks below its subject, as the native one does (`:scope` is put in front), unless the argument says `:scope` itself. `:not(arg)` is about the subject itself.
- CSS after an operator continues from what the operator kept (`continueFrom`): ` a` and ` > a` look below each element, `+ a` and `~ a` after it, and `.a` with no space keeps the element if it matches. Since `querySelectorAll` can't start from an element's siblings or test the element itself, those cases name the element from its parent as `:scope > :nth-child(n)`.
- In `:matches-attr()`, `:matches-css()` and `:matches-prop()` a value that isn't a regular expression must be the whole value; in `:has-text()` and `:matches-path()` it is text to find.
- `:others()` selects each element that isn't one of the subjects, inside one or around one, and not what is inside those elements: hiding them hides their content.
- An operator this version doesn't know selects nothing.

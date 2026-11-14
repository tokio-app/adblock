---
paths:
  - "src/network/**"
  - "src/psl/**"
  - "scripts/bench/**"
---

# Network engine

`NetworkEngine` (`src/network/engine.ts`) decides in three places: `match()` before a request (block, and the redirect resource to answer with), `rewrite()` for a request that isn't blocked (`removeparam=`, `urlskip=`, `uritransform=`), and `response()` when the headers arrive (`header=`, and the policies of `csp=`, `permissions=`, `inline-script` and `inline-font`). `cosmeticSwitches()` reads the `generichide`, `specifichide` and `elemhide` exceptions for a document.

## Precedence

- An `important` block wins, then an exception, then a block.
- `redirect=` is a block filter plus a redirect directive; `redirect-rule=` is the directive alone. A directive only applies to a request something blocks. Among the directives that match, an `important` one wins, then the highest priority. An exception with the same resource lifts that directive, one without a value lifts them all, and neither lifts the block. `redirect=none` is read as that second kind of exception.
- A filter whose `redirect=` names a resource that doesn't exist is discarded whole, block included (`stats.unknownResources`).
- Modifier exceptions (`csp`, `permissions`, `removeparam`, `urlskip`, `uritransform`) work the same way: same value, or no value for all; `important` ignores both (`Modifiers`).
- `badfilter` removes the filter that parses to the same rule, whatever the order or spelling of its options (`ruleKey`). A filter for every URL (`*`, `|http://`, `|https://`) limited to sites counts as one filter per site (`perSite`).

## Choices where the wiki is silent

- `domain=` is compared with the document that makes the request, `top=` with the top document. A document's own request is first-party to itself, whatever opened it.
- A plain exception for the request lifts a `header=` block too, unless the block is `important`.
- `removeparam=name` removes the parameter with exactly that name, as written in the URL; `~` negates, as in AdGuard's documentation.
- `urlskip=` only redirects to an http(s) URL that differs from the request's.
- `inline-script` adds `script-src 'unsafe-eval' * blob: data:` and `inline-font` adds `font-src *` (`INLINE_SCRIPT_CSP`, `INLINE_FONT_CSP`).
- `ipaddress=` only matches a URL whose host is an address: Chromium doesn't tell which address a name resolved to.
- `popup` filters only answer a request of type `popup`; nothing makes one by itself (see the Electron rule once there is one).

## Filing

`FilterIndex` files rules so a request tests a handful:

- `||hostname^` and `||hostname/literal[^]` rules with nothing but flags and types are packed: the pattern and one number, `(flags << 18) | types`, with bit 29 for a trailing `^`. Lists hold 200,000 of them, and a rule object each costs five times the memory. **The number must stay under 2^30** (a V8 small integer): `src/parser/types.ts` has 18 type bits and 11 flag bits, and a new bit there needs a new layout here. A packed rule's `raw` in a decision is rebuilt without its options.
- Packed paths are sorted per hostname and found by bisection (`visitPaths`): one hostname can have 50,000 of them.
- Other rules that start with a whole hostname go under it; more than `MAX_HOST_BUCKET` patterns under one hostname go by token instead.
- The rest go under a token: a run of letters, digits and `%` that any URL the pattern matches holds whole (`src/network/tokens.ts`). A run next to `*`, or at an unanchored end of the pattern, could be part of a longer token and isn't one. From a regular expression only what is certain counts: a wrong token hides the rule from the requests it should match, so when in doubt give none.
- A rule without a token goes under each site of its `domain=`, or is tested against every request (`rest`).
- `finalizing()` is `finalize()` in steps: `Engine` gives the event loop a turn between them.

## Public Suffix List

`PublicSuffixList` (`src/psl/psl.ts`) is our own matcher over Mozilla's list, which `Engine` downloads from `PUBLIC_SUFFIX_LIST_URLS` and keeps in the storage. The list is MPL-2.0 data: it isn't bundled (that needs the user's OK). Without it the class guesses: the last label, or the last two under a two-letter country domain with a common second level (`co.uk`).

## Measuring

`yarn bench` (after `yarn lists`) builds the engine from `lists/` and prints the times, the heap and requests per second over made-up traffic; `--skip <list id>` leaves a list out. On the development machine, with the nine default lists (307,000 lines, 237,000 network rules): parse 550 ms, file 210 ms, 41 MB of heap (21 MB without `urlhaus-1`), 110,000 requests a second. A change that makes one of these clearly worse needs a reason.

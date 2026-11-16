---
paths:
  - "src/lists/**"
  - "src/parser/**"
  - "src/engine.ts"
  - "scripts/lists/**"
---

# Lists and parser

## Lists

- `DEFAULT_LISTS` (`src/lists/defaults.ts`) are the lists uBlock Origin enables by default, with its ids, read from its published asset index, `https://raw.githubusercontent.com/gorhill/uBlock/master/assets/assets.json` (a data file: URLs and which lists are on). Peter Lowe's list and the malware list (`urlhaus-1`) stay in, and a host app leaves out what it doesn't want (the user's call). Each list's own URL comes first, then its CDN mirrors. A new default list or host goes in `THIRD_PARTY_NOTICES.md` too.
- Only uBlock Origin's own lists are `trusted`. A trusted list can run arbitrary code in pages (`trusted-*` scriptlets) and send navigations elsewhere (`urlskip=`), so never mark a third-party list trusted by default.
- A sub-list (`!#include`) is downloaded from the folder of the URL that served its list, so a list from a mirror gets the mirror's sub-lists. Its path can't leave that folder (`isSafeInclude`). It is stored under `<list id>/<path>`.
- A failed download never throws past a stored copy: the copy stays in effect and the list is tried again an hour later. `ListManager.load` rejects only when a list is neither stored nor downloadable.
- A list without `! Expires:` lasts `updateAfterDays`, 5 days by default (our choice: the wiki doesn't give uBlock Origin's).
- `Engine` parses in slices of `SLICE` lines with a turn of the event loop between them: a host's main process must not freeze while 300,000 lines load. A changed list rebuilds everything; parsed rules aren't kept per list, to not hold them twice.
- A build fetches every list first (`ListManager.get`: texts only), then splits, parses and files one list at a time, each slice's rules handed to the engines before the next slice: holding every list's lines and rules at once made the peak twice what the engines keep. `updateLists()` is that first step alone, for a host that builds the engine only when it needs it.
- `preprocess` walks the text line by line instead of splitting it, and `includesOf` only reads the lines a directive starts. Their output must stay what a split at `\r?\n` gives (`preprocessor.test.ts`).
- `yarn lists` (opt-in, network) downloads the default lists into `lists/` and prints the counts. Its `--samples` prints list lines: terminal only, never into the repository.

## Pre-parsing directives

- `ENVIRONMENT` (`src/lists/preprocessor.ts`) is what `!#if` sees: uBlock Origin on a Chromium desktop browser, with `cap_html_filtering` false (Electron can't rewrite a response body) and `cap_ipaddress` false. A name that isn't in it is false (our choice: the wiki says unknown names are "ignored"; false keeps another product's filters out).

## Parser

Choices where the wiki doesn't pin the behavior down, or where the obvious reading breaks:

- **Where the options start:** at the first `$` after which every option name is known (`splitFilter`). A `$` also appears in patterns (`/x$/`) and in values (`removeparam=/^utm_$/`). So a new option must be added to `TYPE_OPTIONS` or `OTHER_OPTIONS`, or filters using it are discarded as "unknown option".
- **A comma splits options only when an option name follows it** (`splitOptions`): values hold commas too (`domain=/x{3,5}/`, a CSP).
- **`||hostname` without `^` is a host rule**, like `||hostname^` and a bare `hostname` (the wiki only says so for the bare form). A host rule without a type also applies to documents (strict blocking), block and exception alike: an exception that left the page blocked would be worse than one that unblocks it.
- **A filter with `cname` is dropped, not kept without the option:** `@@*$cname` without it would allow everything. Chromium has no CNAME uncloaking, so the filter can never apply.
- `csp=` with `report-uri` or `report-to` is discarded: a list shouldn't make pages report to a server.
- `important` is ignored on an exception, and `redirect=` in an exception means `redirect-rule=`: an exception lifts the redirect, never the block.
- A modifier without a type applies to documents and subdocuments (`csp`, `permissions`) or to every request, documents included (`removeparam`, `urlskip`, `uritransform`).
- A quoted scriptlet argument only unescapes its own quote (`\'`): other backslashes belong to regular expressions.
- A selector list with procedural parts (`.a, .b:has-text(x)`) gives one rule per procedural part and one for the plain parts. The wiki says such lists aren't supported, but uBlock Origin's own lists have them.
- `##selector { declarations }` is read like AdGuard's `#$#` (EasyList writes it that way), and `#%#//scriptlet(...)` like `##+js(...)`.
- Plain selectors are only checked for balance, braces, comments and control characters (`splitOperators`, `plainSelectorError`): an unbalanced `[` or `(` would swallow the rules after it in a stylesheet. Whether a selector is valid CSS is left to the page, where each selector gets its own rule so a bad one only loses itself.
- `||hostname^` and `@@||hostname^` in lowercase, without options, skip the whole parser (`plainHostFilter`, `src/parser/index.ts`): they're most of the lists. The result must stay what `parseNetworkFilter` gives (`index.test.ts`); anything else, a capital included, takes the whole parser. Their `raw` is cut out of the list's text: the network engine packs them and drops it.
- `requestheader=` appears once in uBlock Origin's lists and isn't in the wiki: it is discarded as an unknown option until it is documented (the user's call).

Not applied, and counted as `unsupported` (`yarn lists` prints them): HTML filters (`##^`, except `##^responseheader()`) and `replace=` (Electron can't rewrite response bodies), `cname`, and `popunder` (needs a browser's tabs).

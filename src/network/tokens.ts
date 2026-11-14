import {
  F_HOST_ANCHOR,
  F_LEFT_ANCHOR,
  F_RIGHT_ANCHOR,
  P_PATTERN,
  P_REGEX,
  type NetworkRule,
} from "../parser/types.js";

// A token is a run of letters, digits and `%`. A rule is filed under a token
// its pattern can't match without, so a request only looks at the rules filed
// under the tokens of its URL.

function isTokenChar(c: number): boolean {
  return (
    (c >= 0x61 && c <= 0x7a) || // a-z
    (c >= 0x30 && c <= 0x39) || // 0-9
    c === 0x25 // %
  );
}

// Past this, a URL is a blob of data, not something filters describe.
const MAX_TOKENIZED = 2048;

/** The tokens of a lowercased URL. */
export function urlTokens(lower: string): string[] {
  const tokens: string[] = [];
  const end = Math.min(lower.length, MAX_TOKENIZED);
  let start = -1;
  for (let i = 0; i < end; i++) {
    if (isTokenChar(lower.charCodeAt(i))) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      tokens.push(lower.slice(start, i));
      start = -1;
    }
  }
  // A token cut by the limit isn't whole: no rule may rely on it.
  if (start !== -1 && end === lower.length) tokens.push(lower.slice(start));
  return tokens;
}

/**
 * The tokens every URL a pattern matches holds whole: runs bounded on both
 * sides by a character that isn't part of a token, by `^`, or by an anchor.
 * A run next to `*` or at an unanchored end could be part of a longer token.
 */
function patternTokens(pattern: string, flags: number): string[] {
  const tokens: string[] = [];
  let start = -1;
  for (let i = 0; i <= pattern.length; i++) {
    const c = i < pattern.length ? pattern.charCodeAt(i) : -1;
    if (c !== -1 && isTokenChar(c)) {
      if (start === -1) start = i;
      continue;
    }
    if (start === -1) continue;
    const before = start === 0 ? -1 : pattern.charCodeAt(start - 1);
    const bounded = (edge: number, anchors: number) =>
      edge === -1 ? (flags & anchors) !== 0 : edge !== 0x2a; /* * */
    if (
      bounded(before, F_HOST_ANCHOR | F_LEFT_ANCHOR) &&
      bounded(c, F_RIGHT_ANCHOR)
    ) {
      tokens.push(pattern.slice(start, i));
    }
    start = -1;
  }
  return tokens;
}

// In a regular expression, a character that stands for itself and isn't part
// of a token.
const LITERAL_BOUNDARY = /[\s!"#&',/:;<=>@_`~-]/;

/**
 * The tokens every URL a regular expression matches holds whole. Only what
 * is certain counts: literal runs outside groups, between literal characters
 * that aren't part of a token. An alternation at the top level gives none.
 */
function regexTokens(source: string): string[] {
  const tokens: string[] = [];
  // Each element: a literal token character, a literal boundary, or anything
  // else (a class, a group, a wildcard: could be part of a token).
  const kinds: ("token" | "boundary" | "other")[] = [];
  const chars: string[] = [];
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    let kind: "token" | "boundary" | "other" = "other";
    let char = "";
    if (c === "\\") {
      const next = source[++i] ?? "";
      // An escaped punctuation mark is that mark; `\d`, `\w`, `\x41` aren't.
      if (depth === 0 && /[^a-z0-9]/i.test(next)) {
        kind = next === "%" ? "token" : "boundary";
        char = next;
      }
    } else if (c === "[") {
      for (i++; i < source.length && source[i] !== "]"; i++) {
        if (source[i] === "\\") i++;
      }
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    } else if (c === "|") {
      if (depth === 0) return [];
    } else if (depth === 0) {
      if (/[a-z0-9%]/i.test(c)) {
        kind = "token";
        char = c.toLowerCase();
      } else if (c === "?" || c === "*" || c === "{") {
        // The element before may be absent: it bounds nothing, is no token.
        if (kinds.length > 0) kinds[kinds.length - 1] = "other";
      } else if (LITERAL_BOUNDARY.test(c)) {
        kind = "boundary";
        char = c;
      } else if (c === "^" && i === 0) {
        kind = "boundary";
      } else if (c === "$" && i === source.length - 1) {
        kind = "boundary";
      }
    }
    kinds.push(depth === 0 || c === ")" ? kind : "other");
    chars.push(char);
  }
  let start = -1;
  for (let i = 0; i <= kinds.length; i++) {
    if (kinds[i] === "token") {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (
        start > 0 &&
        kinds[start - 1] === "boundary" &&
        kinds[i] === "boundary"
      ) {
        tokens.push(chars.slice(start, i).join(""));
      }
      start = -1;
    }
  }
  return tokens;
}

/** The tokens a rule can be filed under. None when nothing is certain. */
export function ruleTokens(rule: NetworkRule): string[] {
  if (rule.patternKind === P_PATTERN) {
    return patternTokens(rule.pattern, rule.flags);
  }
  return rule.patternKind === P_REGEX ? regexTokens(rule.pattern) : [];
}

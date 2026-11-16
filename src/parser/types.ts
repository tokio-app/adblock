// The typed rules the parser turns filter list lines into.

// Request types, as bits. A filter's `types` is the set it applies to.
export const T_DOCUMENT = 1 << 0;
export const T_SUBDOCUMENT = 1 << 1;
export const T_STYLESHEET = 1 << 2;
export const T_SCRIPT = 1 << 3;
export const T_IMAGE = 1 << 4;
export const T_FONT = 1 << 5;
export const T_OBJECT = 1 << 6;
export const T_XHR = 1 << 7;
export const T_PING = 1 << 8;
export const T_MEDIA = 1 << 9;
export const T_WEBSOCKET = 1 << 10;
export const T_OTHER = 1 << 11;
export const T_POPUP = 1 << 12;
export const T_INLINE_SCRIPT = 1 << 13;
export const T_INLINE_FONT = 1 << 14;
// Not requests: exception filters with these switch cosmetic filtering off
// for the documents they match.
export const T_GENERICHIDE = 1 << 15;
export const T_SPECIFICHIDE = 1 << 16;
export const T_ELEMHIDE = 1 << 17;

/** What a filter without a type option applies to. */
export const T_NETWORK =
  T_SUBDOCUMENT |
  T_STYLESHEET |
  T_SCRIPT |
  T_IMAGE |
  T_FONT |
  T_OBJECT |
  T_XHR |
  T_PING |
  T_MEDIA |
  T_WEBSOCKET |
  T_OTHER;
/** The `all` option. */
export const T_ALL =
  T_NETWORK | T_DOCUMENT | T_POPUP | T_INLINE_SCRIPT | T_INLINE_FONT;
export const T_COSMETIC = T_GENERICHIDE | T_SPECIFICHIDE | T_ELEMHIDE;

// A network rule's flags.
export const F_EXCEPTION = 1 << 0;
export const F_IMPORTANT = 1 << 1;
export const F_BADFILTER = 1 << 2;
export const F_MATCH_CASE = 1 << 3;
/** `||`: the pattern starts at a hostname label. */
export const F_HOST_ANCHOR = 1 << 4;
/** `|` at the start: the pattern starts where the URL does. */
export const F_LEFT_ANCHOR = 1 << 5;
/** `|` at the end: the pattern ends where the URL does. */
export const F_RIGHT_ANCHOR = 1 << 6;
export const F_FIRST_PARTY = 1 << 7;
export const F_THIRD_PARTY = 1 << 8;
export const F_STRICT_FIRST_PARTY = 1 << 9;
export const F_STRICT_THIRD_PARTY = 1 << 10;

// HTTP methods, as bits (the `method=` option).
export const METHODS: Readonly<Record<string, number>> = {
  connect: 1 << 0,
  delete: 1 << 1,
  get: 1 << 2,
  head: 1 << 3,
  options: 1 << 4,
  patch: 1 << 5,
  post: 1 << 6,
  put: 1 << 7,
};

/**
 * - `P_ALL`: every URL (`*` or no pattern at all).
 * - `P_HOST`: `||hostname^`: the request's hostname is that one or one below
 *   it. Hosts file lines and bare hostnames become this too.
 * - `P_PATTERN`: an Adblock Plus pattern (`*`, `^`), lowercased, without its
 *   anchors (they are flags).
 * - `P_REGEX`: the source of a regular expression.
 */
export const P_ALL = 0;
export const P_HOST = 1;
export const P_PATTERN = 2;
export const P_REGEX = 3;
export type PatternKind =
  typeof P_ALL | typeof P_HOST | typeof P_PATTERN | typeof P_REGEX;

/**
 * A list of hostnames a filter is limited to. Entries are lowercase:
 * `example.com` (it and its subdomains), `example.*` (an entity: any public
 * suffix), `/regex/` (tested against the hostname) or `*` (everywhere, only in
 * cosmetic filters). A hostname matches when no `exclude` entry matches and,
 * if there are `include` entries, one of them does. Lists are shared, an
 * empty one by every filter without entries, so nothing changes them.
 */
export interface HostList {
  include: readonly string[];
  exclude: readonly string[];
}

export type ModifierType =
  | "redirect"
  | "redirect-rule"
  | "removeparam"
  | "csp"
  | "permissions"
  | "urlskip"
  | "uritransform";

/** What a modifier filter does to a request instead of blocking it. */
export interface Modifier {
  type: ModifierType;
  /** Empty when the option had no value (`removeparam`, `@@…$csp`). */
  value: string;
  /** `redirect=name:priority`. */
  priority: number;
}

export interface HeaderMatch {
  /** Lowercase header name; empty in a bare `header` exception. */
  name: string;
  /** Undefined: the header only has to be present. */
  value: string | undefined;
  /** The value is the source of a regular expression. */
  regex: boolean;
  regexFlags: string;
  /** `~value`: matches when the value doesn't. */
  negated: boolean;
}

/** The options few filters carry, kept off the rule to keep rules small. */
export interface ExtraOptions {
  to?: HostList;
  top?: HostList;
  denyallow?: string[];
  /** `method=`: bits of `METHODS`. Zero means no constraint. */
  methods?: number;
  notMethods?: number;
  header?: HeaderMatch;
  ipaddress?: string;
}

export interface NetworkRule {
  kind: "network";
  /** The filter as written, for reports. */
  raw: string;
  patternKind: PatternKind;
  pattern: string;
  flags: number;
  types: number;
  /** `domain=` / `from=`. */
  from: HostList | undefined;
  modifier: Modifier | undefined;
  extra: ExtraOptions | undefined;
}

/** One step of a procedural selector: an operator and its argument. */
export type ProceduralTask = [op: string, arg: unknown];

/**
 * A procedural cosmetic filter, compiled to plain data the page-side engine
 * runs: start from `selector` (empty: the document), apply each task to the
 * set of elements, then `action` to what is left (no action: hide).
 */
export interface ProceduralPlan {
  selector: string;
  tasks: ProceduralTask[];
  action?: [
    op: "style" | "remove" | "remove-attr" | "remove-class",
    arg: string,
  ];
}

export interface CosmeticRule {
  kind: "cosmetic";
  raw: string;
  exception: boolean;
  hosts: HostList;
  /** The filter's body as written: an exception cancels the same body. */
  key: string;
  /** A plain CSS selector, when the filter needs no JavaScript. */
  selector: string;
  /** `:style()` declarations for a plain selector. Undefined: hide. */
  style: string | undefined;
  /** `:matches-media()` on a plain selector, as a media query. */
  media: string | undefined;
  /** Set when the filter is procedural. */
  procedural: ProceduralPlan | undefined;
}

export interface ScriptletRule {
  kind: "scriptlet";
  raw: string;
  exception: boolean;
  hosts: HostList;
  /** The token as written, without `.js`. Empty in `#@#+js()`. */
  name: string;
  args: string[];
  /** The rule comes from a list allowed to use trusted scriptlets. */
  trusted: boolean;
}

/** `##^responseheader(name)`: remove a response header from documents. */
export interface ResponseHeaderRule {
  kind: "responseheader";
  raw: string;
  exception: boolean;
  hosts: HostList;
  header: string;
}

export type Rule =
  NetworkRule | CosmeticRule | ScriptletRule | ResponseHeaderRule;

/** What a line is when it isn't a rule. */
export interface NotARule {
  /**
   * - `comment`: a comment, a header or an empty line.
   * - `unsupported`: valid syntax the library can't apply in Electron.
   * - `invalid`: malformed, or discarded as uBlock Origin documents.
   */
  kind: "comment" | "unsupported" | "invalid";
  reason: string;
}

export type ParsedLine = Rule | NotARule;

export interface ParseContext {
  /**
   * The list may use what uBlock Origin keeps for its own lists: trusted
   * scriptlets and the `urlskip`, `uritransform` and `replace` options.
   */
  trusted: boolean;
}

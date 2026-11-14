import { domainToASCII } from "node:url";
import { tryRegex } from "../util.js";
import { isHostname, normalizeHostname, parseHostList } from "./hosts.js";
import {
  F_BADFILTER,
  F_EXCEPTION,
  F_FIRST_PARTY,
  F_HOST_ANCHOR,
  F_IMPORTANT,
  F_LEFT_ANCHOR,
  F_MATCH_CASE,
  F_RIGHT_ANCHOR,
  F_STRICT_FIRST_PARTY,
  F_STRICT_THIRD_PARTY,
  F_THIRD_PARTY,
  METHODS,
  P_ALL,
  P_HOST,
  P_PATTERN,
  P_REGEX,
  T_ALL,
  T_COSMETIC,
  T_DOCUMENT,
  T_ELEMHIDE,
  T_FONT,
  T_GENERICHIDE,
  T_IMAGE,
  T_INLINE_FONT,
  T_INLINE_SCRIPT,
  T_MEDIA,
  T_NETWORK,
  T_OBJECT,
  T_OTHER,
  T_PING,
  T_POPUP,
  T_SCRIPT,
  T_SPECIFICHIDE,
  T_STYLESHEET,
  T_SUBDOCUMENT,
  T_WEBSOCKET,
  T_XHR,
  type ExtraOptions,
  type HeaderMatch,
  type HostList,
  type Modifier,
  type NetworkRule,
  type NotARule,
  type ParseContext,
  type PatternKind,
} from "./types.js";

const TYPE_OPTIONS: Readonly<Record<string, number>> = {
  script: T_SCRIPT,
  image: T_IMAGE,
  stylesheet: T_STYLESHEET,
  css: T_STYLESHEET,
  object: T_OBJECT,
  xmlhttprequest: T_XHR,
  xhr: T_XHR,
  subdocument: T_SUBDOCUMENT,
  frame: T_SUBDOCUMENT,
  ping: T_PING,
  websocket: T_WEBSOCKET,
  media: T_MEDIA,
  font: T_FONT,
  other: T_OTHER,
  document: T_DOCUMENT,
  doc: T_DOCUMENT,
  popup: T_POPUP,
  "inline-script": T_INLINE_SCRIPT,
  "inline-font": T_INLINE_FONT,
  all: T_ALL,
  generichide: T_GENERICHIDE,
  ghide: T_GENERICHIDE,
  elemhide: T_ELEMHIDE,
  ehide: T_ELEMHIDE,
  specifichide: T_SPECIFICHIDE,
  shide: T_SPECIFICHIDE,
};

// Every other option name. A `$` only starts the options when each name after
// it is a known one, so this list also decides where a pattern ends.
const OTHER_OPTIONS = new Set([
  "popunder",
  "genericblock",
  "third-party",
  "3p",
  "first-party",
  "1p",
  "strict1p",
  "strict3p",
  "important",
  "badfilter",
  "match-case",
  "cname",
  "domain",
  "from",
  "to",
  "top",
  "denyallow",
  "method",
  "header",
  "ipaddress",
  "csp",
  "permissions",
  "redirect",
  "redirect-rule",
  "removeparam",
  "queryprune",
  "empty",
  "mp4",
  "rewrite",
  "replace",
  "uritransform",
  "urltransform",
  "urlskip",
  "reason",
]);

function isOptionName(name: string): boolean {
  return (
    Object.hasOwn(TYPE_OPTIONS, name) ||
    OTHER_OPTIONS.has(name) ||
    /^_+$/.test(name)
  );
}

const NEXT_OPTION = /~?([a-z0-9_-]+)(?=[=,]|$)/iy;

/**
 * Splits `a,b=c,d` at the commas that an option name follows, so a comma
 * inside a value (a regex, a CSP) or an escaped one stays in the value.
 */
function splitOptions(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x5c /* \ */) i++;
    else if (c === 0x2c /* , */) {
      NEXT_OPTION.lastIndex = i + 1;
      const match = NEXT_OPTION.exec(text);
      if (match === null || !isOptionName(match[1]!.toLowerCase())) continue;
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function optionName(part: string): string {
  const equals = part.indexOf("=");
  const name = equals === -1 ? part : part.slice(0, equals);
  return (name.startsWith("~") ? name.slice(1) : name).trim().toLowerCase();
}

/**
 * Finds where the options start: the first `$` after which every option name
 * is known. A `$` can also be part of the pattern or of a value.
 */
function splitFilter(
  text: string,
): { pattern: string; options: string[] } | string {
  let last = -1;
  for (
    let i = text.indexOf("$");
    i !== -1 && i < text.length - 1;
    i = text.indexOf("$", i + 1)
  ) {
    last = i;
    const options = splitOptions(text.slice(i + 1));
    if (options.every((part) => isOptionName(optionName(part)))) {
      return { pattern: text.slice(0, i), options };
    }
  }
  if (last !== -1) {
    const tail = text.slice(last + 1);
    if (/^~?[a-z0-9_-]+(?:[=,]|$)/i.test(tail)) {
      const unknown = tail
        .split(",")
        .map(optionName)
        .find((name) => !isOptionName(name));
      return `unknown option: ${unknown ?? tail}`;
    }
  }
  return { pattern: text, options: [] };
}

const invalid = (reason: string): NotARule => ({ kind: "invalid", reason });
const unsupported = (reason: string): NotARule => ({
  kind: "unsupported",
  reason,
});

function parseHeader(value: string): HeaderMatch | undefined {
  const colon = value.indexOf(":");
  const name = (colon === -1 ? value : value.slice(0, colon))
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) return undefined;
  const header: HeaderMatch = {
    name,
    value: undefined,
    regex: false,
    regexFlags: "",
    negated: false,
  };
  if (colon === -1) return header;
  let text = value.slice(colon + 1);
  if (text.startsWith("~")) {
    header.negated = true;
    text = text.slice(1);
  }
  const regex = /^\/(.+)\/([a-z]*)$/.exec(text);
  if (regex !== null) {
    if (tryRegex(regex[1]!, regex[2]) === undefined) return undefined;
    header.value = regex[1];
    header.regex = true;
    header.regexFlags = regex[2]!;
  } else {
    header.value = text.replaceAll("\\,", ",");
  }
  return header;
}

interface Pattern {
  kind: PatternKind;
  text: string;
  flags: number;
}

function parsePattern(text: string): Pattern | string {
  if (text.length > 1 && text.startsWith("/") && text.endsWith("/")) {
    const source = text.slice(1, -1);
    if (tryRegex(source) === undefined) return "bad regular expression";
    return { kind: P_REGEX, text: source, flags: 0 };
  }
  let flags = 0;
  if (text.startsWith("||")) {
    flags |= F_HOST_ANCHOR;
    text = text.slice(2);
  } else if (text.startsWith("|")) {
    flags |= F_LEFT_ANCHOR;
    text = text.slice(1);
  }
  if (text.endsWith("|")) {
    flags |= F_RIGHT_ANCHOR;
    text = text.slice(0, -1);
  }
  text = text.toLowerCase();
  if (flags & F_HOST_ANCHOR) {
    // Request URLs carry punycode hostnames.
    const end = text.search(/[/^:?*]/);
    const host = end === -1 ? text : text.slice(0, end);
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7f]/.test(host)) {
      text = domainToASCII(host) + text.slice(host.length);
    }
    const hostname = text.endsWith("^") ? text.slice(0, -1) : text;
    if (isHostname(hostname)) return { kind: P_HOST, text: hostname, flags: 0 };
  } else if (flags === 0 && isHostname(text)) {
    // A pattern that reads as a hostname is one, as in a hosts file.
    return { kind: P_HOST, text, flags: 0 };
  }
  text = text.replace(/\*{2,}/g, "*");
  // A wildcard next to an anchor undoes it.
  while (text.startsWith("*")) {
    text = text.slice(1);
    flags &= ~(F_HOST_ANCHOR | F_LEFT_ANCHOR);
  }
  while (text.endsWith("*")) {
    text = text.slice(0, -1);
    flags &= ~F_RIGHT_ANCHOR;
  }
  if (text === "") return { kind: P_ALL, text: "", flags: 0 };
  return { kind: P_PATTERN, text, flags };
}

/**
 * Parses a network filter: `[@@]pattern[$options]`. `line` is trimmed and
 * isn't a comment or a cosmetic filter.
 */
export function parseNetworkFilter(
  line: string,
  context: ParseContext,
): NetworkRule | NotARule {
  let flags = 0;
  let text = line;
  if (text.startsWith("@@")) {
    flags |= F_EXCEPTION;
    text = text.slice(2);
  }
  const split = splitFilter(text);
  if (typeof split === "string") return invalid(split);

  let types = 0;
  let notTypes = 0;
  let popunder = false;
  let from: HostList | undefined;
  let extra: ExtraOptions | undefined;
  // A filter has one modifier: a second one discards it.
  const modifiers: Modifier[] = [];
  const modify = (type: Modifier["type"], value: string, priority = 0) =>
    modifiers.push({ type, value, priority });

  for (const part of split.options) {
    const equals = part.indexOf("=");
    let name = (equals === -1 ? part : part.slice(0, equals))
      .trim()
      .toLowerCase();
    const value = equals === -1 ? "" : part.slice(equals + 1).trim();
    const negated = name.startsWith("~");
    if (negated) name = name.slice(1);

    const type = TYPE_OPTIONS[name];
    if (type !== undefined) {
      if (negated) notTypes |= type;
      else types |= type;
      continue;
    }
    if (negated && !/^(?:third-party|first-party|3p|1p)$/.test(name)) {
      return invalid(`option can't be negated: ${name}`);
    }
    switch (name) {
      case "third-party":
      case "3p":
        flags |= negated ? F_FIRST_PARTY : F_THIRD_PARTY;
        break;
      case "first-party":
      case "1p":
        flags |= negated ? F_THIRD_PARTY : F_FIRST_PARTY;
        break;
      case "strict1p":
        flags |= F_STRICT_FIRST_PARTY;
        break;
      case "strict3p":
        flags |= F_STRICT_THIRD_PARTY;
        break;
      case "important":
        flags |= F_IMPORTANT;
        break;
      case "badfilter":
        flags |= F_BADFILTER;
        break;
      case "match-case":
        flags |= F_MATCH_CASE;
        break;
      case "popunder":
        popunder = true;
        break;
      case "domain":
      case "from":
        from = parseHostList(value, "|");
        if (from === undefined) return invalid(`bad ${name}= value`);
        break;
      case "to":
      case "top": {
        const list = parseHostList(value, "|");
        if (list === undefined) return invalid(`bad ${name}= value`);
        (extra ??= {})[name] = list;
        break;
      }
      case "denyallow": {
        const hosts = value
          .split("|")
          .map((host) => normalizeHostname(host, true));
        const valid = hosts.filter((host) => host !== undefined);
        if (value === "" || valid.length !== hosts.length) {
          return invalid("bad denyallow= value");
        }
        (extra ??= {}).denyallow = valid;
        break;
      }
      case "method": {
        extra ??= {};
        for (let method of value.toLowerCase().split("|")) {
          const not = method.startsWith("~");
          if (not) method = method.slice(1);
          const bit = METHODS[method];
          if (bit === undefined) return invalid("bad method= value");
          if (not) extra.notMethods = (extra.notMethods ?? 0) | bit;
          else extra.methods = (extra.methods ?? 0) | bit;
        }
        break;
      }
      case "header": {
        // A bare `header` in an exception lifts every header= block.
        const header =
          value === "" && flags & F_EXCEPTION
            ? {
                name: "",
                value: undefined,
                regex: false,
                regexFlags: "",
                negated: false,
              }
            : parseHeader(value);
        if (header === undefined) return invalid("bad header= value");
        (extra ??= {}).header = header;
        break;
      }
      case "ipaddress":
        if (value === "") return invalid("bad ipaddress= value");
        (extra ??= {}).ipaddress = value.startsWith("/")
          ? value
          : value.toLowerCase();
        break;
      case "csp":
        if (/\breport-(?:uri|to)\b/i.test(value)) {
          return invalid("csp= with a report directive");
        }
        modify("csp", value);
        break;
      case "permissions":
        modify("permissions", value.replaceAll("|", ", "));
        break;
      case "redirect":
      case "redirect-rule": {
        const priority = /^(.+):(-?\d+)$/.exec(value);
        if (priority === null) modify(name, value);
        else modify(name, priority[1]!, Number(priority[2]));
        break;
      }
      case "empty":
        modify("redirect", "empty");
        break;
      case "mp4":
        modify("redirect", "noopmp4-1s");
        if (types === 0) types = T_MEDIA;
        break;
      case "rewrite":
        // Adblock Plus's name for redirect=.
        if (!value.startsWith("abp-resource:")) {
          return invalid("bad rewrite= value");
        }
        modify("redirect", value.slice("abp-resource:".length));
        break;
      case "removeparam":
      case "queryprune":
        modify("removeparam", value);
        break;
      case "uritransform":
      case "urltransform":
      case "urlskip":
        if (!context.trusted) return invalid(`${name}= in an untrusted list`);
        modify(name === "urlskip" ? "urlskip" : "uritransform", value);
        break;
      case "replace":
        return unsupported("replace= (Electron can't rewrite response bodies)");
      case "cname":
        return unsupported("cname (Chromium has no CNAME uncloaking)");
      case "genericblock":
        return invalid("genericblock (not supported, as in uBlock Origin)");
      case "reason":
        break;
      default:
        // `_`, a placeholder.
        break;
    }
  }

  const pattern = parsePattern(split.pattern);
  if (typeof pattern === "string") return invalid(pattern);
  flags |= pattern.flags;

  const exception = (flags & F_EXCEPTION) !== 0;
  if (flags & F_MATCH_CASE && pattern.kind !== P_REGEX) {
    return invalid("match-case on a filter that isn't a regular expression");
  }
  if (exception) flags &= ~F_IMPORTANT;
  if (extra?.denyallow !== undefined && from === undefined) {
    return invalid("denyallow= without domain=");
  }

  if (popunder && types === 0) {
    return unsupported("popunder (needs a browser's tabs)");
  }
  const explicitTypes = types !== 0 || notTypes !== 0;
  if (types === 0) {
    types = T_NETWORK;
    // A filter that is only a hostname blocks pages on it too.
    if (pattern.kind === P_HOST && notTypes === 0 && modifiers.length === 0) {
      types |= T_DOCUMENT;
    }
  }
  types &= ~notTypes;
  if (types & T_COSMETIC && !exception) {
    return invalid("generichide, specifichide and elemhide need an exception");
  }

  if (modifiers.length > 1) return invalid("two modifiers");
  const mod = modifiers[0];
  if (mod !== undefined) {
    if (mod.type === "redirect" && exception) mod.type = "redirect-rule";
    const needsValue =
      mod.type === "urlskip" ||
      mod.type === "uritransform" ||
      (!exception && mod.type !== "removeparam");
    if (needsValue && mod.value === "") return invalid(`${mod.type}= value`);
    if (mod.type === "csp" || mod.type === "permissions") {
      types = explicitTypes
        ? types & (T_DOCUMENT | T_SUBDOCUMENT)
        : T_DOCUMENT | T_SUBDOCUMENT;
    } else if (
      !explicitTypes &&
      mod.type !== "redirect" &&
      mod.type !== "redirect-rule"
    ) {
      // removeparam, urlskip and uritransform clean navigations too.
      types |= T_DOCUMENT;
    }
  }
  if (types === 0) return invalid("no request type left");

  return {
    kind: "network",
    raw: line,
    patternKind: pattern.kind,
    pattern: pattern.text,
    flags,
    types,
    from,
    modifier: mod,
    extra,
  };
}

import { anyHostMatches, hostListMatches } from "../parser/hosts.js";
import {
  F_FIRST_PARTY,
  F_HOST_ANCHOR,
  F_LEFT_ANCHOR,
  F_MATCH_CASE,
  F_RIGHT_ANCHOR,
  F_STRICT_FIRST_PARTY,
  F_STRICT_THIRD_PARTY,
  F_THIRD_PARTY,
  P_ALL,
  P_HOST,
  P_PATTERN,
  type NetworkRule,
} from "../parser/types.js";
import { tryRegex } from "../util.js";
import type { Request } from "./request.js";

// Compiled the first time a rule is tested: most rules never are.
const regexes = new WeakMap<NetworkRule, RegExp | null>();

const SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * An Adblock Plus pattern as a regular expression: `*` is anything, `^` a
 * separator (anything but a letter, a digit or one of `_-.%`, or the end of
 * the URL), `||` the start of a hostname label.
 */
function patternRegex(rule: NetworkRule): RegExp | null {
  const body = rule.pattern
    .replace(SPECIAL, "\\$&")
    .replaceAll("\\*", ".*")
    .replaceAll("\\^", "(?:[^\\w\\-.%]|$)");
  const start =
    rule.flags & F_HOST_ANCHOR
      ? "^[a-z][a-z0-9+.-]*:/+(?:[^/?#]*@)?(?:[^/?#]*\\.)?"
      : rule.flags & F_LEFT_ANCHOR
        ? "^"
        : "";
  return (
    tryRegex(start + body + (rule.flags & F_RIGHT_ANCHOR ? "$" : "")) ?? null
  );
}

function regexFor(rule: NetworkRule): RegExp | null {
  let regex = regexes.get(rule);
  if (regex === undefined) {
    regex =
      rule.patternKind === P_PATTERN
        ? patternRegex(rule)
        : (tryRegex(rule.pattern, rule.flags & F_MATCH_CASE ? "" : "i") ??
          null);
    regexes.set(rule, regex);
  }
  return regex;
}

/** Whether a hostname is `suffix` or a subdomain of it. */
export function hostnameEndsWith(hostname: string, suffix: string): boolean {
  return (
    hostname === suffix ||
    (hostname.endsWith(suffix) &&
      hostname.charCodeAt(hostname.length - suffix.length - 1) === 0x2e) /* . */
  );
}

function patternMatches(rule: NetworkRule, request: Request): boolean {
  const { pattern, flags } = rule;
  const { lower } = request;
  if (pattern.includes("*") || pattern.includes("^")) {
    return regexFor(rule)?.test(lower) === true;
  }
  // A literal: no regular expression needed.
  if (flags & F_HOST_ANCHOR) {
    for (
      let i = lower.indexOf(pattern, request.hostStart);
      i !== -1 && i < request.hostEnd;
      i = lower.indexOf(pattern, i + 1)
    ) {
      if (
        (i === request.hostStart || lower.charCodeAt(i - 1) === 0x2e) /* . */ &&
        (!(flags & F_RIGHT_ANCHOR) || i + pattern.length === lower.length)
      ) {
        return true;
      }
    }
    return false;
  }
  if (flags & F_LEFT_ANCHOR) {
    return flags & F_RIGHT_ANCHOR
      ? lower === pattern
      : lower.startsWith(pattern);
  }
  return flags & F_RIGHT_ANCHOR
    ? lower.endsWith(pattern)
    : lower.includes(pattern);
}

const IPV4_LAN = /^(?:10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const IPV6_LAN = /^\[(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/;

/**
 * `ipaddress=`: Chromium doesn't tell which address a request resolved to,
 * so only a URL whose host is an address can match.
 */
function ipAddressMatches(value: string, hostname: string): boolean {
  const v6 = hostname.startsWith("[");
  if (!v6 && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return false;
  const address = v6 ? hostname.slice(1, -1) : hostname;
  if (value === "lan")
    return IPV4_LAN.test(hostname) || IPV6_LAN.test(hostname);
  if (value === "loopback")
    return address.startsWith("127.") || address === "::1";
  if (value.length > 2 && value.startsWith("/") && value.endsWith("/")) {
    return tryRegex(value.slice(1, -1))?.test(address) === true;
  }
  return value.endsWith("*")
    ? address.startsWith(value.slice(0, -1))
    : address === value;
}

/**
 * Whether a rule applies to a request: its type, party, pattern and hostname
 * options. `header=` isn't checked here: it needs the response.
 */
export function ruleMatches(rule: NetworkRule, request: Request): boolean {
  if ((rule.types & request.type) === 0) return false;
  const { flags } = rule;
  if (flags & F_THIRD_PARTY && !request.thirdParty) return false;
  if (flags & F_FIRST_PARTY && request.thirdParty) return false;
  if (flags & F_STRICT_THIRD_PARTY && !request.strictThirdParty) return false;
  if (flags & F_STRICT_FIRST_PARTY && request.strictThirdParty) return false;

  if (rule.patternKind === P_HOST) {
    if (!hostnameEndsWith(request.hostname, rule.pattern)) return false;
  } else if (rule.patternKind === P_PATTERN) {
    if (!patternMatches(rule, request)) return false;
  } else if (rule.patternKind !== P_ALL) {
    const regex = regexFor(rule);
    if (regex === null || !regex.test(request.url)) return false;
  }

  if (
    rule.from !== undefined &&
    !hostListMatches(rule.from, request.sourceHostname, request.sourceEntity)
  ) {
    return false;
  }
  const { extra } = rule;
  if (extra === undefined) return true;
  if (extra.methods !== undefined && (extra.methods & request.method) === 0) {
    return false;
  }
  if (extra.notMethods !== undefined && extra.notMethods & request.method) {
    return false;
  }
  if (
    extra.to !== undefined &&
    !hostListMatches(extra.to, request.hostname, request.hostEntity)
  ) {
    return false;
  }
  if (
    extra.top !== undefined &&
    !hostListMatches(extra.top, request.topHostname, request.topEntity)
  ) {
    return false;
  }
  if (
    extra.denyallow !== undefined &&
    anyHostMatches(extra.denyallow, request.hostname, "")
  ) {
    return false;
  }
  return (
    extra.ipaddress === undefined ||
    ipAddressMatches(extra.ipaddress, request.hostname)
  );
}

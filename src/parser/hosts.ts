import { domainToASCII } from "node:url";
import { tryRegex } from "../util.js";
import type { HostList } from "./types.js";

// Labels of letters, digits, hyphens and underscores, at least two of them.
const HOSTNAME =
  /^(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?\.)+[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/;
const SINGLE_LABEL = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/;
// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7f]/;

/** No hostnames: shared by every list without any. Nothing changes a list. */
const NO_HOSTNAMES: readonly string[] = Object.freeze([]);

/** A list without hostnames: what a generic filter has. */
export const NO_HOSTS: HostList = Object.freeze({
  include: NO_HOSTNAMES,
  exclude: NO_HOSTNAMES,
});

/**
 * Lowercases a hostname and turns non-ASCII labels into punycode, as request
 * URLs have them. Undefined when the text isn't a hostname.
 */
export function normalizeHostname(
  text: string,
  allowSingleLabel = false,
): string | undefined {
  let hostname = text.toLowerCase();
  if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
  if (NON_ASCII.test(hostname)) hostname = domainToASCII(hostname);
  if (HOSTNAME.test(hostname) || IPV6.test(hostname)) return hostname;
  if (allowSingleLabel && SINGLE_LABEL.test(hostname)) return hostname;
  return undefined;
}

/** Whether a pattern reads as a hostname, which makes it `||hostname^`. */
export function isHostname(text: string): boolean {
  return HOSTNAME.test(text);
}

/**
 * Splits a hostname list. A regex entry (`/…/`) may hold the separator, so it
 * runs to the slash that the separator or the end follows.
 */
function splitEntries(text: string, separator: string): string[] | undefined {
  const entries: string[] = [];
  let i = 0;
  while (i < text.length) {
    const first = text[i] === "~" ? i + 1 : i;
    if (text[first] !== "/") {
      const next = text.indexOf(separator, i);
      if (next === -1) {
        entries.push(text.slice(i));
        break;
      }
      entries.push(text.slice(i, next));
      i = next + 1;
      continue;
    }
    let end = -1;
    for (let k = first + 1; k < text.length; k++) {
      if (text[k] === "\\") k++;
      else if (
        text[k] === "/" &&
        (k + 1 === text.length || text[k + 1] === separator)
      ) {
        end = k;
        break;
      }
    }
    if (end === -1) return undefined;
    entries.push(text.slice(i, end + 1));
    i = end + 2;
  }
  return entries;
}

/**
 * Parses the hostnames of `domain=`, `to=` (`|` between them) or of a cosmetic
 * filter (`,`). Undefined when an entry isn't a hostname, an entity or a regex.
 */
export function parseHostList(
  text: string,
  separator: "|" | ",",
  allowWildcard = false,
): HostList | undefined {
  const entries = splitEntries(text, separator);
  if (entries === undefined) return undefined;
  let include: string[] | undefined;
  let exclude: string[] | undefined;
  for (let entry of entries) {
    entry = entry.trim();
    if (entry === "") continue;
    const negated = entry.startsWith("~");
    if (negated) entry = entry.slice(1);
    let value: string | undefined;
    if (entry.length > 2 && entry.startsWith("/") && entry.endsWith("/")) {
      if (tryRegex(entry.slice(1, -1)) === undefined) return undefined;
      value = entry;
    } else if (entry === "*") {
      if (!allowWildcard || negated) return undefined;
      value = entry;
    } else if (entry.endsWith(".*")) {
      const name = normalizeHostname(entry.slice(0, -2), true);
      if (name !== undefined) value = `${name}.*`;
    } else {
      value = normalizeHostname(entry, true);
    }
    if (value === undefined) return undefined;
    if (negated) (exclude ??= []).push(value);
    else (include ??= []).push(value);
  }
  if (include === undefined && exclude === undefined) return undefined;
  // Copies of the exact size: an array grown by push keeps room for 16 more
  // entries, and filters keep their lists as long as they are in effect.
  return {
    include: include === undefined ? NO_HOSTNAMES : include.slice(),
    exclude: exclude === undefined ? NO_HOSTNAMES : exclude.slice(),
  };
}

const regexes = new Map<string, RegExp>();

function entryMatches(entry: string, hostname: string, entity: string) {
  if (entry.charCodeAt(0) === 0x2f /* / */) {
    let regex = regexes.get(entry);
    if (regex === undefined) {
      regex = new RegExp(entry.slice(1, -1));
      regexes.set(entry, regex);
    }
    return regex.test(hostname);
  }
  if (entry === "*") return true;
  if (entry.endsWith(".*")) {
    return entity !== "" && (entity === entry || entity.endsWith(`.${entry}`));
  }
  return (
    hostname === entry ||
    (hostname.endsWith(entry) &&
      hostname.charCodeAt(hostname.length - entry.length - 1) === 0x2e) /* . */
  );
}

/** Whether any entry of the list matches. */
export function anyHostMatches(
  entries: readonly string[],
  hostname: string,
  entity: string,
): boolean {
  for (const entry of entries) {
    if (entryMatches(entry, hostname, entity)) return true;
  }
  return false;
}

/**
 * Whether a hostname is in a list. `entity` is the hostname with its public
 * suffix replaced by `*` (`www.google.*` for `www.google.co.uk`), or empty.
 */
export function hostListMatches(
  list: HostList,
  hostname: string,
  entity: string,
): boolean {
  if (anyHostMatches(list.exclude, hostname, entity)) return false;
  return (
    list.include.length === 0 || anyHostMatches(list.include, hostname, entity)
  );
}

import { parseCosmeticFilter, splitCosmetic } from "./cosmetic.js";
import { normalizeHostname } from "./hosts.js";
import { parseNetworkFilter } from "./network.js";
import {
  F_EXCEPTION,
  P_HOST,
  T_DOCUMENT,
  T_NETWORK,
  type CosmeticRule,
  type NetworkRule,
  type NotARule,
  type ParseContext,
  type ParsedLine,
  type ResponseHeaderRule,
  type ScriptletRule,
} from "./types.js";

/** How many lines of each kind a list holds. */
export interface ParseStats {
  lines: number;
  comments: number;
  network: number;
  networkExceptions: number;
  cosmetic: number;
  cosmeticExceptions: number;
  /** Cosmetic filters that need JavaScript, counted in `cosmetic` too. */
  procedural: number;
  scriptlets: number;
  scriptletExceptions: number;
  responseHeaders: number;
  /** Valid syntax the library can't apply, by reason. */
  unsupported: Record<string, number>;
  /** Malformed or discarded filters, by reason. */
  invalid: Record<string, number>;
}

export interface ParsedList {
  network: NetworkRule[];
  cosmetic: CosmeticRule[];
  scriptlets: ScriptletRule[];
  responseHeaders: ResponseHeaderRule[];
  stats: ParseStats;
}

export function emptyParsedList(): ParsedList {
  return {
    network: [],
    cosmetic: [],
    scriptlets: [],
    responseHeaders: [],
    stats: {
      lines: 0,
      comments: 0,
      network: 0,
      networkExceptions: 0,
      cosmetic: 0,
      cosmeticExceptions: 0,
      procedural: 0,
      scriptlets: 0,
      scriptletExceptions: 0,
      responseHeaders: 0,
      unsupported: {},
      invalid: {},
    },
  };
}

const COMMENT: NotARule = { kind: "comment", reason: "" };
const EXTENDED_START = /^#@?(?:\$\?|\$|\?|%)?#/;
// A hosts file line: an address that means "nowhere", then hostnames.
const HOSTS_LINE =
  /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?|fe80::1%lo0|255\.255\.255\.255|ff0[02]::[1-3])\s+(\S.*)$/;
const LOCAL_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "local",
  "broadcasthost",
  "ip6-localhost",
  "ip6-loopback",
  "ip6-localnet",
  "ip6-mcastprefix",
  "ip6-allnodes",
  "ip6-allrouters",
  "ip6-allhosts",
  "0.0.0.0",
]);

/**
 * Parses one line of a filter list and hands each result to `emit`: one per
 * line, except a hosts file line, which gives a rule per hostname.
 */
export function parseLine(
  raw: string,
  context: ParseContext,
  emit: (parsed: ParsedLine) => void,
): void {
  let line = raw.trim();
  const first = line.charCodeAt(0);
  if (
    line === "" ||
    first === 0x21 /* ! */ ||
    (first === 0x5b /* [ */ && /^\[[^\]]*\]$/.test(line)) ||
    (first === 0x23 /* # */ && !EXTENDED_START.test(line))
  ) {
    emit(COMMENT);
    return;
  }
  // A line cut out of a list's text keeps the whole text in memory, and so
  // does every string cut out of the line: parse a copy. (V8 copies anything
  // shorter than 13 characters by itself.)
  if (line.length >= 13) line = Buffer.from(line).toString();
  const hosts = HOSTS_LINE.exec(line);
  if (hosts !== null) {
    for (const name of hosts[1]!.split(/\s+/)) {
      if (name.startsWith("#")) break;
      const hostname = normalizeHostname(name, true);
      if (hostname === undefined) {
        emit({ kind: "invalid", reason: "bad hostname in a hosts line" });
      } else if (LOCAL_NAMES.has(hostname)) {
        emit(COMMENT);
      } else {
        emit({
          kind: "network",
          raw: line,
          patternKind: P_HOST,
          pattern: hostname,
          flags: 0,
          types: T_NETWORK | T_DOCUMENT,
          from: undefined,
          modifier: undefined,
          extra: undefined,
        });
      }
    }
    return;
  }
  const cosmetic = splitCosmetic(line);
  const parsed =
    cosmetic === undefined
      ? parseNetworkFilter(line, context)
      : parseCosmeticFilter(line, cosmetic, context);
  if (Array.isArray(parsed)) parsed.forEach(emit);
  else emit(parsed);
}

/** Adds what `parseLine` found to a list's rules and counts. */
function collect(list: ParsedList, parsed: ParsedLine): void {
  const { stats } = list;
  switch (parsed.kind) {
    case "comment":
      stats.comments++;
      break;
    case "unsupported":
    case "invalid": {
      const counts = stats[parsed.kind];
      counts[parsed.reason] = (counts[parsed.reason] ?? 0) + 1;
      break;
    }
    case "network":
      list.network.push(parsed);
      if (parsed.flags & F_EXCEPTION) stats.networkExceptions++;
      else stats.network++;
      break;
    case "cosmetic":
      list.cosmetic.push(parsed);
      if (parsed.exception) stats.cosmeticExceptions++;
      else stats.cosmetic++;
      if (parsed.procedural !== undefined) stats.procedural++;
      break;
    case "scriptlet":
      list.scriptlets.push(parsed);
      if (parsed.exception) stats.scriptletExceptions++;
      else stats.scriptlets++;
      break;
    case "responseheader":
      list.responseHeaders.push(parsed);
      stats.responseHeaders++;
      break;
  }
}

/**
 * Parses `lines[start, end)` into `list`. A caller with a long list parses it
 * in slices, to give the event loop a turn between them.
 */
export function parseInto(
  list: ParsedList,
  lines: readonly string[],
  context: ParseContext,
  start = 0,
  end = lines.length,
): void {
  const emit = (parsed: ParsedLine) => collect(list, parsed);
  for (let i = start; i < end; i++) parseLine(lines[i]!, context, emit);
  list.stats.lines += end - start;
}

/** Parses a filter list's text, already preprocessed, into typed rules. */
export function parseList(
  text: string,
  context: ParseContext = { trusted: false },
): ParsedList {
  const list = emptyParsedList();
  parseInto(list, text.split(/\r?\n/), context);
  return list;
}

export type * from "./types.js";

import {
  F_EXCEPTION,
  F_FIRST_PARTY,
  F_HOST_ANCHOR,
  F_RIGHT_ANCHOR,
  F_STRICT_FIRST_PARTY,
  F_STRICT_THIRD_PARTY,
  F_THIRD_PARTY,
  P_HOST,
  P_PATTERN,
  type NetworkRule,
} from "../parser/types.js";
import { compactBuckets, ownString } from "../util.js";
import { ruleMatches } from "./pattern.js";
import type { Request } from "./request.js";
import { ruleTokens } from "./tokens.js";

// Rules filed between two turns of the event loop.
const STEP = 5000;
// More patterns than this under one hostname are filed by token instead.
const MAX_HOST_BUCKET = 8;

// A rule with nothing but a pattern, flags and types packs into its pattern
// and one number: uBlock Origin's lists hold 200,000 of them, and a rule
// object each would cost five times the memory.
const TYPE_BITS = 18;
const TYPE_MASK = (1 << TYPE_BITS) - 1;
const FLAG_MASK = (1 << 11) - 1;
/** A packed path ends with `^`: a separator or the URL's end must follow. */
const SEPARATOR_FOLLOWS = 1 << 29;

/** A rule's flags and types as one number, as packed rules keep them. */
export const packBits = (flags: number, types: number): number =>
  (flags << TYPE_BITS) | types;
export const typesOf = (bits: number): number => bits & TYPE_MASK;

/** A `||hostname^` rule with nothing but flags and types: it packs. */
export function isPlainHost(rule: NetworkRule): boolean {
  return rule.patternKind === P_HOST && isPlain(rule);
}

/** The plain `||hostname^` rule packed into `bits`. */
export function unpackHost(hostname: string, bits: number): NetworkRule {
  return unpack(hostname, bits);
}

/** `||hostname/literal` rules of one hostname, sorted by pattern. */
interface PathBucket {
  patterns: string[];
  packed: number[];
}

/** A hostname a host-anchored pattern starts with, whole: `||a.example/x`. */
function leadingHostname(rule: NetworkRule): string | undefined {
  if (rule.patternKind !== P_PATTERN || !(rule.flags & F_HOST_ANCHOR)) {
    return undefined;
  }
  const end = rule.pattern.search(/[/^:?*]/);
  // A wildcard right after could continue the hostname: `||a.example*`.
  if (end <= 0 || rule.pattern[end] === "*") return undefined;
  const hostname = rule.pattern.slice(0, end);
  return /^[a-z0-9_.-]+\.[a-z0-9_-]+$/.test(hostname) ? hostname : undefined;
}

function isPlain(rule: NetworkRule): boolean {
  return (
    rule.from === undefined &&
    rule.modifier === undefined &&
    rule.extra === undefined
  );
}

function push<K>(map: Map<K, NetworkRule[]>, key: K, rule: NetworkRule): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [rule]);
  else bucket.push(rule);
}

/** `^` in a pattern: anything but a letter, a digit or one of `_-.%`. */
function isSeparator(c: number): boolean {
  // NaN, past the end of the URL, is one too.
  return !(
    (c >= 0x61 && c <= 0x7a) ||
    (c >= 0x30 && c <= 0x39) ||
    c === 0x5f ||
    c === 0x2d ||
    c === 0x2e ||
    c === 0x25
  );
}

/**
 * Rules filed so that a request only tests a few of them: by the hostname
 * they start with, else by a token of their pattern, else by the site they
 * are limited to. Only what can't be filed is tested against every request.
 */
export class FilterIndex {
  /** How many rules the index holds. */
  size = 0;
  private pending: NetworkRule[] | undefined = [];
  /** `||hostname^` rules, packed, by hostname. */
  private readonly simpleHosts = new Map<string, number | number[]>();
  /** `||hostname/literal` rules, packed, by hostname. */
  private readonly simplePaths = new Map<string, PathBucket>();
  /** The other rules that start with a whole hostname. */
  private readonly hosts = new Map<string, NetworkRule[]>();
  private readonly tokens = new Map<string, NetworkRule[]>();
  private readonly sources = new Map<string, NetworkRule[]>();
  private readonly rest: NetworkRule[] = [];

  /**
   * Files a plain `||hostname^` rule from its hostname and `packBits`. The
   * parser gives hostnames of their own (`ownString`), not cut out of a line,
   * which a key would keep in memory.
   */
  addHost(hostname: string, packed: number): void {
    this.size++;
    const existing = this.simpleHosts.get(hostname);
    if (existing === undefined) this.simpleHosts.set(hostname, packed);
    else if (typeof existing === "number") {
      if (existing !== packed) {
        this.simpleHosts.set(hostname, [existing, packed]);
      }
    } else if (!existing.includes(packed)) existing.push(packed);
  }

  add(rule: NetworkRule): void {
    const packed = packBits(rule.flags, rule.types);
    if (rule.patternKind === P_HOST) {
      if (isPlain(rule)) {
        this.addHost(rule.pattern, packed);
        return;
      }
      this.size++;
      push(this.hosts, rule.pattern, rule);
      return;
    }
    this.size++;
    const hostname = leadingHostname(rule);
    if (hostname === undefined) {
      this.pending!.push(rule);
      return;
    }
    // A literal after the hostname, with at most a `^` to end it.
    const separator = rule.pattern.endsWith("^");
    const literal = separator ? rule.pattern.slice(0, -1) : rule.pattern;
    if (
      !isPlain(rule) ||
      /[*^]/.test(literal) ||
      (separator && rule.flags & F_RIGHT_ANCHOR)
    ) {
      push(this.hosts, hostname, rule);
      return;
    }
    let bucket = this.simplePaths.get(hostname);
    if (bucket === undefined) {
      bucket = { patterns: [], packed: [] };
      this.simplePaths.set(ownString(hostname), bucket);
    }
    // Packed, the rule is only its pattern: a copy of its own, not a cut of
    // the line, which would keep the whole line.
    bucket.patterns.push(ownString(literal));
    bucket.packed.push(separator ? packed | SEPARATOR_FOLLOWS : packed);
  }

  /** How the rules are filed, for `yarn bench`. */
  describe(): string {
    const longest = (buckets: Iterable<{ length: number }>) =>
      Math.max(0, ...[...buckets].map((bucket) => bucket.length));
    const paths = [...this.simplePaths.values()].map((bucket) => bucket.packed);
    return [
      `${this.simpleHosts.size} packed hosts`,
      `${this.simplePaths.size} hosts with packed paths (most ${longest(paths)})`,
      `${this.hosts.size} hosts (most ${longest(this.hosts.values())})`,
      `${this.tokens.size} tokens (most ${longest(this.tokens.values())})`,
      `${this.sources.size} sites`,
      `${this.rest.length} unfiled`,
    ].join(", ");
  }

  /** Files what `add()` couldn't file alone. Call it before matching. */
  finalize(): void {
    const steps = this.finalizing();
    while (steps.next().done !== true);
  }

  /** `finalize()` in steps, for a caller that has an event loop to feed. */
  *finalizing(): Generator<void> {
    const pending = this.pending ?? [];
    this.pending = undefined;
    // Sorted, a bucket is searched by bisection: one hostname can have
    // 50,000 patterns (a file host with that many bad files).
    for (const bucket of this.simplePaths.values()) {
      const order = bucket.patterns
        .map((_, index) => index)
        .sort((a, b) =>
          bucket.patterns[a]! < bucket.patterns[b]!
            ? -1
            : bucket.patterns[a]! > bucket.patterns[b]!
              ? 1
              : 0,
        );
      bucket.patterns = order.map((index) => bucket.patterns[index]!);
      bucket.packed = order.map((index) => bucket.packed[index]!);
      if (order.length > STEP) yield;
    }
    // A hostname with many other patterns would test them all for each of
    // its requests: those are filed by token.
    for (const [hostname, bucket] of this.hosts) {
      if (bucket.length <= MAX_HOST_BUCKET) continue;
      const kept = bucket.filter((rule) => rule.patternKind === P_HOST);
      for (const rule of bucket) {
        if (rule.patternKind !== P_HOST) pending.push(rule);
      }
      if (kept.length === 0) this.hosts.delete(hostname);
      else this.hosts.set(hostname, kept);
    }
    // Each rule goes under the token the fewest other rules could go under,
    // so no bucket grows long.
    const candidates: string[][] = [];
    const counts = new Map<string, number>();
    for (const rule of pending) {
      const tokens = ruleTokens(rule);
      candidates.push(tokens);
      for (const token of tokens) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
      if (candidates.length % STEP === 0) yield;
    }
    for (let index = 0; index < pending.length; index++) {
      if (index % STEP === 0) yield;
      const rule = pending[index]!;
      let best: string | undefined;
      let bestCount = Infinity;
      for (const token of candidates[index]!) {
        const count = counts.get(token)!;
        if (count < bestCount) {
          best = token;
          bestCount = count;
        }
      }
      if (best !== undefined) {
        push(this.tokens, best, rule);
        continue;
      }
      // No token: a rule limited to some sites is filed under each of them.
      const sites = rule.from?.include ?? [];
      if (
        sites.length > 0 &&
        sites.every((site) => site !== "*" && !site.startsWith("/"))
      ) {
        for (const site of sites) push(this.sources, site, rule);
      } else this.rest.push(rule);
    }
    compactBuckets(this.hosts);
    compactBuckets(this.tokens);
    compactBuckets(this.sources);
    for (const [hostname, packed] of this.simpleHosts) {
      if (typeof packed !== "number")
        this.simpleHosts.set(hostname, packed.slice());
    }
  }

  /**
   * Calls `visit` with each rule that matches the request, until it returns
   * true.
   */
  forEachMatch(
    request: Request,
    visit: (rule: NetworkRule) => boolean | void,
  ): void {
    const { hostname } = request;
    // The hostname and each of its parents: a.b.example, b.example, example.
    for (let start = 0; start !== -1;) {
      const suffix = start === 0 ? hostname : hostname.slice(start);
      const packed = this.simpleHosts.get(suffix);
      if (packed !== undefined) {
        if (typeof packed === "number") {
          if (simpleMatches(packed, request) && visit(unpack(suffix, packed))) {
            return;
          }
        } else {
          for (const one of packed) {
            if (simpleMatches(one, request) && visit(unpack(suffix, one))) {
              return;
            }
          }
        }
      }
      const paths = this.simplePaths.get(suffix);
      if (
        (paths !== undefined &&
          this.visitPaths(paths, request, suffix.length, visit)) ||
        this.visit(this.hosts.get(suffix), request, visit)
      ) {
        return;
      }
      const dot = hostname.indexOf(".", start);
      start = dot === -1 ? -1 : dot + 1;
    }
    if (this.tokens.size > 0) {
      for (const token of request.tokens) {
        if (this.visit(this.tokens.get(token), request, visit)) return;
      }
    }
    if (this.sources.size > 0) {
      const source = request.sourceHostname;
      const entity = request.sourceEntity;
      for (let start = 0; start !== -1;) {
        if (
          this.visit(this.sources.get(source.slice(start)), request, visit) ||
          (start < entity.length - 2 &&
            this.visit(this.sources.get(entity.slice(start)), request, visit))
        ) {
          return;
        }
        const dot = source.indexOf(".", start);
        start = dot === -1 ? -1 : dot + 1;
      }
    }
    this.visit(this.rest, request, visit);
  }

  private visit(
    bucket: NetworkRule[] | undefined,
    request: Request,
    visit: (rule: NetworkRule) => boolean | void,
  ): boolean {
    if (bucket === undefined) return false;
    for (const rule of bucket) {
      if (ruleMatches(rule, request) && visit(rule)) return true;
    }
    return false;
  }

  /**
   * Visits the packed paths the URL starts with, from where the hostname
   * they share starts. The patterns are sorted, so each one is found by
   * bisection, the longest first.
   */
  private visitPaths(
    { patterns, packed }: PathBucket,
    request: Request,
    hostLength: number,
    visit: (rule: NetworkRule) => boolean | void,
  ): boolean {
    const { lower } = request;
    const at = request.hostEnd - hostLength;
    // Shortened as patterns are ruled out; `lower` stays whole for what
    // follows a pattern.
    let text = lower.slice(at);
    let high = patterns.length;
    while (high > 0 && text.length > hostLength) {
      // The last pattern that sorts at or before the text.
      let low = 0;
      for (let end = high; low < end;) {
        const middle = (low + end) >>> 1;
        if (patterns[middle]! <= text) low = middle + 1;
        else end = middle;
      }
      if (low === 0) return false;
      const pattern = patterns[low - 1]!;
      if (!text.startsWith(pattern)) {
        // No pattern longer than what the two share can match.
        let shared = 0;
        while (pattern.charCodeAt(shared) === text.charCodeAt(shared)) shared++;
        text = text.slice(0, shared);
        high = low - 1;
        continue;
      }
      // The same pattern can be there twice, with other flags and types.
      for (high = low; high > 0 && patterns[high - 1] === pattern; high--) {
        const bits = packed[high - 1]!;
        const flags = (bits >>> TYPE_BITS) & FLAG_MASK;
        if (
          simpleMatches(bits, request) &&
          (!(bits & SEPARATOR_FOLLOWS) ||
            isSeparator(lower.charCodeAt(at + pattern.length))) &&
          (!(flags & F_RIGHT_ANCHOR) || at + pattern.length === lower.length) &&
          visit(unpack(pattern, bits, P_PATTERN))
        ) {
          return true;
        }
      }
    }
    return false;
  }
}

function simpleMatches(packed: number, request: Request): boolean {
  if ((packed & request.type) === 0) return false;
  const flags = packed >>> TYPE_BITS;
  return !(
    (flags & F_THIRD_PARTY && !request.thirdParty) ||
    (flags & F_FIRST_PARTY && request.thirdParty) ||
    (flags & F_STRICT_THIRD_PARTY && !request.strictThirdParty) ||
    (flags & F_STRICT_FIRST_PARTY && request.strictThirdParty)
  );
}

/** The rule a packed rule stands for, made when it matches. */
function unpack(
  pattern: string,
  packed: number,
  patternKind: typeof P_HOST | typeof P_PATTERN = P_HOST,
): NetworkRule {
  const flags = (packed >>> TYPE_BITS) & FLAG_MASK;
  const separator = patternKind === P_HOST || packed & SEPARATOR_FOLLOWS;
  return {
    kind: "network",
    // Without its options: they aren't kept apart from the bits.
    raw:
      (flags & F_EXCEPTION ? "@@||" : "||") +
      pattern +
      (separator ? "^" : flags & F_RIGHT_ANCHOR ? "|" : ""),
    patternKind,
    pattern: patternKind === P_PATTERN && separator ? `${pattern}^` : pattern,
    flags,
    types: packed & TYPE_MASK,
    from: undefined,
    modifier: undefined,
    extra: undefined,
  };
}

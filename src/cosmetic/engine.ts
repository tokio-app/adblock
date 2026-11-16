import { selectorKey } from "../parser/selector.js";
import {
  T_ELEMHIDE,
  T_GENERICHIDE,
  T_SPECIFICHIDE,
  type CosmeticRule,
  type HostList,
  type ProceduralPlan,
  type ResponseHeaderRule,
  type ScriptletRule,
} from "../parser/types.js";
import { PublicSuffixList } from "../psl/psl.js";
import { findResource } from "../resources/index.js";
import { findScriptlet, type ScriptletCall } from "../scriptlets/index.js";
import { compactBuckets, tryRegex } from "../util.js";

/** What a document gets when it starts loading. */
export interface DocumentCosmetics {
  /** A stylesheet: the selectors to hide, and the `:style()` rules. */
  css: string;
  /** The procedural filters, for the page-side engine to run. */
  procedural: ProceduralPlan[];
  /** The scriptlets to run in the page's own world, before its scripts. */
  scriptlets: ScriptletCall[];
  /**
   * Whether generic filters apply: the page then asks for the ones that
   * match the classes and ids it uses (`genericFor`).
   */
  generic: boolean;
}

export interface CosmeticStats {
  /** Cosmetic filters limited to hostnames, procedural ones included. */
  specific: number;
  /** Generic filters found by a class or id the page uses. */
  genericByName: number;
  /** Generic filters every page gets: no class or id to find them by. */
  genericAlways: number;
  procedural: number;
  scriptlets: number;
  /** Scriptlet names without an implementation, with their filter counts. */
  unknownScriptlets: Record<string, number>;
  /** Filters of untrusted lists that asked for a trusted scriptlet. */
  untrustedScriptlets: number;
}

interface Call extends ScriptletCall {
  /** Name and arguments: what an exception has to repeat to lift the call. */
  id: string;
}

/** A filter whose hostnames include a regular expression. */
interface RegexHosted<T> {
  regex: RegExp;
  value: T;
}

const CACHE_SIZE = 256;
/** Where a filter without hostnames applies. */
const EVERYWHERE: readonly string[] = ["*"];

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [value]);
  else bucket.push(value);
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, new Set([value]));
  else bucket.add(value);
}

/** The CSS of a filter that needs no JavaScript. */
function cssOf(rule: CosmeticRule, selector = rule.selector): string {
  const css = `${selector}{${rule.style ?? "display:none!important;"}}`;
  return rule.media === undefined ? css : `@media ${rule.media}{${css}}`;
}

/**
 * Files what applies to a hostname under it, and under `*` what applies
 * everywhere. A regular expression goes in `regexes`, to be tried on each
 * hostname.
 */
function file<T>(
  hosts: readonly string[],
  value: T,
  map: (key: string, value: T) => void,
  regexes: RegexHosted<T>[],
): void {
  for (const host of hosts) {
    if (!host.startsWith("/")) map(host, value);
    else {
      const regex = tryRegex(host.slice(1, -1));
      if (regex !== undefined) regexes.push({ regex, value });
    }
  }
}

/**
 * Decides what a document gets beyond its requests: the selectors to hide,
 * the procedural filters, the scriptlets and the response headers to drop.
 * Add every list's rules, then ask.
 */
export class CosmeticEngine {
  readonly stats: CosmeticStats = {
    specific: 0,
    genericByName: 0,
    genericAlways: 0,
    procedural: 0,
    scriptlets: 0,
    unknownScriptlets: {},
    untrustedScriptlets: 0,
  };
  private readonly psl: PublicSuffixList;
  /** Filters by the hostname, entity or `*` they are limited to. */
  private readonly specific = new Map<string, CosmeticRule[]>();
  private readonly specificRegex: RegexHosted<CosmeticRule>[] = [];
  /** The bodies of the filters an exception lifts, by hostname. */
  private readonly exceptions = new Map<string, Set<string>>();
  private readonly exceptionRegex: RegexHosted<string>[] = [];
  /** Generic filters by a class (`.name`) or id (`#name`) they need. */
  private readonly genericByName = new Map<string, CosmeticRule[]>();
  private readonly genericAlways: CosmeticRule[] = [];
  private readonly scriptlets = new Map<string, Call[]>();
  private readonly scriptletRegex: RegexHosted<Call>[] = [];
  /** Call ids an exception lifts, by hostname; the empty id lifts them all. */
  private readonly scriptletExceptions = new Map<string, Set<string>>();
  private readonly scriptletExceptionRegex: RegexHosted<string>[] = [];
  private readonly headers = new Map<string, Set<string>>();
  private readonly headerExceptions = new Map<string, Set<string>>();
  private readonly documents = new Map<string, DocumentCosmetics>();

  constructor(options: { psl?: PublicSuffixList } = {}) {
    this.psl = options.psl ?? new PublicSuffixList();
  }

  /** Adds a list's cosmetic, scriptlet and response header filters. */
  add(rules: {
    cosmetic: readonly CosmeticRule[];
    scriptlets: readonly ScriptletRule[];
    responseHeaders: readonly ResponseHeaderRule[];
  }): void {
    this.documents.clear();
    for (const rule of rules.cosmetic) this.addCosmetic(rule);
    for (const rule of rules.scriptlets) this.addScriptlet(rule);
    for (const rule of rules.responseHeaders) {
      const map = rule.exception ? this.headerExceptions : this.headers;
      for (const host of this.hostsOf(rule.hosts)) add(map, host, rule.header);
    }
  }

  /**
   * Trims the memory what was added holds, once every list is in: arrays
   * grown one filter at a time keep room for many more. Adding more after
   * still works.
   */
  compact(): void {
    compactBuckets(this.specific);
    compactBuckets(this.genericByName);
    compactBuckets(this.scriptlets);
  }

  /** Where a filter applies: its hostnames, or everywhere without any. */
  private hostsOf(hosts: HostList): readonly string[] {
    return hosts.include.length === 0 ? EVERYWHERE : hosts.include;
  }

  // Made once, not for each of the 40,000 filters a build adds.
  private readonly fileException = (host: string, key: string) =>
    add(this.exceptions, host, key);
  private readonly fileSpecific = (host: string, rule: CosmeticRule) =>
    push(this.specific, host, rule);
  private readonly fileScriptletException = (host: string, id: string) =>
    add(this.scriptletExceptions, host, id);
  private readonly fileScriptlet = (host: string, call: Call) =>
    push(this.scriptlets, host, call);

  private addCosmetic(rule: CosmeticRule): void {
    const except = this.fileException;
    // A negated hostname is an exception for that hostname.
    file(rule.hosts.exclude, rule.key, except, this.exceptionRegex);
    if (rule.exception) {
      file(this.hostsOf(rule.hosts), rule.key, except, this.exceptionRegex);
      return;
    }
    if (rule.procedural !== undefined) this.stats.procedural++;
    if (rule.hosts.include.length > 0) {
      this.stats.specific++;
      file(rule.hosts.include, rule, this.fileSpecific, this.specificRegex);
      return;
    }
    const key = selectorKey(rule.selector);
    if (key === undefined) {
      this.stats.genericAlways++;
      this.genericAlways.push(rule);
    } else {
      this.stats.genericByName++;
      push(this.genericByName, key, rule);
    }
  }

  private addScriptlet(rule: ScriptletRule): void {
    const scriptlet = findScriptlet(rule.name);
    const name = scriptlet?.name ?? rule.name;
    const id = rule.name === "" ? "" : [name, ...rule.args].join("\x00");
    const except = this.fileScriptletException;
    file(rule.hosts.exclude, id, except, this.scriptletExceptionRegex);
    if (rule.exception) {
      file(this.hostsOf(rule.hosts), id, except, this.scriptletExceptionRegex);
      return;
    }
    if (scriptlet === undefined) {
      const unknown = this.stats.unknownScriptlets;
      unknown[rule.name] = (unknown[rule.name] ?? 0) + 1;
      return;
    }
    if (scriptlet.trusted === true && !rule.trusted) {
      this.stats.untrustedScriptlets++;
      return;
    }
    this.stats.scriptlets++;
    // A `war:` argument names a redirect resource, which the page doesn't
    // have: its text goes with the call.
    let resources: Record<string, string> | undefined;
    for (const arg of rule.args) {
      if (!arg.startsWith("war:")) continue;
      const body = findResource(arg.slice(4))?.body;
      if (typeof body === "string") (resources ??= {})[arg.slice(4)] = body;
    }
    file(
      rule.hosts.include,
      { id, name, args: rule.args, ...(resources && { resources }) },
      this.fileScriptlet,
      this.scriptletRegex,
    );
  }

  /**
   * What filters can be filed under for a hostname: itself and its parents
   * (`a.b.example`, `b.example`, `example`), the same as entities
   * (`a.b.*`, `b.*`), and `*`.
   */
  private keys(hostname: string): string[] {
    const keys = ["*"];
    const entity = this.psl.entity(hostname);
    for (let start = 0; start !== -1;) {
      keys.push(start === 0 ? hostname : hostname.slice(start));
      if (start < entity.length - 2) keys.push(entity.slice(start));
      const dot = hostname.indexOf(".", start);
      start = dot === -1 ? -1 : dot + 1;
    }
    return keys;
  }

  /** Everything filed for a hostname in a map and its regular expressions. */
  private *lookUp<T>(
    hostname: string,
    map: Map<string, Iterable<T>>,
    regexes: readonly RegexHosted<T>[],
  ): Generator<T> {
    for (const key of this.keys(hostname)) {
      const bucket = map.get(key);
      if (bucket !== undefined) yield* bucket;
    }
    for (const { regex, value } of regexes) {
      if (regex.test(hostname)) yield value;
    }
  }

  /**
   * What a document on `hostname` gets as it starts loading. `switches` are
   * the bits of `NetworkEngine.cosmeticSwitches()` for the document:
   * `generichide`, `specifichide` and `elemhide` exceptions.
   */
  forDocument(hostname: string, switches = 0): DocumentCosmetics {
    const cacheKey = `${switches} ${hostname}`;
    const cached = this.documents.get(cacheKey);
    if (cached !== undefined) return cached;

    const css = new Set<string>();
    const procedural: ProceduralPlan[] = [];
    const generic = (switches & (T_ELEMHIDE | T_GENERICHIDE)) === 0;
    if (!(switches & T_ELEMHIDE)) {
      const lifted = new Set(
        this.lookUp(hostname, this.exceptions, this.exceptionRegex),
      );
      const apply = (rule: CosmeticRule) => {
        if (lifted.has(rule.key)) return;
        if (rule.procedural === undefined) css.add(cssOf(rule));
        else procedural.push(rule.procedural);
      };
      for (const rule of this.lookUp(
        hostname,
        this.specific,
        this.specificRegex,
      )) {
        // `*##selector` is a generic filter that every page gets.
        const everywhere = rule.hosts.include.includes("*");
        if (everywhere ? generic : !(switches & T_SPECIFICHIDE)) apply(rule);
      }
      if (generic) this.genericAlways.forEach(apply);
    }

    const liftedCalls = new Set(
      this.lookUp(
        hostname,
        this.scriptletExceptions,
        this.scriptletExceptionRegex,
      ),
    );
    const calls = new Map<string, ScriptletCall>();
    if (!liftedCalls.has("")) {
      for (const { id, ...call } of this.lookUp(
        hostname,
        this.scriptlets,
        this.scriptletRegex,
      )) {
        if (!liftedCalls.has(id)) calls.set(id, call);
      }
    }

    const result = {
      css: [...css].join("\n"),
      procedural,
      scriptlets: [...calls.values()],
      generic,
    };
    if (this.documents.size >= CACHE_SIZE) this.documents.clear();
    this.documents.set(cacheKey, result);
    return result;
  }

  /**
   * The stylesheet of the generic filters that need one of the classes or
   * ids a page uses. The page asks as it finds new ones, so each is asked
   * about once.
   */
  genericFor(
    hostname: string,
    classes: readonly string[],
    ids: readonly string[],
  ): string {
    const lifted = new Set(
      this.lookUp(hostname, this.exceptions, this.exceptionRegex),
    );
    const css: string[] = [];
    const collect = (prefix: string, names: readonly string[]) => {
      for (const name of names) {
        const key = prefix + name;
        for (const rule of this.genericByName.get(key) ?? []) {
          if (lifted.has(rule.key)) continue;
          // A bare class or id never hides the page itself.
          css.push(
            rule.selector === key
              ? cssOf(rule, `${key}:not(html):not(body)`)
              : cssOf(rule),
          );
        }
      }
    };
    collect(".", classes);
    collect("#", ids);
    return css.join("\n");
  }

  /**
   * The response headers `##^responseheader()` filters remove from a
   * document on `hostname`, lowercase.
   */
  headersToRemove(hostname: string): string[] {
    if (this.headers.size === 0) return [];
    const lifted = new Set(this.lookUp(hostname, this.headerExceptions, []));
    return [...new Set(this.lookUp(hostname, this.headers, []))].filter(
      (header) => !lifted.has(header),
    );
  }
}

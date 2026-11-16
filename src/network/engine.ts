import {
  F_BADFILTER,
  F_EXCEPTION,
  F_IMPORTANT,
  F_LEFT_ANCHOR,
  P_ALL,
  P_PATTERN,
  T_COSMETIC,
  T_DOCUMENT,
  T_INLINE_FONT,
  T_INLINE_SCRIPT,
  T_SUBDOCUMENT,
  type HostList,
  type ModifierType,
  type NetworkRule,
} from "../parser/types.js";
import { PublicSuffixList } from "../psl/psl.js";
import { findResource } from "../resources/index.js";
import { tryRegex } from "../util.js";
import {
  FilterIndex,
  isPlainHost,
  packBits,
  typesOf,
  unpackHost,
} from "./filterIndex.js";
import {
  INLINE_FONT_CSP,
  INLINE_SCRIPT_CSP,
  paramNames,
  removeParams,
  skipsBlocked,
  uriTransform,
  urlSkip,
} from "./modifiers.js";
import { ruleMatches } from "./pattern.js";
import { Request, type RequestInfo } from "./request.js";

export interface NetworkEngineOptions {
  psl?: PublicSuffixList;
  /**
   * Gives a redirect resource's own name from the name or alias a filter
   * uses, or undefined when there is no such resource: the filter is then
   * discarded, as uBlock Origin does. Defaults to the library's resources.
   */
  resource?: (token: string) => string | undefined;
}

/** What to do with a request. */
export interface Decision {
  /** Block the request (or, with `redirect`, answer it locally). */
  block: boolean;
  /** The filter that decided: the block, or the exception that lifted one. */
  filter: string | undefined;
  /** The redirect resource to answer a blocked request with. */
  redirect: string | undefined;
}

/** What to do with a response. */
export interface ResponseDecision {
  /** Block it: a `header=` filter matched its headers. */
  block: boolean;
  filter: string | undefined;
  /** Policies to add as `Content-Security-Policy` headers. */
  csp: string[];
  /** Policies to add as `Permissions-Policy` headers. */
  permissions: string[];
}

export interface NetworkStats {
  /** Rules in effect. */
  rules: number;
  /** Rules a `badfilter` removed. */
  badfiltered: number;
  /** `redirect=` names without a resource, with how many filters use each. */
  unknownResources: Record<string, number>;
}

const NO_DECISION: Decision = {
  block: false,
  filter: undefined,
  redirect: undefined,
};

/**
 * The modifier filters that matched a request, exceptions applied: an
 * exception with the same value lifts that value, one without a value lifts
 * every value of its kind, and `important` ignores both.
 */
class Modifiers {
  private readonly found: NetworkRule[] = [];
  private lifted: Set<string> | undefined;

  add(rule: NetworkRule): void {
    const { type, value } = rule.modifier!;
    if (!(rule.flags & F_EXCEPTION)) this.found.push(rule);
    else
      (this.lifted ??= new Set()).add(value === "" ? type : `${type}=${value}`);
  }

  of(type: ModifierType): NetworkRule[] {
    const { lifted } = this;
    return this.found.filter(
      (rule) =>
        rule.modifier!.type === type &&
        ((rule.flags & F_IMPORTANT) !== 0 ||
          lifted === undefined ||
          !(lifted.has(type) || lifted.has(`${type}=${rule.modifier!.value}`))),
    );
  }
}

function hostListKey(list: HostList | undefined): string {
  return list === undefined
    ? ""
    : `${[...list.include].sort().join("|")}~${[...list.exclude].sort().join("|")}`;
}

/** What makes two filters the same filter, whatever their options' order. */
function ruleKey(rule: NetworkRule, withFrom: boolean): string {
  const { modifier, extra } = rule;
  return [
    rule.patternKind,
    rule.pattern,
    rule.flags & ~F_BADFILTER,
    rule.types,
    withFrom ? hostListKey(rule.from) : "",
    modifier === undefined
      ? ""
      : `${modifier.type}=${modifier.value}:${modifier.priority}`,
    extra === undefined
      ? ""
      : [
          hostListKey(extra.to),
          hostListKey(extra.top),
          extra.denyallow?.join("|"),
          extra.methods,
          extra.notMethods,
          JSON.stringify(extra.header),
          extra.ipaddress,
        ].join("\x02"),
  ].join("\x01");
}

/**
 * A filter for every URL (`*`, `|http://`, `|https://`) limited to some sites
 * counts as one filter per site, so a `badfilter` can remove a single site.
 */
function perSite(rule: NetworkRule): boolean {
  const everyUrl =
    rule.patternKind === P_ALL ||
    (rule.patternKind === P_PATTERN &&
      (rule.flags & F_LEFT_ANCHOR) !== 0 &&
      (rule.pattern === "http://" || rule.pattern === "https://"));
  const type = rule.modifier?.type;
  return (
    everyUrl &&
    rule.from !== undefined &&
    rule.from.include.length > 0 &&
    rule.from.exclude.length === 0 &&
    type !== "csp" &&
    type !== "redirect" &&
    type !== "redirect-rule"
  );
}

/**
 * Decides what happens to requests: uBlock Origin's static network filtering.
 * Add every list's rules, call `finalize()`, then ask.
 */
export class NetworkEngine {
  readonly psl: PublicSuffixList;
  readonly stats: NetworkStats = {
    rules: 0,
    badfiltered: 0,
    unknownResources: {},
  };
  private readonly resource: (token: string) => string | undefined;
  private pending: NetworkRule[] = [];
  // `||hostname^` rules with nothing but flags and types, most of a list's
  // network rules, wait as their hostname and one number: a rule object each
  // would hold three times the memory until `finalize()`.
  private pendingHosts: string[] = [];
  private pendingHostBits: number[] = [];
  /** Block and exception filters, the block half of `redirect=` included. */
  private readonly blocks = new FilterIndex();
  /** Redirect directives: `redirect-rule=` and the other half of `redirect=`. */
  private readonly redirects = new FilterIndex();
  /** `removeparam=` filters for every URL, by the parameter they remove. */
  private readonly params = new Map<string, NetworkRule[]>();
  /** The other `removeparam=` filters, and `urlskip=` and `uritransform=`. */
  private readonly rewrites = new FilterIndex();
  /** `header=`, `csp=` and `permissions=`: decided when the response comes. */
  private readonly responses = new FilterIndex();
  /** Exceptions that switch cosmetic filtering off for a document. */
  private readonly switches = new FilterIndex();

  constructor(options: NetworkEngineOptions = {}) {
    this.psl = options.psl ?? new PublicSuffixList();
    this.resource = options.resource ?? ((token) => findResource(token)?.name);
  }

  /** Adds a list's network rules. They take effect at `finalize()`. */
  add(rules: readonly NetworkRule[]): void {
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index]!;
      if (isPlainHost(rule) && !(rule.flags & F_BADFILTER)) {
        this.pendingHosts.push(rule.pattern);
        this.pendingHostBits.push(packBits(rule.flags, rule.types));
      } else this.pending.push(rule);
    }
  }

  /** Applies the `badfilter`s and files every rule. */
  finalize(): void {
    const steps = this.finalizing();
    while (steps.next().done !== true);
  }

  /** How each kind of rule is filed, for `yarn bench`. */
  describe(): Record<string, string> {
    return {
      blocks: this.blocks.describe(),
      redirects: this.redirects.describe(),
      rewrites: `${this.params.size} parameters, ${this.rewrites.describe()}`,
      responses: this.responses.describe(),
      switches: this.switches.describe(),
    };
  }

  /**
   * `finalize()` in steps: a host with an event loop gives it a turn between
   * them, so filing 230,000 rules doesn't freeze its main process.
   */
  *finalizing(): Generator<void> {
    const bad = new Set<string>();
    const badSites = new Map<string, Set<string>>();
    // A badfilter only removes a rule with its pattern: the others are filed
    // without making their key.
    const badPatterns = new Set<string>();
    const { pending } = this;
    for (let index = 0; index < pending.length; index++) {
      const rule = pending[index]!;
      if (!(rule.flags & F_BADFILTER)) continue;
      badPatterns.add(rule.pattern);
      if (perSite(rule)) {
        const key = ruleKey(rule, false);
        const sites = badSites.get(key) ?? new Set();
        for (const site of rule.from!.include) sites.add(site);
        badSites.set(key, sites);
      } else bad.add(ruleKey(rule, true));
    }
    const hosts = this.pendingHosts;
    const hostBits = this.pendingHostBits;
    this.pendingHosts = [];
    this.pendingHostBits = [];
    for (let index = 0; index < hosts.length; index++) {
      if ((index + 1) % 5000 === 0) yield;
      const pattern = hosts[index]!;
      const bits = hostBits[index]!;
      if (
        badPatterns.has(pattern) &&
        bad.has(ruleKey(unpackHost(pattern, bits), true))
      ) {
        this.stats.badfiltered++;
        continue;
      }
      this.fileHost(pattern, bits);
    }
    for (let index = 0; index < pending.length; index++) {
      if ((index + 1) % 5000 === 0) yield;
      let rule = pending[index]!;
      if (rule.flags & F_BADFILTER) continue;
      if (badPatterns.has(rule.pattern)) {
        if (bad.size > 0 && bad.has(ruleKey(rule, true))) {
          this.stats.badfiltered++;
          continue;
        }
        if (badSites.size > 0 && perSite(rule)) {
          const sites = badSites.get(ruleKey(rule, false));
          if (sites !== undefined) {
            const include = rule.from!.include.filter(
              (site) => !sites.has(site),
            );
            if (include.length === 0) {
              this.stats.badfiltered++;
              continue;
            }
            rule = { ...rule, from: { include, exclude: [] } };
          }
        }
      }
      this.file(rule);
    }
    this.pending = [];
    for (const index of [
      this.blocks,
      this.redirects,
      this.rewrites,
      this.responses,
      this.switches,
    ]) {
      yield* index.finalizing();
    }
  }

  /** What `file()` does with a plain `||hostname^` rule, without the rule. */
  private fileHost(hostname: string, bits: number): void {
    this.stats.rules++;
    const types = typesOf(bits);
    if (types & T_COSMETIC) {
      this.switches.addHost(hostname, bits);
      if ((types & ~T_COSMETIC) === 0) return;
    }
    this.blocks.addHost(hostname, bits);
  }

  private file(rule: NetworkRule): void {
    this.stats.rules++;
    if (rule.types & T_COSMETIC) {
      this.switches.add(rule);
      if ((rule.types & ~T_COSMETIC) === 0) return;
    }
    if (rule.extra?.header !== undefined) {
      this.responses.add(rule);
      return;
    }
    const { modifier } = rule;
    switch (modifier?.type) {
      case undefined:
        this.blocks.add(rule);
        return;
      case "csp":
      case "permissions":
        this.responses.add(rule);
        return;
      case "removeparam":
        // One for every URL is found by the parameter's name, not by the URL.
        if (
          rule.patternKind === P_ALL &&
          /^[^~/]/.test(modifier.value) &&
          !(rule.flags & F_EXCEPTION)
        ) {
          const bucket = this.params.get(modifier.value);
          if (bucket === undefined) this.params.set(modifier.value, [rule]);
          else bucket.push(rule);
        } else this.rewrites.add(rule);
        return;
      case "urlskip":
      case "uritransform":
        this.rewrites.add(rule);
        return;
      case "redirect":
      case "redirect-rule": {
        if (modifier.value === "none") {
          // The old way to write an exception to every redirect.
          this.redirects.add({
            ...rule,
            flags: rule.flags | F_EXCEPTION,
            modifier: { type: "redirect-rule", value: "", priority: 0 },
          });
          return;
        }
        let name = "";
        if (modifier.value !== "") {
          const resource = this.resource(modifier.value);
          if (resource === undefined) {
            const unknown = this.stats.unknownResources;
            unknown[modifier.value] = (unknown[modifier.value] ?? 0) + 1;
            this.stats.rules--;
            return;
          }
          name = resource;
        }
        // `redirect=` is a block filter and a redirect directive.
        this.redirects.add({
          ...rule,
          modifier: { ...modifier, type: "redirect-rule", value: name },
        });
        if (modifier.type === "redirect") this.blocks.add(rule);
      }
    }
  }

  /** Works out what filters ask about a request, once. */
  request(info: RequestInfo): Request {
    return new Request(info, this.psl);
  }

  /**
   * Whether to block a request: an `important` block wins, then an
   * exception, then a block.
   */
  match(request: Request): Decision {
    const decision = this.decide(request);
    if (!decision.block) return decision;
    return { ...decision, redirect: this.redirectFor(request) };
  }

  private decide(request: Request): Decision {
    // An object: TypeScript doesn't follow a callback's assignments to locals.
    const found: {
      block?: NetworkRule;
      exception?: NetworkRule;
      important?: NetworkRule;
    } = {};
    this.blocks.forEachMatch(request, (rule) => {
      if (rule.flags & F_EXCEPTION) found.exception ??= rule;
      else if (rule.flags & F_IMPORTANT) {
        found.important = rule;
        return true;
      } else found.block ??= rule;
      return false;
    });
    const decided = found.important ?? found.exception ?? found.block;
    if (decided === undefined) return NO_DECISION;
    return {
      block: (decided.flags & F_EXCEPTION) === 0,
      filter: decided.raw,
      redirect: undefined,
    };
  }

  private modifiers(index: FilterIndex, request: Request): Modifiers {
    const modifiers = new Modifiers();
    index.forEachMatch(request, (rule) => {
      if (rule.modifier !== undefined) modifiers.add(rule);
    });
    return modifiers;
  }

  /** The directive with the highest priority, `important` ones first. */
  private redirectFor(request: Request): string | undefined {
    let best: NetworkRule | undefined;
    const rank = (rule: NetworkRule) =>
      (rule.flags & F_IMPORTANT ? 1e9 : 0) + rule.modifier!.priority;
    for (const rule of this.modifiers(this.redirects, request).of(
      "redirect-rule",
    )) {
      if (best === undefined || rank(rule) > rank(best)) best = rule;
    }
    return best?.modifier!.value;
  }

  /**
   * The URL to send a request to instead: its own without the parameters
   * `removeparam=` names, or the one `urlskip=` or `uritransform=` gives.
   * Undefined when the URL stays. A blocked request is only rewritten by a
   * `urlskip=` that says `-blocked`.
   */
  rewrite(request: Request, blocked = false): string | undefined {
    let url = request.url;
    const modifiers = this.modifiers(this.rewrites, request);
    for (const rule of modifiers.of("urlskip")) {
      const { value } = rule.modifier!;
      if (blocked && !skipsBlocked(value)) continue;
      const skipped = urlSkip(url, value);
      if (skipped !== undefined) return skipped;
    }
    if (blocked) return undefined;
    for (const rule of modifiers.of("uritransform")) {
      url = uriTransform(url, rule.modifier!.value) ?? url;
    }
    if (url.includes("?")) {
      if (this.params.size > 0) {
        for (const name of paramNames(url)) {
          for (const rule of this.params.get(name) ?? []) {
            if (ruleMatches(rule, request)) modifiers.add(rule);
          }
        }
      }
      url = removeParams(
        url,
        modifiers.of("removeparam").map((rule) => rule.modifier!.value),
      );
    }
    return url === request.url ? undefined : url;
  }

  /**
   * What a response changes: a `header=` filter can block it, and a document
   * gets the policies of `csp=`, `permissions=`, `inline-script` and
   * `inline-font`. `header` gives a response header's value by its lowercase
   * name.
   */
  response(
    request: Request,
    header: (name: string) => string | undefined,
  ): ResponseDecision {
    const decision: ResponseDecision = {
      block: false,
      filter: undefined,
      csp: [],
      permissions: [],
    };
    const found: { block?: NetworkRule; exception: boolean } = {
      exception: false,
    };
    const modifiers = new Modifiers();
    this.responses.forEachMatch(request, (rule) => {
      const wanted = rule.extra?.header;
      if (wanted === undefined) {
        modifiers.add(rule);
        return;
      }
      if (wanted.name !== "") {
        const value = header(wanted.name);
        if (value === undefined) return;
        if (wanted.value !== undefined) {
          const matches = wanted.regex
            ? tryRegex(wanted.value, wanted.regexFlags)?.test(value) === true
            : value === wanted.value;
          if (matches === wanted.negated) return;
        }
      }
      if (rule.flags & F_EXCEPTION) found.exception = true;
      else if (rule.flags & F_IMPORTANT || found.block === undefined) {
        found.block = rule;
      }
    });
    const { block } = found;
    if (block !== undefined) {
      // A plain exception for the request lifts a header= block too.
      const plain = this.decide(request);
      if (
        block.flags & F_IMPORTANT ||
        !(found.exception || (!plain.block && plain.filter !== undefined))
      ) {
        decision.block = true;
        decision.filter = block.raw;
        return decision;
      }
    }
    if (request.type & (T_DOCUMENT | T_SUBDOCUMENT)) {
      const values = (type: ModifierType) =>
        modifiers.of(type).map((rule) => rule.modifier!.value);
      decision.csp = values("csp");
      decision.permissions = values("permissions");
      const type = request.type;
      request.type = T_INLINE_SCRIPT;
      if (this.decide(request).block) decision.csp.push(INLINE_SCRIPT_CSP);
      request.type = T_INLINE_FONT;
      if (this.decide(request).block) decision.csp.push(INLINE_FONT_CSP);
      request.type = type;
    }
    return decision;
  }

  /**
   * Which cosmetic filtering exceptions switch off for a document, as
   * `T_GENERICHIDE`, `T_SPECIFICHIDE` and `T_ELEMHIDE` bits. `request` is the
   * document's own, of type `document`.
   */
  cosmeticSwitches(request: Request): number {
    let bits = 0;
    const type = request.type;
    request.type = T_COSMETIC;
    this.switches.forEachMatch(request, (rule) => {
      bits |= rule.types & T_COSMETIC;
    });
    request.type = type;
    return bits;
  }
}

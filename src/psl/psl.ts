import { domainToASCII } from "node:url";

const IP = /^(?:\d{1,3}\.){3}\d{1,3}$|^\[/;
// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7f]/;
// Without the list: second-level names that country domains commonly sell
// under (`example.co.uk`). A guess, used until the real list is downloaded.
const COMMON_SECOND_LEVEL = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "mil",
  "ne",
  "net",
  "nom",
  "or",
  "org",
]);
const CACHE_SIZE = 8192;

/**
 * Tells where a hostname's registrable domain starts, from Mozilla's Public
 * Suffix List (<https://publicsuffix.org>): the request `a.example.co.uk` is
 * first-party to `b.example.co.uk`, and `example.*` means `example.co.uk`.
 * The list is data the host's machine downloads; without it the class guesses.
 */
export class PublicSuffixList {
  private readonly exact = new Set<string>();
  private readonly wildcard = new Set<string>();
  private readonly exception = new Set<string>();
  private readonly domains = new Map<string, string>();

  /** `text` is the content of `public_suffix_list.dat`, when there is one. */
  constructor(text = "") {
    for (let line of text.split(/\r?\n/)) {
      // A rule ends at the first whitespace; `//` starts a comment.
      line = line.trim().split(/\s/)[0]!.toLowerCase();
      if (line === "" || line.startsWith("//")) continue;
      const set = line.startsWith("!")
        ? this.exception
        : line.startsWith("*.")
          ? this.wildcard
          : this.exact;
      if (set !== this.exact) line = line.slice(line.startsWith("!") ? 1 : 2);
      // Request hostnames are punycode.
      set.add(NON_ASCII.test(line) ? domainToASCII(line) : line);
    }
  }

  /** Whether the real list was given, or the class is guessing. */
  get loaded(): boolean {
    return this.exact.size > 0;
  }

  /**
   * The public suffix of a hostname (`co.uk` for `www.example.co.uk`). Empty
   * for an IP address.
   */
  publicSuffix(hostname: string): string {
    if (IP.test(hostname)) return "";
    if (!this.loaded) {
      const labels = hostname.split(".");
      const last = labels.at(-1)!;
      return labels.length > 2 &&
        last.length === 2 &&
        COMMON_SECOND_LEVEL.has(labels.at(-2)!)
        ? `${labels.at(-2)}.${last}`
        : last;
    }
    // From the whole hostname down: the first rule to match is the longest.
    let start = 0;
    for (;;) {
      const suffix = start === 0 ? hostname : hostname.slice(start);
      const dot = hostname.indexOf(".", start);
      if (this.exception.has(suffix)) {
        return dot === -1 ? "" : hostname.slice(dot + 1);
      }
      if (this.exact.has(suffix)) return suffix;
      if (dot === -1) return suffix;
      if (this.wildcard.has(hostname.slice(dot + 1))) return suffix;
      start = dot + 1;
    }
  }

  /**
   * The registrable domain (`example.co.uk`), or the hostname itself when it
   * has none: an IP address, a public suffix, `localhost`.
   */
  domain(hostname: string): string {
    let domain = this.domains.get(hostname);
    if (domain !== undefined) return domain;
    const suffix = this.publicSuffix(hostname);
    if (suffix === "" || suffix.length >= hostname.length) {
      domain = hostname;
    } else {
      const before = hostname.length - suffix.length - 1;
      domain = hostname.slice(hostname.lastIndexOf(".", before - 1) + 1);
    }
    if (this.domains.size >= CACHE_SIZE) this.domains.clear();
    this.domains.set(hostname, domain);
    return domain;
  }

  /**
   * The hostname with its public suffix replaced by `*` (`www.example.*`),
   * which `example.*` in a filter is compared with. Empty when the hostname
   * has no name before its suffix.
   */
  entity(hostname: string): string {
    const suffix = this.publicSuffix(hostname);
    if (suffix === "" || suffix.length >= hostname.length) return "";
    return `${hostname.slice(0, hostname.length - suffix.length)}*`;
  }
}

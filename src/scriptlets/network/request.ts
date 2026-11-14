import { matcher, resourceText } from "../helpers.js";
import { randomText } from "./util.js";

const random = Math.random;

/** What a fetch or an XMLHttpRequest asks for, by `init` option name. */
export type Details = Record<string, unknown>;

// The names a `name:value` condition can use. Anything else with a colon,
// like `https://…`, is a URL to match.
const NAMES = new Set([
  "url",
  "method",
  "headers",
  "body",
  "mode",
  "credentials",
  "cache",
  "redirect",
  "referrer",
  "referrerPolicy",
  "integrity",
  "keepalive",
  "signal",
  "priority",
  "duplex",
]);

function asText(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  if (typeof Headers === "function" && value instanceof Headers) {
    const entries: Record<string, string> = {};
    value.forEach((one, name) => (entries[name] = one));
    return JSON.stringify(entries);
  }
  try {
    return JSON.stringify(value);
  } catch {
    // A cycle: nothing a condition can match.
    return "";
  }
}

/**
 * A space-separated list of conditions a request must all meet: text or
 * `/regex/` to find in its URL (`!` inverts, when `negatable`), or
 * `name:value` for one of its options. Nothing, or `*`, matches any request.
 */
export function requestMatcher(
  props = "",
  negatable = false,
): (details: Details) => boolean {
  const tests: ((details: Details) => boolean)[] = [];
  for (const condition of props.split(/\s+/)) {
    if (condition === "" || condition === "*") continue;
    const pair = /^(\w+):(.*)$/s.exec(condition);
    if (pair !== null && NAMES.has(pair[1]!)) {
      const name = pair[1]!;
      const matches = matcher(pair[2]);
      tests.push(
        (details) =>
          details[name] !== undefined && matches(asText(details[name])),
      );
    } else {
      const matches = matcher(condition, negatable);
      tests.push((details) => matches(String(details.url)));
    }
  }
  return (details) => tests.every((test) => test(details));
}

/** The URL as the request resolves it. */
export function absolute(url: unknown): string {
  try {
    return new URL(String(url), document.baseURI).href;
  } catch {
    return String(url);
  }
}

const OPTIONS = [...NAMES].filter((name) => name !== "url");

/** What a call of `fetch(input, init)` asks for. */
export function fetchDetails(args: readonly unknown[]): Details {
  const [input, init] = args;
  const details: Details = { method: "GET" };
  const request =
    typeof Request === "function" && input instanceof Request
      ? input
      : undefined;
  for (const source of [request, init]) {
    if (typeof source !== "object" || source === null) continue;
    for (const name of OPTIONS) {
      const value = (source as Record<string, unknown>)[name];
      if (value !== undefined) details[name] = value;
    }
  }
  details.url = absolute(request === undefined ? input : request.url);
  return details;
}

/**
 * The body a defused request answers with, from a directive. Trusted
 * filters can give any text; for the others an unknown directive is empty.
 * Call it while the scriptlet is set up: a `war:` resource is only there
 * then. The function it returns gives the body of each answer.
 */
export function responseBody(
  directive: string,
  trusted: boolean,
): () => string {
  if (directive.startsWith("war:")) {
    const text = resourceText(directive.slice(4));
    return () => text;
  }
  return () => bodyOf(directive, trusted);
}

function bodyOf(directive: string, trusted: boolean): string {
  switch (directive) {
    case "":
    case "emptyStr":
      return "";
    case "true":
      return randomText(10);
    case "emptyObj":
      return "{}";
    case "emptyArr":
      return "[]";
  }
  const length = /^length:(\d+)(?:-(\d+))?$/.exec(directive);
  if (length !== null) {
    const min = Number(length[1]);
    const max = Math.max(min, Number(length[2] ?? min));
    const size = min + Math.floor(random() * (max - min + 1));
    return randomText(Math.min(size, 500000));
  }
  return trusted ? directive : "";
}

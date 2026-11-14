// What scriptlets share. This file runs in pages: it is bundled with the
// scriptlets, so it can't import from outside this folder.
//
// The page's scripts run after ours and may replace built-ins, so what the
// traps call later is taken here, while it is still the browser's own.

const { defineProperty, getOwnPropertyDescriptor } = Object;
const { apply } = Reflect;
const test = RegExp.prototype.test;
const includes = String.prototype.includes;

type Matcher = (text: string) => boolean;

/** The regular expression of `/source/flags`, or undefined for anything else. */
export function parseRegex(text: string): RegExp | undefined {
  const match = /^\/(.+)\/([dgimsuvy]*)$/s.exec(text);
  if (match === null) return undefined;
  try {
    return new RegExp(match[1]!, match[2]);
  } catch {
    return undefined;
  }
}

/**
 * How scriptlets read a "string or regular expression" argument: `/…/` is a
 * regular expression, anything else is text to find, and nothing matches
 * everything. With `negatable`, a leading `!` inverts the result.
 */
export function matcher(pattern = "", negatable = false): Matcher {
  const negated = negatable && pattern.startsWith("!");
  if (negated) pattern = pattern.slice(1);
  const regex = parseRegex(pattern);
  const matches: Matcher =
    pattern === ""
      ? () => true
      : regex === undefined
        ? (text) => apply(includes, text, [pattern])
        : (text) => {
            regex.lastIndex = 0;
            return apply(test, regex, [text]);
          };
  return negated ? (text) => !matches(text) : matches;
}

/**
 * The name and value pairs that follow a scriptlet's positional arguments
 * (`…, runAt, idle, elements, a.promo`).
 */
export function tokens(
  args: readonly string[],
  from: number,
): Record<string, string | undefined> {
  const found: Record<string, string | undefined> = {};
  for (let i = from; i < args.length; i += 2)
    found[args[i]!] = args[i + 1] ?? "";
  return found;
}

const STATES: Record<string, number | undefined> = {
  loading: 1,
  asap: 1,
  "1": 1,
  interactive: 2,
  end: 2,
  "2": 2,
  complete: 3,
  idle: 3,
  "3": 3,
};

/**
 * Runs `task` once the document is at least in the state a `runAt` token
 * names: now (the default), `interactive` or `end`, `complete` or `idle`.
 */
export function runAt(when: string | undefined, task: () => void): void {
  const wanted = STATES[when ?? ""] ?? 1;
  const reached = () => (STATES[document.readyState] ?? 1) >= wanted;
  if (reached()) {
    task();
    return;
  }
  const listener = () => {
    if (!reached()) return;
    document.removeEventListener("readystatechange", listener, true);
    task();
  };
  document.addEventListener("readystatechange", listener, true);
}

/** What an aborted script gets: an error no handler of the page expects. */
export function abort(): never {
  throw new ReferenceError(
    `${Math.random().toString(36).slice(2, 10)} is not defined`,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

/**
 * Calls `install(owner, property)` for the last property of a chain like
 * `a.b.c`, on the object that holds it: now when `a.b` exists, and again
 * each time the page assigns `a` or `a.b`, since most chains don't exist
 * yet when a scriptlet runs.
 */
export function onChain(
  root: object,
  chain: string,
  install: (owner: Record<string, unknown>, property: string) => void,
): void {
  const owner = root as Record<string, unknown>;
  const dot = chain.indexOf(".");
  if (dot === -1) {
    install(owner, chain);
    return;
  }
  const property = chain.slice(0, dot);
  const rest = chain.slice(dot + 1);
  let value = owner[property];
  if (isObject(value)) onChain(value, rest, install);
  const descriptor = getOwnPropertyDescriptor(owner, property);
  // An accessor is the page's or the browser's business: leave it alone.
  if (descriptor !== undefined && !("value" in descriptor)) return;
  if (descriptor?.configurable === false) return;
  defineProperty(owner, property, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => value,
    set(next: unknown) {
      value = next;
      if (isObject(next)) onChain(next, rest, install);
    },
  });
}

/**
 * Replaces a property with an accessor, when the page lets it. `get` and
 * `set` receive the value the property would have without the trap.
 */
export function trap(
  owner: Record<string, unknown>,
  property: string,
  handlers: {
    get?: (value: unknown) => unknown;
    set?: (next: unknown, value: unknown) => unknown;
  },
): boolean {
  const descriptor = getOwnPropertyDescriptor(owner, property);
  if (descriptor?.configurable === false) return false;
  let value = descriptor === undefined ? owner[property] : descriptor.value;
  if (descriptor?.get !== undefined) value = apply(descriptor.get, owner, []);
  defineProperty(owner, property, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => (handlers.get === undefined ? value : handlers.get(value)),
    set(next: unknown) {
      value = handlers.set === undefined ? next : handlers.set(next, value);
    },
  });
  return true;
}

/**
 * Puts a function in front of a method, as a Proxy so that the method still
 * reads as the browser's own (`toString()`, `name`, `length`). `wrapper`
 * gets the original, `this` and the arguments, and returns the result.
 * Returns false when there is no such method.
 */
export function wrapMethod(
  owner: object,
  property: string,
  wrapper: (
    original: (...args: any[]) => any,
    self: unknown,
    args: any[],
  ) => unknown,
): boolean {
  const original = (owner as Record<string, unknown>)[property];
  if (typeof original !== "function") return false;
  (owner as Record<string, unknown>)[property] = new Proxy(original, {
    apply: (target, self, args) =>
      wrapper(
        (...inner) => apply(target as (...a: any[]) => any, self, inner),
        self,
        args,
      ),
  });
  return true;
}

/** The object a chain like `a.b` names, from `window`, or undefined. */
export function lookUp(chain: string):
  | {
      owner: Record<string, unknown>;
      property: string;
    }
  | undefined {
  const names = chain.split(".");
  const property = names.pop()!;
  let owner: unknown = window;
  for (const name of names) {
    if (!isObject(owner)) return undefined;
    owner = owner[name];
  }
  return isObject(owner) ? { owner, property } : undefined;
}

/**
 * The text of the call stack, one frame after the other separated by tabs,
 * for scriptlets that only act when called from some code. A frame of the
 * page's own inline scripts reads `inlineScript`.
 */
export function stackTrace(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(1);
  const here = location.href.split("#")[0]!;
  const frames = lines
    .map((line) => line.trim().replace(/^at\s+/, ""))
    .filter((frame) => frame !== "")
    .map((frame) =>
      frame
        .split(here)
        .join("inlineScript")
        .replace(/:(\d+):\d+\)?$/, ":$1:1"),
    );
  return `stackDepth:${frames.length}\t${frames.join("\t")}`;
}

/** Whether the call stack matches a `stack` argument (`!` inverts). */
export function stackMatches(pattern: string | undefined): boolean {
  return pattern === undefined || pattern === ""
    ? true
    : matcher(pattern, true)(stackTrace());
}

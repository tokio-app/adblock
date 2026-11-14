import { lookUp, matcher, parseRegex, tokens } from "../helpers.js";
import { safeConstant } from "../setConstant.js";
import type { Scriptlet } from "../types.js";
import { editFetchResponses } from "./fetch.js";
import { requestMatcher } from "./request.js";
import { onMethod, position } from "./util.js";
import { editXhrResponses } from "./xhr.js";

const { apply, construct } = Reflect;
const { parse } = JSON;

/**
 * Replaces `pattern` in a text: `*` is the whole text, `/…/` a regex (its
 * flags say how often), anything else every occurrence of that text.
 */
function replacer(
  pattern: string,
  replacement: string,
): (text: string) => string {
  if (pattern === "*") return () => replacement;
  const regex = parseRegex(pattern);
  if (regex === undefined) {
    return (text) => text.split(pattern).join(replacement);
  }
  return (text) => {
    regex.lastIndex = 0;
    return text.replace(regex, replacement);
  };
}

function replaceResponses(
  args: string[],
  install: typeof editFetchResponses,
): void {
  const [pattern = "", replacement = "", props = ""] = args;
  if (pattern === "") return;
  const includes = matcher(tokens(args, 3).includes);
  const replace = replacer(pattern, replacement);
  install(requestMatcher(props), (text) => {
    if (!includes(text)) return undefined;
    const next = replace(text);
    return next === text ? undefined : next;
  });
}

export const trustedReplaceFetchResponse: Scriptlet = {
  name: "trusted-replace-fetch-response",
  aliases: ["trusted-rpfr"],
  trusted: true,
  run: (...args) => replaceResponses(args, editFetchResponses),
};

export const trustedReplaceXhrResponse: Scriptlet = {
  name: "trusted-replace-xhr-response",
  trusted: true,
  run: (...args) => replaceResponses(args, editXhrResponses),
};

export const trustedReplaceOutboundText: Scriptlet = {
  name: "trusted-replace-outbound-text",
  aliases: ["trusted-rpot"],
  trusted: true,
  run(...args) {
    const [chain = "", pattern = "", raw = ""] = args;
    // Without a pattern the scriptlet only logs, and there is no logger.
    if (pattern === "") return;
    let replacement = raw;
    if (raw.startsWith("json:")) {
      try {
        replacement = String(parse(raw.slice(5)));
      } catch {
        return;
      }
    } else if (raw.length > 1 && raw.startsWith("/") && raw.endsWith("/")) {
      // The wiki writes regex replacements between slashes: `/$1$2/`.
      replacement = raw.slice(1, -1);
    }
    const options = tokens(args, 3);
    const condition = matcher(options.condition);
    const base64 = options.encoding === "base64";
    const decode = atob;
    const encode = btoa;
    const replace = replacer(pattern, replacement);
    onMethod(chain, (original, _self, callArgs) => {
      const result: unknown = original(...callArgs);
      if (typeof result !== "string") return result;
      try {
        const text = base64 ? decode(result) : result;
        if (!condition(text)) return result;
        const next = replace(text);
        if (next === text) return result;
        return base64 ? encode(next) : next;
      } catch {
        // Not base64 after all, or not text btoa can encode.
        return result;
      }
    });
  },
};

/** What `repl:/pattern/replacement/flags` does to a value. */
function regexReplacement(
  text: string,
): ((value: unknown) => unknown) | undefined {
  const match =
    /^repl:\/((?:\\.|[^\\/])+)\/((?:\\.|[^\\/])*)\/([dgimsuvy]*)$/s.exec(text);
  if (match === null) return undefined;
  let regex: RegExp;
  try {
    regex = new RegExp(match[1]!, match[3]);
  } catch {
    return undefined;
  }
  const replacement = match[2]!.replace(/\\\//g, "/");
  return (value) => {
    regex.lastIndex = 0;
    return String(value).replace(regex, replacement);
  };
}

/** The new value of a replaced argument, from the filter's text. */
function argumentReplacement(
  raw: string,
): ((value: unknown) => unknown) | undefined {
  if (raw.startsWith("repl:")) return regexReplacement(raw);
  if (raw.startsWith("json:")) {
    try {
      parse(raw.slice(5));
    } catch {
      return undefined;
    }
    return () => parse(raw.slice(5));
  }
  const value = safeConstant(raw);
  return typeof value === "symbol" ? undefined : () => value;
}

export const trustedReplaceArgument: Scriptlet = {
  name: "trusted-replace-argument",
  trusted: true,
  run(...args) {
    const [chain = "", at = "", raw = ""] = args;
    // Without a position the scriptlet only logs, and there is no logger.
    if (at === "") return;
    const replace = argumentReplacement(raw);
    const target = lookUp(chain);
    if (replace === undefined || target === undefined) return;
    const method = target.owner[target.property];
    if (typeof method !== "function") return;
    const condition = matcher(tokens(args, 3).condition);
    // `this` can be replaced too, so this traps the calls itself rather
    // than through a wrapper that keeps it.
    const edit = (self: unknown, callArgs: unknown[]): unknown => {
      if (at === "this") return condition(String(self)) ? replace(self) : self;
      const index = position(at, callArgs.length);
      if (index !== undefined && index >= 0 && index < callArgs.length) {
        if (condition(String(callArgs[index]))) {
          callArgs[index] = replace(callArgs[index]);
        }
      }
      return self;
    };
    target.owner[target.property] = new Proxy(method, {
      apply: (fn, self, callArgs) => apply(fn, edit(self, callArgs), callArgs),
      construct: (fn, callArgs, newTarget) => {
        edit(undefined, callArgs);
        return construct(fn, callArgs, newTarget);
      },
    });
  },
};

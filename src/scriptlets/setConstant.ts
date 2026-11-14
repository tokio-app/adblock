import { onChain, runAt, tokens, trap } from "./helpers.js";
import type { Scriptlet } from "./types.js";

const INVALID = Symbol("invalid");

/** One of the values `set-constant` may set, or `INVALID`. */
export function safeConstant(text: string): unknown {
  switch (text) {
    case "undefined":
      return undefined;
    case "false":
      return false;
    case "true":
      return true;
    case "null":
      return null;
    case "noopFunc":
      return function () {};
    case "trueFunc":
      return function () {
        return true;
      };
    case "falseFunc":
      return function () {
        return false;
      };
    case "throwFunc":
      return function () {
        throw new Error();
      };
    case "''":
    case "":
      return "";
    case "[]":
      return [];
    case "{}":
      return {};
  }
  return /^\d+$/.test(text) && Number(text) <= 0x7fff ? Number(text) : INVALID;
}

/** Anything a trusted filter says: text, or JSON after `json:` or in `{}`. */
function trustedConstant(text: string): unknown {
  try {
    if (text.startsWith("json:")) return JSON.parse(text.slice(5));
    if (text.startsWith("{") && text.endsWith("}")) {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && "value" in parsed) {
        return parsed.value;
      }
    }
  } catch {
    // Not JSON after all: it is the text itself.
  }
  const safe = safeConstant(text);
  return safe === INVALID ? text : safe;
}

function setConstant(args: string[], parse: (text: string) => unknown): void {
  const [chain = "", raw = "", third] = args;
  let constant = parse(raw);
  if (chain === "" || constant === INVALID) return;
  // The third argument used to be when to run; now it is a token.
  const options = tokens(args, /^(?:runAt|as)$/.test(third ?? "") ? 2 : 3);
  const value = constant;
  switch (options.as) {
    case "function":
      constant = () => value;
      break;
    case "callback":
      constant = () => () => value;
      break;
    case "resolved":
      constant = Promise.resolve(value);
      break;
    case "rejected":
      constant = Promise.reject(value);
      break;
  }
  const isNothing = (one: unknown) => one === undefined || one === null;
  runAt(options.runAt ?? third, () => {
    onChain(window, chain, (owner, property) => {
      // A property that already holds another kind of value stays the
      // page's: the constant would break what uses it.
      const current = owner[property];
      if (
        !isNothing(current) &&
        !isNothing(constant) &&
        typeof current !== typeof constant
      ) {
        return;
      }
      let overwritten = false;
      trap(owner, property, {
        get: (stored) => (overwritten ? stored : constant),
        set(next, stored) {
          // The page can only replace the constant with another kind of
          // value, which no longer is what the filter meant to pin.
          if (
            !isNothing(constant) &&
            !isNothing(next) &&
            typeof next !== typeof constant
          ) {
            overwritten = true;
            return next;
          }
          return stored;
        },
      });
    });
  });
}

export const setConstantScriptlet: Scriptlet = {
  name: "set-constant",
  aliases: ["set"],
  run: (...args) => setConstant(args, safeConstant),
};

export const trustedSetConstant: Scriptlet = {
  name: "trusted-set-constant",
  aliases: ["trusted-set"],
  trusted: true,
  run: (...args) => setConstant(args, trustedConstant),
};

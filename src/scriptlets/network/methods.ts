import { abort, matcher, parseRegex, stackMatches } from "../helpers.js";
import { safeConstant } from "../setConstant.js";
import type { Scriptlet } from "../types.js";
import { isObject, onMethod } from "./util.js";

const { parse } = JSON;

export const trustedOverrideElementMethod: Scriptlet = {
  name: "trusted-override-element-method",
  trusted: true,
  run(chain = "", selector = "", disposition = "") {
    // `debug` only stops in a debugger, and there is no logger to open.
    if (chain === "" || disposition === "debug") return;
    // No disposition: the call does nothing, like an empty function.
    const value =
      disposition === "" || disposition === "throw"
        ? undefined
        : safeConstant(disposition);
    if (typeof value === "symbol") return;
    onMethod(chain, (original, self, args) => {
      let matches = self instanceof Element;
      try {
        matches &&= selector === "" || (self as Element).matches(selector);
      } catch {
        matches = false;
      }
      if (!matches) return original(...args);
      if (disposition === "throw") abort();
      return value;
    });
  },
};

/** One part of a `trusted-suppress-native-method` signature. */
function argumentMatcher(text: string): (value: unknown) => boolean {
  if (text.trim() === "") return () => true;
  if (parseRegex(text) !== undefined) {
    const matches = matcher(text);
    return (value) => matches(String(value));
  }
  let expected: unknown;
  try {
    expected = text === "undefined" ? undefined : parse(text);
  } catch {
    expected = text;
  }
  return (value) => like(value, expected);
}

/**
 * Whether a value fits what a signature expects: a string found in it (only
 * `""` for the empty string), the same primitive, an object with those
 * properties, or an array holding those values.
 */
function like(value: unknown, expected: unknown): boolean {
  if (typeof expected === "string") {
    return (
      typeof value === "string" &&
      (expected === "" ? value === "" : value.includes(expected))
    );
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(value) &&
      expected.every((one) => value.some((item) => same(item, one)))
    );
  }
  if (isObject(expected)) {
    return (
      isObject(value) &&
      Object.keys(expected).every((name) => like(value[name], expected[name]))
    );
  }
  return value === expected;
}

function same(value: unknown, expected: unknown): boolean {
  return isObject(expected) ? like(value, expected) : value === expected;
}

export const trustedSuppressNativeMethod: Scriptlet = {
  name: "trusted-suppress-native-method",
  trusted: true,
  run(chain = "", signature = "", how = "abort", stack = "") {
    // Without a signature the scriptlet only logs, and there is no logger.
    if (chain === "" || signature === "" || how === "debug") return;
    const matchers = signature.split("|").map(argumentMatcher);
    onMethod(chain, (original, _self, args) => {
      if (
        !matchers.every((matches, index) => matches(args[index])) ||
        !stackMatches(stack)
      ) {
        return original(...args);
      }
      if (how === "prevent") return undefined;
      return abort();
    });
  },
};

export const callNothrow: Scriptlet = {
  name: "call-nothrow",
  run(chain = "") {
    onMethod(chain, (original, _self, args) => {
      try {
        return original(...args);
      } catch {
        return undefined;
      }
    });
  },
};

export const trustedPreventDomBypass: Scriptlet = {
  name: "trusted-prevent-dom-bypass",
  trusted: true,
  run(chain = "", property = "") {
    // An anonymous frame added by the page gets this window's (patched)
    // method, or becomes this window when no method is named.
    const own = window as unknown as Record<string, unknown>;
    const patch = (frame: HTMLIFrameElement) => {
      try {
        if (property === "") {
          Object.defineProperty(frame, "contentWindow", { get: () => window });
        } else if (frame.contentWindow !== null) {
          (frame.contentWindow as unknown as Record<string, unknown>)[
            property
          ] = own[property];
        }
      } catch {
        // A frame of another origin keeps its own.
      }
    };
    onMethod(chain, (original, _self, args) => {
      const result: unknown = original(...args);
      for (const arg of args) {
        if (!(arg instanceof HTMLElement)) continue;
        if (arg instanceof HTMLIFrameElement) patch(arg);
        for (const frame of arg.querySelectorAll("iframe")) patch(frame);
      }
      return result;
    });
  },
};

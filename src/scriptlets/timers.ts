import { matcher, wrapMethod } from "./helpers.js";
import type { Scriptlet } from "./types.js";

/**
 * A delay argument: a number (that delay), `min-max`, `min-` or `-max`
 * (a range), with a leading `!` to invert. Nothing matches any delay.
 */
function delayMatcher(pattern = ""): (delay: number) => boolean {
  const negated = pattern.startsWith("!");
  if (negated) pattern = pattern.slice(1);
  if (pattern === "") return () => true;
  const range = /^(\d*)-(\d*)$/.exec(pattern);
  const min = range === null ? Number(pattern) : Number(range[1] || 0);
  const max = range === null ? min : Number(range[2] || Infinity);
  return (delay) => (delay >= min && delay <= max) !== negated;
}

/** Makes the calls of a timer that match do nothing. */
function preventTimer(
  timer: "setTimeout" | "setInterval",
  needle: string | undefined,
  delay: string | undefined,
): void {
  // Without arguments the scriptlet only logs, and there is no logger.
  if (needle === undefined && delay === undefined) return;
  const callbackMatches = matcher(needle, true);
  const delayMatches = delayMatcher(delay);
  wrapMethod(window, timer, (original, _self, args) => {
    if (
      callbackMatches(String(args[0])) &&
      delayMatches(Number(args[1] ?? 0))
    ) {
      args[0] = function () {};
    }
    return original(...args);
  });
}

/** Multiplies the delay of the calls of a timer that match. */
function adjustTimer(
  timer: "setTimeout" | "setInterval",
  needle = "",
  delay = "1000",
  boost = "0.05",
): void {
  const callbackMatches = matcher(needle);
  const wanted = delay === "*" ? undefined : Number(delay || 1000);
  // Fifty times faster or slower at most.
  const factor = Math.min(Math.max(Number(boost) || 0.05, 0.02), 50);
  wrapMethod(window, timer, (original, _self, args) => {
    const requested = Number(args[1] ?? 0);
    if (
      (wanted === undefined || requested === wanted) &&
      callbackMatches(String(args[0]))
    ) {
      args[1] = requested * factor;
    }
    return original(...args);
  });
}

export const preventSetTimeout: Scriptlet = {
  name: "prevent-setTimeout",
  aliases: ["no-setTimeout-if", "nostif", "setTimeout-defuser"],
  run: (needle, delay) => preventTimer("setTimeout", needle, delay),
};

export const preventSetInterval: Scriptlet = {
  name: "prevent-setInterval",
  aliases: ["no-setInterval-if", "nosiif", "setInterval-defuser"],
  run: (needle, delay) => preventTimer("setInterval", needle, delay),
};

export const adjustSetTimeout: Scriptlet = {
  name: "adjust-setTimeout",
  aliases: ["nano-setTimeout-booster", "nano-stb"],
  run: (needle, delay, boost) =>
    adjustTimer("setTimeout", needle, delay, boost),
};

export const adjustSetInterval: Scriptlet = {
  name: "adjust-setInterval",
  aliases: ["nano-setInterval-booster", "nano-sib"],
  run: (needle, delay, boost) =>
    adjustTimer("setInterval", needle, delay, boost),
};

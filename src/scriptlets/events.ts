import { matcher, runAt, tokens, wrapMethod } from "./helpers.js";
import type { Scriptlet } from "./types.js";

/** Whether a listener is being added to what an `elements` token names. */
function isTarget(target: unknown, selector: string): boolean {
  if (selector === "window") return target === window;
  if (selector === "document") return target === document;
  try {
    return target instanceof Element && target.matches(selector);
  } catch {
    return false;
  }
}

export const addEventListenerDefuser: Scriptlet = {
  name: "addEventListener-defuser",
  aliases: ["aeld", "prevent-addEventListener"],
  run(...args) {
    const [type, needle] = args;
    // Without arguments the scriptlet only logs, and there is no logger.
    if (type === undefined && needle === undefined) return;
    const options = tokens(args, 2);
    const typeMatches = matcher(type);
    const handlerMatches = matcher(needle);
    runAt(options.runAt, () => {
      wrapMethod(
        EventTarget.prototype,
        "addEventListener",
        (original, self, callArgs) => {
          const [eventType, listener] = callArgs;
          const handler: unknown =
            typeof listener === "object" && listener !== null
              ? (listener as { handleEvent?: unknown }).handleEvent
              : listener;
          if (
            typeMatches(String(eventType)) &&
            handlerMatches(String(handler)) &&
            (options.elements === undefined ||
              isTarget(self ?? window, options.elements))
          ) {
            return undefined;
          }
          return original(...callArgs);
        },
      );
    });
  },
};

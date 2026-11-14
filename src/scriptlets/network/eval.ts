import { matcher, wrapMethod } from "../helpers.js";
import type { Scriptlet } from "../types.js";

// Any wrapper makes the page's direct `eval(…)` calls indirect: the code
// they let through runs in the global scope, not the caller's.
function preventEval(needle: string): void {
  const matches = matcher(needle);
  wrapMethod(window, "eval", (original, _self, args) =>
    matches(String(args[0])) ? undefined : original(...args),
  );
}

// Without a logger, the silent one is the same.
export const noEval: Scriptlet = {
  name: "noeval",
  aliases: ["noeval-silent"],
  run: () => preventEval(""),
};

export const noEvalIf: Scriptlet = {
  name: "noeval-if",
  aliases: ["prevent-eval-if"],
  run(needle = "") {
    // Without a needle the scriptlet only logs, and there is no logger.
    if (needle !== "") preventEval(needle);
  },
};

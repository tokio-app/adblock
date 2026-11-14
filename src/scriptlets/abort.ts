import { abort, matcher, onChain, stackMatches, trap } from "./helpers.js";
import type { Scriptlet } from "./types.js";

export const abortOnPropertyRead: Scriptlet = {
  name: "abort-on-property-read",
  aliases: ["aopr"],
  run(chain = "") {
    if (chain === "") return;
    onChain(window, chain, (owner, property) => {
      // Writes go through: only reading the property aborts the script.
      trap(owner, property, { get: abort });
    });
  },
};

export const abortOnPropertyWrite: Scriptlet = {
  name: "abort-on-property-write",
  aliases: ["aopw"],
  run(chain = "") {
    if (chain === "") return;
    onChain(window, chain, (owner, property) => {
      trap(owner, property, { set: abort });
    });
  },
};

/** The script a `data:` URL holds, or empty. */
function dataUrlText(src: string): string {
  const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(src);
  if (match === null) return "";
  try {
    return match[1] === undefined
      ? decodeURIComponent(match[2]!)
      : atob(match[2]!);
  } catch {
    return "";
  }
}

export const abortCurrentScript: Scriptlet = {
  name: "abort-current-script",
  aliases: ["acs", "abort-current-inline-script", "acis"],
  run(chain = "", needle = "", srcNeedle = "") {
    if (chain === "") return;
    const textMatches = matcher(needle);
    const srcMatches = matcher(srcNeedle);
    // Abort when the script that touches the property is the one the filter
    // describes, by its text or by the script its `data:` URL holds.
    const check = () => {
      const script = document.currentScript;
      if (!(script instanceof HTMLScriptElement)) return;
      if (needle !== "" && !textMatches(script.textContent ?? "")) return;
      if (srcNeedle !== "" && !srcMatches(dataUrlText(script.src))) return;
      abort();
    };
    onChain(window, chain, (owner, property) => {
      trap(owner, property, {
        get(value) {
          check();
          return value;
        },
        set(next) {
          check();
          return next;
        },
      });
    });
  },
};

export const abortOnStackTrace: Scriptlet = {
  name: "abort-on-stack-trace",
  aliases: ["aost"],
  run(chain = "", needle = "") {
    // Without a needle the scriptlet only logs, and there is no logger.
    if (chain === "" || needle === "") return;
    const check = () => {
      if (stackMatches(needle)) abort();
    };
    onChain(window, chain, (owner, property) => {
      trap(owner, property, {
        get(value) {
          check();
          return value;
        },
        set(next) {
          check();
          return next;
        },
      });
    });
  },
};

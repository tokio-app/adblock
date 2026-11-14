import { parseRegex, stackMatches, tokens, wrapMethod } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import { jsonTextEdit } from "./edit.js";
import { editFetchResponses } from "./fetch.js";
import { requestMatcher } from "./request.js";
import { isObject, onMethod } from "./util.js";
import { editXhrResponses } from "./xhr.js";

const { keys } = Object;
const { parse, stringify } = JSON;
const hasOwn = Object.hasOwn;
const then = Promise.prototype.then;
const { apply } = Reflect;

/** The keys of `node` a path segment names. */
function selected(node: Record<string, unknown>, key: string): string[] {
  if (key === "[]" || key === "[-]")
    return Array.isArray(node) ? keys(node) : [];
  if (key === "*" || key === "{-}") return keys(node);
  return hasOwn(node, key) ? [key] : [];
}

/** Whether a path, from segment `from`, leads to a property. */
function exists(node: unknown, path: string[], from = 0): boolean {
  if (from === path.length) return true;
  if (!isObject(node)) return false;
  return selected(node, path[from]!).some((key) =>
    exists(node[key], path, from + 1),
  );
}

function remove(owner: Record<string, unknown>, names: string[]): boolean {
  if (names.length === 0) return false;
  if (Array.isArray(owner)) {
    for (const index of names.map(Number).sort((a, b) => b - a)) {
      owner.splice(index, 1);
    }
  } else for (const name of names) delete owner[name];
  return true;
}

function prunePath(node: unknown, path: string[], from: number): boolean {
  if (!isObject(node)) return false;
  const key = path[from]!;
  const names = selected(node, key);
  // `[-]` and `{-}` remove the entries the rest of the path leads into.
  if (key === "[-]" || key === "{-}") {
    return remove(
      node,
      names.filter((name) => exists(node[name], path, from + 1)),
    );
  }
  if (from === path.length - 1) return remove(node, names);
  let pruned = false;
  for (const name of names) {
    if (prunePath(node[name], path, from + 1)) pruned = true;
  }
  return pruned;
}

/**
 * The `json-prune` edit: removes the properties `prune` lists from an
 * object, when every property `needle` lists is there (or, when `needle`
 * is a regex, when the object's JSON matches it). Says whether it did.
 */
export function pruner(prune: string, needle = ""): (data: unknown) => boolean {
  const toPath = (chain: string) => chain.split(".");
  const paths = prune.split(/\s+/).filter(Boolean).map(toPath);
  const regex = parseRegex(needle);
  const needles =
    regex === undefined ? needle.split(/\s+/).filter(Boolean).map(toPath) : [];
  return (data) => {
    if (!isObject(data)) return false;
    if (!needles.every((path) => exists(data, path))) return false;
    if (regex !== undefined) {
      regex.lastIndex = 0;
      if (!regex.test(stringify(data))) return false;
    }
    let pruned = false;
    for (const path of paths) if (prunePath(data, path, 0)) pruned = true;
    return pruned;
  };
}

export const jsonPrune: Scriptlet = {
  name: "json-prune",
  run(prune = "", needle = "", stack = "") {
    // Without paths the scriptlet only logs, and there is no logger.
    if (prune === "") return;
    const edit = pruner(prune, needle);
    wrapMethod(JSON, "parse", (original, _self, args) => {
      const data: unknown = original(...args);
      if (stackMatches(stack)) edit(data);
      return data;
    });
    if (typeof Response !== "function") return;
    wrapMethod(Response.prototype, "json", (original, _self, args) => {
      // The stack is the caller's only until the promise settles.
      if (!stackMatches(stack)) return original(...args);
      return apply(then, original(...args), [
        (data: unknown) => {
          edit(data);
          return data;
        },
      ]);
    });
  },
};

function pruneResponses(
  args: string[],
  install: typeof editFetchResponses,
): void {
  const [prune = "", needle = ""] = args;
  if (prune === "") return;
  const options = tokens(args, 2);
  const edit = pruner(prune, needle);
  const props = requestMatcher(options.propsToMatch);
  install(
    (details) => props(details) && stackMatches(options.stackToMatch),
    jsonTextEdit((data) => (edit(data) ? { root: data } : undefined)),
  );
}

export const jsonPruneFetchResponse: Scriptlet = {
  name: "json-prune-fetch-response",
  run: (...args) => pruneResponses(args, editFetchResponses),
};

export const jsonPruneXhrResponse: Scriptlet = {
  name: "json-prune-xhr-response",
  run: (...args) => pruneResponses(args, editXhrResponses),
};

export const evaldataPrune: Scriptlet = {
  name: "evaldata-prune",
  run(prune = "", needle = "") {
    if (prune === "") return;
    const edit = pruner(prune, needle);
    wrapMethod(window, "eval", (original, _self, args) => {
      let data: unknown;
      try {
        data = parse(String(args[0]));
      } catch {
        return original(...args);
      }
      // JSON the filter prunes is the result, as eval can't run all JSON.
      return edit(data) ? data : original(...args);
    });
  },
};

/** A copy of an object, for `dontOverwrite`: what JSON keeps of it. */
function copy(value: unknown): unknown {
  try {
    return parse(stringify(value));
  } catch {
    return value;
  }
}

export const trustedPruneInboundObject: Scriptlet = {
  name: "trusted-prune-inbound-object",
  trusted: true,
  run(...args) {
    const [chain = "", position = "", prune = "", needle = ""] = args;
    const index = Number(position) - 1;
    if (prune === "" || !Number.isInteger(index) || index < 0) return;
    const options = tokens(args, 4);
    const edit = pruner(prune, needle);
    onMethod(chain, (original, _self, callArgs) => {
      if (isObject(callArgs[index]) && stackMatches(options.stackToMatch)) {
        const object =
          options.dontOverwrite === undefined
            ? callArgs[index]
            : copy(callArgs[index]);
        if (edit(object)) callArgs[index] = object;
      }
      return original(...callArgs);
    });
  },
};

export const trustedPruneOutboundObject: Scriptlet = {
  name: "trusted-prune-outbound-object",
  trusted: true,
  run(chain = "", prune = "", needle = "") {
    if (prune === "") return;
    const edit = pruner(prune, needle);
    onMethod(chain, (original, _self, args) => {
      const result: unknown = original(...args);
      edit(result);
      return result;
    });
  },
};

// uBO-flavored JSONPath: the part of RFC 9535 its wiki lists as supported,
// plus regex selectors, the string operators, assignments and chaining.

import { isObject } from "./util.js";

type Value = unknown;

interface Node {
  value: Value;
  owner?: Record<string, unknown>;
  key?: string | number;
}

type Selector = (node: Node, root: Value, out: Node[]) => void;

interface Segment {
  deep: boolean;
  selectors: Selector[];
}

type Path = Segment[];

/** What an operand of a filter gives: a value, or NOTHING. */
type Operand = (current: Value, root: Value) => Value;

/** For a query operand: whether it selects anything. */
type Exists = (current: Value, root: Value) => boolean;

type Assign = (node: Node, set: (value: Value) => void) => void;

/** An edit's result for a root the query removed (a JSONL line drops). */
export const REMOVED = Symbol("removed");

const NOTHING = Symbol("nothing");
const { apply } = Reflect;
const { keys, getPrototypeOf } = Object;
const hasOwn = Object.hasOwn;
const { parse } = JSON;

class QueryError extends Error {}

function fail(): never {
  throw new QueryError();
}

function children(node: Node): Node[] {
  const { value } = node;
  if (!isObject(value)) return [];
  const names: (string | number)[] = Array.isArray(value)
    ? value.map((_, index) => index)
    : keys(value);
  return names.map((key) => ({ value: value[key], owner: value, key }));
}

function descendants(node: Node, seen: Set<unknown>, out: Node[]): Node[] {
  out.push(node);
  if (isObject(node.value) && !seen.has(node.value)) {
    seen.add(node.value);
    for (const child of children(node)) descendants(child, seen, out);
  }
  return out;
}

/** A member a name selects: own, or inherited on what isn't plain data. */
function has(object: Record<string, unknown>, name: string): boolean {
  if (hasOwn(object, name)) return true;
  const proto: unknown = getPrototypeOf(object);
  return proto !== Object.prototype && proto !== null && name in object;
}

function select(path: Path, root: Value, current: Value): Node[] {
  let nodes: Node[] = [{ value: current }];
  for (const { deep, selectors } of path) {
    const next: Node[] = [];
    for (const node of nodes) {
      const targets = deep ? descendants(node, new Set(), []) : [node];
      for (const target of targets) {
        for (const selector of selectors) selector(target, root, next);
      }
    }
    nodes = next;
  }
  return nodes;
}

const byName =
  (name: string): Selector =>
  ({ value }, _root, out) => {
    if (isObject(value) && !Array.isArray(value) && has(value, name)) {
      out.push({ value: value[name], owner: value, key: name });
    }
  };

const byRegex =
  (regex: RegExp): Selector =>
  ({ value }, _root, out) => {
    if (!isObject(value) || Array.isArray(value)) return;
    for (const key of keys(value)) {
      regex.lastIndex = 0;
      if (regex.test(key)) out.push({ value: value[key], owner: value, key });
    }
  };

const byIndex =
  (index: number): Selector =>
  ({ value }, _root, out) => {
    if (!Array.isArray(value)) return;
    const at = index < 0 ? value.length + index : index;
    if (at >= 0 && at < value.length) {
      out.push({ value: value[at], owner: value as never, key: at });
    }
  };

const wildcard: Selector = (node, _root, out) => {
  out.push(...children(node));
};

function equal(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const names = keys(a);
  return (
    names.length === keys(b).length &&
    names.every((name) => hasOwn(b, name) && equal(a[name], b[name]))
  );
}

function less(a: Value, b: Value): boolean {
  return (
    ((typeof a === "number" && typeof b === "number") ||
      (typeof a === "string" && typeof b === "string")) &&
    a < b
  );
}

const COMPARISONS: Record<string, (a: Value, b: Value) => boolean> = {
  "==": equal,
  "!=": (a, b) => !equal(a, b),
  "<=": (a, b) => less(a, b) || equal(a, b),
  ">=": (a, b) => less(b, a) || equal(a, b),
  "^=": (a, b) =>
    typeof a === "string" && typeof b === "string" && a.startsWith(b),
  "$=": (a, b) =>
    typeof a === "string" && typeof b === "string" && a.endsWith(b),
  "*=": (a, b) =>
    typeof a === "string" && typeof b === "string" && a.includes(b),
  "<": less,
  ">": (a, b) => less(b, a),
};

const NAME = /[A-Za-z_\u0080-￿][\w\u0080-￿]*/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/y;
const INTEGER = /-?(?:0|[1-9]\d*)/y;
const QUANTIFIER = /(\d*)(,?)(\d*)\}/y;
const ESCAPES: Record<string, string> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  "/": "/",
  "\\": "\\",
  "'": "'",
  '"': '"',
};

/** Parses a query; throws a QueryError on anything it doesn't support. */
function parseQuery(text: string, trusted: boolean) {
  let pos = 0;
  const eat = (token: string) => {
    if (!text.startsWith(token, pos)) return false;
    pos += token.length;
    return true;
  };
  const skip = () => {
    while (/[ \t\n\r]/.test(text[pos] ?? "")) pos++;
  };
  const sticky = (regex: RegExp) => {
    regex.lastIndex = pos;
    const match = regex.exec(text);
    if (match === null) fail();
    pos = regex.lastIndex;
    return match;
  };

  const string = (): string => {
    const quote = text[pos++];
    let out = "";
    while (pos < text.length) {
      const char = text[pos++]!;
      if (char === quote) return out;
      if (char !== "\\") {
        out += char;
        continue;
      }
      const escape = text[pos++] ?? "";
      if (escape === "u") {
        const hex = text.slice(pos, pos + 4);
        if (!/^[\da-fA-F]{4}$/.test(hex)) fail();
        out += String.fromCharCode(parseInt(hex, 16));
        pos += 4;
      } else out += ESCAPES[escape] ?? fail();
    }
    return fail();
  };

  const regex = (): RegExp => {
    let end = pos + 1;
    let inClass = false;
    for (; end < text.length; end++) {
      const char = text[end];
      if (char === "\\") end++;
      else if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) break;
    }
    if (end >= text.length) fail();
    const source = text.slice(pos + 1, end);
    pos = end + 1;
    const flags = sticky(/[dgimsuvy]*/y)[0];
    try {
      return new RegExp(source, flags);
    } catch {
      return fail();
    }
  };

  const operand = (): [Operand, Exists?] => {
    const char = text[pos];
    if (char === "@" || char === "$") {
      pos++;
      const query = path();
      const nodes = (current: Value, root: Value) =>
        select(query, root, char === "@" ? current : root);
      return [
        (current, root) => {
          const found = nodes(current, root);
          return found.length === 1 ? found[0]!.value : NOTHING;
        },
        (current, root) => nodes(current, root).length > 0,
      ];
    }
    let literal: Value;
    if (char === '"' || char === "'") literal = string();
    else if (eat("true")) literal = true;
    else if (eat("false")) literal = false;
    else if (eat("null")) literal = null;
    else literal = Number(sticky(NUMBER)[0]);
    return [() => literal];
  };

  const filter = (): Selector => {
    skip();
    const negated = eat("!");
    skip();
    const [left, exists] = operand();
    skip();
    const op = Object.keys(COMPARISONS).find((one) =>
      text.startsWith(one, pos),
    );
    let test: (current: Value, root: Value) => boolean;
    if (op !== undefined && !negated) {
      pos += op.length;
      skip();
      const [right] = operand();
      const compare = COMPARISONS[op]!;
      test = (current, root) =>
        compare(left(current, root), right(current, root));
    } else if (text[pos] === "=" && text[pos + 1] === "/" && !negated) {
      pos++;
      const pattern = regex();
      test = (current, root) => {
        const value = left(current, root);
        pattern.lastIndex = 0;
        return typeof value === "string" && pattern.test(value);
      };
    } else if (op === undefined && exists !== undefined) {
      test = (current, root) => exists(current, root) !== negated;
    } else return fail();
    return (node, root, out) => {
      for (const child of children(node)) {
        if (test(child.value, root)) out.push(child);
      }
    };
  };

  const selector = (): Selector => {
    const char = text[pos];
    if (char === '"' || char === "'") return byName(string());
    if (char === "*") {
      pos++;
      return wildcard;
    }
    if (char === "?") {
      pos++;
      return filter();
    }
    if (char === "/") return byRegex(regex());
    return byIndex(Number(sticky(INTEGER)[0]));
  };

  const bracket = (): Selector[] => {
    pos++;
    const selectors: Selector[] = [];
    do {
      skip();
      selectors.push(selector());
      skip();
    } while (eat(","));
    if (!eat("]")) fail();
    return selectors;
  };

  // After `.` or `..`: a name, `*`, a regex, or (uBO's) a bracket.
  const member = (): Selector[] => {
    const char = text[pos];
    if (char === "[") return bracket();
    if (char === "*") {
      pos++;
      return [wildcard];
    }
    if (char === "/") return [byRegex(regex())];
    return [byName(sticky(NAME)[0])];
  };

  function path(): Path {
    const segments: Path = [];
    for (;;) {
      const before = pos;
      skip();
      if (eat("..")) segments.push({ deep: true, selectors: member() });
      else if (eat(".")) segments.push({ deep: false, selectors: member() });
      else if (text[pos] === "[") {
        segments.push({ deep: false, selectors: bracket() });
      } else {
        pos = before;
        return segments;
      }
    }
  }

  const assignment = (): Assign | undefined => {
    skip();
    if (pos === text.length) return undefined;
    if (!trusted) fail();
    const merge = eat("+=");
    if (!merge && !eat("=")) fail();
    const rest = text.slice(pos).trim();
    if (merge) {
      if (!isObject(parse(rest))) fail();
      return ({ value }) => {
        if (isObject(value)) Object.assign(value, parse(rest));
      };
    }
    const call = /^(repl|call)\((.*)\)$/s.exec(rest);
    if (call === null) {
      parse(rest);
      return (_node, set) => set(parse(rest));
    }
    const spec: unknown = parse(call[2]!);
    return call[1] === "repl" ? replacer(spec) : caller(spec);
  };

  const steps: { path: Path; min: number; max: number }[] = [];
  for (;;) {
    skip();
    if (!eat("$")) fail();
    const query = path();
    skip();
    if (eat("{")) {
      const [, min, comma, max] = sticky(QUANTIFIER);
      if (min === "" && max === "") fail();
      const low = Number(min || 0);
      const high = max !== "" ? Number(max) : comma ? Infinity : low;
      skip();
      // A quantifier never ends the chain.
      if (!eat(";")) fail();
      steps.push({ path: query, min: low, max: high });
    } else if (eat(";")) {
      steps.push({ path: query, min: 1, max: Infinity });
    } else {
      return { steps, last: query, assign: assignment() };
    }
  }
}

function replacer(spec: unknown): Assign {
  if (!isObject(spec) || typeof spec.replacement !== "string") fail();
  const replacement = spec.replacement;
  let find: (text: string) => string;
  if (typeof spec.pattern === "string") {
    const pattern = spec.pattern;
    find = (text) => text.split(pattern).join(replacement);
  } else if (typeof spec.regex === "string") {
    const regex = new RegExp(spec.regex, "g");
    find = (text) => text.replace(regex, replacement);
  } else fail();
  return ({ value }, set) => {
    if (typeof value === "string") set(find(value));
  };
}

const OBJ = "${obj}";
const KEY = "${key}";
const VAL = "${val}";

function caller(spec: unknown): Assign {
  if (!Array.isArray(spec)) fail();
  const [context, name, ...rest] = spec as unknown[];
  if (typeof name !== "string" || (context !== null && context !== OBJ)) {
    fail();
  }
  return (node) => {
    const self: unknown = context === null ? window : node.owner;
    if (!isObject(self) && typeof self !== "function") return;
    const method = (self as Record<string, unknown>)[name];
    if (typeof method !== "function") return;
    const args = rest.map((arg) =>
      arg === OBJ
        ? node.owner
        : arg === KEY
          ? node.key
          : arg === VAL
            ? node.value
            : arg,
    );
    try {
      apply(method, self, args);
    } catch {
      // A call the page's object refuses changes nothing.
    }
  };
}

function remove(nodes: Node[]): void {
  const byOwner = new Map<Record<string, unknown>, Set<string | number>>();
  for (const { owner, key } of nodes) {
    if (owner === undefined || key === undefined) continue;
    byOwner.set(owner, (byOwner.get(owner) ?? new Set()).add(key));
  }
  for (const [owner, names] of byOwner) {
    if (Array.isArray(owner)) {
      // From the end, so the indices left to remove stay right.
      for (const index of [...names].map(Number).sort((a, b) => b - a)) {
        owner.splice(index, 1);
      }
    } else for (const name of names) delete owner[name];
  }
}

/**
 * Compiles a query into an edit of a value, in place: it gives the new root
 * (`REMOVED` when the query selected the root itself), or undefined when
 * the query selected nothing. Assignments need `trusted`. An invalid or
 * unsupported query gives undefined.
 */
export function compileJsonPath(
  query: string,
  trusted: boolean,
): ((root: Value) => { root: Value } | undefined) | undefined {
  let parsed: ReturnType<typeof parseQuery>;
  try {
    parsed = parseQuery(
      query.startsWith("v2:") ? query.slice(3) : query,
      trusted,
    );
  } catch {
    return undefined;
  }
  const { steps, last, assign } = parsed;
  return (root) => {
    for (const { path, min, max } of steps) {
      const count = select(path, root, root).length;
      if (count < min || count > max) return undefined;
    }
    const nodes = select(last, root, root);
    if (nodes.length === 0) return undefined;
    let result = root;
    if (assign === undefined) {
      if (nodes.some((node) => node.owner === undefined)) {
        return { root: REMOVED };
      }
      remove(nodes);
    } else {
      for (const node of nodes) {
        assign(node, (value) => {
          if (node.owner === undefined) result = value;
          else node.owner[node.key as string] = value;
        });
      }
    }
    return { root: result };
  };
}

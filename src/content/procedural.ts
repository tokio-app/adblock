// Runs procedural cosmetic filters in the page. This file is bundled into the
// preload: it can only import types, and other files of this folder.
import type { ProceduralPlan, ProceduralTask } from "../parser/types.js";

type Step = (nodes: Node[]) => Node[];
type Matcher = (text: string) => boolean;

/**
 * A matcher from what the parser compiled an operator's argument to: text,
 * or the source and flags of a regular expression. Text has to be found in
 * the value, or with `exact` to be the value.
 */
function textMatcher(spec: unknown, exact = false): Matcher {
  if (Array.isArray(spec)) {
    const regex = new RegExp(String(spec[0]), String(spec[1]));
    return (text) => {
      regex.lastIndex = 0;
      return regex.test(text);
    };
  }
  const literal = String(spec);
  return exact ? (text) => text === literal : (text) => text.includes(literal);
}

function select(root: Node, selector: string): Element[] {
  try {
    return [...(root as ParentNode).querySelectorAll(selector)];
  } catch {
    // Not a selector this browser knows: the filter selects nothing.
    return [];
  }
}

const unique = (nodes: Node[]): Node[] => [...new Set(nodes)];

/**
 * The CSS that follows an operator, from each node the operator kept:
 * ` > a` and ` a` look below the node, `+ a` and `~ a` after it, and `.a`
 * (no space) keeps the node if it matches.
 */
function continueFrom(node: Node, css: string): Element[] {
  const trimmed = css.trim();
  if (!(node instanceof Element)) return select(node, trimmed);
  if (css.includes(":scope")) return select(node, css);
  const sibling = /^[+~]/.test(trimmed);
  if (!sibling && (/^\s/.test(css) || trimmed.startsWith(">"))) {
    return select(node, `:scope ${trimmed}`);
  }
  // The node itself has to take part: name it from its parent.
  const parent = node.parentElement;
  if (parent === null) return [];
  const index = [...parent.children].indexOf(node) + 1;
  return select(
    parent,
    `:scope > :nth-child(${index})${sibling ? trimmed : css}`,
  );
}

/** Everything but the nodes, what is inside them and what they are inside. */
function others(nodes: Node[]): Node[] {
  const subjects = new Set(nodes);
  const ancestors = new Set<Node>();
  for (const node of nodes) {
    for (let up = node.parentNode; up !== null; up = up.parentNode) {
      ancestors.add(up);
    }
  }
  const found: Node[] = [];
  const visit = (element: Element) => {
    if (subjects.has(element)) return;
    if (!ancestors.has(element)) found.push(element);
    else for (const child of element.children) visit(child);
  };
  visit(document.documentElement);
  return found;
}

function compileTask(
  [op, arg]: ProceduralTask,
  watched: Set<string>,
): Step | undefined {
  const keep =
    (test: (node: Node) => boolean): Step =>
    (nodes) =>
      nodes.filter(test);
  switch (op) {
    case "spath": {
      const css = String(arg);
      return (nodes) =>
        unique(nodes.flatMap((node) => continueFrom(node, css)));
    }
    case "has":
    case "not": {
      const inner = compileSteps((arg as ProceduralPlan).tasks, watched);
      const wanted = op === "has";
      return keep((node) => run(inner, [node]).length > 0 === wanted);
    }
    case "has-text": {
      const matches = textMatcher(arg);
      return keep((node) => matches(node.textContent ?? ""));
    }
    case "matches-path": {
      const matches = textMatcher(arg);
      // All or nothing: the filter only applies on some pages of the site.
      return (nodes) =>
        matches(location.pathname + location.search) ? nodes : [];
    }
    case "matches-media": {
      const query = String(arg);
      return (nodes) => (matchMedia(query).matches ? nodes : []);
    }
    case "matches-attr": {
      const { name, value } = arg as { name: unknown; value?: unknown };
      const nameMatches = textMatcher(name, true);
      const valueMatches =
        value === undefined ? () => true : textMatcher(value, true);
      return keep(
        (node) =>
          node instanceof Element &&
          [...node.attributes].some(
            (attribute) =>
              nameMatches(attribute.name) && valueMatches(attribute.value),
          ),
      );
    }
    case "matches-css": {
      const { name, pseudo, value } = arg as {
        name: string;
        pseudo: string;
        value: unknown;
      };
      const matches = textMatcher(value, true);
      return keep(
        (node) =>
          node instanceof Element &&
          matches(
            getComputedStyle(node, pseudo === "" ? null : pseudo)
              .getPropertyValue(name)
              .trim(),
          ),
      );
    }
    case "matches-prop": {
      const { name, value } = arg as { name: unknown; value?: unknown };
      const chain = String(name).split(".");
      const matches =
        value === undefined ? undefined : textMatcher(value, true);
      return keep((node) => {
        let current: unknown = node;
        for (const property of chain) {
          if (typeof current !== "object" || current === null) return false;
          current = (current as Record<string, unknown>)[property];
        }
        if (current === undefined) return false;
        if (matches === undefined) return true;
        // An object has no text to compare with the filter's value.
        return (
          (typeof current === "string" ||
            typeof current === "number" ||
            typeof current === "boolean") &&
          matches(String(current))
        );
      });
    }
    case "min-text-length": {
      const length = Number(arg);
      return keep((node) => (node.textContent ?? "").length >= length);
    }
    case "others":
      return others;
    case "upward": {
      if (typeof arg !== "number") {
        const selector = String(arg);
        return (nodes) =>
          unique(
            nodes.flatMap((node) => {
              try {
                return node.parentElement?.closest(selector) ?? [];
              } catch {
                return [];
              }
            }),
          );
      }
      return (nodes) =>
        unique(
          nodes.flatMap((node) => {
            let up: Node | null = node;
            for (let i = 0; i < arg && up !== null; i++) up = up.parentElement;
            return up ?? [];
          }),
        );
    }
    case "watch-attr": {
      // Selects nothing new: it says which attribute changes to rerun for.
      const names = arg as string[];
      for (const name of names.length === 0 ? ["*"] : names) watched.add(name);
      return (nodes) => nodes;
    }
    case "xpath": {
      const expression = String(arg);
      return (nodes) =>
        unique(
          nodes.flatMap((node) => {
            try {
              const result = document.evaluate(
                expression,
                node,
                null,
                XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
                null,
              );
              return Array.from({ length: result.snapshotLength }, (_, i) =>
                result.snapshotItem(i),
              ).filter((found) => found instanceof Element);
            } catch {
              return [];
            }
          }),
        );
    }
    default:
      return undefined;
  }
}

function compileSteps(
  tasks: readonly ProceduralTask[],
  watched: Set<string>,
): Step[] {
  return tasks.map(
    // An operator this version doesn't know selects nothing: hiding too
    // little is the safe way to be wrong.
    (task) => compileTask(task, watched) ?? (() => []),
  );
}

function run(steps: readonly Step[], nodes: Node[]): Node[] {
  for (const step of steps) {
    if (nodes.length === 0) break;
    nodes = step(nodes);
  }
  return nodes;
}

/** A procedural filter ready to run. */
export interface CompiledFilter {
  /** The elements the filter selects in the document now. */
  select(): Element[];
  /**
   * The attributes whose changes should run it again (`:watch-attr()`),
   * `*` for any.
   */
  watched: ReadonlySet<string>;
  /** What to do with the elements. Undefined: hide them. */
  action: ProceduralPlan["action"];
}

/** Compiles the plan the parser made of a procedural filter. */
export function compileFilter(plan: ProceduralPlan): CompiledFilter {
  const watched = new Set<string>();
  const steps = compileSteps(plan.tasks, watched);
  return {
    select: () =>
      run(
        steps,
        plan.selector === "" ? [document] : select(document, plan.selector),
      ).filter((node) => node instanceof Element),
    watched,
    action: plan.action,
  };
}

/** `name` or `/regex/flags`, as the action operators take them. */
export function nameMatcher(text: string): Matcher {
  const regex = /^\/(.+)\/([dgimsuvy]*)$/.exec(text);
  return regex === null
    ? (name) => name === text
    : textMatcher([regex[1], regex[2]]);
}

import { tryRegex } from "../util.js";
import type { ProceduralPlan, ProceduralTask } from "./types.js";

/** What a cosmetic filter's selector compiles to. */
export interface CompiledSelector {
  /** A plain CSS selector, when `procedural` is undefined. */
  selector: string;
  style: string | undefined;
  media: string | undefined;
  procedural: ProceduralPlan | undefined;
}

/** A literal to find, or the source and flags of a regular expression. */
type TextMatcher = string | [source: string, flags: string];

const ALIASES: Readonly<Record<string, string>> = {
  "-abp-has": "has",
  if: "has",
  "if-not": "not",
  "-abp-contains": "has-text",
  contains: "has-text",
  "nth-ancestor": "upward",
};

// Operators that always need JavaScript. `has` and `not` do when their
// argument does, or when the filter says so with `#?#`.
const PROCEDURAL = new Set([
  "has-text",
  "matches-attr",
  "matches-css",
  "matches-css-before",
  "matches-css-after",
  "matches-media",
  "matches-path",
  "matches-prop",
  "min-text-length",
  "others",
  "upward",
  "watch-attr",
  "xpath",
  "style",
  "remove",
  "remove-attr",
  "remove-class",
]);
const ACTIONS = new Set(["style", "remove", "remove-attr", "remove-class"]);
// Their argument is free text, where a quote is only a quote.
const TEXT_ARGUMENT = new Set([
  "has-text",
  "matches-attr",
  "matches-css",
  "matches-css-before",
  "matches-css-after",
  "matches-path",
  "matches-prop",
  "min-text-length",
  "others",
  "watch-attr",
  "remove",
  "remove-attr",
  "remove-class",
]);

type Part =
  { type: "css"; text: string } | { type: "op"; name: string; arg: string };

function skipString(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i + 1;
  }
  return -1;
}

function skipBrackets(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === '"' || c === "'") {
      i = skipString(text, i) - 1;
      if (i < 0) return -1;
    } else if (c === "]") return i + 1;
  }
  return -1;
}

/** The index of the `)` that closes an operator's argument, or -1. */
function findArgumentEnd(text: string, start: number, name: string): number {
  let first = start;
  while (text[first] === " ") first++;
  const quote = text[first];
  if (quote === '"' || quote === "'") {
    let after = skipString(text, first);
    if (after !== -1) {
      while (text[after] === " ") after++;
      if (text[after] === ")") return after;
    }
  } else if (quote === "/" && TEXT_ARGUMENT.has(name)) {
    // A regular expression may hold a lone parenthesis.
    for (let i = first + 1; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === "/") {
        let after = i + 1;
        while (/[a-z]/.test(text[after] ?? "")) after++;
        if (text[after] === ")") return after;
      }
    }
  }
  const strings = !TEXT_ARGUMENT.has(name);
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (strings && (c === '"' || c === "'")) {
      i = skipString(text, i) - 1;
      if (i < 0) return -1;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

const PSEUDO = /::?(-?[a-z][\w-]*)\(/iy;

/**
 * Splits a selector at its top-level procedural operators. The CSS between
 * them, native pseudo-classes included, stays as text.
 */
function splitOperators(
  text: string,
  force: boolean,
): { parts: Part[]; commas: number[] } | string {
  const parts: Part[] = [];
  // Where the top-level commas of a selector list are.
  const commas: number[] = [];
  let cssStart = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
    } else if (c === '"' || c === "'") {
      i = skipString(text, i);
      if (i === -1) return "unbalanced quote";
    } else if (c === "[") {
      i = skipBrackets(text, i);
      if (i === -1) return "unbalanced bracket";
    } else if (c === ":") {
      PSEUDO.lastIndex = i;
      const match = PSEUDO.exec(text);
      if (match === null) {
        i++;
        continue;
      }
      const raw = match[1]!.toLowerCase();
      const name = ALIASES[raw] ?? raw;
      const argStart = i + match[0].length;
      const argEnd = findArgumentEnd(text, argStart, name);
      if (argEnd === -1) return "unbalanced parenthesis";
      const arg = text.slice(argStart, argEnd);
      let procedural = PROCEDURAL.has(name);
      if (!procedural) {
        // A native pseudo-class: procedural when its argument is.
        const inner = splitOperators(arg, false);
        if (typeof inner === "string") return inner;
        const nested = inner.parts.some((part) => part.type === "op");
        if (name === "has" || name === "not") procedural = force || nested;
        else if (nested) return `procedural operator inside :${name}()`;
      }
      if (procedural) {
        if (i > cssStart) {
          parts.push({ type: "css", text: text.slice(cssStart, i) });
        }
        parts.push({ type: "op", name, arg });
        cssStart = argEnd + 1;
      }
      i = argEnd + 1;
    } else if (c === "(" || c === ")") {
      return "unbalanced parenthesis";
    } else if (c === "{" || c === "}") {
      return "braces in a selector";
    } else {
      if (c === ",") commas.push(i);
      i++;
    }
  }
  if (cssStart < text.length) {
    parts.push({ type: "css", text: text.slice(cssStart) });
  }
  return { parts, commas };
}

/** Why a plain CSS selector can't be used, or undefined when it can. */
function plainSelectorError(selector: string): string | undefined {
  if (selector.trim() === "") return "empty selector";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(selector)) return "control character in a selector";
  if (selector.includes("/*")) return "comment in a selector";
  return undefined;
}

function unquote(text: string): string | undefined {
  const quote = text[0];
  if (
    text.length < 2 ||
    (quote !== '"' && quote !== "'") ||
    !text.endsWith(quote)
  ) {
    return undefined;
  }
  // Only the quote and the backslash are escaped: `\w` in a quoted regular
  // expression stays as it is.
  return text.slice(1, -1).replace(/\\(["'\\])/g, "$1");
}

/** A literal, quoted or bare, or `/regex/flags`, quoted or bare. */
function compileTextMatcher(text: string): TextMatcher | undefined {
  text = unquote(text.trim()) ?? text.trim();
  // `/shop/item` is a path, not a regular expression with the flags `item`.
  const regex = /^\/(.+)\/([dgimsuvy]*)$/.exec(text);
  if (regex === null) return text;
  if (tryRegex(regex[1]!, regex[2]) === undefined) return undefined;
  return [regex[1]!, regex[2]!];
}

/** Whether `:style()` declarations are free of what uBlock Origin forbids. */
function styleError(style: string): string | undefined {
  if (style.trim() === "") return "empty :style()";
  if (
    /url\s*\(|image-set\s*\(|\/\*|\*\/|\\|\/\s*\/|[{}]|@import/i.test(style)
  ) {
    return "forbidden value in :style()";
  }
  return undefined;
}

function compileOperator(
  name: string,
  arg: string,
  force: boolean,
): ProceduralTask | string {
  switch (name) {
    case "has":
    case "not": {
      const inner = splitOperators(arg, force);
      if (typeof inner === "string") return inner;
      const tasks: ProceduralTask[] = [];
      for (const part of inner.parts) {
        if (part.type === "op") {
          if (ACTIONS.has(part.name))
            return `:${part.name}() inside :${name}()`;
          const task = compileOperator(part.name, part.arg, force);
          if (typeof task === "string") return task;
          tasks.push(task);
          continue;
        }
        let css = part.text;
        const first = tasks.length === 0;
        if (first) css = css.trimStart();
        if (css.trim() === "") continue;
        if (first && inner.commas.length > 0) {
          if (inner.parts.length > 1) {
            return "selector list with procedural operators";
          }
          css = `:is(${css})`;
        }
        // `:has()` looks below its subject, `:not()` at the subject itself.
        if (
          first &&
          name === "has" &&
          !/^[>+~]/.test(css) &&
          !css.includes(":scope")
        ) {
          css = ` ${css}`;
        }
        tasks.push(["spath", css]);
      }
      if (tasks.length === 0) return `empty :${name}()`;
      return [name, { selector: "", tasks } satisfies ProceduralPlan];
    }
    case "has-text":
    case "matches-path": {
      const matcher = compileTextMatcher(arg);
      return matcher === undefined
        ? `bad :${name}() argument`
        : [name, matcher];
    }
    case "matches-attr":
    case "matches-prop": {
      // name="value", "name"="value" or name alone.
      const match =
        /^\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\/.+\/[a-z]*|[^=]+?)\s*(?:=\s*(.+))?$/s.exec(
          arg,
        );
      if (match === null) return `bad :${name}() argument`;
      const key = compileTextMatcher(match[1]!);
      const value =
        match[2] === undefined ? undefined : compileTextMatcher(match[2]);
      if (
        key === undefined ||
        (match[2] !== undefined && value === undefined)
      ) {
        return `bad :${name}() argument`;
      }
      return [name, value === undefined ? { name: key } : { name: key, value }];
    }
    case "matches-css":
    case "matches-css-before":
    case "matches-css-after": {
      const colon = arg.indexOf(":");
      const property = arg.slice(0, colon).trim();
      const value = compileTextMatcher(arg.slice(colon + 1));
      if (
        colon === -1 ||
        !/^-?[a-z-]+$/i.test(property) ||
        value === undefined
      ) {
        return `bad :${name}() argument`;
      }
      const pseudo =
        name === "matches-css" ? "" : `::${name.slice("matches-css-".length)}`;
      return ["matches-css", { name: property, pseudo, value }];
    }
    case "matches-media":
      if (arg.trim() === "" || /[{};]/.test(arg)) {
        return "bad :matches-media() argument";
      }
      return [name, arg.trim()];
    case "min-text-length": {
      const length = Number(arg.trim());
      if (!Number.isInteger(length) || length < 0) {
        return "bad :min-text-length() argument";
      }
      return [name, length];
    }
    case "others":
      return [name, ""];
    case "upward": {
      const text = arg.trim();
      if (/^\d+$/.test(text)) {
        const distance = Number(text);
        if (distance < 1 || distance > 255) return "bad :upward() argument";
        return [name, distance];
      }
      const error = plainSelectorError(text);
      return error === undefined ? [name, text] : error;
    }
    case "watch-attr":
      return [
        name,
        arg
          .split(",")
          .map((attribute) => attribute.trim())
          .filter((attribute) => attribute !== ""),
      ];
    case "xpath":
      return arg.trim() === "" ? "empty :xpath()" : [name, arg.trim()];
    default:
      return `unknown operator :${name}()`;
  }
}

const LIST = "selector list with procedural operators";

/**
 * Compiles a cosmetic filter's selector. `force` (`#?#`) keeps `:has()` and
 * `:not()` procedural even when the browser could match them itself.
 * A selector list with procedural parts gives one result per procedural part
 * and one for the plain parts together. Returns the reason when the selector
 * can't be used.
 */
export function compileSelector(
  text: string,
  force = false,
): CompiledSelector[] | string {
  text = text.trim();
  const split = splitOperators(text, force);
  if (typeof split === "string") return split;
  const whole = compileOne(text, split, force);
  if (whole !== LIST) return typeof whole === "string" ? whole : [whole];

  const compiled: CompiledSelector[] = [];
  const plain: string[] = [];
  let start = 0;
  for (const end of [...split.commas, text.length]) {
    const part = text.slice(start, end);
    start = end + 1;
    const partSplit = splitOperators(part, force);
    if (typeof partSplit === "string") return partSplit;
    const one = compileOne(part.trim(), partSplit, force);
    if (typeof one === "string") return one;
    if (
      one.procedural === undefined &&
      one.style === undefined &&
      one.media === undefined
    ) {
      plain.push(one.selector);
    } else compiled.push(one);
  }
  if (plain.length > 0) {
    compiled.unshift({
      selector: plain.join(", "),
      style: undefined,
      media: undefined,
      procedural: undefined,
    });
  }
  return compiled;
}

function compileOne(
  text: string,
  split: { parts: Part[]; commas: number[] },
  force: boolean,
): CompiledSelector | string {
  const { parts } = split;
  const ops = parts.filter((part) => part.type === "op");

  if (ops.length === 0) {
    const error = plainSelectorError(text);
    if (error !== undefined) return error;
    return {
      selector: text,
      style: undefined,
      media: undefined,
      procedural: undefined,
    };
  }
  // `a, b:style()` restyles both; any other operator belongs to its part.
  if (split.commas.length > 0 && ops.some((op) => !ACTIONS.has(op.name))) {
    return LIST;
  }

  const plan: ProceduralPlan = { selector: "", tasks: [] };
  const first = parts[0]!;
  let rest = parts;
  if (first.type === "css") {
    const error = plainSelectorError(first.text);
    if (error !== undefined) return error;
    plan.selector = first.text.trim();
    rest = parts.slice(1);
  }
  for (const [index, part] of rest.entries()) {
    if (plan.action !== undefined) return "operator after an action operator";
    if (part.type === "css") {
      if (part.text.trim() === "") continue;
      // What follows an operator continues from the elements it kept.
      plan.tasks.push(["spath", part.text.trimEnd()]);
      continue;
    }
    if (!ACTIONS.has(part.name)) {
      const task = compileOperator(part.name, part.arg, force);
      if (typeof task === "string") return task;
      plan.tasks.push(task);
      continue;
    }
    if (index !== rest.length - 1) return "operator after an action operator";
    if (part.name === "style") {
      const error = styleError(part.arg);
      if (error !== undefined) return error;
      plan.action = ["style", part.arg.trim()];
    } else if (part.name === "remove") {
      if (part.arg.trim() !== "") return "bad :remove() argument";
      plan.action = ["remove", ""];
    } else {
      const matcher = compileTextMatcher(part.arg);
      if (matcher === undefined || matcher === "") {
        return `bad :${part.name}() argument`;
      }
      plan.action = [
        part.name === "remove-attr" ? "remove-attr" : "remove-class",
        typeof matcher === "string" ? matcher : `/${matcher[0]}/${matcher[1]}`,
      ];
    }
  }

  // A plain selector that only restyles, or only applies to some media, needs
  // no JavaScript: a stylesheet does it.
  const style = plan.action?.[0] === "style" ? plan.action[1] : undefined;
  const declarative = plan.action === undefined || style !== undefined;
  const only = plan.tasks.length === 1 ? plan.tasks[0] : undefined;
  if (plan.selector !== "" && declarative) {
    if (plan.tasks.length === 0) {
      return {
        selector: plan.selector,
        style,
        media: undefined,
        procedural: undefined,
      };
    }
    if (only?.[0] === "matches-media" && typeof only[1] === "string") {
      return {
        selector: plan.selector,
        style,
        media: only[1],
        procedural: undefined,
      };
    }
  }
  if (plan.selector === "" && plan.tasks.length === 0) return "empty selector";
  return { selector: "", style: undefined, media: undefined, procedural: plan };
}

/**
 * A class or id a generic selector needs in the page, so the selector can be
 * looked up by what the page uses: `.ad-box` and `div > #ad-box a` have one,
 * `[href^="ad"]` doesn't. A selector list, or one with `:not()` and the like,
 * may not need its first class or id, and an escaped name isn't the page's
 * text, so those have none either.
 */
export function selectorKey(selector: string): string | undefined {
  if (/[,(\\]/.test(selector)) return undefined;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === "[") {
      i = skipBrackets(selector, i) - 1;
      if (i < 0) return undefined;
    } else if (c === "." || c === "#") {
      const name = /^[\w-]+/.exec(selector.slice(i + 1));
      return name === null ? undefined : c + name[0];
    }
  }
  return undefined;
}

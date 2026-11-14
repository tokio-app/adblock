import { matcher, parseRegex } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import { readCookies } from "./cookies.js";

/** The element a directive names: a selector, `xpath:…`, `>>>` into shadow roots. */
function find(directive: string): Element | null {
  if (directive.startsWith("xpath:")) {
    const node = document.evaluate(
      directive.slice(6),
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
    ).singleNodeValue;
    return node instanceof Element ? node : null;
  }
  let root: Document | ShadowRoot | null = document;
  let found: Element | null = null;
  for (const part of directive.split(">>>")) {
    found = root?.querySelector(part.trim()) ?? null;
    root = found?.shadowRoot ?? null;
  }
  return found;
}

function isVisible(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * Whether the page's cookies or local storage meet one `cookie:key[=value]`
 * or `localStorage:key[=value]` condition. A regex is tested against each
 * `key=value`; `!` wants no match.
 */
function meets(condition: string): boolean {
  const negated = condition.startsWith("!");
  const match = /^(cookie|localStorage):(.+)$/.exec(
    negated ? condition.slice(1) : condition,
  );
  if (match === null) return false;
  let pairs: [string, string][];
  try {
    pairs =
      match[1] === "cookie"
        ? readCookies()
        : Object.keys(localStorage).map((key) => [
            key,
            localStorage.getItem(key) ?? "",
          ]);
  } catch {
    pairs = [];
  }
  const test = match[2]!;
  const equals = test.indexOf("=");
  const matches =
    parseRegex(test) === undefined
      ? ([key, value]: [string, string]) =>
          equals === -1
            ? key === test
            : key === test.slice(0, equals) && value === test.slice(equals + 1)
      : ([key, value]: [string, string]) => matcher(test)(`${key}=${value}`);
  const found = pairs.some(matches);
  return found !== negated;
}

export const trustedClickElement: Scriptlet = {
  name: "trusted-click-element",
  trusted: true,
  run(list = "", conditions = "", delay = "") {
    const directives = list
      .split(",")
      .map((one) => one.trim())
      .filter((one) => one !== "");
    if (directives.length === 0) return;
    const start = () => {
      if (
        !conditions
          .split(",")
          .map((one) => one.trim())
          .filter((one) => one !== "")
          .every(meets)
      ) {
        return;
      }
      const deadline = Date.now() + 10_000;
      const next = (index: number) => {
        const directive = directives[index];
        if (directive === undefined || Date.now() > deadline) return;
        if (/^\d+$/.test(directive)) {
          setTimeout(() => next(index + 1), Number(directive));
          return;
        }
        const visible = directive.startsWith("when-visible:");
        let element: Element | null;
        try {
          element = find(visible ? directive.slice(13) : directive);
        } catch {
          return;
        }
        if (element === null || (visible && !isVisible(element))) {
          // shortcut: polls; an observer would click sooner on busy pages.
          setTimeout(() => next(index), 100);
          return;
        }
        if (element instanceof HTMLElement) element.click();
        else element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        next(index + 1);
      };
      next(0);
    };
    const ms = Number(delay);
    if (ms > 0) setTimeout(start, ms);
    else start();
  },
};

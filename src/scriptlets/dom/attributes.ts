import { runAt } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import { watch } from "./watch.js";

/**
 * What `remove-attr` and `remove-class` share: act once the document is
 * interactive (or `complete`, or now with `asap`), and keep at it with
 * `stay`. `behavior` is their space-separated third argument.
 */
function cleanUp(
  selector: string,
  behavior: string,
  clean: (element: Element) => void,
  watched: readonly string[],
): void {
  const words = behavior.split(/\s+/);
  const start = () => {
    const observer = watch(selector, clean, watched);
    if (!words.includes("stay")) observer?.disconnect();
  };
  if (words.includes("asap")) start();
  else runAt(words.includes("complete") ? "complete" : "interactive", start);
}

function names(list: string): string[] {
  return list
    .split("|")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

export const removeAttr: Scriptlet = {
  name: "remove-attr",
  aliases: ["ra"],
  run(list = "", selector = "", behavior = "") {
    const attributes = names(list);
    if (attributes.length === 0) return;
    cleanUp(
      selector || attributes.map((name) => `[${name}]`).join(","),
      behavior,
      (element) => {
        for (const name of attributes) element.removeAttribute(name);
      },
      attributes,
    );
  },
};

export const removeClass: Scriptlet = {
  name: "remove-class",
  aliases: ["rc"],
  run(list = "", selector = "", behavior = "") {
    const classes = names(list);
    if (classes.length === 0) return;
    cleanUp(
      selector || classes.map((name) => `.${name}`).join(","),
      behavior,
      (element) => {
        // `classList.remove` writes the attribute even when nothing goes,
        // which the observer would see as a change, forever.
        for (const name of classes) {
          if (element.classList.contains(name)) element.classList.remove(name);
        }
      },
      ["class"],
    );
  },
};

function setAttr(
  selector = "",
  attribute = "",
  value: (element: Element) => string | null,
  watched: readonly string[],
): void {
  if (selector === "" || attribute === "") return;
  watch(
    selector,
    (element) => {
      const next = value(element);
      if (next !== null && element.getAttribute(attribute) !== next) {
        element.setAttribute(attribute, next);
      }
    },
    [attribute, ...watched],
  );
}

export const setAttrScriptlet: Scriptlet = {
  name: "set-attr",
  run(selector, attribute = "", text = "") {
    // Copying a value into an event handler would run the page's text.
    if (/^on/i.test(attribute)) return;
    const copied = /^\[([^\]]+)\]$/.exec(text)?.[1];
    if (copied !== undefined) {
      setAttr(selector, attribute, (element) => element.getAttribute(copied), [
        copied,
      ]);
      return;
    }
    const value = text === "''" ? "" : text;
    if (
      value === "" ||
      value === "true" ||
      value === "false" ||
      (/^\d+$/.test(value) && Number(value) < 32768)
    ) {
      setAttr(selector, attribute, () => value, []);
    }
  },
};

export const trustedSetAttr: Scriptlet = {
  name: "trusted-set-attr",
  trusted: true,
  run: (selector, attribute, text = "") =>
    setAttr(selector, attribute, () => text, []),
};

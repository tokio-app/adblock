import { wrapMethod } from "../helpers.js";
import type { Scriptlet } from "../types.js";

const { apply, get } = Reflect;

function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export const spoofCss: Scriptlet = {
  name: "spoof-css",
  run(selector = "", ...pairs) {
    if (selector === "" || pairs.length === 0) return;
    const Rect = DOMRect;
    const spoofed = new Map<string, string>();
    for (let i = 0; i < pairs.length; i += 2) {
      spoofed.set(camelCase(pairs[i]!), pairs[i + 1] ?? "");
    }
    const matches = (element: unknown) => {
      try {
        return element instanceof Element && element.matches(selector);
      } catch {
        return false;
      }
    };
    wrapMethod(window, "getComputedStyle", (original, _self, args) => {
      const style: CSSStyleDeclaration = original(...args);
      if (!matches(args[0])) return style;
      const getPropertyValue = (name: string) =>
        spoofed.get(camelCase(name)) ?? style.getPropertyValue(name);
      return new Proxy(style, {
        get(target, property) {
          if (property === "getPropertyValue") return getPropertyValue;
          if (typeof property === "string" && spoofed.has(camelCase(property)))
            return spoofed.get(camelCase(property));
          // The declaration's own getters and methods need it as `this`.
          const value: unknown = get(target, property, target);
          return typeof value === "function"
            ? (...inner: unknown[]) => apply(value, target, inner)
            : value;
        },
      });
    });
    wrapMethod(Element.prototype, "getBoundingClientRect", (original, self) => {
      const rect: DOMRect = original();
      if (!matches(self)) return rect;
      const pick = (current: number, ...names: string[]) => {
        for (const name of names) {
          const value = Number.parseFloat(spoofed.get(name) ?? "");
          if (!Number.isNaN(value)) return value;
        }
        return current;
      };
      return new Rect(
        pick(rect.x, "_rectx"),
        pick(rect.y, "_recty"),
        pick(rect.width, "_rectw", "width"),
        pick(rect.height, "_recth", "height"),
      );
    });
  },
};

import { matcher, wrapMethod } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import { wrapSetter } from "./util.js";

export const preventRequestAnimationFrame: Scriptlet = {
  name: "prevent-requestAnimationFrame",
  aliases: ["no-requestAnimationFrame-if", "norafif"],
  run(needle = "") {
    // Without a needle the scriptlet only logs, and there is no logger.
    if (needle === "") return;
    const matches = matcher(needle, true);
    wrapMethod(window, "requestAnimationFrame", (original, _self, args) => {
      // The page still gets a frame id it can cancel.
      if (matches(String(args[0]))) args[0] = function () {};
      return original(...args);
    });
  },
};

export const preventCanvas: Scriptlet = {
  name: "prevent-canvas",
  run(type = "") {
    // Unlike most scriptlets, no type means every kind of canvas.
    const matches = matcher(type, true);
    wrapMethod(
      HTMLCanvasElement.prototype,
      "getContext",
      (original, _self, args) =>
        matches(String(args[0])) ? null : original(...args),
    );
  },
};

export const preventInnerHtml: Scriptlet = {
  name: "prevent-innerHTML",
  run(selector = "", pattern = "") {
    // Without arguments the scriptlet only logs, and there is no logger.
    if (selector === "" && pattern === "") return;
    const matches = matcher(pattern, true);
    wrapSetter(Element.prototype, "innerHTML", (write, self, value) => {
      let target = true;
      try {
        target = selector === "" || (self as Element).matches(selector);
      } catch {
        target = false;
      }
      if (!target || !matches(String(value))) write(value);
    });
  },
};

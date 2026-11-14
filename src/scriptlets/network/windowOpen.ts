import { matcher, wrapMethod } from "../helpers.js";
import type { Scriptlet } from "../types.js";

export const preventWindowOpen: Scriptlet = {
  name: "prevent-window-open",
  aliases: ["nowoif", "no-window-open-if", "window.open-defuser"],
  run(pattern = "", delay = "", decoy = "") {
    // Unlike most scriptlets, no pattern means every call.
    const matches = matcher(pattern, true);
    const seconds = /^\d+$/.test(delay) ? Number(delay) : 0;
    const wait = setTimeout;
    wrapMethod(window, "open", (original, _self, args) => {
      if (!matches(args.map(String).join(" "))) return original(...args);
      if (decoy === "blank") return original("about:blank", ...args.slice(1));
      if (seconds === 0) return null;
      // A page that needs a window gets the one of a hidden frame, for a
      // while: nothing loads in it.
      const frame = document.createElement(
        decoy === "obj" ? "object" : "iframe",
      );
      if (frame instanceof HTMLObjectElement) frame.data = "about:blank";
      frame.style.setProperty("display", "none", "important");
      (document.body ?? document.documentElement).append(frame);
      wait(() => frame.remove(), seconds * 1000);
      return frame.contentWindow;
    });
  },
};

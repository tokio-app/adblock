import { matcher, parseRegex, runAt } from "../helpers.js";
import type { Scriptlet } from "../types.js";

const { apply } = Reflect;

export const preventRefresh: Scriptlet = {
  name: "prevent-refresh",
  aliases: ["refresh-defuser"],
  run(seconds = "") {
    const stop = window.stop;
    // A refresh counts its delay from the end of the load, and stopping
    // only cancels a navigation already under way: stop just after it.
    runAt("complete", () => {
      const content = document
        .querySelector('meta[http-equiv="refresh" i]')
        ?.getAttribute("content");
      const delay = Number.parseFloat(seconds || (content ?? ""));
      if (!(delay >= 0)) return;
      setTimeout(() => apply(stop, window, []), delay * 1000 + 50);
    });
  },
};

export const disableNewtabLinks: Scriptlet = {
  name: "disable-newtab-links",
  run() {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const link = target.closest("a[target]");
        // These open in the same tab.
        if (
          link === null ||
          /^(?:|_self|_parent|_top)$/i.test(link.getAttribute("target") ?? "")
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
  },
};

export const closeWindow: Scriptlet = {
  name: "close-window",
  aliases: ["window-close-if"],
  run(needle = "") {
    // In a browser this closes a tab a page opened. Here a window no page
    // opened is the host app's own, and a filter must not close that.
    if (!window.opener || window.top !== window) return;
    // A regex reads the whole URL, text the path and query.
    const subject =
      parseRegex(needle) === undefined
        ? location.pathname + location.search
        : location.href;
    if (matcher(needle)(subject)) window.close();
  },
};

export const windowNameDefuser: Scriptlet = {
  name: "window.name-defuser",
  run() {
    window.name = "";
  },
};

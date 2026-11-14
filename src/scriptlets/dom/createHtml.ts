import { runAt } from "../helpers.js";
import type { Scriptlet } from "../types.js";

export const trustedCreateHtml: Scriptlet = {
  name: "trusted-create-html",
  aliases: ["trusted-create-HTML"],
  trusted: true,
  run(parent = "", html = "", duration = "") {
    if (parent === "" || html === "") return;
    // The parent is often one the parser hasn't reached when this runs.
    runAt("interactive", () => {
      const target = document.querySelector(parent);
      if (target === null) return;
      const parsed = new DOMParser().parseFromString(html, "text/html");
      // A lone `<style>` or `<meta>` lands in the head.
      const nodes = [...parsed.head.childNodes, ...parsed.body.childNodes];
      target.append(...nodes);
      const ms = Number(duration);
      if (ms > 0) {
        setTimeout(() => {
          for (const node of nodes) node.parentNode?.removeChild(node);
        }, ms);
      }
    });
  },
};

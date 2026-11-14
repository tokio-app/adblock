import { matcher, parseRegex, tokens } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import { isOn } from "./cookies.js";

const { apply } = Reflect;
const replace = String.prototype.replace;
// There is no Node when the main process loads this file for the names.
const textContent =
  typeof Node === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(Node.prototype, "textContent");

/**
 * Edits the text of the nodes named `nodeName` (`#text`, `script`…) as the
 * document gets them. `edit` returns the new text, or undefined to leave
 * it. Quits at `DOMContentLoaded`, `quitAfter` ms after it, after
 * `sedCount` edits, or never with `stay`.
 */
function editNodes(
  nodeName: string,
  options: Record<string, string | undefined>,
  edit: (text: string) => string | undefined,
): void {
  const wanted = nodeName.toLowerCase();
  if (wanted === "") return;
  // `condition` is what the wiki's examples call `includes`.
  const includes = matcher(options.includes ?? options.condition);
  const excludes =
    options.excludes === undefined ? () => false : matcher(options.excludes);
  let left = Number(options.sedCount) || 0;
  let done = false;
  const handle = (node: Node) => {
    if (done || node.nodeName.toLowerCase() !== wanted) return;
    const text = String(apply(textContent!.get!, node, []));
    if (!includes(text) || excludes(text)) return;
    const next = edit(text);
    if (next === undefined || next === text) return;
    apply(textContent!.set!, node, [next]);
    if (left > 0 && --left === 0) quit();
  };
  const visit = (node: Node) => {
    // The parser adds a script's text after the script itself.
    if (node.nodeType === Node.TEXT_NODE && node.parentNode !== null) {
      handle(node.parentNode);
    }
    handle(node);
    if (!node.hasChildNodes()) return;
    const walker = document.createTreeWalker(
      node,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    const found: Node[] = [];
    while (walker.nextNode() !== null) found.push(walker.currentNode);
    for (const one of found) handle(one);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) visit(node);
    }
    // What changed in there is our own editing.
    observer.takeRecords();
  });
  const quit = () => {
    done = true;
    observer.disconnect();
  };
  visit(document);
  if (done) return;
  observer.observe(document, { childList: true, subtree: true });
  if (isOn(options.stay)) return;
  const delay = Number(options.quitAfter) || 0;
  const later = () => (delay > 0 ? setTimeout(quit, delay) : quit());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", later, { once: true });
  } else later();
}

export const removeNodeText: Scriptlet = {
  name: "remove-node-text",
  aliases: ["rmnt"],
  run(...args) {
    const [nodeName = "", needle = ""] = args;
    const matches = matcher(needle);
    editNodes(nodeName, tokens(args, 2), (text) =>
      matches(text) ? "" : undefined,
    );
  },
};

export const trustedReplaceNodeText: Scriptlet = {
  name: "trusted-replace-node-text",
  aliases: ["trusted-rpnt", "replace-node-text", "rpnt"],
  trusted: true,
  run(...args) {
    const [nodeName = "", needle = "", replacement = ""] = args;
    if (needle === "") return;
    const pattern = parseRegex(needle) ?? needle;
    editNodes(nodeName, tokens(args, 3), (text) =>
      String(apply(replace, text, [pattern, replacement])),
    );
  },
};

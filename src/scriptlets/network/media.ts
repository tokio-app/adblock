import { matcher, parseRegex } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import { editFetchResponses, type TextEdit } from "./fetch.js";
import { editXhrResponses } from "./xhr.js";

/** Applies a text edit to the fetch and xhr responses from URLs that match. */
function onResponses(url: string, edit: TextEdit): void {
  const urlMatches = matcher(url);
  const matches = (details: Record<string, unknown>) =>
    urlMatches(String(details.url));
  editFetchResponses(matches, edit);
  editXhrResponses(matches, edit);
}

/** The nodes a CSS selector or an `xpath(…)` finds in a document. */
function finder(query: string): (document: Document) => Node[] {
  const xpath = /^xpath\((.+)\)$/s.exec(query);
  if (xpath === null)
    return (document) => [...document.querySelectorAll(query)];
  return (document) => {
    const found = document.evaluate(
      xpath[1]!,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const nodes: Node[] = [];
    for (let i = 0; i < found.snapshotLength; i++)
      nodes.push(found.snapshotItem(i)!);
    return nodes;
  };
}

export const xmlPrune: Scriptlet = {
  name: "xml-prune",
  run(selector = "", needle = "", url = "") {
    if (selector === "") return;
    const find = finder(selector);
    const required = needle === "" ? undefined : finder(needle);
    const Parser = DOMParser;
    const Serializer = XMLSerializer;
    onResponses(url, (text) => {
      if (!text.trimStart().startsWith("<")) return undefined;
      const document = new Parser().parseFromString(text, "text/xml");
      if (document.getElementsByTagName("parsererror").length > 0)
        return undefined;
      if (required !== undefined && required(document).length === 0)
        return undefined;
      const nodes = find(document);
      if (nodes.length === 0) return undefined;
      for (const node of nodes) {
        if (node instanceof Attr) node.ownerElement?.removeAttributeNode(node);
        else node.parentNode?.removeChild(node);
      }
      return new Serializer().serializeToString(document);
    });
  },
};

/** Removes the lines that match, a segment's #EXTINF line with its URL. */
function pruneLines(text: string, matches: (line: string) => boolean): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!matches(line)) kept.push(line);
    else if (line.startsWith("#EXTINF")) i++;
    else if (!line.startsWith("#") && kept.at(-1)?.startsWith("#EXTINF")) {
      kept.pop();
    }
  }
  return kept.join("\n");
}

/** Removes what a multiline regex matches, where it is whole lines. */
function pruneMatches(text: string, regex: RegExp): string {
  const global = new RegExp(regex.source, regex.flags.replace("g", "") + "g");
  return text.replace(global, (match: string, ...rest: unknown[]) => {
    const start = rest.find((one) => typeof one === "number")!;
    const end = start + match.length;
    const whole =
      (start === 0 || text[start - 1] === "\n") &&
      (end === text.length || text[end] === "\n" || match.endsWith("\n"));
    return whole ? "" : match;
  });
}

export const m3uPrune: Scriptlet = {
  name: "m3u-prune",
  run(needle = "", url = "") {
    if (needle === "") return;
    const regex = parseRegex(needle);
    const matches = matcher(needle);
    onResponses(url, (text) => {
      if (!text.trimStart().startsWith("#EXTM3U")) return undefined;
      const next =
        regex?.multiline === true
          ? pruneMatches(text, regex)
          : pruneLines(text, matches);
      return next === text ? undefined : next;
    });
  },
};

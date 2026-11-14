import { parseHostList } from "./hosts.js";
import { compileSelector } from "./selector.js";
import type {
  CosmeticRule,
  HostList,
  NotARule,
  ParseContext,
  Rule,
} from "./types.js";

// hostnames, then ##, #@#, #?#, #@?#, AdGuard's #$#, #@$#, #$?#, #@$?# (CSS)
// and #%#, #@%# (JavaScript), then the body.
const MARKER = /^([^#]*?)(#@?(?:\$\?|\$|\?|%)?#)(.+)$/s;

// The headers `##^responseheader()` may remove: never one that protects the
// page, like `content-security-policy`.
const REMOVABLE_HEADERS = new Set([
  "location",
  "refresh",
  "report-to",
  "set-cookie",
]);

export interface CosmeticParts {
  hosts: HostList;
  marker: string;
  body: string;
}

/**
 * Splits `hostnames##body`. Undefined when the line isn't an extended filter:
 * no marker, or what precedes it isn't a list of hostnames.
 */
export function splitCosmetic(line: string): CosmeticParts | undefined {
  if (!line.includes("#")) return undefined;
  const match = MARKER.exec(line);
  if (match === null) return undefined;
  const prefix = match[1]!.trim();
  const hosts =
    prefix === ""
      ? { include: [], exclude: [] }
      : parseHostList(prefix, ",", true);
  if (hosts === undefined) return undefined;
  return { hosts, marker: match[2]!, body: match[3]!.trim() };
}

/**
 * Splits a scriptlet's `name, arg, arg`. A comma inside an argument is
 * escaped (`\,`) or the argument is quoted, with `'`, `"` or a backtick.
 */
export function parseScriptletArgs(text: string): string[] {
  const args: string[] = [];
  let i = 0;
  for (;;) {
    while (text[i] === " ") i++;
    const quote = text[i];
    let end = -1;
    let next = -1;
    if (quote === '"' || quote === "'" || quote === "`") {
      for (let k = i + 1; k < text.length && end === -1; k++) {
        if (text[k] === "\\") k++;
        else if (text[k] === quote) {
          let after = k + 1;
          while (text[after] === " ") after++;
          if (after >= text.length || text[after] === ",") {
            end = k;
            next = after + 1;
          }
        }
      }
    }
    if (end !== -1) {
      args.push(text.slice(i + 1, end).replaceAll(`\\${quote}`, quote!));
      if (next > text.length) break;
      i = next;
      continue;
    }
    let arg = "";
    let k = i;
    for (; k < text.length && text[k] !== ","; k++) {
      if (text[k] === "\\" && text[k + 1] === ",") k++;
      arg += text[k];
    }
    args.push(arg.trim());
    if (k >= text.length) break;
    i = k + 1;
  }
  return args;
}

const invalid = (reason: string): NotARule => ({ kind: "invalid", reason });
const unsupported = (reason: string): NotARule => ({
  kind: "unsupported",
  reason,
});

/**
 * Parses an extended filter: cosmetic, scriptlet or HTML. A selector list with
 * procedural parts gives several cosmetic rules.
 */
export function parseCosmeticFilter(
  line: string,
  parts: CosmeticParts,
  context: ParseContext,
): Rule | NotARule | CosmeticRule[] {
  const { hosts, marker } = parts;
  let { body } = parts;
  const exception = marker[1] === "@";
  const specific = hosts.include.length > 0;
  if (marker.includes("%")) {
    // AdGuard's way to write a scriptlet: `#%#//scriptlet('name', 'arg')`.
    const scriptlet = /^\/\/scriptlet\((.*)\)$/s.exec(body);
    if (scriptlet === null) return unsupported("AdGuard JavaScript rule");
    body = `+js(${scriptlet[1]})`;
  }
  // `selector { declarations }`: AdGuard's CSS rules (`#$#`), which EasyList
  // writes with `##` too.
  const css = /^(.*?)\s*\{\s*(.*?)\s*\}$/s.exec(body);
  if (css !== null) {
    body = /^remove\s*:\s*true\s*;?$/i.test(css[2]!)
      ? `${css[1]}:remove()`
      : `${css[1]}:style(${css[2]})`;
  } else if (marker.includes("$")) {
    return unsupported("Adblock Plus snippet");
  }

  if (body.startsWith("+js(") && body.endsWith(")")) {
    const [token = "", ...args] = parseScriptletArgs(body.slice(4, -1));
    const name = token.endsWith(".js") ? token.slice(0, -3) : token;
    if (!exception) {
      if (name === "") return invalid("scriptlet without a name");
      if (!specific) return invalid("generic scriptlet");
    }
    return {
      kind: "scriptlet",
      raw: line,
      exception,
      hosts,
      name,
      args: name === "" ? [] : args,
      trusted: context.trusted,
    };
  }

  if (body.startsWith("^")) {
    const header = /^\^responseheader\((.*)\)$/.exec(body);
    if (header === null) {
      return unsupported(
        "HTML filter (Electron can't rewrite response bodies)",
      );
    }
    const name = header[1]!.trim().toLowerCase();
    if (!REMOVABLE_HEADERS.has(name)) {
      return invalid("responseheader() of a header that can't be removed");
    }
    if (!specific && !exception) return invalid("generic responseheader()");
    return {
      kind: "responseheader",
      raw: line,
      exception,
      hosts,
      header: name,
    };
  }

  const compiled = compileSelector(body, marker.includes("?"));
  if (typeof compiled === "string") return invalid(`selector: ${compiled}`);
  const plain = compiled.every(
    (one) =>
      one.procedural === undefined &&
      one.style === undefined &&
      one.media === undefined,
  );
  if (!plain && !specific && !exception) {
    return invalid("generic procedural or :style() filter");
  }
  return compiled.map((one) => ({
    kind: "cosmetic",
    raw: line,
    exception,
    hosts,
    key: body,
    selector: one.selector,
    style: one.style,
    media: one.media,
    procedural: one.procedural,
  }));
}

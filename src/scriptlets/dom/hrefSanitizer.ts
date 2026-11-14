import { parseRegex } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import { watch } from "./watch.js";

function queryOf(text: string): URLSearchParams | undefined {
  const query = text.indexOf("?");
  if (query === -1) return undefined;
  const hash = text.indexOf("#", query);
  return new URLSearchParams(
    text.slice(query + 1, hash === -1 ? undefined : hash),
  );
}

function decodeBase64(text: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(text), (char) => char.charCodeAt(0)),
  );
}

/**
 * One `urlskip=` step (Static filter syntax) applied to the text, or
 * undefined when it can't be.
 */
function step(text: string, directive: string): string | undefined {
  if (directive.startsWith("?"))
    return queryOf(text)?.get(directive.slice(1)) ?? undefined;
  if (directive.startsWith("&")) {
    return [...(queryOf(text)?.keys() ?? [])][Number(directive.slice(1)) - 1];
  }
  if (directive === "#") {
    const hash = text.indexOf("#");
    return hash === -1 ? undefined : text.slice(hash + 1);
  }
  if (directive === "+https") {
    return /^https?:\/\//i.test(text)
      ? text.replace(/^http:/i, "https:")
      : `https://${text}`;
  }
  if (directive === "-base64") return decodeBase64(text);
  if (directive === "-safebase64") {
    return decodeBase64(text.replaceAll("-", "+").replaceAll("_", "/"));
  }
  if (directive === "-uricomponent") return decodeURIComponent(text);
  return parseRegex(directive)?.exec(text)?.[1];
}

/** Applies the steps in turn: undefined when one fails or gives nothing. */
function skip(text: string, steps: readonly string[]): string | undefined {
  let current: string | undefined = text;
  for (const directive of steps) {
    try {
      current = step(current, directive);
    } catch {
      return undefined;
    }
    if (current === undefined || current === "") return undefined;
  }
  return current;
}

export const hrefSanitizer: Scriptlet = {
  name: "href-sanitizer",
  run(selector = "", source = "") {
    if (selector === "") return;
    // A `/regex/` step may hold spaces; `?a?b` is `?a ?b`.
    const steps = (
      source.match(/\/(?:\\.|[^\\])+?\/(?=\s|$)|\S+/g) ?? []
    ).flatMap((one) =>
      /^\?[^?]+\?/.test(one)
        ? one
            .split("?")
            .filter((name) => name !== "")
            .map((name) => `?${name}`)
        : [one],
    );
    const attribute = /^\[(.+)\]$/.exec(steps[0] ?? "")?.[1];
    if (attribute !== undefined) steps.shift();
    watch(
      selector,
      (element) => {
        const href = element.getAttribute("href");
        if (element.localName !== "a" || href === null) return;
        // The steps unwrap the link's own URL, unless something else is named.
        const start =
          attribute !== undefined
            ? element.getAttribute(attribute)
            : steps.length > 0
              ? href
              : (element.textContent ?? "").trim();
        const url = start === null ? undefined : skip(start, steps);
        if (
          url === undefined ||
          url === href ||
          !/^https?:\/\//i.test(url) ||
          !URL.canParse(url)
        ) {
          return;
        }
        element.setAttribute("href", url);
      },
      attribute === undefined ? ["href"] : ["href", attribute],
    );
  },
};

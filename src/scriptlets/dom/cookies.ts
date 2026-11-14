import { matcher, parseRegex, tokens } from "../helpers.js";
import type { Scriptlet } from "../types.js";

const { apply } = Reflect;
// The page may replace `document.cookie` with its own accessor. (There is
// no Document when the main process loads this file for the names.)
const cookieAccessor =
  typeof Document === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(Document.prototype, "cookie");

/** The page's cookies, as name and value pairs. */
export function readCookies(): [string, string][] {
  return String(apply(cookieAccessor!.get!, document, []))
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair !== "")
    .map((pair): [string, string] => {
      const equals = pair.indexOf("=");
      return equals === -1
        ? ["", pair]
        : [pair.slice(0, equals), pair.slice(equals + 1)];
    });
}

function writeCookie(text: string): void {
  apply(cookieAccessor!.set!, document, [text]);
}

/** The value of a cookie, or undefined when the page has none by that name. */
function cookieValue(name: string): string | undefined {
  return readCookies().find(([one]) => one === name)?.[1];
}

/** Whether a token like `reload, 1` is on. */
export function isOn(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0";
}

/** `$now$`, `$currentDate$` and `$currentISODate$`, anywhere in the text. */
export function withDates(text: string): string {
  return text
    .replaceAll("$now$", String(Date.now()))
    .replaceAll("$currentDate$", String(new Date()))
    .replaceAll("$currentISODate$", new Date().toISOString());
}

const SAFE_COOKIE_VALUES = new Set(
  (
    "accept reject accepted rejected notaccepted allow disallow deny allowed " +
    "denied approved disapproved checked unchecked dismiss dismissed enable " +
    "disable enabled disabled essential nonessential forbidden forever hide " +
    "hidden necessary required ok on off true t false f yes y no n all none " +
    "functional granted done decline declined closed next mandatory " +
    "disagree agree"
  ).split(" "),
);

/** One of the values `set-cookie` may set: a small integer or a constant in any case. */
export function isSafeCookieValue(value: string): boolean {
  if (/^-?\d+$/.test(value)) return Math.abs(Number(value)) <= 32767;
  return SAFE_COOKIE_VALUES.has(value.toLowerCase());
}

/** The value inside double quotes, or the value itself. */
export function unquoted(value: string): string {
  return /^"(.*)"$/s.exec(value)?.[1] ?? value;
}

const EXPIRED = "; expires=Thu, 01 Jan 1970 00:00:00 GMT";

function secure(name: string): string {
  return /^__(?:Secure|Host)-/.test(name) ? "; secure" : "";
}

function removeCookies(needle: string | undefined): void {
  const matches = matcher(needle);
  const host = location.hostname;
  const domains = ["", `; domain=${host}`];
  if (host.startsWith("www.")) domains.push(`; domain=${host.slice(4)}`);
  // Every path a cookie the page sees can have: the prefixes of its own.
  const paths = ["/"];
  let path = "";
  for (const part of location.pathname.split("/").slice(1)) {
    if (part === "") continue;
    path += `/${part}`;
    paths.push(path);
  }
  for (const [name] of readCookies()) {
    if (name === "" || !matches(name)) continue;
    for (const domain of domains) {
      for (const one of paths) {
        writeCookie(`${name}=${EXPIRED}; path=${one}${domain}${secure(name)}`);
      }
    }
  }
}

export const removeCookie: Scriptlet = {
  name: "remove-cookie",
  aliases: ["cookie-remover"],
  run(...args) {
    const [needle] = args;
    const when = tokens(args, 1).when;
    const remove = () => {
      try {
        removeCookies(needle);
      } catch {
        // No cookies here (a sandboxed frame).
      }
    };
    remove();
    addEventListener("load", remove);
    addEventListener("beforeunload", remove);
    let pending = false;
    for (const type of (when ?? "").split(/\s+/)) {
      if (type !== "scroll" && type !== "keydown") continue;
      addEventListener(
        type,
        () => {
          if (pending) return;
          pending = true;
          setTimeout(() => {
            pending = false;
            remove();
          }, 500);
        },
        { capture: true, passive: true },
      );
    }
  },
};

/** `path` argument: `/` (the default) or `none`. Undefined for anything else. */
function pathAttribute(path = ""): string | undefined {
  if (path === "" || path === "/") return "; path=/";
  return path === "none" ? "" : undefined;
}

/**
 * Sets a cookie, then reloads the page when `reload` is on and the cookie
 * wasn't there with that value before. It reloads only once the cookie
 * reads back, so a page that refuses the cookie doesn't reload forever.
 */
function putCookie(
  name: string,
  value: string,
  attributes: string,
  options: Record<string, string | undefined>,
  reload: boolean,
): void {
  const before = cookieValue(name);
  if (before !== undefined && isOn(options.dontOverwrite)) return;
  writeCookie(`${name}=${value}${attributes}${secure(name)}`);
  // `history.go(0)` reloads, like `location.reload()`, and tests can stub it.
  if (reload && before !== value && cookieValue(name) === value) history.go(0);
}

function setCookie(args: string[], reload: boolean): void {
  const [name = "", raw = "", path] = args;
  const value = unquoted(raw);
  const attributes = pathAttribute(path);
  if (name === "" || !isSafeCookieValue(value) || attributes === undefined)
    return;
  const options = tokens(args, 3);
  const encoded =
    value === raw
      ? encodeURIComponent(value)
      : `"${encodeURIComponent(value)}"`;
  putCookie(
    encodeURIComponent(name),
    encoded,
    attributes,
    options,
    reload || isOn(options.reload),
  );
}

const DAY = 86_400;

function trustedSetCookie(args: string[], reload: boolean): void {
  const [name = "", raw = "", offset = "", path] = args;
  let attributes = pathAttribute(path);
  if (name === "" || attributes === undefined) return;
  if (offset !== "") {
    const seconds =
      offset === "1year"
        ? 365 * DAY
        : offset === "1day"
          ? DAY
          : /^\d+$/.test(offset)
            ? Number(offset)
            : undefined;
    if (seconds === undefined) return;
    attributes += `; max-age=${seconds}`;
  }
  const options = tokens(args, 4);
  if (options.domain !== undefined && options.domain !== "") {
    const regex = parseRegex(options.domain);
    const domain =
      regex === undefined ? options.domain : regex.exec(location.hostname)?.[0];
    if (domain === undefined) return;
    attributes += `; domain=${domain}`;
  }
  putCookie(
    name,
    withDates(raw),
    attributes,
    options,
    reload || isOn(options.reload),
  );
}

export const setCookieScriptlet: Scriptlet = {
  name: "set-cookie",
  run: (...args) => setCookie(args, false),
};

export const setCookieReload: Scriptlet = {
  name: "set-cookie-reload",
  run: (...args) => setCookie(args, true),
};

export const trustedSetCookieScriptlet: Scriptlet = {
  name: "trusted-set-cookie",
  trusted: true,
  run: (...args) => trustedSetCookie(args, false),
};

export const trustedSetCookieReload: Scriptlet = {
  name: "trusted-set-cookie-reload",
  trusted: true,
  run: (...args) => trustedSetCookie(args, true),
};

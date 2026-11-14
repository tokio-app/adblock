import type { Scriptlet } from "../types.js";
import { isSafeCookieValue, unquoted, withDates } from "./cookies.js";

type Area = "localStorage" | "sessionStorage";

/**
 * One of the values `set-local-storage-item` may set, as stored, or
 * undefined. Double quotes around an allowed value stay in what is stored.
 */
function safeValue(text: string): string | undefined {
  if (text === "''") return "";
  if (["undefined", "null", "{}", "[]", '""'].includes(text)) return text;
  return isSafeCookieValue(unquoted(text)) ? text : undefined;
}

function trustedValue(text: string): string {
  return text === "''" ? "" : withDates(text);
}

function setItem(
  area: Area,
  key = "",
  raw = "",
  parse: (text: string) => string | undefined,
): void {
  if (key === "") return;
  const value = raw === "$remove$" ? null : parse(raw);
  if (value === undefined) return;
  try {
    const storage = window[area];
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // No storage here, or it is full.
  }
}

export const setLocalStorageItem: Scriptlet = {
  name: "set-local-storage-item",
  run: (key, value) => setItem("localStorage", key, value, safeValue),
};

export const setSessionStorageItem: Scriptlet = {
  name: "set-session-storage-item",
  run: (key, value) => setItem("sessionStorage", key, value, safeValue),
};

export const trustedSetLocalStorageItem: Scriptlet = {
  name: "trusted-set-local-storage-item",
  trusted: true,
  run: (key, value) => setItem("localStorage", key, value, trustedValue),
};

export const trustedSetSessionStorageItem: Scriptlet = {
  name: "trusted-set-session-storage-item",
  trusted: true,
  run: (key, value) => setItem("sessionStorage", key, value, trustedValue),
};

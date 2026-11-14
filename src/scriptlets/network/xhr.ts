import { wrapMethod } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import type { TextEdit } from "./fetch.js";
import {
  absolute,
  requestMatcher,
  responseBody,
  type Details,
} from "./request.js";
import { wrapGetter } from "./util.js";

const { apply } = Reflect;
const { parse, stringify } = JSON;
const kind = Object.prototype.toString;
const later = queueMicrotask;

// What defused requests read, by property, in place of the browser's.
const faked = new WeakMap<object, Record<string, unknown>>();
let fakes = false;

/**
 * Watches `open()`: the map holds what each request that matches asked
 * for, until it is opened again.
 */
function watchOpens(
  matches: (details: Details) => boolean,
): WeakMap<object, Details> {
  const matched = new WeakMap<object, Details>();
  wrapMethod(XMLHttpRequest.prototype, "open", (original, self, args) => {
    const [method, url, async] = args;
    const details: Details = {
      method: String(method),
      url: absolute(url),
      async: args.length < 3 || Boolean(async),
    };
    faked.delete(self as object);
    if (matches(details)) matched.set(self as object, details);
    else matched.delete(self as object);
    return original(...args);
  });
  return matched;
}

/** Hands the text of each response that matches to `edit`. */
export function editXhrResponses(
  matches: (details: Details) => boolean,
  edit: TextEdit,
): void {
  if (typeof XMLHttpRequest !== "function") return;
  const matched = watchOpens(matches);
  const readyState = Object.getOwnPropertyDescriptor(
    XMLHttpRequest.prototype,
    "readyState",
  )?.get;
  // The edit runs once per response, on its first read.
  const cache = new WeakMap<object, { source: unknown; result: unknown }>();
  const edited = (self: object, source: unknown): unknown => {
    const cached = cache.get(self);
    if (cached !== undefined && cached.source === source) return cached.result;
    let result = source;
    try {
      if (typeof source === "string") result = edit(source) ?? source;
      else if (
        Array.isArray(source) ||
        apply(kind, source, []) === "[object Object]"
      ) {
        // A `json` response: the edit works on its text.
        const text = edit(stringify(source));
        if (text !== undefined) result = parse(text);
      }
    } catch {
      result = source;
    }
    cache.set(self, { source, result });
    return result;
  };
  for (const name of ["response", "responseText"]) {
    wrapGetter(XMLHttpRequest.prototype, name, (read, self) => {
      const value = read();
      return matched.has(self as object) &&
        readyState !== undefined &&
        apply(readyState, self, []) === 4
        ? edited(self as object, value)
        : value;
    });
  }
}

/** Hands the text body of each request that matches to `edit`. */
export function editXhrRequests(
  matches: (details: Details) => boolean,
  edit: TextEdit,
): void {
  if (typeof XMLHttpRequest !== "function") return;
  const matched = watchOpens(matches);
  wrapMethod(XMLHttpRequest.prototype, "send", (original, self, args) => {
    if (matched.has(self as object) && typeof args[0] === "string") {
      try {
        args[0] = edit(args[0]) ?? args[0];
      } catch {
        // The body stays as the page wrote it.
      }
    }
    return original(...args);
  });
}

function fakeGetters(): void {
  if (fakes) return;
  fakes = true;
  for (const name of [
    "readyState",
    "status",
    "statusText",
    "responseURL",
    "response",
    "responseText",
  ]) {
    wrapGetter(XMLHttpRequest.prototype, name, (read, self) => {
      const fake = faked.get(self as object);
      return fake === undefined ? read() : fake[name];
    });
  }
}

function typed(body: string, type: string): unknown {
  switch (type) {
    case "json":
      try {
        return parse(body);
      } catch {
        return null;
      }
    case "arraybuffer":
      return new TextEncoder().encode(body).buffer;
    case "blob":
      return new Blob([body]);
    case "document":
      return null;
  }
  return body;
}

function preventXhr(args: string[], trusted: boolean): void {
  // Without arguments the scriptlet only logs, and there is no logger.
  if (args.every((arg) => arg === "")) return;
  if (typeof XMLHttpRequest !== "function") return;
  const [props = "", directive = ""] = args;
  const answer = responseBody(directive, trusted);
  const matched = watchOpens(requestMatcher(props, true));
  fakeGetters();
  const dispatch = EventTarget.prototype.dispatchEvent;
  const NativeEvent = Event;
  const NativeProgressEvent = ProgressEvent;
  wrapMethod(XMLHttpRequest.prototype, "send", (original, self, callArgs) => {
    const details = matched.get(self as object);
    if (details === undefined) return original(...callArgs);
    // Nothing goes out: the request answers with the directive's body.
    const xhr = self as XMLHttpRequest;
    const finish = () => {
      const body = answer();
      faked.set(xhr, {
        readyState: 4,
        status: 200,
        statusText: "OK",
        responseURL: details.url,
        responseText: body,
        response: typed(body, xhr.responseType),
      });
      apply(dispatch, xhr, [new NativeEvent("readystatechange")]);
      for (const type of ["load", "loadend"]) {
        apply(dispatch, xhr, [new NativeProgressEvent(type)]);
      }
    };
    if (details.async) later(finish);
    else finish();
    return undefined;
  });
}

export const preventXhrScriptlet: Scriptlet = {
  name: "prevent-xhr",
  aliases: ["no-xhr-if"],
  run: (...args) => preventXhr(args, false),
};

export const trustedPreventXhr: Scriptlet = {
  name: "trusted-prevent-xhr",
  trusted: true,
  run: (...args) => preventXhr(args, true),
};

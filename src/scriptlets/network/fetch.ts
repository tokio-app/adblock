import { wrapMethod } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import {
  fetchDetails,
  requestMatcher,
  responseBody,
  type Details,
} from "./request.js";
import { isObject } from "./util.js";

const { apply } = Reflect;
const { defineProperties } = Object;
const NativePromise = Promise;
const then = Promise.prototype.then;

/** A change to a body's text: the new text, or undefined to keep it. */
export type TextEdit = (text: string) => string | undefined;

function tryEdit(edit: TextEdit, text: string): string | undefined {
  try {
    return edit(text);
  } catch {
    return undefined;
  }
}

/** A Response with `body` and what the page reads of `like`. */
function responseLike(
  NativeResponse: typeof Response,
  like: Record<string, unknown>,
  body: string,
): Response | undefined {
  try {
    const response = new NativeResponse(body, {
      status: like.status as number,
      statusText: like.statusText as string,
      headers: like.headers as HeadersInit | undefined,
    });
    // The constructor can't set these: they shadow the prototype's.
    const own: PropertyDescriptorMap = {};
    for (const name of ["url", "type", "redirected", "ok"]) {
      if (name in like) own[name] = { value: like[name], configurable: true };
    }
    defineProperties(response, own);
    return response;
  } catch {
    return undefined;
  }
}

/** Hands the body of each fetch response that matches to `edit`. */
export function editFetchResponses(
  matches: (details: Details) => boolean,
  edit: TextEdit,
): void {
  if (typeof Response !== "function") return;
  const NativeResponse = Response;
  const { clone, text } = Response.prototype;
  wrapMethod(window, "fetch", (original, _self, args) => {
    const result: Promise<Response> = original(...args);
    if (!matches(fetchDetails(args))) return result;
    return apply(then, result, [
      (response: Response) =>
        apply(then, apply(text, apply(clone, response, []), []), [
          (body: string) => {
            const edited = tryEdit(edit, body);
            if (edited === undefined) return response;
            const { status, statusText, headers, url, type, redirected } =
              response;
            return (
              responseLike(
                NativeResponse,
                { status, statusText, headers, url, type, redirected },
                edited,
              ) ?? response
            );
          },
          () => response,
        ]),
    ]);
  });
}

/** Hands the text body of each fetch request that matches to `edit`. */
export function editFetchRequests(
  matches: (details: Details) => boolean,
  edit: TextEdit,
): void {
  const NativeRequest = typeof Request === "function" ? Request : undefined;
  const { clone, text } = NativeRequest?.prototype ?? {};
  wrapMethod(window, "fetch", (original, _self, args) => {
    const [input, init] = args;
    if (!matches(fetchDetails(args))) return original(...args);
    if (isObject(init) && typeof init.body === "string") {
      const edited = tryEdit(edit, init.body);
      if (edited !== undefined)
        return original(input, { ...init, body: edited });
    } else if (
      NativeRequest !== undefined &&
      input instanceof NativeRequest &&
      input.body !== null
    ) {
      // The body of a Request can only be read asynchronously.
      return apply(then, apply(text!, apply(clone!, input, []), []), [
        (body: string) => {
          const edited = tryEdit(edit, body);
          return edited === undefined
            ? original(...args)
            : original(new NativeRequest(input, { body: edited }), init);
        },
        () => original(...args),
      ]);
    }
    return original(...args);
  });
}

const TYPES = new Set(["basic", "cors", "default", "error", "opaque"]);
const STATUS_TEXTS = new Set(["", "Not Found", "OK"]);

/** The `ok`, `type` and `statusText` a defused response gets. */
function responseProps(text: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  let given: unknown = text;
  try {
    if (text.startsWith("{")) given = JSON.parse(text);
  } catch {
    return props;
  }
  if (typeof given === "string") given = { type: given };
  if (!isObject(given)) return props;
  if (typeof given.ok === "boolean") props.ok = given.ok;
  if (TYPES.has(given.type as string)) props.type = given.type;
  if (STATUS_TEXTS.has(given.statusText as string)) {
    props.statusText = given.statusText;
  }
  return props;
}

function preventFetch(args: string[], trusted: boolean): void {
  // Without arguments the scriptlet only logs, and there is no logger.
  if (args.every((arg) => arg === "")) return;
  const [props = "", directive = "", responseType = ""] = args;
  const matches = requestMatcher(props, true);
  const extra = responseProps(responseType);
  const body = responseBody(directive, trusted);
  if (typeof Response !== "function") return;
  const NativeResponse = Response;
  wrapMethod(window, "fetch", (original, _self, callArgs) => {
    const details = fetchDetails(callArgs);
    if (!matches(details)) return original(...callArgs);
    const response = responseLike(
      NativeResponse,
      { status: 200, statusText: "OK", url: details.url, ...extra },
      body(),
    );
    return new NativePromise((resolve) => resolve(response));
  });
}

export const preventFetchScriptlet: Scriptlet = {
  name: "prevent-fetch",
  aliases: ["no-fetch-if"],
  run: (...args) => preventFetch(args, false),
};

export const trustedPreventFetch: Scriptlet = {
  name: "trusted-prevent-fetch",
  trusted: true,
  run: (...args) => preventFetch(args, true),
};

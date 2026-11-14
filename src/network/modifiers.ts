import { tryRegex } from "../util.js";

// What a document's response gets for `inline-script` and `inline-font`: a
// policy that leaves out `'unsafe-inline'` and `data:`.
export const INLINE_SCRIPT_CSP = "script-src 'unsafe-eval' * blob: data:";
export const INLINE_FONT_CSP = "font-src *";

const REGEX_VALUE = /^\/(.+)\/([a-z]*)$/;

/** Whether one `removeparam=` value removes a `name=value` parameter. */
function removesParam(value: string, param: string): boolean {
  if (value === "") return true;
  const negated = value.startsWith("~");
  if (negated) value = value.slice(1);
  const regex = REGEX_VALUE.exec(value);
  let matches: boolean;
  if (regex === null) {
    const equals = param.indexOf("=");
    matches = (equals === -1 ? param : param.slice(0, equals)) === value;
  } else {
    matches = tryRegex(regex[1]!, regex[2])?.test(param) === true;
  }
  return matches !== negated;
}

/**
 * Applies `removeparam=` values to a URL: a name removes that parameter, a
 * `/regex/` the parameters whose `name=value` it matches, `~` what doesn't
 * match, and an empty value all of them. Returns the URL as given when
 * nothing was removed.
 */
export function removeParams(url: string, values: readonly string[]): string {
  const hash = url.indexOf("#");
  const base = hash === -1 ? url : url.slice(0, hash);
  const query = base.indexOf("?");
  if (query === -1 || values.length === 0) return url;
  const params = base.slice(query + 1).split("&");
  const kept = params.filter(
    (param) => !values.some((value) => removesParam(value, param)),
  );
  if (kept.length === params.length) return url;
  return (
    base.slice(0, query) +
    (kept.length === 0 ? "" : `?${kept.join("&")}`) +
    (hash === -1 ? "" : url.slice(hash))
  );
}

/** The names of a URL's query parameters, as written. */
export function paramNames(url: string): string[] {
  const hash = url.indexOf("#");
  const query = url.indexOf("?");
  if (query === -1 || (hash !== -1 && hash < query)) return [];
  return url
    .slice(query + 1, hash === -1 ? undefined : hash)
    .split("&")
    .map((param) => {
      const equals = param.indexOf("=");
      return equals === -1 ? param : param.slice(0, equals);
    });
}

function queryOf(text: string): URLSearchParams | undefined {
  const query = text.indexOf("?");
  if (query === -1) return undefined;
  const hash = text.indexOf("#", query);
  return new URLSearchParams(
    text.slice(query + 1, hash === -1 ? undefined : hash),
  );
}

function decodeBase64(text: string): string | undefined {
  try {
    return Buffer.from(atob(text), "latin1").toString("utf8");
  } catch {
    return undefined;
  }
}

/** Splits `urlskip=` steps at spaces, keeping a `/regex/` step whole. */
function skipSteps(value: string): string[] {
  const steps: string[] = [];
  for (let i = 0; i < value.length;) {
    if (value[i] === " ") {
      i++;
      continue;
    }
    let end = value.indexOf(" ", i);
    if (value[i] === "/") {
      // To the slash that a space or the end follows.
      for (let k = i + 1; k < value.length; k++) {
        if (value[k] === "\\") k++;
        else if (
          value[k] === "/" &&
          (k + 1 === value.length || value[k + 1] === " ")
        ) {
          end = k + 1;
          break;
        }
      }
    }
    if (end === -1) end = value.length;
    steps.push(value.slice(i, end));
    i = end;
  }
  return steps;
}

/** Whether `urlskip=` steps also apply to a request another filter blocks. */
export function skipsBlocked(value: string): boolean {
  return skipSteps(value).includes("-blocked");
}

/**
 * Applies `urlskip=` steps: extracts the URL a tracking link wraps. Undefined
 * when a step fails or the result isn't an http(s) URL.
 */
export function urlSkip(url: string, value: string): string | undefined {
  let current: string | undefined = url;
  for (const step of skipSteps(value)) {
    if (step === "-blocked") continue;
    if (step.startsWith("?")) {
      current = queryOf(current)?.get(step.slice(1)) ?? undefined;
    } else if (step.startsWith("&")) {
      const keys: string[] = [...(queryOf(current)?.keys() ?? [])];
      current = keys[Number(step.slice(1)) - 1];
    } else if (step === "#") {
      const hash = current.indexOf("#");
      current = hash === -1 ? undefined : current.slice(hash + 1);
    } else if (step.length > 2 && step.startsWith("/") && step.endsWith("/")) {
      current = tryRegex(step.slice(1, -1))?.exec(current)?.[1];
    } else if (step === "+https") {
      current = /^https?:\/\//i.test(current)
        ? current.replace(/^http:/i, "https:")
        : `https://${current}`;
    } else if (step === "-base64") {
      current = decodeBase64(current);
    } else if (step === "-safebase64") {
      current = decodeBase64(current.replaceAll("-", "+").replaceAll("_", "/"));
    } else if (step === "-uricomponent") {
      try {
        current = decodeURIComponent(current);
      } catch {
        current = undefined;
      }
    } else {
      return undefined;
    }
    if (current === undefined || current === "") return undefined;
  }
  return current !== url &&
    /^https?:\/\//i.test(current) &&
    URL.canParse(current)
    ? current
    : undefined;
}

/**
 * Applies `uritransform=/regex/replacement/flags` to the path, query and hash
 * of a URL. Undefined when the value can't be read or nothing changes.
 */
export function uriTransform(url: string, value: string): string | undefined {
  if (!value.startsWith("/") || !URL.canParse(url)) return undefined;
  let end = -1;
  let inClass = false;
  for (let i = 1; i < value.length && end === -1; i++) {
    const c = value[i];
    if (c === "\\") i++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) end = i;
  }
  const last = value.lastIndexOf("/");
  if (end === -1 || last <= end) return undefined;
  const regex = tryRegex(value.slice(1, end), value.slice(last + 1));
  if (regex === undefined) return undefined;
  const { origin, pathname, search, hash } = new URL(url);
  const before = pathname + search + hash;
  const after = before.replace(regex, value.slice(end + 1, last));
  return after === before || !after.startsWith("/")
    ? undefined
    : origin + after;
}

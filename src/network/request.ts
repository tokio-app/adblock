import {
  METHODS,
  T_DOCUMENT,
  T_FONT,
  T_IMAGE,
  T_INLINE_FONT,
  T_INLINE_SCRIPT,
  T_MEDIA,
  T_OBJECT,
  T_OTHER,
  T_PING,
  T_POPUP,
  T_SCRIPT,
  T_STYLESHEET,
  T_SUBDOCUMENT,
  T_WEBSOCKET,
  T_XHR,
} from "../parser/types.js";
import type { PublicSuffixList } from "../psl/psl.js";
import { urlTokens } from "./tokens.js";

/** What a request is for, in the words filters use. */
export type RequestType =
  | "document"
  | "subdocument"
  | "stylesheet"
  | "script"
  | "image"
  | "font"
  | "object"
  | "xhr"
  | "ping"
  | "media"
  | "websocket"
  | "other"
  | "popup";

export const REQUEST_TYPES: Readonly<Record<RequestType, number>> = {
  document: T_DOCUMENT,
  subdocument: T_SUBDOCUMENT,
  stylesheet: T_STYLESHEET,
  script: T_SCRIPT,
  image: T_IMAGE,
  font: T_FONT,
  object: T_OBJECT,
  xhr: T_XHR,
  ping: T_PING,
  media: T_MEDIA,
  websocket: T_WEBSOCKET,
  other: T_OTHER,
  popup: T_POPUP,
};

export interface RequestInfo {
  url: string;
  type: RequestType;
  /**
   * The URL of the document that makes the request. Without it the request
   * is taken as first-party, as a page's own navigation is.
   */
  sourceUrl?: string;
  /** The URL of the top document (`top=`). Defaults to `sourceUrl`. */
  topUrl?: string;
  /** The HTTP method (`method=`). */
  method?: string;
}

/**
 * Where the hostname is in a lowercased URL, or undefined when the URL has
 * none (`data:`, `blob:`, `about:`).
 */
function hostSpan(lower: string): [start: number, end: number] | undefined {
  const scheme = lower.indexOf("://");
  if (scheme <= 0 || scheme > 16) return undefined;
  let start = scheme + 3;
  let end = lower.length;
  for (let i = start; i < lower.length; i++) {
    const c = lower.charCodeAt(i);
    if (c === 0x2f /* / */ || c === 0x3f /* ? */ || c === 0x23 /* # */) {
      end = i;
      break;
    }
  }
  const at = lower.lastIndexOf("@", end - 1);
  if (at >= start) start = at + 1;
  if (lower.charCodeAt(start) === 0x5b /* [ */) {
    const close = lower.indexOf("]", start);
    if (close !== -1 && close < end) end = close + 1;
  } else {
    const colon = lower.indexOf(":", start);
    if (colon !== -1 && colon < end) end = colon;
  }
  return [start, end];
}

// A page's requests come one after the other with the same source URL.
let lastUrl = "";
let lastHostname = "";

/** The hostname of a URL, lowercase and without a trailing dot, or empty. */
export function hostnameOf(url: string): string {
  if (url === lastUrl) return lastHostname;
  lastUrl = url;
  return (lastHostname = parseHostname(url));
}

function parseHostname(url: string): string {
  const lower = url.toLowerCase();
  const span = hostSpan(lower);
  if (span === undefined) return "";
  const hostname = lower.slice(span[0], span[1]);
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

/** A request, with what filters ask about it worked out once. */
export class Request {
  readonly url: string;
  /** The URL lowercased: patterns are case-insensitive. */
  readonly lower: string;
  readonly hostname: string;
  /** Where the hostname starts and ends in `lower`. */
  readonly hostStart: number;
  readonly hostEnd: number;
  /** The request type, as a `T_*` bit. */
  type: number;
  readonly sourceHostname: string;
  readonly topHostname: string;
  /** The request's site isn't the source document's. */
  readonly thirdParty: boolean;
  /** The request's hostname isn't the source document's. */
  readonly strictThirdParty: boolean;
  /** The method as a `METHODS` bit, or 0. */
  readonly method: number;
  private readonly psl: PublicSuffixList;
  private entities: [string, string, string] | undefined;
  private urlTokens: string[] | undefined;

  constructor(info: RequestInfo, psl: PublicSuffixList) {
    this.psl = psl;
    this.url = info.url;
    this.lower = info.url.toLowerCase();
    const span = hostSpan(this.lower);
    this.hostStart = span?.[0] ?? 0;
    this.hostEnd = span?.[1] ?? 0;
    const hostname = this.lower.slice(this.hostStart, this.hostEnd);
    this.hostname = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
    this.type = REQUEST_TYPES[info.type];
    const source =
      info.sourceUrl === undefined || info.type === "document"
        ? ""
        : hostnameOf(info.sourceUrl);
    this.sourceHostname = source === "" ? this.hostname : source;
    const top = info.topUrl === undefined ? "" : hostnameOf(info.topUrl);
    this.topHostname = top === "" ? this.sourceHostname : top;
    this.strictThirdParty = this.hostname !== this.sourceHostname;
    this.thirdParty =
      this.strictThirdParty &&
      psl.domain(this.hostname) !== psl.domain(this.sourceHostname);
    this.method =
      info.method === undefined ? 0 : (METHODS[info.method.toLowerCase()] ?? 0);
  }

  private entity(index: 0 | 1 | 2): string {
    this.entities ??= [
      this.psl.entity(this.hostname),
      this.psl.entity(this.sourceHostname),
      this.psl.entity(this.topHostname),
    ];
    return this.entities[index];
  }

  /** The tokens of the URL, which rules are filed under. */
  get tokens(): string[] {
    return (this.urlTokens ??= urlTokens(this.lower));
  }

  /** The hostname with its public suffix as `*`, for `to=example.*`. */
  get hostEntity(): string {
    return this.entity(0);
  }

  /** The same for the source document, for `domain=example.*`. */
  get sourceEntity(): string {
    return this.entity(1);
  }

  get topEntity(): string {
    return this.entity(2);
  }
}

// `inline-script` and `inline-font` aren't requests: a document's response is
// asked about them (`Request.type` is set to one of them for the question).
export const INLINE_TYPES = { script: T_INLINE_SCRIPT, font: T_INLINE_FONT };

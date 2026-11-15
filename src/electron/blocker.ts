import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
  CallbackResponse,
  HeadersReceivedResponse,
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  OnBeforeRequestListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
  WebFrameMain,
} from "electron";
import type { DocumentCosmetics } from "../cosmetic/engine.js";
import { Engine, type EngineOptions } from "../engine.js";
import { hostnameOf, type RequestType } from "../network/request.js";
import { findResource } from "../resources/index.js";
import { isRecord, toError } from "../util.js";
import { DOCUMENT_CHANNEL, GENERIC_CHANNEL } from "./channels.js";
import { ADBLOCK_SCHEME } from "./scheme.js";

export interface ElectronBlockerOptions extends EngineOptions {
  /** Electron's `ipcMain`: the preload asks the main process through it. */
  ipcMain: IpcMain;
  /**
   * The path of the preload script. Defaults to the one in this package;
   * pass `require.resolve("@tokioapp/adblock/preload")` when the package is
   * bundled into the app's own code.
   */
  preloadPath?: string;
}

/** What the blocker did since it was created. */
export interface BlockerCounts {
  /** Requests blocked. */
  blocked: number;
  /** Blocked requests answered with a redirect resource. */
  redirected: number;
  /** Requests sent to another URL (`removeparam=`, `urlskip=`…). */
  rewritten: number;
  /** Responses blocked, or given a policy or fewer headers. */
  responses: number;
  /** Documents given scriptlets or cosmetic filters. */
  documents: number;
  /** Scriptlets given to documents. */
  scriptlets: number;
}

const TYPES: Readonly<Record<string, RequestType>> = {
  mainFrame: "document",
  subFrame: "subdocument",
  stylesheet: "stylesheet",
  script: "script",
  image: "image",
  font: "font",
  object: "object",
  xhr: "xhr",
  ping: "ping",
  media: "media",
  webSocket: "websocket",
};
// What filters are about. The rest (the blocker's own scheme, data:, blob:,
// file:, devtools:) is never touched.
const FILTERED = /^(?:https?|wss?):/i;
const MAX_NAMES = 10_000;

/** The address of the first document, from a frame up, that has one. */
function documentUrl(frame: WebFrameMain | null | undefined): string {
  for (let up = frame; up; up = up.parent) {
    if (FILTERED.test(up.url)) return up.url;
  }
  return "";
}

/**
 * Applies uBlock Origin's filter lists in Electron sessions: it blocks,
 * redirects and rewrites requests, adds policies to documents, and gives
 * each document its scriptlets and cosmetic filters through a preload.
 *
 * The app registers `adblockScheme` with its own schemes before `ready`,
 * creates one blocker, and enables it in the sessions it wants filtered.
 * In those sessions the blocker owns `webRequest.onBeforeRequest` and
 * `webRequest.onHeadersReceived`: Electron keeps one listener per event.
 */
export class ElectronBlocker {
  /** The lists and what decides from them. */
  readonly engine: Engine;
  /** Resolves once the lists are in effect. It never rejects. */
  readonly ready: Promise<void>;
  readonly counts: BlockerCounts = {
    blocked: 0,
    redirected: 0,
    rewritten: 0,
    responses: 0,
    documents: 0,
    scriptlets: 0,
  };
  private readonly ipcMain: IpcMain;
  private readonly preloadPath: string;
  private readonly onError: (error: Error) => void;
  /** The sessions it is enabled in, with the id of their preload. */
  private readonly sessions = new Map<Session, string>();
  // Part of every resource's address, so a page can't ask for one to find
  // out the blocker is there.
  private readonly token = randomBytes(8).toString("hex");
  private disposed = false;

  constructor(options: ElectronBlockerOptions) {
    const { ipcMain, preloadPath, ...engine } = options;
    this.ipcMain = ipcMain;
    this.onError = options.onError ?? (() => {});
    this.preloadPath =
      preloadPath ?? fileURLToPath(new URL("../preload.cjs", import.meta.url));
    this.engine = new Engine(engine);
    this.ready = this.engine.ready;
    ipcMain.on(DOCUMENT_CHANNEL, this.onDocument);
    ipcMain.handle(GENERIC_CHANNEL, this.onGeneric);
  }

  /** Starts filtering a session. Enabling one twice changes nothing. */
  enable(session: Session): void {
    if (this.disposed || this.sessions.has(session)) return;
    this.sessions.set(
      session,
      session.registerPreloadScript({
        type: "frame",
        filePath: this.preloadPath,
      }),
    );
    session.webRequest.onBeforeRequest(this.onBeforeRequest);
    session.webRequest.onHeadersReceived(this.onHeadersReceived);
    session.protocol.handle(ADBLOCK_SCHEME, this.serve);
  }

  /** Stops filtering a session. Pages already loaded keep what they got. */
  disable(session: Session): void {
    const preload = this.sessions.get(session);
    if (preload === undefined) return;
    this.sessions.delete(session);
    // Each on its own: a session that is going away may refuse one.
    for (const undo of [
      () => session.unregisterPreloadScript(preload),
      () => session.webRequest.onBeforeRequest(null),
      () => session.webRequest.onHeadersReceived(null),
      () => session.protocol.unhandle(ADBLOCK_SCHEME),
    ]) {
      try {
        undo();
      } catch (error) {
        this.onError(toError(error));
      }
    }
  }

  isEnabled(session: Session): boolean {
    return this.sessions.has(session);
  }

  /** Looks for new versions of the lists. See `Engine.update()`. */
  update(force = false): Promise<boolean> {
    return this.engine.update(force);
  }

  /** Stops everything: every session, the updates and the IPC channels. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const session of [...this.sessions.keys()]) this.disable(session);
    this.engine.dispose();
    this.ipcMain.removeListener(DOCUMENT_CHANNEL, this.onDocument);
    this.ipcMain.removeHandler(GENERIC_CHANNEL);
  }

  /** The address a redirect resource is served from. */
  private resourceUrl(name: string, original: string): string {
    const url = `${ADBLOCK_SCHEME}://${this.token}/${encodeURIComponent(name)}`;
    // This one shows the address of the frame it stands in for.
    return name === "click2load.html"
      ? `${url}?url=${encodeURIComponent(original)}`
      : url;
  }

  /**
   * `webRequest.onBeforeRequest`: blocks, redirects or rewrites a request.
   * A listener of the app's own can call it for the sessions it handles.
   */
  readonly onBeforeRequest = (
    details: OnBeforeRequestListenerDetails,
    callback: (response: CallbackResponse) => void,
  ): void => {
    let response: CallbackResponse = {};
    try {
      response = this.decide(details);
    } catch (error) {
      // A failure here must never fail the request.
      this.onError(toError(error));
    }
    callback(response);
  };

  /** What filters ask about a request Electron describes. */
  private requestOf(
    details: OnBeforeRequestListenerDetails | OnHeadersReceivedListenerDetails,
  ) {
    let sourceUrl = details.referrer;
    let topUrl: string | undefined;
    try {
      const { frame } = details;
      // A frame's own navigation comes from the document that holds it.
      const from = details.resourceType === "subFrame" ? frame?.parent : frame;
      sourceUrl = documentUrl(from) || details.referrer;
      topUrl = frame?.top?.url;
    } catch {
      // The frame is gone already: the referrer is what is left.
    }
    return this.engine.network.request({
      url: details.url,
      type: TYPES[details.resourceType] ?? "other",
      sourceUrl,
      topUrl,
      method: details.method,
    });
  }

  private decide(details: OnBeforeRequestListenerDetails): CallbackResponse {
    if (!FILTERED.test(details.url)) return {};
    // The page asked for the frame it had been given a placeholder for.
    if (
      details.resourceType === "subFrame" &&
      details.frame?.url.startsWith(`${ADBLOCK_SCHEME}://${this.token}/`) ===
        true
    ) {
      return {};
    }
    const { network } = this.engine;
    const request = this.requestOf(details);
    const decision = network.match(request);
    if (decision.block) {
      this.counts.blocked++;
      if (decision.redirect !== undefined) {
        this.counts.redirected++;
        return {
          redirectURL: this.resourceUrl(decision.redirect, details.url),
        };
      }
    }
    const rewritten = network.rewrite(request, decision.block);
    if (rewritten !== undefined) {
      this.counts.rewritten++;
      return { redirectURL: rewritten };
    }
    return decision.block ? { cancel: true } : {};
  }

  /**
   * `webRequest.onHeadersReceived`: blocks a response by its headers, adds
   * the policies of `csp=` and `permissions=` to a document and removes the
   * headers `##^responseheader()` names.
   */
  readonly onHeadersReceived = (
    details: OnHeadersReceivedListenerDetails,
    callback: (response: HeadersReceivedResponse) => void,
  ): void => {
    let response: HeadersReceivedResponse = {};
    try {
      response = this.decideResponse(details);
    } catch (error) {
      this.onError(toError(error));
    }
    callback(response);
  };

  private decideResponse(
    details: OnHeadersReceivedListenerDetails,
  ): HeadersReceivedResponse {
    if (!FILTERED.test(details.url)) return {};
    const isDocument =
      details.resourceType === "mainFrame" ||
      details.resourceType === "subFrame";
    const headers: Record<string, string[]> = { ...details.responseHeaders };
    // Servers write header names in any case.
    const nameOf = (lower: string) =>
      Object.keys(headers).find((name) => name.toLowerCase() === lower);
    const { network, cosmetic } = this.engine;
    const request = this.requestOf(details);
    const decision = network.response(request, (lower) => {
      const name = nameOf(lower);
      return name === undefined ? undefined : headers[name]!.join(", ");
    });
    if (decision.block) {
      this.counts.responses++;
      return { cancel: true };
    }
    if (!isDocument) return {};
    let changed = false;
    for (const [header, policies] of [
      ["content-security-policy", decision.csp],
      ["permissions-policy", decision.permissions],
    ] as const) {
      if (policies.length === 0) continue;
      // A second header of the same name: the browser applies both.
      const name = nameOf(header) ?? header;
      headers[name] = [...(headers[name] ?? []), ...policies];
      changed = true;
    }
    for (const header of cosmetic.headersToRemove(request.hostname)) {
      const name = nameOf(header);
      if (name === undefined) continue;
      delete headers[name];
      changed = true;
    }
    if (!changed) return {};
    this.counts.responses++;
    return { responseHeaders: headers };
  }

  /** The protocol handler: serves the redirect resources. */
  private readonly serve = (request: Request): Response => {
    const url = new URL(request.url);
    const resource =
      url.hostname === this.token
        ? findResource(decodeURIComponent(url.pathname.slice(1)))
        : undefined;
    if (resource === undefined) return new Response(null, { status: 404 });
    const { body } = resource;
    return new Response(typeof body === "string" ? body : Buffer.from(body), {
      headers: {
        "content-type": resource.mime,
        // The page that asked is on another origin.
        "access-control-allow-origin": "*",
      },
    });
  };

  /** A document asks what it gets: answered at once, from memory. */
  private readonly onDocument = (event: IpcMainEvent, url: unknown): void => {
    let config: DocumentCosmetics | null = null;
    try {
      if (this.sessions.has(event.sender.session) && typeof url === "string") {
        // A document without an address of its own (about:blank, srcdoc)
        // is filtered as the document that holds it.
        const address = FILTERED.test(url)
          ? url
          : documentUrl(event.senderFrame?.parent);
        if (address !== "") {
          config = this.engine.document(address, event.senderFrame?.top?.url);
          this.counts.documents++;
          this.counts.scriptlets += config.scriptlets.length;
        }
      }
    } catch (error) {
      this.onError(toError(error));
    }
    // Always answered: the page waits for it.
    event.returnValue = config;
  };

  /** A page asks for the generic filters of its classes and ids. */
  private readonly onGeneric = (
    event: IpcMainInvokeEvent,
    request: unknown,
  ): string => {
    try {
      if (!this.sessions.has(event.sender.session) || !isRecord(request)) {
        return "";
      }
      const { url, classes, ids } = request;
      const names = (given: unknown): string[] =>
        Array.isArray(given)
          ? given.filter((name) => typeof name === "string").slice(0, MAX_NAMES)
          : [];
      const hostname = typeof url === "string" ? hostnameOf(url) : "";
      return hostname === ""
        ? ""
        : this.engine.cosmetic.genericFor(hostname, names(classes), names(ids));
    } catch (error) {
      this.onError(toError(error));
      return "";
    }
  };
}

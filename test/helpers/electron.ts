import type {
  CallbackResponse,
  HeadersReceivedResponse,
  IpcMain,
  OnBeforeRequestListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
} from "electron";

// Fakes of the parts of Electron the blocker uses. They keep what was
// registered and let a test play Electron's part: send a request through
// the session's listener, or a message from a page.

export interface FakeFrame {
  url: string;
  parent: FakeFrame | null;
  top: FakeFrame;
}

/** A frame, in a document tree: its parent, and the top one. */
export function fakeFrame(url: string, parent?: FakeFrame): FakeFrame {
  const frame: FakeFrame = { url, parent: parent ?? null, top: undefined! };
  frame.top = parent?.top ?? frame;
  return frame;
}

type BeforeRequest = (
  details: OnBeforeRequestListenerDetails,
  callback: (response: CallbackResponse) => void,
) => void;
type HeadersReceived = (
  details: OnHeadersReceivedListenerDetails,
  callback: (response: HeadersReceivedResponse) => void,
) => void;

export class FakeSession {
  readonly preloads = new Map<string, { type: string; filePath: string }>();
  readonly handlers = new Map<string, (request: Request) => Response>();
  beforeRequest: BeforeRequest | null = null;
  headersReceived: HeadersReceived | null = null;
  private nextId = 0;

  readonly webRequest = {
    onBeforeRequest: (listener: BeforeRequest | null) => {
      this.beforeRequest = listener;
    },
    onHeadersReceived: (listener: HeadersReceived | null) => {
      this.headersReceived = listener;
    },
  };

  readonly protocol = {
    handle: (scheme: string, handler: (request: Request) => Response) => {
      if (this.handlers.has(scheme)) throw new Error(`${scheme} is handled`);
      this.handlers.set(scheme, handler);
    },
    unhandle: (scheme: string) => {
      this.handlers.delete(scheme);
    },
  };

  registerPreloadScript(script: { type: string; filePath: string }): string {
    const id = `preload-${++this.nextId}`;
    this.preloads.set(id, script);
    return id;
  }

  unregisterPreloadScript(id: string): void {
    this.preloads.delete(id);
  }

  /** The session, as the Electron type the blocker takes. */
  get electron(): Session {
    return this as unknown as Session;
  }

  /** What the session's listener answers a request with. */
  request(
    url: string,
    resourceType: OnBeforeRequestListenerDetails["resourceType"] = "script",
    more: { frame?: FakeFrame | null; referrer?: string; method?: string } = {},
  ): CallbackResponse {
    let answer: CallbackResponse | undefined;
    this.beforeRequest?.(
      {
        id: 1,
        url,
        method: more.method ?? "GET",
        resourceType,
        referrer: more.referrer ?? "",
        timestamp: 0,
        uploadData: [],
        frame: more.frame,
      } as unknown as OnBeforeRequestListenerDetails,
      (response) => (answer = response),
    );
    if (answer === undefined) throw new Error("the request wasn't answered");
    return answer;
  }

  /** What the session's listener answers a response with. */
  response(
    url: string,
    resourceType: OnHeadersReceivedListenerDetails["resourceType"],
    responseHeaders: Record<string, string[]>,
    frame?: FakeFrame,
  ): HeadersReceivedResponse {
    let answer: HeadersReceivedResponse | undefined;
    this.headersReceived?.(
      {
        id: 1,
        url,
        method: "GET",
        resourceType,
        referrer: "",
        timestamp: 0,
        statusLine: "HTTP/1.1 200 OK",
        statusCode: 200,
        responseHeaders,
        frame,
      } as unknown as OnHeadersReceivedListenerDetails,
      (response) => (answer = response),
    );
    if (answer === undefined) throw new Error("the response wasn't answered");
    return answer;
  }

  /** What the protocol handler serves for a URL. */
  fetch(url: string): Response {
    const handler = this.handlers.get(new URL(url).protocol.slice(0, -1));
    if (handler === undefined) throw new Error(`nothing handles ${url}`);
    return handler(new Request(url));
  }
}

export class FakeIpcMain {
  readonly listeners = new Map<string, (...args: any[]) => void>();
  readonly handlers = new Map<string, (...args: any[]) => unknown>();

  on(channel: string, listener: (...args: any[]) => void): this {
    this.listeners.set(channel, listener);
    return this;
  }

  removeListener(channel: string, listener: (...args: any[]) => void): this {
    if (this.listeners.get(channel) === listener)
      this.listeners.delete(channel);
    return this;
  }

  handle(channel: string, handler: (...args: any[]) => unknown): void {
    if (this.handlers.has(channel)) throw new Error(`${channel} is handled`);
    this.handlers.set(channel, handler);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  get electron(): IpcMain {
    return this as unknown as IpcMain;
  }

  /** `ipcRenderer.sendSync` from a page of a session: what main answers. */
  sendSync(
    channel: string,
    session: FakeSession,
    frame: FakeFrame | null,
    ...args: unknown[]
  ): unknown {
    const event = {
      sender: { session },
      senderFrame: frame,
      returnValue: undefined as unknown,
    };
    this.listeners.get(channel)?.(event, ...args);
    return event.returnValue;
  }

  /** `ipcRenderer.invoke` from a page of a session. */
  invoke(channel: string, session: FakeSession, ...args: unknown[]): unknown {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error(`nothing handles ${channel}`);
    return handler({ sender: { session } }, ...args);
  }
}

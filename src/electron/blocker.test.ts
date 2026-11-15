import { afterEach, describe, expect, test } from "vitest";
import {
  FakeIpcMain,
  FakeSession,
  fakeFrame,
} from "../../test/helpers/electron.js";
import { fetchStub } from "../../test/helpers/fetchStub.js";
import { ElectronBlocker } from "./blocker.js";
import { DOCUMENT_CHANNEL, GENERIC_CHANNEL } from "./channels.js";

const LIST = "https://lists.example/main.txt";
const PAGE = "https://www.site.example/page";
const page = fakeFrame(PAGE);

let blocker: ElectronBlocker | undefined;
afterEach(() => {
  blocker?.dispose();
  blocker = undefined;
});

async function setup(...rules: string[]) {
  const ipc = new FakeIpcMain();
  const session = new FakeSession();
  const errors: string[] = [];
  blocker = new ElectronBlocker({
    ipcMain: ipc.electron,
    preloadPath: "/app/preload.cjs",
    lists: [{ id: "main", urls: [LIST], trusted: true }],
    // A list without rules still has its header.
    fetch: fetchStub({
      [LIST]: { body: ["! Title: test", ...rules].join("\n") },
    }),
    publicSuffixListUrls: [],
    autoUpdate: false,
    onError: (error) => errors.push(error.message),
  });
  blocker.enable(session.electron);
  await blocker.ready;
  return { blocker, ipc, session, errors };
}

describe("enable and disable", () => {
  test("enable registers the preload, the listeners and the scheme", async () => {
    const { blocker, session } = await setup();
    expect(blocker.isEnabled(session.electron)).toBe(true);
    expect([...session.preloads.values()]).toEqual([
      { type: "frame", filePath: "/app/preload.cjs" },
    ]);
    expect(session.beforeRequest).toBeTypeOf("function");
    expect(session.headersReceived).toBeTypeOf("function");
    expect([...session.handlers.keys()]).toEqual(["tokio-adblock"]);
  });

  test("enabling twice changes nothing", async () => {
    const { blocker, session } = await setup();
    blocker.enable(session.electron);
    expect(session.preloads.size).toBe(1);
  });

  test("disable undoes it all, and twice is fine", async () => {
    const { blocker, session } = await setup("||ads.example^");
    blocker.disable(session.electron);
    blocker.disable(session.electron);
    expect(blocker.isEnabled(session.electron)).toBe(false);
    expect(session.preloads.size).toBe(0);
    expect(session.beforeRequest).toBeNull();
    expect(session.headersReceived).toBeNull();
    expect(session.handlers.size).toBe(0);
    // And it can be enabled again.
    blocker.enable(session.electron);
    expect(session.request("https://ads.example/x.js")).toEqual({
      cancel: true,
    });
  });

  test("a session that refuses part of disable is still disabled", async () => {
    const { blocker, session, errors } = await setup();
    session.unregisterPreloadScript = () => {
      throw new Error("the session is gone");
    };
    blocker.disable(session.electron);
    expect(errors).toEqual(["the session is gone"]);
    expect(session.beforeRequest).toBeNull();
    expect(session.handlers.size).toBe(0);
  });

  test("the default preload is the one in the package", () => {
    const ipc = new FakeIpcMain();
    const session = new FakeSession();
    blocker = new ElectronBlocker({
      ipcMain: ipc.electron,
      lists: [],
      publicSuffixListUrls: [],
      autoUpdate: false,
    });
    blocker.enable(session.electron);
    const [preload] = [...session.preloads.values()];
    expect(preload?.filePath.replaceAll("\\", "/")).toMatch(/\/preload\.cjs$/);
  });

  test("dispose stops every session and frees the channels", async () => {
    const { blocker, ipc, session } = await setup();
    const other = new FakeSession();
    blocker.enable(other.electron);
    blocker.dispose();
    blocker.dispose();
    expect(session.beforeRequest).toBeNull();
    expect(other.beforeRequest).toBeNull();
    expect(ipc.listeners.size).toBe(0);
    expect(ipc.handlers.size).toBe(0);
    // Nothing is enabled after that.
    blocker.enable(session.electron);
    expect(session.preloads.size).toBe(0);
  });
});

describe("requests", () => {
  test("a blocked request is cancelled, the others go on", async () => {
    const { blocker, session } = await setup("||ads.example^", "/banner.");
    expect(
      session.request("https://ads.example/x.js", "script", { frame: page }),
    ).toEqual({ cancel: true });
    expect(session.request("https://cdn.example/banner.png", "image")).toEqual({
      cancel: true,
    });
    expect(session.request("https://cdn.example/app.js", "script")).toEqual({});
    expect(blocker.counts).toMatchObject({ blocked: 2, redirected: 0 });
  });

  test("nothing is blocked until the lists are in effect", async () => {
    const ipc = new FakeIpcMain();
    const session = new FakeSession();
    blocker = new ElectronBlocker({
      ipcMain: ipc.electron,
      lists: [{ id: "main", urls: [LIST] }],
      fetch: fetchStub({ [LIST]: { body: "||ads.example^" } }),
      publicSuffixListUrls: [],
      autoUpdate: false,
    });
    blocker.enable(session.electron);
    expect(session.request("https://ads.example/x.js")).toEqual({});
    await blocker.ready;
    expect(session.request("https://ads.example/x.js")).toEqual({
      cancel: true,
    });
  });

  test("Electron's resource types are the filters' types", async () => {
    const { session } = await setup(
      "||a.example^$xhr",
      "||b.example^$websocket",
      "||c.example^$subdocument",
      "||d.example^$document",
      "||e.example^$other",
    );
    const blocked = (
      url: string,
      type: Parameters<FakeSession["request"]>[1],
    ) => session.request(url, type).cancel === true;
    expect(blocked("https://a.example/", "xhr")).toBe(true);
    expect(blocked("https://a.example/", "script")).toBe(false);
    expect(blocked("wss://b.example/", "webSocket")).toBe(true);
    expect(blocked("https://c.example/", "subFrame")).toBe(true);
    expect(blocked("https://d.example/", "mainFrame")).toBe(true);
    expect(blocked("https://e.example/", "cspReport")).toBe(true);
    expect(blocked("https://e.example/", "other")).toBe(true);
  });

  test("party and domain= follow the frame that asks", async () => {
    const { session } = await setup(
      "/3p.js$third-party",
      "/only.js$domain=site.example",
    );
    const from = (url: string, frame: ReturnType<typeof fakeFrame>) =>
      session.request(url, "script", { frame }).cancel === true;
    expect(from("https://cdn.other.example/3p.js", page)).toBe(true);
    expect(from("https://cdn.site.example/3p.js", page)).toBe(false);
    expect(from("https://x.example/only.js", page)).toBe(true);
    expect(
      from("https://x.example/only.js", fakeFrame("https://b.example/")),
    ).toBe(false);
    // A frame without an address of its own asks as the one that holds it.
    expect(
      from("https://x.example/only.js", fakeFrame("about:blank", page)),
    ).toBe(true);
  });

  test("a frame's navigation is asked about from its parent", async () => {
    const { session } = await setup("||embed.example^$subdocument,3p");
    const frame = fakeFrame("about:blank", page);
    expect(
      session.request("https://embed.example/player", "subFrame", { frame }),
    ).toEqual({ cancel: true });
    // The same site's own frame is first-party.
    const own = fakeFrame("about:blank", fakeFrame("https://embed.example/"));
    expect(
      session.request("https://embed.example/player", "subFrame", {
        frame: own,
      }),
    ).toEqual({});
  });

  test("without a frame the referrer says who asks", async () => {
    const { session } = await setup("/3p.js$third-party");
    expect(
      session.request("https://cdn.other.example/3p.js", "script", {
        frame: null,
        referrer: PAGE,
      }),
    ).toEqual({ cancel: true });
    expect(
      session.request("https://www.site.example/3p.js", "script", {
        referrer: PAGE,
      }),
    ).toEqual({});
  });

  test("a frame that is gone doesn't fail the request", async () => {
    const { session, errors } = await setup("||ads.example^");
    const gone = {
      get url(): string {
        throw new Error("Render frame was disposed");
      },
    } as unknown as ReturnType<typeof fakeFrame>;
    expect(
      session.request("https://ads.example/x.js", "script", { frame: gone }),
    ).toEqual({ cancel: true });
    expect(errors).toEqual([]);
  });

  test("what isn't http(s) or a WebSocket is left alone", async () => {
    const { session } = await setup("*$image");
    for (const url of [
      "data:image/png;base64,AAAA",
      "blob:https://site.example/1",
      "file:///C:/x.png",
      "devtools://devtools/x.png",
      "tokio-adblock://abc/1x1.gif",
    ]) {
      expect(session.request(url, "image")).toEqual({});
    }
    expect(session.request("https://x.example/a.png", "image")).toEqual({
      cancel: true,
    });
  });

  test("removeparam and urlskip send the request elsewhere", async () => {
    const { blocker, session } = await setup(
      "*$removeparam=utm_source",
      "||out.example/go?$urlskip=?to",
    );
    expect(
      session.request("https://x.example/p?a=1&utm_source=n", "mainFrame"),
    ).toEqual({ redirectURL: "https://x.example/p?a=1" });
    expect(
      session.request(
        "https://out.example/go?to=https%3A%2F%2Fdest.example%2F",
        "mainFrame",
      ),
    ).toEqual({ redirectURL: "https://dest.example/" });
    expect(blocker.counts.rewritten).toBe(2);
  });
});

describe("redirect resources", () => {
  test("a redirected request goes to the blocker's scheme, which serves it", async () => {
    const { blocker, session } = await setup(
      "||ads.example/lib.js$script,redirect=noopjs",
      "||ads.example/pixel$image,redirect=1x1.gif",
    );
    const script = session.request("https://ads.example/lib.js", "script");
    expect(script.redirectURL).toMatch(
      /^tokio-adblock:\/\/[0-9a-f]{16}\/noop\.js$/,
    );
    const served = session.fetch(script.redirectURL!);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("text/javascript");
    expect(served.headers.get("access-control-allow-origin")).toBe("*");
    expect(await served.text()).toBe("");

    const image = session.request("https://ads.example/pixel", "image");
    const bytes = new Uint8Array(
      await session.fetch(image.redirectURL!).arrayBuffer(),
    );
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
    expect(blocker.counts).toMatchObject({ blocked: 2, redirected: 2 });
  });

  test("only the address the blocker gave is served", async () => {
    const { session } = await setup("||ads.example^$script,redirect=noopjs");
    const { redirectURL } = session.request("https://ads.example/a.js");
    const token = new URL(redirectURL!).hostname;
    expect(session.fetch("tokio-adblock://guess/noop.js").status).toBe(404);
    expect(session.fetch(`tokio-adblock://${token}/nope.js`).status).toBe(404);
    expect(session.fetch(`tokio-adblock://${token}/noop.js`).status).toBe(200);
  });

  test("click2load.html gets the frame's address, and its click goes through", async () => {
    const { session } = await setup(
      "||video.example^$3p,frame,redirect=click2load.html",
    );
    const frame = fakeFrame("about:blank", page);
    const address = "https://video.example/embed/7?a=1";
    const { redirectURL } = session.request(address, "subFrame", { frame });
    expect(redirectURL).toMatch(
      /\/click2load\.html\?url=https%3A%2F%2Fvideo\.example%2Fembed%2F7%3Fa%3D1$/,
    );
    expect(await session.fetch(redirectURL!).text()).toContain("<html");
    // The placeholder now is the frame's document: its request isn't filtered.
    frame.url = redirectURL!;
    expect(session.request(address, "subFrame", { frame })).toEqual({});
    // Another frame's still is.
    expect(
      session.request(address, "subFrame", {
        frame: fakeFrame("about:blank", page),
      }).redirectURL,
    ).toBeDefined();
  });
});

describe("responses", () => {
  test("csp= and permissions= are added to a document's headers", async () => {
    const { blocker, session } = await setup(
      "||site.example^$csp=script-src 'none'",
      "||site.example^$permissions=camera=()",
    );
    expect(
      session.response(PAGE, "mainFrame", {
        "Content-Type": ["text/html"],
        "Content-Security-Policy": ["default-src 'self'"],
      }),
    ).toEqual({
      responseHeaders: {
        "Content-Type": ["text/html"],
        "Content-Security-Policy": ["default-src 'self'", "script-src 'none'"],
        "permissions-policy": ["camera=()"],
      },
    });
    expect(session.response(`${PAGE}.js`, "script", {})).toEqual({});
    expect(blocker.counts.responses).toBe(1);
  });

  test("a response nothing applies to is left as it is", async () => {
    const { session } = await setup("||other.example^$csp=script-src 'none'");
    expect(session.response(PAGE, "mainFrame", { "X-A": ["1"] })).toEqual({});
  });

  test("##^responseheader() removes a header from a document", async () => {
    const { session } = await setup("site.example##^responseheader(refresh)");
    expect(
      session.response(PAGE, "mainFrame", {
        Refresh: ["5; url=https://ads.example/"],
        "Content-Type": ["text/html"],
      }),
    ).toEqual({ responseHeaders: { "Content-Type": ["text/html"] } });
  });

  test("header= blocks a response", async () => {
    const { session } = await setup("*$script,header=via:1.1 proxy");
    expect(
      session.response("https://x.example/a.js", "script", {
        Via: ["1.1 proxy"],
      }),
    ).toEqual({ cancel: true });
    expect(
      session.response("https://x.example/a.js", "script", { Via: ["other"] }),
    ).toEqual({});
  });
});

describe("documents", () => {
  const rules = [
    "site.example##.ad",
    "site.example##+js(set-constant, ads, false)",
    "##.generic-ad",
    "@@||site.example/plain/$ghide",
  ];

  test("a document gets its scriptlets and cosmetic filters at once", async () => {
    const { blocker, ipc, session } = await setup(...rules);
    expect(ipc.sendSync(DOCUMENT_CHANNEL, session, page, PAGE)).toEqual({
      css: ".ad{display:none!important;}",
      procedural: [],
      scriptlets: [{ name: "set-constant", args: ["ads", "false"] }],
      generic: true,
    });
    expect(blocker.counts).toMatchObject({ documents: 1, scriptlets: 1 });
  });

  test("a document without an address is filtered as the one that holds it", async () => {
    const { ipc, session } = await setup(...rules);
    const frame = fakeFrame("about:blank", page);
    expect(
      ipc.sendSync(DOCUMENT_CHANNEL, session, frame, "about:blank"),
    ).toMatchObject({ css: ".ad{display:none!important;}" });
    expect(
      ipc.sendSync(
        DOCUMENT_CHANNEL,
        session,
        fakeFrame("about:blank"),
        "about:blank",
      ),
    ).toBeNull();
  });

  test("the cosmetic switches of the document apply", async () => {
    const { ipc, session } = await setup(...rules);
    const url = "https://www.site.example/plain/x";
    expect(
      ipc.sendSync(DOCUMENT_CHANNEL, session, fakeFrame(url), url),
    ).toMatchObject({ generic: false });
  });

  test("a page of another session, or a bad message, gets nothing", async () => {
    const { ipc, session } = await setup(...rules);
    expect(
      ipc.sendSync(DOCUMENT_CHANNEL, new FakeSession(), page, PAGE),
    ).toBeNull();
    expect(ipc.sendSync(DOCUMENT_CHANNEL, session, page, 42)).toBeNull();
    expect(ipc.sendSync(DOCUMENT_CHANNEL, session, page)).toBeNull();
  });

  test("a page asks for the generic filters of its classes and ids", async () => {
    const { ipc, session } = await setup(...rules);
    expect(
      ipc.invoke(GENERIC_CHANNEL, session, {
        url: PAGE,
        classes: ["generic-ad", "other", 7],
        ids: ["x"],
      }),
    ).toBe(".generic-ad:not(html):not(body){display:none!important;}");
    for (const bad of [undefined, "x", { url: 1 }, { url: "about:blank" }]) {
      expect(ipc.invoke(GENERIC_CHANNEL, session, bad)).toBe("");
    }
    expect(
      ipc.invoke(GENERIC_CHANNEL, new FakeSession(), {
        url: PAGE,
        classes: ["generic-ad"],
        ids: [],
      }),
    ).toBe("");
  });
});

describe("failures", () => {
  test("an error while deciding lets the request through and is reported", async () => {
    const { blocker, session, errors } = await setup("||ads.example^");
    blocker.engine.network.match = () => {
      throw new Error("boom");
    };
    blocker.engine.network.response = () => {
      throw new Error("bang");
    };
    expect(session.request("https://ads.example/x.js")).toEqual({});
    expect(session.response(PAGE, "mainFrame", {})).toEqual({});
    expect(errors).toEqual(["boom", "bang"]);
  });

  test("an error while answering a document still answers it", async () => {
    const { blocker, ipc, session, errors } = await setup("site.example##.ad");
    blocker.engine.document = () => {
      throw new Error("boom");
    };
    expect(ipc.sendSync(DOCUMENT_CHANNEL, session, page, PAGE)).toBeNull();
    expect(errors).toEqual(["boom"]);
  });
});

import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, test } from "vitest";
import type { DocumentCosmetics } from "../../src/cosmetic/engine.js";
import {
  DOCUMENT_CHANNEL,
  GENERIC_CHANNEL,
} from "../../src/electron/channels.js";
import { bundlePreload } from "./bundle.js";

let preload: string;
beforeAll(async () => {
  preload = await bundlePreload();
});

/**
 * Runs the built preload in a jsdom page the way Electron runs it in a
 * sandboxed renderer: `require` only gives `electron`, and the page's own
 * world only gets the text of the function it is handed.
 */
function load(config: DocumentCosmetics | null, html = "<!doctype html>") {
  const { window } = new JSDOM(html, {
    url: "https://www.site.example/page",
    runScripts: "outside-only",
  });
  const seen = {
    sync: [] as unknown[][],
    invoked: [] as unknown[][],
    css: [] as string[],
  };
  const electron = {
    ipcRenderer: {
      sendSync(...args: unknown[]) {
        seen.sync.push(args);
        return config;
      },
      async invoke(...args: unknown[]) {
        seen.invoked.push(args);
        return ".ad-box{display:none}";
      },
    },
    contextBridge: {
      executeInMainWorld({ func, args }: { func: unknown; args: unknown[] }) {
        window.eval(`(${String(func)})(...${JSON.stringify(args)})`);
      },
    },
    webFrame: {
      insertCSS(css: string) {
        seen.css.push(css);
        return "key";
      },
    },
  };
  const require = (name: string) => {
    if (name !== "electron") {
      throw new Error(`a sandboxed preload can't require ${name}`);
    }
    return electron;
  };
  const run = window.eval(
    `(function (require, module, exports) {${preload}\n})`,
  ) as (require: unknown, module: unknown, exports: unknown) => void;
  run(require, { exports: {} }, {});
  return { window, seen };
}

describe("the built preload", () => {
  test("is one CommonJS file that requires only electron", () => {
    const required = [...preload.matchAll(/\brequire\(["']([^"']+)["']\)/g)];
    expect(required.map((match) => match[1])).toEqual(["electron"]);
    expect(preload).not.toMatch(/^\s*(?:import|export)\s/m);
  });

  test("asks main about the document and applies the answer", async () => {
    const { window, seen } = load(
      {
        css: ".ad{display:none!important;}",
        procedural: [{ selector: "p", tasks: [["has-text", "Sponsored"]] }],
        scriptlets: [{ name: "set-constant", args: ["adsEnabled", "false"] }],
        generic: true,
      },
      '<!doctype html><body><p id="one" class="ad-box">Sponsored</p></body>',
    );
    expect(seen.sync).toEqual([
      [DOCUMENT_CHANNEL, "https://www.site.example/page"],
    ]);
    // The scriptlet ran in the page from the function's text alone.
    window.eval("window.adsEnabled = true");
    expect(window.eval("adsEnabled")).toBe(false);
    // The stylesheet, then the rule that hides what the procedural filter marks.
    expect(seen.css[0]).toBe(".ad{display:none!important;}");
    const mark = window.document
      .getElementById("one")
      ?.getAttributeNames()
      .find((name) => !["id", "class"].includes(name));
    expect(seen.css[1]).toBe(`[${mark}]{display:none!important;}`);
    // The generic filters of the classes and ids it found.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(seen.invoked).toEqual([
      [
        GENERIC_CHANNEL,
        {
          url: "https://www.site.example/page",
          classes: ["ad-box"],
          ids: ["one"],
        },
      ],
    ]);
    expect(seen.css[2]).toBe(".ad-box{display:none}");
  });

  test("does nothing for a document main has nothing for", () => {
    const { seen } = load(null);
    expect(seen.sync).toHaveLength(1);
    expect(seen.css).toEqual([]);
  });

  test("never throws into the page", () => {
    const { window } = new JSDOM("<!doctype html>", {
      runScripts: "outside-only",
    });
    const run = window.eval(
      `(function (require, module, exports) {${preload}\n})`,
    ) as (require: unknown, module: unknown, exports: unknown) => void;
    const electron = {
      ipcRenderer: {
        sendSync() {
          throw new Error("main is gone");
        },
      },
    };
    expect(() => run(() => electron, { exports: {} }, {})).not.toThrow();
  });
});

// The session preload: it runs in every document of a session the blocker is
// enabled in, before the document's scripts. The build bundles it into one
// CommonJS file, dist/preload.cjs: a sandboxed preload can only load
// `electron`.
import { contextBridge, ipcRenderer, webFrame } from "electron";
import type { DocumentCosmetics } from "../cosmetic/engine.js";
import {
  DOCUMENT_CHANNEL,
  GENERIC_CHANNEL,
  type GenericRequest,
} from "../electron/channels.js";
import { startCosmetics } from "./cosmetics.js";
import { runScriptlets } from "./mainWorld.js";

try {
  const url = location.href;
  // Synchronous on purpose: the answer has to be there before the page's
  // first script. Main answers from memory.
  const config = ipcRenderer.sendSync(
    DOCUMENT_CHANNEL,
    url,
  ) as DocumentCosmetics | null;
  if (config !== null) {
    if (config.scriptlets.length > 0) {
      contextBridge.executeInMainWorld({
        func: runScriptlets,
        args: [config.scriptlets],
      });
    }
    startCosmetics(config, {
      // A user stylesheet: the page can't see it, remove it or outrank it.
      insertCSS: (css) => void webFrame.insertCSS(css, { cssOrigin: "user" }),
      generic: (classes, ids) =>
        ipcRenderer.invoke(GENERIC_CHANNEL, {
          url,
          classes,
          ids,
        } satisfies GenericRequest) as Promise<string>,
    });
  }
} catch {
  // Whatever goes wrong here, the page loads as if there were no blocker.
}

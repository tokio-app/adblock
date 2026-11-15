// The Electron side of `yarn smoke`: loads a page in a session the built
// blocker is enabled in and writes what happened to a file. Electron's
// console doesn't reach every shell, so nothing here is printed.
//
// electron scripts/smoke/main.mjs <options file>, the JSON `index.ts` writes.
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, app, ipcMain, protocol, session } from "electron";
import {
  ADBLOCK_SCHEME,
  ElectronBlocker,
  FileStorage,
  adblockScheme,
} from "../../dist/index.js";

const { url, seconds, reportFile, listsFolder, show } = JSON.parse(
  fs.readFileSync(process.argv[2], "utf8"),
);
const report = {
  url,
  seconds: Number(seconds),
  electron: process.versions.electron,
  loaded: false,
  failure: undefined,
};
const write = () => {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
};
const finish = (code) => {
  write();
  app.exit(code);
};
// Written as the run goes: a run that hangs still says how far it got.
const reached = (stage) => {
  report.stage = stage;
  write();
};
// Whatever happens, the process ends.
setTimeout(
  () => {
    report.failure = `timed out at "${report.stage}"`;
    finish(1);
  },
  (Number(seconds) + 150) * 1000,
);
process.on("uncaughtException", (error) => {
  report.failure = String(error.stack ?? error);
  finish(2);
});

// A profile of its own, next to the report.
app.setPath("userData", path.join(path.dirname(reportFile), "smoke-profile"));
// As a host app does: once, before `ready`, with its own schemes.
protocol.registerSchemesAsPrivileged([adblockScheme]);

reached("waiting for Electron");
// Not awaited here: Electron only becomes ready once this module has
// finished loading, so a top-level await on it would wait forever.
app
  .whenReady()
  .then(run)
  .catch((error) => {
    report.failure = String(error.stack ?? error);
    finish(2);
  });

async function run() {
  reached("loading the lists");
  const ses = session.fromPartition("smoke");
  const blockerErrors = [];
  const blocker = new ElectronBlocker({
    ipcMain,
    storage: new FileStorage(listsFolder),
    onError: (error) => blockerErrors.push(error.message),
  });
  blocker.enable(ses);
  const started = Date.now();
  await blocker.ready;
  report.listsReadyMs = Date.now() - started;
  report.lists = Object.fromEntries(
    Object.entries(blocker.engine.stats).map(([id, stats]) => [
      id,
      stats.network +
        stats.networkExceptions +
        stats.cosmetic +
        stats.scriptlets,
    ]),
  );

  // The blocker owns onBeforeRequest and onHeadersReceived. These three other
  // events show what became of the requests.
  const requests = {
    total: 0,
    cancelled: 0,
    redirectedLoaded: [],
    redirectedFailed: [],
    otherErrors: {},
  };
  const scheme = `${ADBLOCK_SCHEME}:`;
  ses.webRequest.onCompleted((details) => {
    requests.total++;
    if (details.url.startsWith(scheme)) {
      // Without the token: only the resource's name.
      const name = decodeURIComponent(new URL(details.url).pathname.slice(1));
      (details.statusCode === 200
        ? requests.redirectedLoaded
        : requests.redirectedFailed
      ).push(name);
    }
  });
  ses.webRequest.onErrorOccurred((details) => {
    requests.total++;
    if (details.error === "net::ERR_BLOCKED_BY_CLIENT") requests.cancelled++;
    else if (details.url.startsWith(scheme)) {
      requests.redirectedFailed.push(`${details.error} ${details.url}`);
    } else {
      requests.otherErrors[details.error] =
        (requests.otherErrors[details.error] ?? 0) + 1;
    }
  });

  const win = new BrowserWindow({
    show,
    width: 1280,
    height: 800,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true },
  });
  const page = { consoleErrors: [], preloadErrors: [] };
  win.webContents.on("console-message", (event) => {
    if (event.level === "error" && page.consoleErrors.length < 40) {
      page.consoleErrors.push(event.message.slice(0, 300));
    }
  });
  win.webContents.on("preload-error", (_event, file, error) => {
    page.preloadErrors.push(`${path.basename(file)}: ${error.message}`);
  });

  reached("loading the page");
  try {
    await win.loadURL(url);
    report.loaded = true;
  } catch (error) {
    report.failure = `the page didn't load: ${error.message}`;
  }
  reached("letting the page run");
  await new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000));
  reached("looking at the page");

  // What the main document was given, and what it did with it.
  const finalUrl = win.webContents.getURL();
  const given = blocker.engine.document(finalUrl);
  const selectors = given.css
    .split("\n")
    .map((rule) => rule.slice(0, rule.lastIndexOf("{")))
    .filter((selector) => selector !== "" && !selector.startsWith("@media"));
  try {
    Object.assign(
      page,
      await win.webContents.executeJavaScript(`(() => {
        const selectors = ${JSON.stringify(selectors)};
        let matched = 0;
        let hidden = 0;
        for (const selector of selectors) {
          try {
            for (const element of document.querySelectorAll(selector)) {
              matched++;
              if (getComputedStyle(element).display === "none") hidden++;
            }
          } catch {}
        }
        return {
          title: document.title,
          readyState: document.readyState,
          // What the stand-in for doubleclick's ad_status.js sets.
          google_ad_status: window.google_ad_status ?? null,
          elementsMatched: matched,
          elementsHidden: hidden,
        };
      })()`),
    );
  } catch (error) {
    page.probeError = error.message;
  }

  report.stage = "done";
  Object.assign(report, {
    finalUrl,
    counts: blocker.counts,
    requests,
    document: {
      cssRules: selectors.length,
      procedural: given.procedural.length,
      generic: given.generic,
      scriptlets: given.scriptlets.map((call) => call.name),
    },
    page,
    blockerErrors,
  });
  finish(0);
}

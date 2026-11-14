import { build } from "esbuild";

// What the page-side code may use: a current Chromium, as Electron has.
const TARGET = "chrome120";

/**
 * Bundles the scriptlets and their runner into the source of one function,
 * `function (calls) { … }`, that needs nothing from outside itself: the
 * preload passes it to `contextBridge.executeInMainWorld`, which only keeps
 * a function's own text.
 */
export async function bundleScriptlets(): Promise<string> {
  const result = await build({
    entryPoints: ["src/scriptlets/runner.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "tokioScriptlets",
    target: TARGET,
    minify: true,
    legalComments: "none",
  });
  const code = result.outputFiles[0]!.text;
  return `function (calls) {\n${code}\ntokioScriptlets.run(calls);\n}`;
}

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

/**
 * Bundles the preload into one CommonJS file that requires nothing but
 * `electron`, which is all a sandboxed preload can load. The scriptlets go
 * in as the one function `bundleScriptlets()` makes.
 */
export async function bundlePreload(): Promise<string> {
  const scriptlets = await bundleScriptlets();
  const result = await build({
    entryPoints: ["src/content/preload.ts"],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "browser",
    external: ["electron"],
    target: TARGET,
    legalComments: "none",
    plugins: [
      {
        name: "scriptlets",
        setup(builder) {
          builder.onLoad({ filter: /[\\/]content[\\/]mainWorld\.ts$/ }, () => ({
            contents: `export const runScriptlets = ${scriptlets};`,
            loader: "js",
          }));
        },
      },
    ],
  });
  return result.outputFiles[0]!.text;
}

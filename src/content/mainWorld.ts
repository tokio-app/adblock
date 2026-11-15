import { run } from "../scriptlets/runner.js";
import type { ScriptletCall } from "../scriptlets/types.js";

/**
 * Runs a document's scriptlets. The preload hands this function to the
 * page's own world, which only keeps a function's own text: the build
 * (`scripts/build`) replaces this file with the scriptlets bundled into one
 * self-contained function. From source, as in tests, it just calls them.
 */
export function runScriptlets(calls: ScriptletCall[]): void {
  run(calls);
}

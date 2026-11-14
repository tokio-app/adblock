import { findScriptlet } from "./index.js";
import type { ScriptletCall } from "./types.js";

/**
 * Runs a page's scriptlets, in the page's own world. The build bundles this
 * file into one self-contained function for the preload to hand to the page
 * (`scripts/build`). One scriptlet failing never stops the next, and never
 * reaches the page.
 */
export function run(calls: readonly ScriptletCall[]): void {
  for (const { name, args } of calls) {
    try {
      findScriptlet(name)?.run(...args);
    } catch {
      // A page that breaks a scriptlet only loses that scriptlet.
    }
  }
}

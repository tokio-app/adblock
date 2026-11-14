import {
  abortCurrentScript,
  abortOnPropertyRead,
  abortOnPropertyWrite,
  abortOnStackTrace,
} from "./abort.js";
import { addEventListenerDefuser } from "./events.js";
import { setConstantScriptlet, trustedSetConstant } from "./setConstant.js";
import {
  adjustSetInterval,
  adjustSetTimeout,
  preventSetInterval,
  preventSetTimeout,
} from "./timers.js";
import type { Scriptlet } from "./types.js";

/** Every scriptlet the library has. A new one is added here. */
export const SCRIPTLETS: readonly Scriptlet[] = [
  abortCurrentScript,
  abortOnPropertyRead,
  abortOnPropertyWrite,
  abortOnStackTrace,
  addEventListenerDefuser,
  adjustSetInterval,
  adjustSetTimeout,
  preventSetInterval,
  preventSetTimeout,
  setConstantScriptlet,
  trustedSetConstant,
];

const byName = new Map<string, Scriptlet>();
for (const scriptlet of SCRIPTLETS) {
  for (const name of [scriptlet.name, ...(scriptlet.aliases ?? [])]) {
    byName.set(name, scriptlet);
  }
}

/** The scriptlet a filter names, by its name or an alias, with or without `.js`. */
export function findScriptlet(token: string): Scriptlet | undefined {
  return byName.get(token.endsWith(".js") ? token.slice(0, -3) : token);
}

export type { Scriptlet, ScriptletCall } from "./types.js";

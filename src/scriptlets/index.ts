import { DEFUSERS } from "../resources/defusers.js";
import {
  abortCurrentScript,
  abortOnPropertyRead,
  abortOnPropertyWrite,
  abortOnStackTrace,
} from "./abort.js";
import { DOM_SCRIPTLETS } from "./dom/index.js";
import { addEventListenerDefuser } from "./events.js";
import { NETWORK_SCRIPTLETS } from "./network/index.js";
import { setConstantScriptlet, trustedSetConstant } from "./setConstant.js";
import {
  adjustSetInterval,
  adjustSetTimeout,
  preventSetInterval,
  preventSetTimeout,
} from "./timers.js";
import type { Scriptlet } from "./types.js";

// The names lists call the defusers by, besides their own.
const DEFUSER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ampproject_v0: ["ampproject.org/v0"],
  nobab: ["bab-defuser"],
  nofab: ["fuckadblock.js-3.2.0"],
  popads: ["popads.net"],
};

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
  ...DOM_SCRIPTLETS,
  ...NETWORK_SCRIPTLETS,
  // The redirect resources that work as scriptlets too.
  ...Object.entries(DEFUSERS).map(([name, run]) => ({
    name,
    aliases: DEFUSER_ALIASES[name],
    run,
  })),
];

const byName = new Map<string, Scriptlet>();
for (const scriptlet of SCRIPTLETS) {
  for (const name of [scriptlet.name, ...(scriptlet.aliases ?? [])]) {
    byName.set(name, scriptlet);
  }
}

/** The scriptlet a filter names, by its name or an alias, with or without `.js`. */
export function findScriptlet(token: string): Scriptlet | undefined {
  return (
    byName.get(token) ??
    byName.get(token.endsWith(".js") ? token.slice(0, -3) : token)
  );
}

export type { Scriptlet, ScriptletCall } from "./types.js";

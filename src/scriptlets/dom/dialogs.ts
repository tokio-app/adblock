import { wrapMethod } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import { watch } from "./watch.js";

const { apply } = Reflect;

export const preventDialog: Scriptlet = {
  name: "prevent-dialog",
  run(selector = "") {
    watch(
      `dialog${selector}`,
      (dialog) => {
        if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
      },
      ["open"],
    );
  },
};

export const alertBuster: Scriptlet = {
  name: "alert-buster",
  run() {
    const info = console.info;
    wrapMethod(window, "alert", (_original, _self, args) => {
      apply(info, console, args);
    });
  },
};

import { tokens, wrapMethod } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import {
  editFetchRequests,
  editFetchResponses,
  type TextEdit,
} from "./fetch.js";
import { REMOVED, compileJsonPath } from "./jsonPath.js";
import { requestMatcher } from "./request.js";
import { onMethod, position } from "./util.js";
import { editXhrRequests, editXhrResponses } from "./xhr.js";

const { parse, stringify } = JSON;

/** An edit of a value in place: the new root, or undefined for no change. */
export type ValueEdit = (data: unknown) => { root: unknown } | undefined;

/** The value to use after an edit: a removed root stays as it was. */
function edited(edit: ValueEdit, data: unknown): unknown {
  const result = edit(data);
  return result === undefined || result.root === REMOVED ? data : result.root;
}

/** A text edit that parses JSON, edits it and gives its text back. */
export function jsonTextEdit(edit: ValueEdit): TextEdit {
  return (text) => {
    const result = edit(parse(text));
    return result === undefined || result.root === REMOVED
      ? undefined
      : stringify(result.root);
  };
}

/** The same for JSONL, line by line: a removed root drops its line. */
function jsonlTextEdit(edit: ValueEdit): TextEdit {
  return (text) => {
    let changed = false;
    const lines = text.split("\n").flatMap((line) => {
      let data: unknown;
      try {
        data = parse(line);
      } catch {
        return [line];
      }
      const result = edit(data);
      if (result === undefined) return [line];
      changed = true;
      return result.root === REMOVED ? [] : [stringify(result.root)];
    });
    return changed ? lines.join("\n") : undefined;
  };
}

/** The scriptlet and its `trusted-` twin, which may assign values. */
function withTrusted(
  name: string,
  run: (edit: ValueEdit, args: string[]) => void,
  queryAt = 0,
): Scriptlet[] {
  const make = (trusted: boolean): Scriptlet => ({
    name: trusted ? `trusted-${name}` : name,
    ...(trusted ? { trusted } : {}),
    run(...args) {
      const edit = compileJsonPath(args[queryAt] ?? "", trusted);
      if (edit !== undefined) run(edit, args);
    },
  });
  return [make(false), make(true)];
}

function onRequests(
  install: typeof editFetchResponses,
  toText: (edit: ValueEdit) => TextEdit,
) {
  return (edit: ValueEdit, args: string[]) =>
    install(requestMatcher(tokens(args, 1).propsToMatch), toText(edit));
}

export const EDIT_SCRIPTLETS: readonly Scriptlet[] = [
  ...withTrusted("json-edit", (edit) => {
    wrapMethod(JSON, "parse", (original, _self, args) =>
      edited(edit, original(...args)),
    );
  }),
  ...withTrusted(
    "json-edit-xhr-response",
    onRequests(editXhrResponses, jsonTextEdit),
  ),
  ...withTrusted(
    "json-edit-xhr-request",
    onRequests(editXhrRequests, jsonTextEdit),
  ),
  ...withTrusted(
    "json-edit-fetch-response",
    onRequests(editFetchResponses, jsonTextEdit),
  ),
  ...withTrusted(
    "json-edit-fetch-request",
    onRequests(editFetchRequests, jsonTextEdit),
  ),
  ...withTrusted(
    "jsonl-edit-xhr-response",
    onRequests(editXhrResponses, jsonlTextEdit),
  ),
  ...withTrusted(
    "jsonl-edit-fetch-response",
    onRequests(editFetchResponses, jsonlTextEdit),
  ),
  ...withTrusted(
    "edit-outbound-object",
    (edit, [chain = ""]) =>
      onMethod(chain, (original, _self, args) =>
        edited(edit, original(...args)),
      ),
    1,
  ),
  ...withTrusted(
    "edit-inbound-object",
    (edit, [chain = "", at = ""]) =>
      onMethod(chain, (original, _self, args) => {
        const index = position(at, args.length);
        if (index !== undefined && index >= 0 && index < args.length) {
          args[index] = edited(edit, args[index]);
        }
        return original(...args);
      }),
    2,
  ),
  ...withTrusted(
    "edit-this-object",
    (edit, [chain = ""]) =>
      onMethod(chain, (original, self, args) => {
        edit(self);
        return original(...args);
      }),
    1,
  ),
  ...withTrusted(
    "edit-element-object",
    (edit, [selector = "", , timeout = ""]) => {
      // Each element is edited once, as soon as it is in the document.
      const done = new WeakSet<Element>();
      const scan = () => {
        try {
          for (const element of document.querySelectorAll(selector)) {
            if (done.has(element)) continue;
            done.add(element);
            edit(element);
          }
        } catch {
          observer.disconnect();
        }
      };
      const observer = new MutationObserver(scan);
      observer.observe(document, { childList: true, subtree: true });
      scan();
      const ms = Number(timeout);
      if (ms > 0) setTimeout(() => observer.disconnect(), ms);
    },
    1,
  ),
];

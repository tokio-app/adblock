import type { Scriptlet } from "../types.js";
import {
  removeAttr,
  removeClass,
  setAttrScriptlet,
  trustedSetAttr,
} from "./attributes.js";
import { trustedClickElement } from "./click.js";
import {
  removeCookie,
  setCookieReload,
  setCookieScriptlet,
  trustedSetCookieReload,
  trustedSetCookieScriptlet,
} from "./cookies.js";
import { trustedCreateHtml } from "./createHtml.js";
import { alertBuster, preventDialog } from "./dialogs.js";
import { hrefSanitizer } from "./hrefSanitizer.js";
import {
  closeWindow,
  disableNewtabLinks,
  preventRefresh,
  windowNameDefuser,
} from "./navigation.js";
import { removeNodeText, trustedReplaceNodeText } from "./nodeText.js";
import { spoofCss } from "./spoofCss.js";
import {
  setLocalStorageItem,
  setSessionStorageItem,
  trustedSetLocalStorageItem,
  trustedSetSessionStorageItem,
} from "./storage.js";

/** The scriptlets that act on the document, its cookies and its storage. */
export const DOM_SCRIPTLETS: readonly Scriptlet[] = [
  alertBuster,
  closeWindow,
  disableNewtabLinks,
  hrefSanitizer,
  preventDialog,
  preventRefresh,
  removeAttr,
  removeClass,
  removeCookie,
  removeNodeText,
  setAttrScriptlet,
  setCookieReload,
  setCookieScriptlet,
  setLocalStorageItem,
  setSessionStorageItem,
  spoofCss,
  trustedClickElement,
  trustedCreateHtml,
  trustedReplaceNodeText,
  trustedSetAttr,
  trustedSetCookieReload,
  trustedSetCookieScriptlet,
  trustedSetLocalStorageItem,
  trustedSetSessionStorageItem,
  windowNameDefuser,
];

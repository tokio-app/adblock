import type { Scriptlet } from "../types.js";
import { EDIT_SCRIPTLETS } from "./edit.js";
import { noEval, noEvalIf } from "./eval.js";
import { preventFetchScriptlet, trustedPreventFetch } from "./fetch.js";
import { m3uPrune, xmlPrune } from "./media.js";
import {
  callNothrow,
  trustedOverrideElementMethod,
  trustedPreventDomBypass,
  trustedSuppressNativeMethod,
} from "./methods.js";
import {
  evaldataPrune,
  jsonPrune,
  jsonPruneFetchResponse,
  jsonPruneXhrResponse,
  trustedPruneInboundObject,
  trustedPruneOutboundObject,
} from "./prune.js";
import {
  preventCanvas,
  preventInnerHtml,
  preventRequestAnimationFrame,
} from "./rendering.js";
import {
  trustedReplaceArgument,
  trustedReplaceFetchResponse,
  trustedReplaceOutboundText,
  trustedReplaceXhrResponse,
} from "./replace.js";
import { noWebrtc, webrtcIf } from "./webrtc.js";
import { preventWindowOpen } from "./windowOpen.js";
import { preventXhrScriptlet, trustedPreventXhr } from "./xhr.js";

/** The scriptlets that act on requests, responses and the data they carry. */
export const NETWORK_SCRIPTLETS: readonly Scriptlet[] = [
  ...EDIT_SCRIPTLETS,
  callNothrow,
  evaldataPrune,
  jsonPrune,
  jsonPruneFetchResponse,
  jsonPruneXhrResponse,
  m3uPrune,
  noEval,
  noEvalIf,
  noWebrtc,
  preventCanvas,
  preventFetchScriptlet,
  preventInnerHtml,
  preventRequestAnimationFrame,
  preventWindowOpen,
  preventXhrScriptlet,
  trustedOverrideElementMethod,
  trustedPreventDomBypass,
  trustedPreventFetch,
  trustedPreventXhr,
  trustedPruneInboundObject,
  trustedPruneOutboundObject,
  trustedReplaceArgument,
  trustedReplaceFetchResponse,
  trustedReplaceOutboundText,
  trustedReplaceXhrResponse,
  trustedSuppressNativeMethod,
  webrtcIf,
  xmlPrune,
];

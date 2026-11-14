import { matcher } from "../helpers.js";
import type { Scriptlet } from "../types.js";
import { isObject, wrapCallable } from "./util.js";

const NAMES = ["RTCPeerConnection", "webkitRTCPeerConnection"];

/** A connection that never connects: what pages get in place of WebRTC. */
function deadConnection(): EventTarget {
  const connection = new EventTarget();
  const nothing = () => undefined;
  const later = () => Promise.resolve();
  const channel = Object.assign(new EventTarget(), {
    close: nothing,
    send: nothing,
  });
  return Object.assign(connection, {
    close: nothing,
    addTrack: nothing,
    removeTrack: nothing,
    addTransceiver: nothing,
    createDataChannel: () => channel,
    createOffer: later,
    createAnswer: later,
    setLocalDescription: later,
    setRemoteDescription: later,
    addIceCandidate: later,
    getStats: () => Promise.resolve(new Map()),
    getSenders: () => [],
    getReceivers: () => [],
    getTransceivers: () => [],
  });
}

export const noWebrtc: Scriptlet = {
  name: "nowebrtc",
  run() {
    for (const name of NAMES) {
      wrapCallable(window, name, () => deadConnection());
    }
  },
};

export const webrtcIf: Scriptlet = {
  name: "webrtc-if",
  run(needle = "") {
    if (needle === "") return;
    const matches = matcher(needle);
    // The connection keeps only the servers the filter allows.
    const allowed = (server: unknown) =>
      isObject(server) &&
      [server.urls, server.username, server.credential]
        .flat()
        .some((value) => typeof value === "string" && matches(value));
    for (const name of NAMES) {
      wrapCallable(window, name, (original, _self, args) => {
        const [config] = args;
        if (isObject(config) && Array.isArray(config.iceServers)) {
          args[0] = {
            ...config,
            iceServers: config.iceServers.filter(allowed),
          };
        }
        return original(...args);
      });
    }
  },
};

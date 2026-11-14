import { describe, expect, test } from "vitest";
import { createPage, type TestPage } from "../../../test/helpers/page.js";

/** jsdom has no WebRTC: a stand-in that records the configs it gets. */
function stubRtc(page: TestPage) {
  page.run(`
    window.configs = [];
    window.RTCPeerConnection = class RTCPeerConnection {
      constructor(config) { configs.push(config); this.real = true; }
    };
    window.webkitRTCPeerConnection = window.RTCPeerConnection;
  `);
}

describe("nowebrtc", () => {
  test("pages get a connection that never connects", async () => {
    const page = await createPage();
    stubRtc(page);
    page.inject("nowebrtc");
    const result = page.run(`
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.example" }] });
      const channel = pc.createDataChannel("x");
      channel.send("hi");
      pc.close();
      [pc.real, configs.length, pc instanceof EventTarget, typeof pc.createOffer().then,
        new webkitRTCPeerConnection().real]
    `);
    expect(result).toEqual([undefined, 0, true, "function", undefined]);
  });

  test("does nothing on a page without WebRTC", async () => {
    const page = await createPage();
    page.inject("nowebrtc");
    expect(page.run("'RTCPeerConnection' in window")).toBe(false);
  });
});

describe("webrtc-if", () => {
  test("keeps only the ICE servers that match", async () => {
    const page = await createPage();
    stubRtc(page);
    page.inject("webrtc-if", "/allowed\\.example/");
    page.run(`
      new RTCPeerConnection({ iceServers: [
        { urls: ["stun:allowed.example", "stun:x.example"] },
        { urls: "turn:other.example", username: "allowed.example" },
        { urls: "stun:blocked.example" },
      ] });
      new RTCPeerConnection();
    `);
    expect(page.run("JSON.stringify(configs)")).toBe(
      JSON.stringify([
        {
          iceServers: [
            { urls: ["stun:allowed.example", "stun:x.example"] },
            { urls: "turn:other.example", username: "allowed.example" },
          ],
        },
        null,
      ]),
    );
  });

  test("without a needle nothing changes", async () => {
    const page = await createPage();
    stubRtc(page);
    const before = page.run("RTCPeerConnection");
    page.inject("webrtc-if");
    expect(page.run("RTCPeerConnection")).toBe(before);
  });
});

import { JSDOM } from "jsdom";
import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { findResource } from "./index.js";

const bytes = (name: string) => Buffer.from(findResource(name)!.body);

describe("1x1.gif", () => {
  const gif = bytes("1x1.gif");

  it("is a 43-byte GIF89a of one transparent pixel", () => {
    expect(gif.length).toBe(43);
    expect(gif.toString("latin1", 0, 6)).toBe("GIF89a");
    expect([gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual([1, 1]);
    const tableSize = 2 << (gif[10]! & 7);
    expect(gif[10]! & 0x80).toBe(0x80);
    let at = 13 + tableSize * 3;
    // Graphic control extension, transparency on, for color 0.
    expect([gif[at], gif[at + 1], gif[at + 3]! & 1, gif[at + 6]]).toEqual([
      0x21, 0xf9, 1, 0,
    ]);
    at += 8;
    expect(gif[at]).toBe(0x2c);
    expect([gif.readUInt16LE(at + 5), gif.readUInt16LE(at + 7)]).toEqual([
      1, 1,
    ]);
    at += 10;
    const minimum = gif[at]!;
    const size = gif[at + 1]!;
    const data = gif.subarray(at + 2, at + 2 + size);
    // Read the LZW codes, low bit first.
    const width = minimum + 1;
    let bits = 0;
    for (let i = data.length - 1; i >= 0; i--) bits = bits * 256 + data[i]!;
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((bits >> (i * width)) & 7);
    expect(codes).toEqual([1 << minimum, 0, (1 << minimum) + 1]);
    expect(gif[at + 2 + size]).toBe(0);
    expect(gif[gif.length - 1]).toBe(0x3b);
  });
});

describe.each([
  ["2x2.png", 2, 2],
  ["3x2.png", 3, 2],
  ["32x32.png", 32, 32],
])("%s", (name, width, height) => {
  it("is a valid transparent PNG of its size", () => {
    const png = bytes(name);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const chunks: [string, Buffer][] = [];
    for (let at = 8; at < png.length;) {
      const length = png.readUInt32BE(at);
      const typeAndData = png.subarray(at + 4, at + 8 + length);
      expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(typeAndData));
      chunks.push([
        typeAndData.toString("latin1", 0, 4),
        typeAndData.subarray(4),
      ]);
      at += 12 + length;
    }
    expect(chunks.map(([type]) => type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const header = chunks[0]![1];
    expect([header.readUInt32BE(0), header.readUInt32BE(4)]).toEqual([
      width,
      height,
    ]);
    expect([...header.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    const rows = inflateSync(chunks[1]![1]);
    expect(rows.length).toBe(height * (1 + width * 4));
    for (let row = 0; row < height; row++) {
      const start = row * (1 + width * 4);
      expect(rows[start]).toBe(0);
      for (let x = 0; x < width; x++)
        expect(rows[start + 1 + x * 4 + 3]).toBe(0);
    }
  });

  it("checks the CRC the way the PNG specification defines it", () => {
    // The specification's sample value: the CRC of an IEND chunk.
    expect(bytes(name).readUInt32BE(bytes(name).length - 4)).toBe(0xae426082);
  });
});

// MPEG-1 Layer III tables, the entries these files may use.
const BITRATES = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const RATES = [44100, 48000, 32000];

describe.each([
  ["noop-0.1s.mp3", 0.1],
  ["noop-0.5s.mp3", 0.5],
])("%s", (name, seconds) => {
  it("is MPEG-1 Layer III frames of silence lasting about that long", () => {
    const mp3 = bytes(name);
    let duration = 0;
    let frames = 0;
    for (let at = 0; at < mp3.length;) {
      const header = mp3.readUInt32BE(at);
      expect(header >>> 21).toBe(0x7ff); // frame sync
      expect((header >>> 19) & 3).toBe(3); // MPEG-1
      expect((header >>> 17) & 3).toBe(1); // Layer III
      const bitrate = BITRATES[(header >>> 12) & 15]! * 1000;
      const rate = RATES[(header >>> 10) & 3]!;
      const padding = (header >>> 9) & 1;
      expect(bitrate).toBeGreaterThan(0);
      const length = Math.floor((144 * bitrate) / rate) + padding;
      expect(
        mp3.subarray(at + 4, at + length).every((byte) => byte === 0),
      ).toBe(true);
      duration += 1152 / rate;
      frames++;
      at += length;
    }
    expect(frames).toBeGreaterThan(0);
    expect(Math.abs(duration - seconds)).toBeLessThanOrEqual(1152 / 48000);
  });
});

describe("XML", () => {
  const parse = (name: string) => {
    const { DOMParser } = new JSDOM().window;
    const xml = new DOMParser().parseFromString(
      findResource(name)!.body as string,
      "application/xml",
    );
    expect(xml.getElementsByTagName("parsererror")).toHaveLength(0);
    return xml.documentElement;
  };

  it.each([
    ["noop-vast2.xml", "2.0"],
    ["noop-vast3.xml", "3.0"],
    ["noop-vast4.xml", "4.0"],
  ])("%s is an empty VAST %s response", (name, version) => {
    const root = parse(name);
    expect(root.localName).toBe("VAST");
    expect(root.getAttribute("version")).toBe(version);
    expect(root.children).toHaveLength(0);
  });

  it("noop-vmap1.xml is an empty VMAP 1.0 playlist", () => {
    const root = parse("noop-vmap1.xml");
    expect(root.localName).toBe("VMAP");
    expect(root.namespaceURI).toBe("http://www.iab.net/videosuite/vmap");
    expect(root.getAttribute("version")).toBe("1.0");
    expect(root.children).toHaveLength(0);
  });
});

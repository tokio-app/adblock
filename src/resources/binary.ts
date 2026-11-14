// The image and sound resources, built from their format specifications.
import { crc32, deflateSync } from "node:zlib";

/** A 1x1 transparent GIF89a: 43 bytes. */
export function gif(): Uint8Array {
  return Uint8Array.of(
    ...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // "GIF89a"
    // Logical screen: 1x1, a global color table of 2 colors, background 0.
    ...[1, 0, 1, 0, 0x80, 0, 0],
    ...[0, 0, 0, 0xff, 0xff, 0xff],
    // Graphic control extension: color 0 is transparent.
    ...[0x21, 0xf9, 4, 1, 0, 0, 0, 0],
    // Image descriptor: 1x1 at 0,0, no local color table.
    ...[0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0],
    // LZW, minimum code size 2: the 3-bit codes clear (4), 0, end (5),
    // packed from the low bit up, in one 2-byte sub-block.
    ...[2, 2, 0x44, 0x01, 0],
    0x3b,
  );
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A transparent PNG: 8-bit RGBA, every pixel 0. */
export function png(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // depth 8, RGBA, deflate, no filter, no interlace
  // Each row is a filter byte (0, none) and its pixels, all zero.
  const pixels = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", new Uint8Array()),
  ]);
}

// MPEG-1 Layer III, 32 kbit/s, 48 kHz, mono, no CRC: every frame is
// 144 * 32000 / 48000 = 96 bytes and lasts 1152 / 48000 = 24 ms.
const FRAME_BYTES = 96;
const FRAME_SECONDS = 0.024;

/**
 * A silent MP3 of about `seconds`: frames whose side information and data
 * are all zero, so every granule decodes to silence.
 */
export function mp3(seconds: number): Uint8Array {
  const frames = Math.round(seconds / FRAME_SECONDS);
  const out = new Uint8Array(frames * FRAME_BYTES);
  for (let i = 0; i < frames; i++) {
    out.set([0xff, 0xfb, 0x14, 0xc0], i * FRAME_BYTES);
  }
  return out;
}

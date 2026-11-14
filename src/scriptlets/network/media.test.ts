import { describe, expect, test } from "vitest";
import { dataUrl, stubFetch, xhr } from "../../../test/helpers/fakes.js";
import { createPage } from "../../../test/helpers/page.js";

const MPD = `<?xml version="1.0"?><MPD duration="P1"><Period id="pre-roll-ad-1"><AdaptationSet/></Period><Period id="main"><SegmentTimeline/></Period></MPD>`;

const M3U = [
  "#EXTM3U",
  "#EXTINF:5,",
  "https://ads.example/ad1.ts",
  "#EXTINF:5,",
  "https://cdn.example/video1.ts",
  "#EXT-X-DISCONTINUITY",
  "#EXTINF:5,ad",
  "https://cdn.example/a.ts",
  "#EXT-X-DISCONTINUITY",
  "#EXTINF:5,",
  "https://cdn.example/video2.ts",
].join("\n");

describe("xml-prune", () => {
  test("removes the elements a selector finds, from responses from URLs that match", async () => {
    const page = await createPage();
    stubFetch(page.window, () => MPD);
    page.inject("xml-prune", 'Period[id*="-roll-"][id*="-ad-"]', "", ".mpd");
    const text = (url: string) =>
      page.run(`fetch("${url}").then((r) => r.text())`);
    const pruned = (await text("https://x.example/a.mpd")) as string;
    expect(pruned).not.toContain("pre-roll");
    expect(pruned).toContain('<Period id="main">');
    await expect(text("https://x.example/a.xml")).resolves.toBe(MPD);
  });

  test("xpath, for elements and attributes, and a needle that must be found", async () => {
    const page = await createPage();
    // jsdom's XPath has no name(), which filters use for namespaced documents.
    page.inject(
      "xml-prune",
      "xpath(//Period[not(.//SegmentTimeline)])",
      "",
      "mpd",
    );
    page.inject("xml-prune", "xpath(//MPD/@duration)", "Period#main", "mpd");
    page.inject("xml-prune", "Period", "NoSuchElement", "mpd");
    const pruned = (await xhr(
      page,
      dataUrl(MPD, "application/dash+xml;mpd"),
    )) as string;
    expect(pruned).not.toContain("pre-roll");
    expect(pruned).not.toContain("duration");
    expect(pruned).toContain('<Period id="main">');
  });

  test("text that isn't XML passes", async () => {
    const page = await createPage();
    page.inject("xml-prune", "Period");
    await expect(xhr(page, dataUrl("<not xml"))).resolves.toBe("<not xml");
    await expect(xhr(page, dataUrl('{"a":1}'))).resolves.toBe('{"a":1}');
  });
});

describe("m3u-prune", () => {
  test("removes the segments whose lines match", async () => {
    const page = await createPage();
    stubFetch(page.window, () => M3U);
    page.inject("m3u-prune", "ads.example", ".m3u8");
    page.inject("m3u-prune", "/#EXTINF:5,ad/", ".m3u8");
    const text = (await page.run(
      `fetch("https://x.example/a.m3u8").then((r) => r.text())`,
    )) as string;
    expect(text.split("\n")).toEqual([
      "#EXTM3U",
      "#EXTINF:5,",
      "https://cdn.example/video1.ts",
      "#EXT-X-DISCONTINUITY",
      "#EXT-X-DISCONTINUITY",
      "#EXTINF:5,",
      "https://cdn.example/video2.ts",
    ]);
  });

  test("a multiline regex removes what it matches when it is whole lines", async () => {
    const page = await createPage();
    page.inject(
      "m3u-prune",
      "/#EXT-X-DISCONTINUITY\\n#EXTINF:5,ad\\n.*\\n#EXT-X-DISCONTINUITY\\n/m",
      "m3u",
    );
    page.inject("m3u-prune", "/video\\d/m", "m3u");
    const text = (await xhr(
      page,
      dataUrl(M3U, "application/x-mpegurl;m3u"),
    )) as string;
    expect(text).not.toContain("a.ts");
    expect(text).not.toContain("DISCONTINUITY");
    // Part of a line is never removed.
    expect(text).toContain("video1.ts");
    await expect(
      xhr(page, dataUrl("not a playlist video1", "text/plain;m3u")),
    ).resolves.toBe("not a playlist video1");
  });
});

import type { ListDefinition } from "./manager.js";

const UASSETS = "https://ublockorigin.github.io/uAssets";
const UASSETS_MIRRORS = [
  "https://ublockorigin.github.io/uAssetsCDN",
  "https://ublockorigin.pages.dev",
  "https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main",
];

/** One of uBlock Origin's own lists: trusted, with its CDN mirrors. */
function ublock(id: string, title: string, name: string): ListDefinition {
  return {
    id,
    title,
    trusted: true,
    urls: [
      `${UASSETS}/filters/${name}.txt`,
      ...UASSETS_MIRRORS.map((mirror) => `${mirror}/filters/${name}.min.txt`),
    ],
  };
}

function thirdParty(id: string, title: string, name: string): ListDefinition {
  return {
    id,
    title,
    urls: [
      `${UASSETS}/thirdparties/${name}.txt`,
      "https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main/thirdparties/" +
        `${name}.txt`,
      `https://ublockorigin.pages.dev/thirdparties/${name}.txt`,
    ],
  };
}

/**
 * The lists uBlock Origin enables by default, from its published asset index
 * (`assets/assets.json`), with the same ids.
 */
export const DEFAULT_LISTS: readonly ListDefinition[] = [
  ublock("ublock-filters", "uBlock filters – Ads", "filters"),
  ublock("ublock-badware", "uBlock filters – Badware risks", "badware"),
  ublock("ublock-privacy", "uBlock filters – Privacy", "privacy"),
  ublock("ublock-unbreak", "uBlock filters – Unbreak", "unbreak"),
  ublock("ublock-quick-fixes", "uBlock filters – Quick fixes", "quick-fixes"),
  thirdParty("easylist", "EasyList", "easylist"),
  thirdParty("easyprivacy", "EasyPrivacy", "easyprivacy"),
  {
    id: "urlhaus-1",
    title: "Online Malicious URL Blocklist",
    urls: [
      "https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-vivaldi-online.txt",
      "https://curbengh.github.io/malware-filter/urlhaus-filter-vivaldi-online.txt",
    ],
  },
  {
    id: "plowe-0",
    title: "Peter Lowe’s Ad and tracking server list",
    urls: [
      "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext",
    ],
    updateAfterDays: 13,
  },
];

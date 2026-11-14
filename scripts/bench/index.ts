// yarn bench: builds the network engine from the lists `yarn lists` downloaded
// and measures how long that takes, how much memory it holds and how many
// requests a second it decides. Offline: it reads lists/, it downloads nothing.
import { DEFAULT_LISTS } from "../../src/lists/defaults.js";
import { ListManager } from "../../src/lists/manager.js";
import { FileStorage } from "../../src/lists/storage.js";
import { NetworkEngine } from "../../src/network/engine.js";
import type { RequestInfo, RequestType } from "../../src/network/request.js";
import { emptyParsedList, parseInto } from "../../src/parser/index.js";
import { F_EXCEPTION, P_HOST } from "../../src/parser/types.js";
import { PublicSuffixList } from "../../src/psl/psl.js";

const REQUESTS = 200_000;
const offline = () => Promise.reject(new Error("offline"));
const storage = new FileStorage("lists");
const manager = new ListManager({ storage, fetch: offline });

const heap = () => {
  globalThis.gc?.();
  return process.memoryUsage().heapUsed / 1e6;
};
const ms = (from: number) => `${(performance.now() - from).toFixed(0)} ms`;

const heapBefore = heap();
let started = performance.now();
// `--skip <list id>`, as many times as needed: what a list costs is the
// difference between two runs.
const skipped = process.argv.filter(
  (_, index, args) => args[index - 1] === "--skip",
);
const lists = [];
for (const list of DEFAULT_LISTS) {
  if (skipped.includes(list.id)) continue;
  try {
    lists.push(await manager.load(list));
  } catch {
    console.error(`${list.id} isn't in lists/: run \`yarn lists\` first`);
    process.exit(1);
  }
}
const suffixes = await storage.read("public_suffix_list");
console.log(`read and preprocess   ${ms(started)}`);

started = performance.now();
const parsed = lists.map((list) => {
  const rules = emptyParsedList();
  parseInto(rules, list.lines, { trusted: list.trusted });
  return rules;
});
const lines = lists.reduce((total, list) => total + list.lines.length, 0);
console.log(`parse                 ${ms(started)} (${lines} lines)`);

started = performance.now();
const engine = new NetworkEngine({ psl: new PublicSuffixList(suffixes?.text) });
// Hostnames the lists block, to ask about later.
const blockedHosts: string[] = [];
for (const rules of parsed) {
  engine.add(rules.network);
  rules.network.forEach((rule, index) => {
    if (
      index % 400 === 0 &&
      rule.patternKind === P_HOST &&
      !(rule.flags & F_EXCEPTION)
    ) {
      blockedHosts.push(rule.pattern);
    }
  });
}
engine.finalize();
console.log(
  `file the rules        ${ms(started)} (${engine.stats.rules} rules, ` +
    `${engine.stats.badfiltered} removed by badfilter)`,
);
parsed.length = 0;
lists.length = 0;
console.log(
  `heap held             ${(heap() - heapBefore).toFixed(0)} MB` +
    (globalThis.gc ? "" : " (inexact: run with --expose-gc)"),
);
console.log(
  `public suffix list    ${engine.psl.loaded ? "loaded" : "missing: guessing"}`,
);
const unknown = Object.entries(engine.stats.unknownResources);
console.log(
  `unknown resources     ${unknown.length === 0 ? "none" : unknown.map(([name, count]) => `${name} (${count})`).join(", ")}`,
);
for (const [kind, filed] of Object.entries(engine.describe())) {
  console.log(`  ${kind.padEnd(10)} ${filed}`);
}

// What a page asks for: mostly its own and CDN resources, some of them ads.
// Made up, in the shape of real traffic.
const TEMPLATES: [type: RequestType, url: (n: number) => string][] = [
  ["script", (n) => `https://static.site${n % 50}.example/assets/app.${n}.js`],
  [
    "stylesheet",
    (n) => `https://static.site${n % 50}.example/css/main.${n}.css`,
  ],
  ["image", (n) => `https://img.cdn${n % 20}.example/photos/${n}/large.jpg`],
  ["image", (n) => `https://i.video${n % 9}.example/vi/${n}/hqdefault.jpg`],
  [
    "font",
    (n) => `https://fonts.cdn${n % 5}.example/s/inter/v${n % 30}/a.woff2`,
  ],
  [
    "xhr",
    (n) => `https://api.site${n % 50}.example/v1/items?page=${n}&sort=new`,
  ],
  ["xhr", (n) => `https://www.site${n % 50}.example/graphql?op=Feed&id=${n}`],
  ["media", (n) => `https://media${n % 7}.video.example/videoplayback?id=${n}`],
  [
    "script",
    (n) =>
      `https://cdn.pkg.example/npm/lib${n % 300}@1.2.${n % 9}/index.min.js`,
  ],
  ["subdocument", (n) => `https://embed.player${n % 4}.example/embed/${n}`],
  ["ping", (n) => `https://www.site${n % 50}.example/log?event=view&n=${n}`],
  ["websocket", (n) => `wss://live.site${n % 50}.example/socket?room=${n}`],
];
const requests: RequestInfo[] = [];
for (let n = 0; n < REQUESTS; n++) {
  const sourceUrl = `https://www.site${n % 50}.example/article/${n % 1000}`;
  if (n % 5 === 0 && blockedHosts.length > 0) {
    const host = blockedHosts[n % blockedHosts.length]!;
    requests.push({
      url: `https://${n % 2 ? "cdn." : ""}${host}/tag/${n}/ads.js?cb=${n}`,
      type: n % 3 ? "script" : "image",
      sourceUrl,
    });
  } else {
    const [type, url] = TEMPLATES[n % TEMPLATES.length]!;
    requests.push({ url: url(n), type, sourceUrl });
  }
}

for (const round of ["warm-up", "measured"]) {
  let blocked = 0;
  let rewritten = 0;
  started = performance.now();
  for (const info of requests) {
    const request = engine.request(info);
    if (engine.match(request).block) blocked++;
    else if (engine.rewrite(request) !== undefined) rewritten++;
  }
  const elapsed = performance.now() - started;
  if (round === "warm-up") continue;
  console.log(
    `decide ${REQUESTS} requests  ${elapsed.toFixed(0)} ms: ` +
      `${Math.round((REQUESTS / elapsed) * 1000)} requests/s, ` +
      `${((elapsed / REQUESTS) * 1000).toFixed(1)} µs each ` +
      `(${blocked} blocked, ${rewritten} rewritten)`,
  );
}

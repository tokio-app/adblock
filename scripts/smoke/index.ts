// yarn smoke [url] [--seconds N] [--show]: builds the package, launches
// Electron against a real page with the default lists, writes
// reports/smoke.json and prints a summary. Opt-in: it needs the network.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { failures, formatSummary, type SmokeReport } from "./summary.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    [
      "yarn smoke [url] [--seconds N] [--show]",
      "",
      "  url         the page to load (default: https://music.youtube.com)",
      "  --seconds   how long to let the page run after it loads (default: 15)",
      "  --show      show the window",
    ].join("\n"),
  );
  process.exit(0);
}
const flag = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const seconds = flag("--seconds") ?? "15";
const url =
  args.find(
    (arg, index) => /^https?:/.test(arg) && args[index - 1] !== "--seconds",
  ) ?? "https://music.youtube.com";
const reportFile = path.resolve("reports/smoke.json");

// Required from Node, the electron package is the path of its binary.
const electron: unknown = createRequire(import.meta.url)("electron");
if (typeof electron !== "string") {
  console.error("The electron package gave no path to its binary.");
  process.exit(1);
}
// VS Code's terminals set this, and Electron then runs as plain Node.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

fs.rmSync(reportFile, { force: true });
// The options go in a file: Electron exits at once, with status 127, when
// the first argument after the script is a URL.
const optionsFile = path.resolve("reports/smoke-options.json");
fs.mkdirSync(path.dirname(optionsFile), { recursive: true });
fs.writeFileSync(
  optionsFile,
  JSON.stringify({
    url,
    seconds: Number(seconds),
    reportFile,
    listsFolder: path.resolve("lists"),
    show: args.includes("--show"),
  }),
);
const { status, error } = spawnSync(
  electron,
  [path.resolve("scripts/smoke/main.mjs"), optionsFile],
  { env, stdio: "ignore" },
);
if (!fs.existsSync(reportFile)) {
  console.error(
    `Electron wrote no report (exit status ${status ?? error?.message}). ` +
      "Was the package built? `yarn smoke` runs `yarn build` first.",
  );
  process.exit(1);
}
const report: SmokeReport = JSON.parse(fs.readFileSync(reportFile, "utf8"));
console.log(formatSummary(report));
console.log(`\nThe whole report: ${reportFile}`);
process.exit(failures(report).length === 0 ? 0 : 1);

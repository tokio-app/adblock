// yarn lists: downloads the default lists into lists/ (gitignored) and prints
// how many rules of each kind parse, and every unsupported syntax with its
// count. Opt-in: it needs the network. The lists are other people's work under
// their own licenses: read them as data, never commit them or a line of them.
import { DEFAULT_LISTS } from "../../src/lists/defaults.js";
import { ListManager } from "../../src/lists/manager.js";
import { FileStorage } from "../../src/lists/storage.js";
import {
  emptyParsedList,
  parseInto,
  parseLine,
} from "../../src/parser/index.js";
import { toError } from "../../src/util.js";
import { formatReport, type ListReport } from "./report.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    [
      "yarn lists [--force] [--samples] [--dir <folder>]",
      "",
      "  --force     download every list again, fresh or not",
      "  --samples   print up to three lines per unsupported or invalid reason",
      "              (terminal only: the lines belong to the lists' authors)",
      "  --dir       where the lists are kept (default: lists)",
    ].join("\n"),
  );
  process.exit(0);
}
const directory = args.includes("--dir")
  ? (args[args.indexOf("--dir") + 1] ?? "lists")
  : "lists";

const manager = new ListManager({
  storage: new FileStorage(directory),
  onError: (error) => console.error(`warning: ${error.message}`),
});
const reports: ListReport[] = [];
const samples = new Map<string, string[]>();
let failed = false;

for (const list of DEFAULT_LISTS) {
  try {
    const { lines, trusted } = await manager.load(
      list,
      args.includes("--force"),
    );
    const parsed = emptyParsedList();
    parseInto(parsed, lines, { trusted });
    reports.push({ id: list.id, stats: parsed.stats });
    if (!args.includes("--samples")) continue;
    for (const line of lines) {
      parseLine(line, { trusted }, (one) => {
        if (one.kind !== "unsupported" && one.kind !== "invalid") return;
        const reason = `${one.kind}: ${one.reason}`;
        const kept = samples.get(reason) ?? [];
        if (kept.length < 3) kept.push(line);
        samples.set(reason, kept);
      });
    }
  } catch (error) {
    failed = true;
    console.error(`error: ${list.id}: ${toError(error).message}`);
  }
}

console.log(formatReport(reports));
for (const [reason, lines] of samples) {
  console.log(`\n${reason}`);
  for (const line of lines) console.log(`  ${line.slice(0, 200)}`);
}
process.exit(failed ? 1 : 0);

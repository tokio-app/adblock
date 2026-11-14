import type { ParseStats } from "../../src/parser/index.js";

export interface ListReport {
  id: string;
  stats: ParseStats;
}

const COLUMNS: [title: string, value: (stats: ParseStats) => number][] = [
  ["lines", (stats) => stats.lines],
  ["network", (stats) => stats.network],
  ["exceptions", (stats) => stats.networkExceptions],
  ["cosmetic", (stats) => stats.cosmetic],
  ["exceptions", (stats) => stats.cosmeticExceptions],
  ["procedural", (stats) => stats.procedural],
  ["scriptlets", (stats) => stats.scriptlets],
  ["exceptions", (stats) => stats.scriptletExceptions],
  ["headers", (stats) => stats.responseHeaders],
  ["unsupported", (stats) => sum(stats.unsupported)],
  ["invalid", (stats) => sum(stats.invalid)],
];

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

/** Adds the reasons of every list together, most frequent first. */
export function mergeReasons(
  reports: readonly ListReport[],
  kind: "unsupported" | "invalid",
): [reason: string, count: number][] {
  const merged = new Map<string, number>();
  for (const { stats } of reports) {
    for (const [reason, count] of Object.entries(stats[kind])) {
      merged.set(reason, (merged.get(reason) ?? 0) + count);
    }
  }
  return [...merged].sort(
    ([a, countA], [b, countB]) => countB - countA || a.localeCompare(b),
  );
}

/** What `yarn lists` prints: a row per list, then why lines were left out. */
export function formatReport(reports: readonly ListReport[]): string {
  const rows = [
    ["list", ...COLUMNS.map(([title]) => title)],
    ...reports.map(({ id, stats }) => [
      id,
      ...COLUMNS.map(([, value]) => String(value(stats))),
    ]),
    [
      "total",
      ...COLUMNS.map(([, value]) =>
        String(reports.reduce((total, { stats }) => total + value(stats), 0)),
      ),
    ],
  ];
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length)),
  );
  const lines = rows.map((row) =>
    row
      .map((cell, column) =>
        column === 0
          ? cell.padEnd(widths[column]!)
          : cell.padStart(widths[column]!),
      )
      .join("  "),
  );
  for (const [kind, title] of [
    ["unsupported", "Unsupported: valid syntax the library can't apply"],
    ["invalid", "Invalid: malformed, or discarded as uBlock Origin documents"],
  ] as const) {
    lines.push("", formatCounts(title, mergeReasons(reports, kind)));
  }
  return lines.join("\n");
}

/** A title, then each name with how many filters it concerns. */
export function formatCounts(
  title: string,
  counts: readonly [name: string, count: number][],
): string {
  return [
    title,
    ...(counts.length === 0 ? ["  none"] : []),
    ...counts.map(([name, count]) => `  ${String(count).padStart(6)}  ${name}`),
  ].join("\n");
}

/** Names with their counts, most frequent first. */
export function sortCounts(
  counts: Readonly<Record<string, number>>,
): [name: string, count: number][] {
  return Object.entries(counts).sort(
    ([a, countA], [b, countB]) => countB - countA || a.localeCompare(b),
  );
}

/** What `scripts/smoke/main.mjs` writes. */
export interface SmokeReport {
  url: string;
  seconds: number;
  electron: string;
  loaded: boolean;
  failure?: string;
  finalUrl?: string;
  listsReadyMs?: number;
  /** Rules per list. */
  lists?: Record<string, number>;
  counts?: {
    blocked: number;
    redirected: number;
    rewritten: number;
    responses: number;
    documents: number;
    scriptlets: number;
  };
  requests?: {
    total: number;
    cancelled: number;
    redirectedLoaded: string[];
    redirectedFailed: string[];
    otherErrors: Record<string, number>;
  };
  document?: {
    cssRules: number;
    procedural: number;
    generic: boolean;
    scriptlets: string[];
  };
  page?: {
    title?: string;
    readyState?: string;
    google_ad_status?: unknown;
    elementsMatched?: number;
    elementsHidden?: number;
    probeError?: string;
    consoleErrors: string[];
    preloadErrors: string[];
  };
  blockerErrors?: string[];
}

function tally(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts.size === 0
    ? "none"
    : [...counts].map(([name, count]) => `${name} ×${count}`).join(", ");
}

/** Why the run failed. Empty: it passed. */
export function failures(report: SmokeReport): string[] {
  const reasons: string[] = [];
  if (report.failure !== undefined) reasons.push(report.failure);
  if (!report.loaded) reasons.push("the page didn't load");
  if (
    (report.lists === undefined ? 0 : Object.keys(report.lists).length) === 0
  ) {
    reasons.push("no list was loaded");
  }
  if ((report.counts?.documents ?? 0) === 0) {
    reasons.push("no document asked the blocker what it gets");
  }
  for (const error of report.page?.preloadErrors ?? []) {
    reasons.push(`the preload failed: ${error}`);
  }
  for (const failed of report.requests?.redirectedFailed ?? []) {
    reasons.push(`a redirect resource didn't load: ${failed}`);
  }
  for (const error of report.blockerErrors ?? []) {
    reasons.push(`the blocker reported: ${error}`);
  }
  return reasons;
}

/** What `yarn smoke` prints. */
export function formatSummary(report: SmokeReport): string {
  const { counts, requests, document, page } = report;
  const lines = [
    `${report.url} in Electron ${report.electron}, ${report.seconds} s`,
    `lists      ${Object.keys(report.lists ?? {}).length} loaded in ${report.listsReadyMs ?? "?"} ms`,
  ];
  if (counts !== undefined && requests !== undefined) {
    lines.push(
      `requests   ${requests.total} seen: ${counts.blocked} blocked ` +
        `(${counts.redirected} of them redirected), ${counts.rewritten} rewritten, ` +
        `${counts.responses} responses changed or blocked`,
      `redirects  loaded: ${tally(requests.redirectedLoaded)}; ` +
        `failed: ${tally(requests.redirectedFailed)}`,
    );
  }
  if (document !== undefined && counts !== undefined) {
    lines.push(
      `scriptlets ${counts.scriptlets} given to ${counts.documents} documents; ` +
        `the page's: ${tally(document.scriptlets)}`,
      `cosmetics  ${document.cssRules} selectors and ${document.procedural} procedural ` +
        `filters for the page; ${page?.elementsHidden ?? "?"} of the ` +
        `${page?.elementsMatched ?? "?"} elements they match are hidden`,
    );
  }
  if (page !== undefined) {
    lines.push(
      `page       "${page.title ?? ""}" (${page.readyState ?? "?"}), ` +
        `${page.consoleErrors.length} console errors, ` +
        `google_ad_status ${JSON.stringify(page.google_ad_status ?? null)}`,
    );
  }
  const reasons = failures(report);
  lines.push(
    reasons.length === 0
      ? "PASSED"
      : `FAILED\n${reasons.map((reason) => `  ${reason}`).join("\n")}`,
  );
  return lines.join("\n");
}

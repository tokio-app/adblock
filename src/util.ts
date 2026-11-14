/** What was thrown, as an Error. */
export function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/** The regular expression, or undefined when the source or flags are bad. */
export function tryRegex(source: string, flags?: string): RegExp | undefined {
  try {
    return new RegExp(source, flags);
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

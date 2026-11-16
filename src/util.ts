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

/**
 * The same text as a string of its own. V8 makes a substring of 13
 * characters or more a view into the string it was cut from, which then
 * stays in memory as long as the substring does: a hostname kept from a
 * list's line would keep the whole line.
 */
export function ownString(text: string): string {
  return text.length < 13 ? text : Buffer.from(text).toString();
}

/**
 * Gives each bucket of a map an array of its exact size, once nothing more
 * is added: an array grown by push keeps room for many more entries.
 */
export function compactBuckets<K, V>(map: Map<K, V[]>): void {
  for (const [key, bucket] of map) {
    if (bucket.length > 1) map.set(key, bucket.slice());
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

import { toError } from "../util.js";
import { includesOf, preprocess } from "./preprocessor.js";
import type { ListStorage, StoredResource } from "./storage.js";

/** A filter list to download and apply. */
export interface ListDefinition {
  /** Names the list in the storage and in reports. */
  id: string;
  title?: string;
  /** Tried in order: the list's own URL first, then its mirrors. */
  urls: readonly string[];
  /**
   * The list may use what uBlock Origin keeps for its own lists: trusted
   * scriptlets and the `urlskip` and `uritransform` options. Only for lists
   * whose authors you trust with running code in every page.
   */
  trusted?: boolean;
  /** Days between updates when the list has no `! Expires:` header. */
  updateAfterDays?: number;
}

/** The part of `fetch` the lists need, so a host can pass Electron's. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface ListManagerOptions {
  storage: ListStorage;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Milliseconds a download may take (default 30 s). */
  timeoutMs?: number;
  now?: () => number;
  /** Told about failed downloads, which never throw past a stored copy. */
  onError?: (error: Error) => void;
}

/** A list ready to parse: its lines, directives applied, sub-lists in place. */
export interface LoadedList {
  id: string;
  trusted: boolean;
  lines: string[];
  /** Whether a download changed it since the copy in the storage. */
  changed: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DEFAULT_UPDATE_DAYS = 5;

/**
 * How long a list stays fresh, from its `! Expires:` header (`4 days`,
 * `8 hours`, `1 day (update frequency)`), in ms. Undefined without one.
 */
export function expiresAfter(text: string): number | undefined {
  const match = /^[!#]\s*Expires\s*:\s*(\d+)\s*(h|d)?/im.exec(
    text.slice(0, 4096),
  );
  if (match === null) return undefined;
  const count = Number(match[1]);
  if (count === 0) return undefined;
  return count * (match[2]?.toLowerCase() === "h" ? HOUR : DAY);
}

/**
 * Downloads filter lists and keeps them fresh: mirrors when the first URL
 * fails, `! Expires:` to know when to look again, `ETag` and `Last-Modified`
 * so an unchanged list isn't downloaded twice, and the host's storage so a
 * restart doesn't download anything.
 */
export class ListManager {
  private readonly storage: ListStorage;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly onError: (error: Error) => void;
  /** When each resource read so far stops being fresh. */
  private readonly expiries = new Map<string, number>();

  constructor(options: ListManagerOptions) {
    this.storage = options.storage;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => {});
  }

  /** When the first of the lists loaded so far needs a refresh, in ms. */
  nextExpiry(): number | undefined {
    return this.expiries.size === 0
      ? undefined
      : Math.min(...this.expiries.values());
  }

  /**
   * Loads a list: from the storage while it is fresh, downloaded otherwise
   * (always with `force`). A failed download falls back to the stored copy.
   * Rejects only when there is neither.
   */
  async load(list: ListDefinition, force = false): Promise<LoadedList> {
    const main = await this.resource(list.id, list.urls, list, force);
    const included = new Map<string, string>();
    let changed = main.changed;
    await Promise.all(
      includesOf(main.resource.text).map(async (path) => {
        // A sub-list lives next to the list that includes it.
        const urls = [main.resource.url, ...list.urls]
          .map((base) => new URL(path, base).href)
          .filter((url, index, all) => all.indexOf(url) === index);
        try {
          const sub = await this.resource(
            `${list.id}/${path}`,
            urls,
            list,
            // An unchanged list can still have changed sub-lists.
            force || main.fetched,
          );
          included.set(path, sub.resource.text);
          changed ||= sub.changed;
        } catch (error) {
          this.onError(toError(error));
        }
      }),
    );
    return {
      id: list.id,
      trusted: list.trusted === true,
      lines: preprocess(main.resource.text, {
        include: (path) => included.get(path),
      }),
      changed,
    };
  }

  /**
   * Gives a resource's text: the stored copy while fresh, else a download
   * that `If-None-Match` and `If-Modified-Since` keep small.
   */
  async resource(
    key: string,
    urls: readonly string[],
    list: Pick<ListDefinition, "updateAfterDays">,
    force = false,
  ): Promise<{ resource: StoredResource; changed: boolean; fetched: boolean }> {
    const stored = await this.storage.read(key);
    const lifetime = (text: string) =>
      expiresAfter(text) ?? (list.updateAfterDays ?? DEFAULT_UPDATE_DAYS) * DAY;
    if (
      stored !== undefined &&
      !force &&
      this.now() - stored.fetchedAt < lifetime(stored.text)
    ) {
      this.expiries.set(key, stored.fetchedAt + lifetime(stored.text));
      return { resource: stored, changed: false, fetched: false };
    }
    let resource: StoredResource;
    try {
      resource = await this.download(urls, stored);
    } catch (error) {
      if (stored === undefined) throw error;
      this.onError(toError(error));
      // Look again in an hour instead of at every load.
      this.expiries.set(key, this.now() + HOUR);
      return { resource: stored, changed: false, fetched: false };
    }
    await this.storage.write(key, resource);
    this.expiries.set(key, resource.fetchedAt + lifetime(resource.text));
    return {
      resource,
      changed: resource.text !== stored?.text,
      fetched: true,
    };
  }

  private async download(
    urls: readonly string[],
    stored: StoredResource | undefined,
  ): Promise<StoredResource> {
    const failures: string[] = [];
    for (const url of urls) {
      try {
        const headers: Record<string, string> = {};
        // Validators only mean something to the server that gave them.
        if (stored?.url === url) {
          if (stored.etag) headers["If-None-Match"] = stored.etag;
          if (stored.lastModified) {
            headers["If-Modified-Since"] = stored.lastModified;
          }
        }
        const response = await this.fetch(url, {
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.status === 304 && stored !== undefined) {
          return { ...stored, fetchedAt: this.now() };
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        // An error page served with a 200 isn't a list.
        if (text.trim() === "" || /^\s*<(?:!doctype|html)/i.test(text)) {
          throw new Error("not a filter list");
        }
        return {
          text,
          url,
          fetchedAt: this.now(),
          etag: response.headers.get("etag") ?? undefined,
          lastModified: response.headers.get("last-modified") ?? undefined,
        };
      } catch (error) {
        failures.push(`${url}: ${toError(error).message}`);
      }
    }
    throw new Error(`Couldn't download ${failures.join("; ")}`);
  }
}

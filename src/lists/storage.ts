import fs from "node:fs/promises";
import path from "node:path";
import { isRecord } from "../util.js";

/** A downloaded list, or one of its sub-lists, as the host app keeps it. */
export interface StoredResource {
  text: string;
  /** Where it was downloaded from. */
  url: string;
  /** When it was last downloaded or confirmed unchanged, in ms. */
  fetchedAt: number;
  etag?: string;
  lastModified?: string;
}

/**
 * Whether a text can be a filter list: not empty, not NULs (what a power cut
 * can leave in a file renamed before its data reached the disk), and not an
 * error page served with a 200.
 */
export function isFilterList(text: string): boolean {
  // Not `trim()`: that would copy megabytes to look at the ends.
  return (
    /\S/.test(text) &&
    !text.includes("\0") &&
    !/^\s*<(?:!doctype|html)/i.test(text)
  );
}

/**
 * Where the host app keeps the downloaded lists, so they survive a restart.
 * Keys are list ids, and `<list id>/<path>` for a sub-list.
 */
export interface ListStorage {
  read(key: string): Promise<StoredResource | undefined>;
  write(key: string, resource: StoredResource): Promise<void>;
}

/** Keeps the lists in memory: for tests, and for apps that don't persist. */
export class MemoryStorage implements ListStorage {
  readonly resources = new Map<string, StoredResource>();

  async read(key: string): Promise<StoredResource | undefined> {
    return this.resources.get(key);
  }

  async write(key: string, resource: StoredResource): Promise<void> {
    this.resources.set(key, resource);
  }
}

/**
 * Keeps each list in a folder as `<key>.txt`, with its HTTP validators in
 * `<key>.json`. Files are written to a temporary name, flushed to the disk
 * and renamed, so a crash midway leaves the old list whole. A text that
 * isn't a list reads as missing, so it is downloaded again.
 */
export class FileStorage implements ListStorage {
  constructor(private readonly directory: string) {}

  private file(key: string, extension: string): string {
    const name = key.replace(/[^\w.-]+/g, "_");
    return path.join(this.directory, `${name}.${extension}`);
  }

  async read(key: string): Promise<StoredResource | undefined> {
    try {
      const [text, meta] = await Promise.all([
        fs.readFile(this.file(key, "txt"), "utf8"),
        fs.readFile(this.file(key, "json"), "utf8"),
      ]);
      if (!isFilterList(text)) return undefined;
      const parsed: unknown = JSON.parse(meta);
      if (!isRecord(parsed)) return undefined;
      const { url, fetchedAt, etag, lastModified } = parsed;
      if (typeof url !== "string" || typeof fetchedAt !== "number") {
        return undefined;
      }
      return {
        text,
        url,
        fetchedAt,
        etag: typeof etag === "string" ? etag : undefined,
        lastModified:
          typeof lastModified === "string" ? lastModified : undefined,
      };
    } catch {
      // Missing or unreadable: the list is downloaded again.
      return undefined;
    }
  }

  async write(key: string, resource: StoredResource): Promise<void> {
    const { text, ...meta } = resource;
    await fs.mkdir(this.directory, { recursive: true });
    await this.removeLeftovers(key);
    // The text first: validators without their text would skip a download.
    await this.replace(this.file(key, "txt"), text);
    await this.replace(this.file(key, "json"), JSON.stringify(meta));
  }

  /** Removes the temporary files of `key` that a quit midway left. */
  private async removeLeftovers(key: string): Promise<void> {
    const names = ["txt", "json"].map((extension) =>
      path.basename(this.file(key, extension)).replaceAll(".", "\\."),
    );
    const leftover = new RegExp(`^(?:${names.join("|")})\\.(\\d+)\\.tmp$`);
    for (const entry of await fs.readdir(this.directory)) {
      const match = leftover.exec(entry);
      // This process's own may belong to a write still running.
      if (match === null || match[1] === String(process.pid)) continue;
      await fs
        .rm(path.join(this.directory, entry), { force: true })
        .catch(() => {});
    }
  }

  private async replace(file: string, data: string): Promise<void> {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      const handle = await fs.open(temporary, "w");
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }
}

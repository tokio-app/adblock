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
 * `<key>.json`. Files are written to a temporary name and renamed, so a crash
 * midway leaves the old list whole.
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
    // The text first: validators without their text would skip a download.
    await this.replace(this.file(key, "txt"), text);
    await this.replace(this.file(key, "json"), JSON.stringify(meta));
  }

  private async replace(file: string, data: string): Promise<void> {
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, file);
  }
}

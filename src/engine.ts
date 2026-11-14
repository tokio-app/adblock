import { DEFAULT_LISTS } from "./lists/defaults.js";
import {
  ListManager,
  type FetchLike,
  type ListDefinition,
} from "./lists/manager.js";
import { MemoryStorage, type ListStorage } from "./lists/storage.js";
import { toError } from "./util.js";
import { emptyParsedList, parseInto, type ParseStats } from "./parser/index.js";

export interface EngineOptions {
  /** The filter lists to apply (default: `DEFAULT_LISTS`). */
  lists?: readonly ListDefinition[];
  /**
   * Where downloaded lists are kept. Without one they live in memory and are
   * downloaded again at every start: pass a `FileStorage`.
   */
  storage?: ListStorage;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Look for new versions of the lists as they expire (default true). */
  autoUpdate?: boolean;
  /** Told about what went wrong in the background. Nothing is ever thrown. */
  onError?: (error: Error) => void;
  now?: () => number;
}

// Lines parsed per turn of the event loop: a few milliseconds of work, so a
// host's main process stays responsive while 300,000 lines load.
const SLICE = 4000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Downloads the filter lists, keeps them up to date and turns them into
 * rules.
 */
export class Engine {
  /**
   * Resolves once the lists that could be loaded are in effect. It never
   * rejects: a list that can't be loaded is reported to `onError` and left
   * out.
   */
  readonly ready: Promise<void>;
  /** What each loaded list holds, by list id. */
  stats: Record<string, ParseStats> = {};

  private readonly lists: readonly ListDefinition[];
  private readonly manager: ListManager;
  private readonly autoUpdate: boolean;
  private readonly onError: (error: Error) => void;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private built = false;
  private disposed = false;

  constructor(options: EngineOptions = {}) {
    this.lists = options.lists ?? DEFAULT_LISTS;
    this.autoUpdate = options.autoUpdate ?? true;
    this.onError = options.onError ?? (() => {});
    this.now = options.now ?? Date.now;
    this.manager = new ListManager({
      storage: options.storage ?? new MemoryStorage(),
      fetch: options.fetch,
      now: options.now,
      onError: this.onError,
    });
    this.ready = this.update().then(() => {});
  }

  /**
   * Looks for new versions of the lists that expired (of all of them with
   * `force`) and rebuilds the rules when one changed. Resolves to whether
   * the rules changed. Calls run one after the other.
   */
  update(force = false): Promise<boolean> {
    const run = this.queue.then(() => this.run(force));
    this.queue = run.catch(() => {});
    return run.catch((error: unknown) => {
      this.onError(toError(error));
      return false;
    });
  }

  /** Stops the updates. The rules stay in effect. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private async run(force: boolean): Promise<boolean> {
    if (this.disposed) return false;
    const loaded = await Promise.all(
      this.lists.map((list) =>
        this.manager.load(list, force).catch((error: unknown) => {
          this.onError(toError(error));
          return undefined;
        }),
      ),
    );
    const changed = !this.built || loaded.some((list) => list?.changed);
    if (changed) {
      const stats: Record<string, ParseStats> = {};
      for (const list of loaded) {
        if (list === undefined) continue;
        const rules = emptyParsedList();
        const context = { trusted: list.trusted };
        for (let start = 0; start < list.lines.length; start += SLICE) {
          parseInto(
            rules,
            list.lines,
            context,
            start,
            Math.min(start + SLICE, list.lines.length),
          );
          await nextTurn();
        }
        stats[list.id] = rules.stats;
      }
      this.stats = stats;
      this.built = true;
    }
    this.schedule();
    return changed;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.autoUpdate || this.disposed) return;
    const expiry = this.manager.nextExpiry();
    if (expiry === undefined) return;
    // Not sooner than a minute, so a list that fails to load isn't hammered.
    const delay = Math.min(Math.max(expiry - this.now(), MINUTE), DAY);
    this.timer = setTimeout(() => void this.update(), delay);
    // The updates alone don't keep a process alive.
    this.timer.unref?.();
  }
}

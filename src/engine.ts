import { CosmeticEngine, type DocumentCosmetics } from "./cosmetic/engine.js";
import { DEFAULT_LISTS } from "./lists/defaults.js";
import {
  ListManager,
  type FetchLike,
  type ListDefinition,
} from "./lists/manager.js";
import { MemoryStorage, type ListStorage } from "./lists/storage.js";
import { NetworkEngine } from "./network/engine.js";
import { emptyParsedList, parseInto, type ParseStats } from "./parser/index.js";
import { PublicSuffixList } from "./psl/psl.js";
import { toError } from "./util.js";

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
  /**
   * Where to download Mozilla's Public Suffix List from, which tells a site
   * from its subdomains (default: `PUBLIC_SUFFIX_LIST_URLS`). Empty: don't,
   * and guess instead.
   */
  publicSuffixListUrls?: readonly string[];
  /** Told about what went wrong in the background. Nothing is ever thrown. */
  onError?: (error: Error) => void;
  now?: () => number;
}

/** Where the Public Suffix List is published. It is downloaded, not shipped. */
export const PUBLIC_SUFFIX_LIST_URLS: readonly string[] = [
  "https://publicsuffix.org/list/public_suffix_list.dat",
];

// Lines parsed per turn of the event loop: a few milliseconds of work, so a
// host's main process stays responsive while 300,000 lines load.
const SLICE = 4000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Downloads the filter lists, keeps them up to date and applies them.
 */
export class Engine {
  /**
   * Decides what happens to requests. Replaced when the lists change, so
   * read it from the engine each time instead of keeping it.
   */
  network = new NetworkEngine();
  /**
   * Decides what a document gets: selectors to hide, procedural filters and
   * scriptlets. Replaced when the lists change, like `network`.
   */
  cosmetic = new CosmeticEngine();
  /**
   * Resolves once the lists that could be loaded are in effect. It never
   * rejects: a list that can't be loaded is reported to `onError` and left
   * out.
   */
  readonly ready: Promise<void>;
  /** What each loaded list holds, by list id. */
  stats: Record<string, ParseStats> = {};

  private readonly lists: readonly ListDefinition[];
  private readonly pslUrls: readonly string[];
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
    this.pslUrls = options.publicSuffixListUrls ?? PUBLIC_SUFFIX_LIST_URLS;
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

  /**
   * What the document at `url` gets as it starts loading: its scriptlets,
   * its stylesheet and its procedural filters, with the `generichide`,
   * `specifichide` and `elemhide` exceptions for it applied. `topUrl` is the
   * top document's, when this one is in a frame.
   */
  document(url: string, topUrl?: string): DocumentCosmetics {
    const request = this.network.request({ url, type: "document", topUrl });
    return this.cosmetic.forDocument(
      request.hostname,
      this.network.cosmeticSwitches(request),
    );
  }

  /**
   * Whether a `popup` filter blocks a window the page at `openerUrl` wants
   * to open at `url`. Nothing asks by itself: an app decides about new
   * windows in its own `setWindowOpenHandler`, and can ask there.
   */
  blocksPopup(url: string, openerUrl: string): boolean {
    const { network } = this;
    return network.match(
      network.request({ url, type: "popup", sourceUrl: openerUrl }),
    ).block;
  }

  /** Stops the updates. The rules stay in effect. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private async run(force: boolean): Promise<boolean> {
    if (this.disposed) return false;
    const reported = (error: unknown) => {
      this.onError(toError(error));
      return undefined;
    };
    const [suffixes, ...loaded] = await Promise.all([
      this.pslUrls.length === 0
        ? undefined
        : this.manager
            // The list changes a few times a month.
            .resource(
              "public_suffix_list",
              this.pslUrls,
              { updateAfterDays: 19 },
              force,
            )
            .catch(reported),
      ...this.lists.map((list) =>
        this.manager.load(list, force).catch(reported),
      ),
    ]);
    const changed =
      !this.built ||
      suffixes?.changed === true ||
      loaded.some((list) => list?.changed);
    if (changed) {
      const stats: Record<string, ParseStats> = {};
      const psl = new PublicSuffixList(suffixes?.resource.text);
      const network = new NetworkEngine({ psl });
      const cosmetic = new CosmeticEngine({ psl });
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
        network.add(rules.network);
        cosmetic.add(rules);
      }
      const steps = network.finalizing();
      while (steps.next().done !== true) await nextTurn();
      this.network = network;
      this.cosmetic = cosmetic;
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

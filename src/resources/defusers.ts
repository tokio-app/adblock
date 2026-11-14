// Resources that also work as scriptlets. Each function runs in a page on
// its own, as a redirected script or a scriptlet: it imports nothing and
// uses nothing from outside its body but the page's globals. This file
// imports nothing either, so the scriptlet bundle can take it as is.

/** FuckAdBlock 3.2, BlockAdBlock and SniffAdBlock, always "not detected". */
export function nofab(): void {
  const w = window as any;
  const Detector = function (this: any) {} as any;
  const later = (fn: unknown) => {
    if (typeof fn === "function") setTimeout(fn, 1);
  };
  const notDetected: unknown[] = [];
  Object.assign(Detector.prototype, {
    setOption() {
      return this;
    },
    check() {
      notDetected.forEach(later);
      return true;
    },
    emitEvent() {
      return this;
    },
    clearEvent() {},
    on(detected: unknown, fn: unknown) {
      if (!detected) {
        notDetected.push(fn);
        later(fn);
      }
      return this;
    },
    onDetected() {
      return this;
    },
    onNotDetected(fn: unknown) {
      return this.on(false, fn);
    },
  });
  const instance = new Detector();
  for (const name of ["FuckAdBlock", "BlockAdBlock", "SniffAdBlock"]) {
    const lower = name[0]!.toLowerCase() + name.slice(1);
    for (const [key, value] of [
      [name, Detector],
      [lower, instance],
    ]) {
      try {
        // The detector's own script may still run: its writes are ignored.
        Object.defineProperty(w, key, {
          configurable: true,
          get: () => value,
          set() {},
        });
      } catch {}
    }
  }
}

/**
 * BlockAdblock: refuses `eval()` of code that names it, which its payloads
 * do once decoded, and lets every other `eval()` through.
 */
export function nobab(): void {
  const original = window.eval;
  window.eval = new Proxy(original, {
    apply(target, self, args) {
      const code = args[0];
      return typeof code === "string" && /blockadblock/i.test(code)
        ? undefined
        : Reflect.apply(target, self, args);
    },
  });
}

/**
 * BlockAdblock 4.2b: the same guard as `nobab`, on `eval()` and on code
 * made with `Function()`.
 */
export function nobab2(): void {
  const w = window as any;
  const blocked = (args: unknown[]) =>
    args.some((arg) => typeof arg === "string" && /blockadblock/i.test(arg));
  w.eval = new Proxy(w.eval, {
    apply: (target, self, args) =>
      blocked(args) ? undefined : Reflect.apply(target, self, args),
  });
  w.Function = new Proxy(w.Function, {
    apply: (target, self, args) =>
      blocked(args) ? () => {} : Reflect.apply(target, self, args),
    construct: (target, args, newTarget) =>
      blocked(args) ? () => {} : Reflect.construct(target, args, newTarget),
  });
}

/** PopAds: aborts the script that sets `PopAds` or `popns`. */
export function popads(): void {
  for (const key of ["PopAds", "popns"]) {
    try {
      Object.defineProperty(window, key, {
        configurable: true,
        get: () => undefined,
        set() {
          throw new ReferenceError("magic");
        },
      });
    } catch {}
  }
}

/** PopAds: `PopAds` and `popns` are there, as fixed empty objects. */
export function popadsDummy(): void {
  for (const key of ["PopAds", "popns"]) {
    try {
      Object.defineProperty(window, key, {
        configurable: true,
        value: Object.freeze({}),
        writable: false,
      });
    } catch {}
  }
}

/** FingerprintJS 2: the same meaningless fingerprint for everyone. */
export function fingerprint2(): void {
  const hash = "00000000000000000000000000000000";
  const later = (fn: unknown, ...args: unknown[]) => {
    if (typeof fn === "function") setTimeout(() => fn(...args), 1);
  };
  const Fingerprint2 = function (this: any) {} as any;
  // Version 1's API: `new Fingerprint2().get((hash, components) => …)`.
  Fingerprint2.prototype.get = (fn: unknown) => later(fn, hash, []);
  Fingerprint2.get = (options: unknown, fn?: unknown) =>
    later(typeof options === "function" ? options : fn, []);
  Fingerprint2.getPromise = () => Promise.resolve([]);
  Fingerprint2.getV18 = (options: unknown, fn?: unknown) =>
    later(typeof options === "function" ? options : fn, hash, []);
  Fingerprint2.x64hash128 = () => hash;
  Fingerprint2.VERSION = "2.1.0";
  (window as any).Fingerprint2 = Fingerprint2;
}

/** FingerprintJS 3: an agent whose visitor id is the same for everyone. */
export function fingerprint3(): void {
  const hash = "00000000000000000000000000000000";
  const result = {
    visitorId: hash,
    confidence: { score: 0 },
    components: {},
    version: "3.4.2",
  };
  (window as any).FingerprintJS = {
    load: () => Promise.resolve({ get: () => Promise.resolve(result) }),
    hashComponents: () => hash,
    componentsToDebugString: () => "{}",
  };
}

/** The bait script sites host as `prebid-ads.js`: ads can run. */
export function prebidAds(): void {
  const w = window as any;
  w.canRunAds = true;
  w.isAdBlockActive = false;
}

/**
 * AMP: its boilerplate keeps the body hidden by an 8-second `-amp-start`
 * animation, which the AMP runtime cancels once it loads. Cancels it.
 */
export function ampprojectV0(): void {
  const id = "tokio-amp-start";
  if (document.getElementById(id) !== null) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent =
    "body { animation: none !important; -webkit-animation: none !important; }";
  (document.head ?? document.documentElement).append(style);
}

/** Resources that also work as scriptlets: name → the self-contained function. */
export const DEFUSERS: Readonly<Record<string, () => void>> = {
  nobab,
  nobab2,
  nofab,
  popads,
  "popads-dummy": popadsDummy,
  fingerprint2,
  fingerprint3,
  "prebid-ads": prebidAds,
  ampproject_v0: ampprojectV0,
};

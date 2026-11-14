// Stand-ins for ad and analytics scripts: the public API of the script each
// replaces, doing nothing, so that pages which call it keep working. Each
// function runs in a page on its own: no imports, nothing from outside its
// body but the page's globals.

/** Google Publisher Tag (`googletag`): every slot renders empty. */
export function googletagServices(): void {
  const w = window as any;
  const tag = typeof w.googletag === "object" && w.googletag ? w.googletag : {};
  if (tag.apiReady === true) return;
  w.googletag = tag;
  // Methods documented to return their own object, for chained calls.
  const chain = (target: any, names: string) => {
    for (const name of names.split(" ")) target[name] = () => target;
    return target;
  };
  const slots: any[] = [];
  const listeners: [string, (event: unknown) => void][] = [];
  let initialLoad = true;
  const service = (name: string) => {
    const created = {
      addEventListener(type: string, listener: (event: unknown) => void) {
        listeners.push([`${name} ${type}`, listener]);
        return created;
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        const index = listeners.findIndex(
          ([key, fn]) => key === `${name} ${type}` && fn === listener,
        );
        if (index !== -1) listeners.splice(index, 1);
        return index !== -1;
      },
      getSlots: () => slots.slice(),
    };
    return created;
  };
  const render = (targets: any[]) =>
    setTimeout(() => {
      for (const slot of targets) {
        const event = {
          serviceName: "publisher_ads",
          slot,
          isEmpty: true,
          size: null,
          advertiserId: null,
          campaignId: null,
          creativeId: null,
          lineItemId: null,
          isBackfill: false,
          slotContentChanged: false,
        };
        for (const [key, listener] of listeners.slice()) {
          if (key === "publisher_ads slotRenderEnded") listener(event);
        }
      }
    }, 0);
  const pubads = chain(
    Object.assign(service("publisher_ads"), {
      clear: () => true,
      collapseEmptyDivs: () => true,
      disableInitialLoad() {
        initialLoad = false;
      },
      display() {},
      enableLazyLoad() {},
      enableSingleRequest: () => true,
      enableVideoAds() {},
      get: () => null,
      getAttributeKeys: () => [],
      getTargeting: () => [],
      getTargetingKeys: () => [],
      isInitialLoadDisabled: () => !initialLoad,
      refresh: (targets?: unknown) =>
        render(Array.isArray(targets) ? targets : slots),
      registerRequestHook: () => () => {},
      setCentering() {},
      setVideoContent() {},
    }),
    "clearCategoryExclusions clearTargeting set setCategoryExclusion setForceSafeFrame setLocation setPrivacySettings setPublisherProvidedId setSafeFrameConfig setTargeting updateCorrelator",
  );
  const companionAds = Object.assign(service("companion_ads"), {
    setRefreshUnfilledSlots() {},
  });
  const content = Object.assign(service("content"), { setContent() {} });
  const slot = (path: unknown, id: unknown) => {
    const created = chain(
      {
        get: () => null,
        getAdUnitPath: () => path,
        getAttributeKeys: () => [],
        getCategoryExclusions: () => [],
        getConfig: () => ({}),
        getResponseInformation: () => null,
        getSlotElementId: () => id,
        getSizes: () => [],
        getTargeting: () => [],
        getTargetingKeys: () => [],
      },
      "addService clearCategoryExclusions clearTargeting defineSizeMapping set setCategoryExclusion setClickUrl setCollapseEmptyDiv setConfig setForceSafeFrame setSafeFrameConfig setTargeting updateTargetingFromMap",
    );
    slots.push(created);
    return created;
  };
  Object.assign(tag, {
    apiReady: true,
    pubadsReady: true,
    companionAds: () => companionAds,
    content: () => content,
    defineOutOfPageSlot: (path: unknown, id: unknown) =>
      slot(path, typeof id === "string" ? id : ""),
    defineSlot: (path: unknown, _size: unknown, id: unknown) => slot(path, id),
    destroySlots(targets?: unknown) {
      const removed = Array.isArray(targets) ? targets : slots.slice();
      for (const target of removed) {
        const index = slots.indexOf(target);
        if (index !== -1) slots.splice(index, 1);
      }
      return true;
    },
    disablePublisherConsole() {},
    display(target: unknown) {
      if (!initialLoad) return;
      render(
        slots.filter(
          (each) => each === target || each.getSlotElementId() === target,
        ),
      );
    },
    enableServices() {},
    getConfig: () => ({}),
    getVersion: () => "",
    openConsole() {},
    pubads: () => pubads,
    setAdIframeTitle() {},
    setConfig() {},
    sizeMapping() {
      const builder = { addSize: () => builder, build: () => [] };
      return builder;
    },
    // Values aren't documented: pages pass them back as they are.
    enums: {
      OutOfPageFormat: {
        BOTTOM_ANCHOR: 3,
        GAME_MANUAL_INTERSTITIAL: 7,
        INTERSTITIAL: 5,
        LEFT_SIDE_RAIL: 8,
        REWARDED: 4,
        RIGHT_SIDE_RAIL: 9,
        TOP_ANCHOR: 2,
      },
      TrafficSource: { ORGANIC: 0, PURCHASED: 1 },
    },
  });
  if (!Array.isArray(tag.secureSignalProviders)) tag.secureSignalProviders = [];
  let processed = 0;
  const queued = Array.isArray(tag.cmd) ? tag.cmd : [];
  tag.cmd = {
    push(...commands: unknown[]) {
      for (const command of commands) {
        if (typeof command !== "function") continue;
        processed++;
        try {
          command.call(tag);
        } catch (error) {
          setTimeout(() => {
            throw error;
          });
        }
      }
      return processed;
    },
  };
  tag.cmd.push(...queued);
}

/** Google Tag Manager: `dataLayer` pushes get their `eventCallback` called. */
export function googletagManager(): void {
  const w = window as any;
  const layer = Array.isArray(w.dataLayer) ? w.dataLayer : [];
  w.dataLayer = layer;
  const later = (fn: unknown) => {
    if (typeof fn === "function") setTimeout(fn, 0);
  };
  // An object pushed directly, or the `arguments` of `gtag(…, { event_callback })`.
  const answer = (item: any) => {
    if (typeof item !== "object" || item === null) return;
    later(item.eventCallback);
    later(item[2]?.event_callback);
  };
  if (!layer.tokioProcessed) {
    Object.defineProperty(layer, "tokioProcessed", { value: true });
    layer.forEach(answer);
  }
  const push = Array.prototype.push;
  layer.push = function (...items: unknown[]) {
    items.forEach(answer);
    return push.apply(this, items);
  };
  const container = {
    dataLayer: { get: () => undefined, set() {}, reset() {} },
  };
  if (w.google_tag_manager === undefined) {
    w.google_tag_manager = new Proxy(
      {},
      {
        get: (_target, key) =>
          typeof key === "string" && /^[A-Z]{1,3}-/.test(key)
            ? container
            : undefined,
      },
    );
  }
}

/** Google Analytics `analytics.js` (`ga`): commands are dropped, callbacks called. */
export function googleAnalytics(): void {
  const w = window as any;
  const name =
    typeof w.GoogleAnalyticsObject === "string"
      ? w.GoogleAnalyticsObject
      : "ga";
  const existing = w[name];
  if (existing?.loaded === true) return;
  const later = (fn: unknown, ...args: unknown[]) => {
    if (typeof fn === "function") setTimeout(() => fn(...args), 0);
  };
  const callBack = (args: unknown[]) => {
    for (const arg of args) {
      if (typeof arg === "object" && arg !== null)
        later((arg as any).hitCallback);
    }
  };
  const trackers = new Map<string, any>();
  const tracker = (trackerName: string) => {
    const created = {
      get: () => undefined,
      set() {},
      send: (...args: unknown[]) => callBack(args),
    };
    trackers.set(trackerName, created);
    return created;
  };
  const ga = function (command: unknown, ...args: unknown[]) {
    if (typeof command === "function") {
      later(command, trackers.get("t0") ?? tracker("t0"));
    } else {
      callBack(args);
    }
  } as any;
  Object.assign(ga, {
    create: (...args: unknown[]) => {
      const named = args.find(
        (arg): arg is { name: string } =>
          typeof (arg as any)?.name === "string",
      );
      const trackerName =
        (typeof args[2] === "string" ? args[2] : named?.name) ?? "t0";
      return tracker(trackerName);
    },
    getByName: (trackerName: string) => trackers.get(trackerName) ?? null,
    getAll: () => [...trackers.values()],
    remove: (trackerName: string) => trackers.delete(trackerName),
    loaded: true,
  });
  w[name] = ga;
  w.GoogleAnalyticsObject = name;
  if (Array.isArray(existing?.q)) {
    for (const queued of existing.q) ga(...Array.from(queued as unknown[]));
  }
}

/** Google Analytics `ga.js` (`_gaq`, `_gat`): trackers whose methods do nothing. */
export function googleAnalyticsGa(): void {
  const w = window as any;
  if (w._gat?._getTracker !== undefined) return;
  const noop = () => {};
  const tracker = new Proxy(
    {
      _getAccount: () => "",
      _getLinkerUrl: (url: unknown) => url,
      _getName: () => "",
      _getVersion: () => "",
      _getVisitorCustomVar: () => undefined,
    },
    {
      get: (target: any, key) =>
        key in target
          ? target[key]
          : typeof key === "string" && key.startsWith("_")
            ? noop
            : undefined,
    },
  );
  w._gat = {
    _anonymizeIp: noop,
    _createTracker: () => tracker,
    _forceSSL: noop,
    _getTracker: () => tracker,
    _getTrackerByName: () => tracker,
  };
  const queued = Array.isArray(w._gaq) ? w._gaq : [];
  w._gaq = {
    _createAsyncTracker: () => tracker,
    _getAsyncTracker: () => tracker,
    push(...commands: unknown[]) {
      for (const command of commands) {
        if (typeof command === "function") {
          try {
            command.call(w._gat);
          } catch {}
        } else if (
          Array.isArray(command) &&
          /(^|\.)_set$/.test(command[0]) &&
          command[1] === "hitCallback" &&
          typeof command[2] === "function"
        ) {
          const callback = command[2];
          setTimeout(() => callback(), 0);
        }
      }
      return 0;
    },
  };
  w._gaq.push(...queued);
}

/** Google Analytics Content Experiments (`cxApi`): always the original. */
export function googleAnalyticsCxApi(): void {
  const noop = () => {};
  (window as any).cxApi = {
    ORIGINAL_VARIATION: 0,
    NO_CHOSEN_VARIATION: -1,
    NOT_PARTICIPATING: -2,
    chooseVariation: () => 0,
    getChosenVariation: () => -1,
    setAllowHash: noop,
    setChosenVariation: noop,
    setCookiePath: noop,
    setDomainName: noop,
  };
}

/** AdSense (`adsbygoogle`): every ad unit is marked as done and unfilled. */
export function googlesyndicationAdsbygoogle(): void {
  const w = window as any;
  const queue = Array.isArray(w.adsbygoogle) ? w.adsbygoogle : [];
  w.adsbygoogle = queue;
  const fill = () => {
    const unit = document.querySelector(
      "ins.adsbygoogle:not([data-adsbygoogle-status])",
    );
    unit?.setAttribute("data-adsbygoogle-status", "done");
    unit?.setAttribute("data-ad-status", "unfilled");
  };
  const page = (item: unknown) =>
    typeof item === "object" &&
    item !== null &&
    ("google_ad_client" in item || "enable_page_level_ads" in item);
  if (queue.loaded !== true) {
    for (const item of queue) if (!page(item)) fill();
  }
  queue.loaded = true;
  const push = Array.prototype.push;
  queue.push = function (...items: unknown[]) {
    for (const item of items) if (!page(item)) fill();
    return push.apply(this, items);
  };
}

/** Amazon Publisher Services (`apstag`): bid requests come back empty. */
export function amazonApstag(): void {
  const w = window as any;
  const queued = Array.isArray(w.apstag?._Q) ? w.apstag._Q : [];
  const fetchBids = (_config: unknown, callback?: unknown) => {
    if (typeof callback === "function") setTimeout(() => callback([]), 0);
  };
  const withCallback = (_config: unknown, callback?: unknown) => {
    if (typeof callback === "function") setTimeout(callback, 0);
  };
  w.apstag = {
    _Q: [],
    init() {},
    fetchBids,
    setDisplayBids() {},
    targetingKeys: () => [],
    renderImp() {},
    dpa: withCallback,
    rpa: withCallback,
    upa: withCallback,
  };
  for (const [kind, args] of queued) {
    if (kind === "f") fetchBids(...(Array.from(args) as [unknown, unknown]));
  }
}

/** Amazon's older `amzn_ads.js` (`amznads`): no ads, callbacks called. */
export function amazonAds(): void {
  const w = window as any;
  const noop = () => {};
  const later = (fn: unknown) => {
    if (typeof fn === "function") setTimeout(fn, 0);
  };
  later(w.amznads?.asyncParams?.callbackFn);
  w.amznads = {
    getAds: noop,
    getAdsCallback: (_id: unknown, callback: unknown) => later(callback),
    getKeys: () => [],
    getTokens: () => [],
    hasAds: () => false,
    renderAd: noop,
    setTargetingForGPTAsync: noop,
    setTargetingForGPTSync: noop,
  };
}

/** comScore (`COMSCORE`, `_comscore`): beacons go nowhere. */
export function scorecardresearchBeacon(): void {
  const w = window as any;
  w.COMSCORE = { beacon() {} };
  w._comscore = [];
}

/** Outbrain (`OBR`): widgets never load. */
export function outbrainWidget(): void {
  const w = window as any;
  const noop = () => {};
  w.OBR = {
    extern: { refreshWidget: noop, reloadWidget: noop, researchWidget: noop },
  };
  w.OB_releaseVer = "0";
}

/** Chartbeat (`pSUPERFLY`). */
export function chartbeat(): void {
  (window as any).pSUPERFLY = { activity() {}, virtualPage() {} };
}

/** Ligatus: its ad block detection flags. */
export function ligatusAngularTag(): void {
  const w = window as any;
  for (const key of ["adProtect", "uabpdl", "uabDetect"]) {
    try {
      Object.defineProperty(w, key, { configurable: true, value: true });
    } catch {}
  }
}

/** AddThis (`addthis`): share buttons that do nothing. */
export function addthisWidget(): void {
  const w = window as any;
  const noop = () => {};
  const layers = Object.assign(noop.bind(null), { refresh: noop });
  w.addthis = {
    addEventListener: noop,
    button: noop,
    counter: noop,
    init: noop,
    layers,
    removeEventListener: noop,
    share: noop,
    toolbox: noop,
    update: noop,
  };
}

/** Google's ad status check for IMA: ads can play. */
export function doubleclickInstreamAdStatus(): void {
  (window as any).google_ad_status = 1;
}

/** The Sensors Analytics web SDK (`sensors`): events go nowhere. */
export function sensorsAnalytics(): void {
  const w = window as any;
  const name =
    typeof w.sensorsDataAnalytic201505 === "string"
      ? w.sensorsDataAnalytic201505
      : "sensors";
  const noop = () => {};
  const call = (...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") setTimeout(callback, 0);
  };
  w[name] = {
    para: {},
    appendProfile: noop,
    bind: noop,
    deleteItem: noop,
    deleteProfile: noop,
    getAnonymousID: () => "",
    getPresetProperties: () => ({}),
    identify: noop,
    incrementProfile: noop,
    init: noop,
    login: noop,
    logout: noop,
    quick: call,
    register: noop,
    registerPage: noop,
    setItem: noop,
    setOnceProfile: noop,
    setProfile: noop,
    track: call,
    unbind: noop,
    unsetProfile: noop,
    use: noop,
  };
}

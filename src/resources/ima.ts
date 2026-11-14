/**
 * The IMA SDK for HTML5 (`google.ima`), from its public reference: every
 * ad request fails with "VAST empty response", so players play the content.
 * Runs in pages on its own: no imports, nothing from outside its body.
 */
export function googleIma(): void {
  const w = window as any;
  if (w.google?.ima?.AdsLoader !== undefined) return;

  class Target {
    #listeners: [string, (event: unknown) => void, unknown][] = [];
    addEventListener(
      types: string | string[],
      listener: (event: unknown) => void,
      _capture?: boolean,
      scope?: unknown,
    ): void {
      for (const type of ([] as string[]).concat(types))
        this.#listeners.push([type, listener, scope]);
    }
    removeEventListener(
      types: string | string[],
      listener: (event: unknown) => void,
    ): void {
      const removed = ([] as string[]).concat(types);
      this.#listeners = this.#listeners.filter(
        ([type, fn]) => fn !== listener || !removed.includes(type),
      );
    }
    dispatchEvent(event: { type: string }): void {
      for (const [type, listener, scope] of this.#listeners.slice()) {
        if (type === event.type) listener.call(scope, event);
      }
    }
  }

  const ErrorCode = {
    ADS_REQUEST_NETWORK_ERROR: 1012,
    ASSET_FALLBACK_FAILED: 1021,
    AUTOPLAY_DISALLOWED: 1205,
    COMPANION_AD_LOADING_FAILED: 603,
    COMPANION_REQUIRED_ERROR: 602,
    CONSENT_MANAGEMENT_PROVIDER_NOT_READY: 1300,
    FAILED_TO_REQUEST_ADS: 1005,
    INVALID_AD_TAG: 1013,
    INVALID_ARGUMENTS: 1101,
    NONLINEAR_DIMENSIONS_ERROR: 501,
    OVERLAY_AD_LOADING_FAILED: 502,
    OVERLAY_AD_PLAYING_FAILED: 500,
    PROTECTED_AUDIENCE_API_ERROR: 1014,
    STREAM_AUTHORIZATION_FAILED: 1024,
    STREAM_INITIALIZATION_FAILED: 1020,
    STREAM_INITIALIZATION_TIMEOUT: 1023,
    UNKNOWN_AD_RESPONSE: 1010,
    UNKNOWN_ERROR: 900,
    UNSUPPORTED_URL: 1022,
    VAST_ASSET_NOT_FOUND: 1007,
    VAST_EMPTY_RESPONSE: 1009,
    VAST_LINEAR_ASSET_MISMATCH: 403,
    VAST_LOAD_TIMEOUT: 301,
    VAST_MALFORMED_RESPONSE: 100,
    VAST_MEDIA_LOAD_TIMEOUT: 402,
    VAST_NO_ADS_AFTER_WRAPPER: 303,
    VAST_NONLINEAR_ASSET_MISMATCH: 503,
    VAST_PROBLEM_DISPLAYING_MEDIA_FILE: 405,
    VAST_SCHEMA_VALIDATION_ERROR: 101,
    VAST_TOO_MANY_REDIRECTS: 302,
    VAST_TRAFFICKING_ERROR: 200,
    VAST_UNEXPECTED_DURATION_ERROR: 202,
    VAST_UNEXPECTED_LINEARITY: 201,
    VAST_UNSUPPORTED_VERSION: 102,
    VAST_WRAPPER_ERROR: 300,
    VIDEO_PLAY_ERROR: 400,
    VPAID_ERROR: 901,
  };

  class AdError {
    static ErrorCode = ErrorCode;
    static Type = { AD_LOAD: "adLoadError", AD_PLAY: "adPlayError" };
    #code: number;
    #message: string;
    #type: string;
    constructor(code: number, message: string, type: string) {
      this.#code = code;
      this.#message = message;
      this.#type = type;
    }
    getErrorCode() {
      return this.#code;
    }
    getInnerError() {
      return null;
    }
    getMessage() {
      return this.#message;
    }
    getType() {
      return this.#type;
    }
    getVastErrorCode() {
      return 303;
    }
    toString() {
      return `AdError ${this.#code}: ${this.#message}`;
    }
  }

  class AdErrorEvent {
    static Type = { AD_ERROR: "adError" };
    type = "adError";
    #error: AdError;
    #context: unknown;
    constructor(error: AdError, context?: unknown) {
      this.#error = error;
      this.#context = context;
    }
    getError() {
      return this.#error;
    }
    getUserRequestContext() {
      return this.#context ?? null;
    }
  }

  class AdEvent {
    static Type = {
      AD_BREAK_FETCH_ERROR: "adBreakFetchError",
      AD_BREAK_READY: "adBreakReady",
      AD_BUFFERING: "adBuffering",
      AD_CAN_PLAY: "adCanPlay",
      AD_METADATA: "adMetadata",
      AD_PROGRESS: "adProgress",
      ALL_ADS_COMPLETED: "allAdsCompleted",
      CLICK: "click",
      COMPLETE: "complete",
      CONTENT_PAUSE_REQUESTED: "contentPauseRequested",
      CONTENT_RESUME_REQUESTED: "contentResumeRequested",
      DURATION_CHANGE: "durationChange",
      FIRST_QUARTILE: "firstQuartile",
      IMPRESSION: "impression",
      INTERACTION: "interaction",
      LINEAR_CHANGED: "linearChanged",
      LOADED: "loaded",
      LOG: "log",
      MIDPOINT: "midpoint",
      PAUSED: "pause",
      RESUMED: "resume",
      SKIPPABLE_STATE_CHANGED: "skippableStateChanged",
      SKIPPED: "skip",
      STARTED: "start",
      THIRD_QUARTILE: "thirdQuartile",
      USER_CLOSE: "userClose",
      VIDEO_CLICKED: "videoClicked",
      VIDEO_ICON_CLICKED: "videoIconClicked",
      VOLUME_CHANGED: "volumeChange",
      VOLUME_MUTED: "mute",
    };
    type: string;
    constructor(type: string) {
      this.type = type;
    }
    getAd() {
      return null;
    }
    getAdData() {
      return null;
    }
  }

  class AdsManager extends Target {
    collapse() {}
    configureAdsManager() {}
    destroy() {}
    discardAdBreak() {}
    expand() {}
    focus() {}
    getAdSkippableState() {
      return false;
    }
    getCuePoints(): number[] {
      return [];
    }
    getRemainingTime() {
      return 0;
    }
    getVolume() {
      return 1;
    }
    init() {}
    isCustomClickTrackingUsed() {
      return false;
    }
    isCustomPlaybackUsed() {
      return false;
    }
    pause() {}
    resize() {}
    resume() {}
    setVolume() {}
    skip() {}
    start() {}
    stop() {}
    updateAdsRenderingSettings() {}
  }

  class AdsManagerLoadedEvent {
    static Type = { ADS_MANAGER_LOADED: "adsManagerLoaded" };
    type = "adsManagerLoaded";
    getAdsManager() {
      return new AdsManager();
    }
    getUserRequestContext() {
      return null;
    }
  }

  class ImaSdkSettings {
    static CompanionBackfillMode = {
      ALWAYS: "always",
      ON_MASTER_AD: "on_master_ad",
    };
    static VpaidMode = { DISABLED: 0, ENABLED: 1, INSECURE: 2 };
    #values: Record<string, unknown> = {
      CompanionBackfill: "always",
      DisableCustomPlaybackForIOS10Plus: false,
      FeatureFlags: {},
      Locale: "en",
      NumRedirects: 4,
      PlayerType: "",
      PlayerVersion: "",
      Ppid: "",
      PreloadTimeSeconds: 0,
    };
    constructor() {
      for (const name of [
        ...Object.keys(this.#values),
        "AutoPlayAdBreaks",
        "SessionId",
        "VpaidAllowed",
        "VpaidMode",
      ]) {
        const self = this as any;
        self[`set${name}`] = (value: unknown) => {
          this.#values[name] = value;
        };
        if (name in this.#values) self[`get${name}`] = () => this.#values[name];
      }
    }
  }

  const settings = new ImaSdkSettings();
  const VERSION = "3.0.0";

  class AdsLoader extends Target {
    contentComplete() {}
    destroy() {}
    getSettings() {
      return settings;
    }
    getVersion() {
      return VERSION;
    }
    requestAds(_request?: unknown, context?: unknown) {
      setTimeout(() => {
        const error = new AdError(
          ErrorCode.VAST_EMPTY_RESPONSE,
          "No ads in the VAST response.",
          AdError.Type.AD_LOAD,
        );
        this.dispatchEvent(new AdErrorEvent(error, context));
      }, 0);
    }
  }

  class AdDisplayContainer {
    initialize() {}
    destroy() {}
  }

  class AdsRequest {
    setAdWillAutoPlay() {}
    setAdWillPlayMuted() {}
    setContinuousPlayback() {}
  }

  class AdsRenderingSettings {}

  class CompanionAdSelectionSettings {
    static CreativeType = { ALL: "All", FLASH: "Flash", IMAGE: "Image" };
    static ResourceType = {
      ALL: "All",
      HTML: "Html",
      IFRAME: "IFrame",
      STATIC: "Static",
    };
    static SizeCriteria = {
      IGNORE: "IgnoreSize",
      SELECT_EXACT_MATCH: "SelectExactMatch",
      SELECT_NEAR_MATCH: "SelectNearMatch",
    };
  }

  const ima = {
    AdDisplayContainer,
    AdError,
    AdErrorEvent,
    AdEvent,
    AdsLoader,
    AdsManager,
    AdsManagerLoadedEvent,
    AdsRenderingSettings,
    AdsRequest,
    CompanionAdSelectionSettings,
    ImaSdkSettings,
    OmidAccessMode: { DOMAIN: "domain", FULL: "full", LIMITED: "limited" },
    // Values aren't documented: pages only use them as keys.
    OmidVerificationVendor: {
      COMSCORE: 1,
      DOUBLEVERIFY: 2,
      GOOGLE: 3,
      HUMAN: 4,
      INTEGRAL_AD_SCIENCE: 5,
      MEETRICS: 6,
      MOAT: 7,
      MOBIAN: 8,
      NIELSEN: 9,
      OTHER: 10,
      PIXELATE: 11,
    },
    UiElements: { AD_ATTRIBUTION: "adAttribution", COUNTDOWN: "countdown" },
    ViewMode: { FULLSCREEN: "fullscreen", NORMAL: "normal" },
    VERSION,
    settings,
  };
  if (typeof w.google !== "object" || w.google === null) w.google = {};
  w.google.ima = Object.assign(w.google.ima ?? {}, ima);
}

/** The scheme the redirect resources are served from. */
export const ADBLOCK_SCHEME = "tokio-adblock";

/**
 * The entry a host app adds to its own `protocol.registerSchemesAsPrivileged`
 * call, before `app.ready`. The library never registers it: Electron takes one
 * call for the whole app, and a second call replaces the first.
 *
 * NOTE: DO NOT CHANGE the privileges without a run of `yarn smoke`. Without
 * `bypassCSP` a page's CSP blocks the redirected scripts, and without
 * `standard` and `secure` an https page can't load them.
 */
export const adblockScheme = {
  scheme: ADBLOCK_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    bypassCSP: true,
  },
} as const;

// The IPC channels between the preload and the main process. The preload is
// bundled with this file, so it holds nothing but the names.

/** Synchronous: a document asks what it gets, before its scripts run. */
export const DOCUMENT_CHANNEL = "tokio-adblock:document";
/** A page asks for the generic filters of the classes and ids it uses. */
export const GENERIC_CHANNEL = "tokio-adblock:generic";

/** What a page sends with `GENERIC_CHANNEL`. */
export interface GenericRequest {
  url: string;
  classes: string[];
  ids: string[];
}

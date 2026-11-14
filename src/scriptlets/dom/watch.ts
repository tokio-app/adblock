const { apply } = Reflect;

/**
 * Calls `act` on every element `selector` matches: now, and again after each
 * change to the document (and to the `attributes` named), until the
 * observer it returns is disconnected. Undefined for a selector that isn't
 * one. `act` must leave alone what is already done, since its own changes
 * are changes to the document too.
 */
export function watch(
  selector: string,
  act: (element: Element) => void,
  attributes?: readonly string[],
): MutationObserver | undefined {
  try {
    document.querySelector(selector);
  } catch {
    return undefined;
  }
  // Taken now, while it is the browser's: the page's scripts run later.
  // (Not when this file loads: the main process loads it too, for the names.)
  const querySelectorAll = Document.prototype.querySelectorAll;
  // shortcut: rescans the whole document per batch of changes; walk only
  // the added nodes if a busy page shows it in a profile.
  const scan = () => {
    for (const element of apply(querySelectorAll, document, [selector])) {
      try {
        act(element);
      } catch {
        // One element the page made odd doesn't stop the rest.
      }
    }
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document, {
    childList: true,
    subtree: true,
    ...(attributes === undefined
      ? {}
      : { attributes: true, attributeFilter: [...attributes] }),
  });
  return observer;
}

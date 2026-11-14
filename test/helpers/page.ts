import { JSDOM, type DOMWindow } from "jsdom";
import { bundleScriptlets } from "../../scripts/build/bundle.js";

let bundle: Promise<string> | undefined;

export interface TestPage {
  window: DOMWindow;
  /** Runs a scriptlet in the page, the way the preload does. */
  inject(name: string, ...args: string[]): void;
  /** Runs code as a script of the page, and gives its value. */
  run(code: string): unknown;
  /**
   * Runs code as a `<script>` element of the page (only with `scripts`):
   * `document.currentScript` is set, and an error doesn't reach the test.
   */
  script(code: string, attributes?: Record<string, string>): void;
}

/**
 * A page of its own, in jsdom, for a scriptlet test: the scriptlets it gets
 * are the bundled ones, as a real page gets them, so a scriptlet that leans
 * on something outside the bundle fails here.
 */
export async function createPage(
  options: { html?: string; url?: string; scripts?: boolean } = {},
): Promise<TestPage> {
  bundle ??= bundleScriptlets();
  const source = await bundle;
  const dom = new JSDOM(
    options.html ?? "<!doctype html><html><head></head><body></body></html>",
    {
      url: options.url ?? "https://www.site.example/path/page?x=1",
      runScripts: options.scripts ? "dangerously" : "outside-only",
      pretendToBeVisual: true,
    },
  );
  const { window } = dom;
  return {
    window,
    inject(name, ...args) {
      window.eval(`(${source})(${JSON.stringify([{ name, args }])})`);
    },
    run: (code): unknown => window.eval(code),
    script(code, attributes = {}) {
      const element = window.document.createElement("script");
      for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
      }
      element.textContent = code;
      window.document.head.append(element);
    },
  };
}

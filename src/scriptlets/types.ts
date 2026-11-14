/**
 * A scriptlet: a function a filter (`example.com##+js(name, arg, …)`) runs in
 * the page's own world, before the page's scripts.
 *
 * Every scriptlet is bundled with the helpers it imports into one function
 * (`scripts/build`), which the preload hands to the page. So a scriptlet can
 * import from `./helpers.js` and other files of this folder, and nothing
 * else: no Node, no Electron, nothing from outside `src/scriptlets`.
 */
export interface Scriptlet {
  /** The name filters call it by, without `.js`. */
  name: string;
  /** Other names filters call it by. */
  aliases?: readonly string[];
  /**
   * Only for filters of a trusted list: the scriptlet runs what the filter
   * says, where the others can only pick from fixed behaviors.
   */
  trusted?: boolean;
  /** Runs in the page. Arguments are the filter's, as text. */
  run: (...args: string[]) => void;
}

/** A scriptlet a page gets, by its own name, with a filter's arguments. */
export interface ScriptletCall {
  name: string;
  args: string[];
}

/**
 * What `!#if` conditions see: uBlock Origin on a Chromium desktop browser,
 * without what Electron can't do. A name that isn't here is false.
 */
const ENVIRONMENT: Readonly<Record<string, boolean>> = {
  ext_ublock: true,
  ext_abp: false,
  ext_ubol: false,
  ext_devbuild: false,
  env_chromium: true,
  env_edge: false,
  env_firefox: false,
  env_mobile: false,
  env_safari: false,
  env_mv3: false,
  false: false,
  // Electron can't rewrite a response's body.
  cap_html_filtering: false,
  cap_user_stylesheet: true,
  // Chromium doesn't tell the address a request resolved to.
  cap_ipaddress: false,
  adguard: false,
  adguard_app_android: false,
  adguard_app_ios: false,
  adguard_app_mac: false,
  adguard_app_windows: false,
  adguard_ext_android_cb: false,
  adguard_ext_chromium: true,
  adguard_ext_edge: false,
  adguard_ext_firefox: false,
  adguard_ext_opera: true,
  adguard_ext_safari: false,
};

/**
 * Evaluates an `!#if` condition: names joined by `&&` and `||`, negated with
 * `!`, grouped with parentheses. False when it can't be read.
 */
export function evaluateCondition(
  expression: string,
  environment: Readonly<Record<string, boolean>> = ENVIRONMENT,
): boolean {
  const tokens = expression.match(/&&|\|\||[!()]|[\w-]+|\S/g) ?? [];
  let position = 0;
  let failed = false;
  const or = (): boolean => {
    let value = and();
    while (tokens[position] === "||") {
      position++;
      // Not short-circuited: the right side must still be consumed.
      const right = and();
      value ||= right;
    }
    return value;
  };
  const and = (): boolean => {
    let value = unary();
    while (tokens[position] === "&&") {
      position++;
      const right = unary();
      value &&= right;
    }
    return value;
  };
  const unary = (): boolean => {
    const token = tokens[position++];
    if (token === "!") return !unary();
    if (token === "(") {
      const value = or();
      if (tokens[position++] !== ")") failed = true;
      return value;
    }
    if (token === undefined || !/^[\w-]+$/.test(token)) {
      failed = true;
      return false;
    }
    return environment[token] === true;
  };
  const value = or();
  return !failed && position === tokens.length && value;
}

/** Whether an `!#include` path stays in the list's own directory tree. */
function isSafeInclude(path: string): boolean {
  return (
    /^[\w.-]+(?:\/[\w.-]+)*$/.test(path) &&
    !path.split("/").some((segment) => segment === ".." || segment === ".")
  );
}

export interface PreprocessOptions {
  environment?: Readonly<Record<string, boolean>>;
  /**
   * Gives the text of an `!#include`d sub-list, or undefined when it isn't
   * available: the directive is then dropped.
   */
  include?: (path: string) => string | undefined;
}

// A sub-list may include another, but not forever.
const MAX_DEPTH = 4;

/**
 * Follows a list's `!#if`, `!#else` and `!#endif` lines: whether the lines
 * after them are live. `directive` gives the path of a live `!#include`.
 */
class Directives {
  live = true;
  // One entry per open `!#if`: whether its block is live, and whether the
  // block around it is.
  private readonly stack: { live: boolean; outer: boolean }[] = [];

  constructor(
    private readonly environment: Readonly<Record<string, boolean>>,
  ) {}

  directive(line: string): string | undefined {
    const directive = /^!#(\w+)\s*(.*?)\s*$/.exec(line);
    switch (directive?.[1]) {
      case "if": {
        const outer = this.live;
        this.live = outer && evaluateCondition(directive[2]!, this.environment);
        this.stack.push({ live: this.live, outer });
        break;
      }
      case "else": {
        const block = this.stack.at(-1);
        if (block !== undefined) this.live = block.outer && !block.live;
        break;
      }
      case "endif": {
        const block = this.stack.pop();
        if (block !== undefined) this.live = block.outer;
        break;
      }
      case "include":
        if (this.live) return directive[2]!;
        break;
    }
    return undefined;
  }
}

/** Where the line starting at `from` ends: its `\n`, or the text's end. */
function lineEnd(text: string, from: number): number {
  const end = text.indexOf("\n", from);
  return end === -1 ? text.length : end;
}

/** The line from `start` to `end`, without the `\r` of a `\r\n`. */
function lineAt(text: string, start: number, end: number): string {
  return end < text.length && text.charCodeAt(end - 1) === 0x0d /* \r */
    ? text.slice(start, end - 1)
    : text.slice(start, end);
}

/**
 * Applies a list's pre-parsing directives: keeps the lines of `!#if` blocks
 * whose condition holds (with `!#else`), and puts each `!#include`d sub-list
 * where its directive was. Returns the lines left, directives removed.
 */
export function preprocess(
  text: string,
  options: PreprocessOptions = {},
  depth = 0,
  out: string[] = [],
): string[] {
  const state = new Directives(options.environment ?? ENVIRONMENT);
  // Line by line without splitting the text first: a split would make an
  // array of every line, directives and dead blocks included.
  for (let start = 0; start <= text.length;) {
    const end = lineEnd(text, start);
    if (
      text.charCodeAt(start) !== 0x21 /* ! */ ||
      text.charCodeAt(start + 1) !== 0x23 /* # */
    ) {
      if (state.live) out.push(lineAt(text, start, end));
    } else {
      const path = state.directive(lineAt(text, start, end));
      if (path !== undefined && depth < MAX_DEPTH && isSafeInclude(path)) {
        const included = options.include?.(path);
        if (included !== undefined) {
          preprocess(included, options, depth + 1, out);
        }
      }
    }
    start = end + 1;
  }
  return out;
}

/** The sub-lists a list `!#include`s from blocks whose condition holds. */
export function includesOf(
  text: string,
  environment: Readonly<Record<string, boolean>> = ENVIRONMENT,
): string[] {
  const paths: string[] = [];
  const state = new Directives(environment);
  // Only the directives' lines matter.
  const next = (from: number) => {
    const at = text.indexOf("\n!#", from);
    return at === -1 ? -1 : at + 1;
  };
  for (let start = text.startsWith("!#") ? 0 : next(0); start !== -1;) {
    const end = lineEnd(text, start);
    const path = state.directive(lineAt(text, start, end));
    if (path !== undefined && isSafeInclude(path) && !paths.includes(path)) {
      paths.push(path);
    }
    start = next(end);
  }
  return paths;
}

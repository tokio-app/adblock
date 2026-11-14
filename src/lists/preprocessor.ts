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
 * Applies a list's pre-parsing directives: keeps the lines of `!#if` blocks
 * whose condition holds (with `!#else`), and puts each `!#include`d sub-list
 * where its directive was. Returns the lines left, directives removed.
 */
export function preprocess(
  text: string,
  options: PreprocessOptions = {},
  depth = 0,
): string[] {
  const environment = options.environment ?? ENVIRONMENT;
  const out: string[] = [];
  // One entry per open `!#if`: whether its block is live, and whether the
  // block around it is.
  const stack: { live: boolean; outer: boolean }[] = [];
  let live = true;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("!#")) {
      if (live) out.push(line);
      continue;
    }
    const directive = /^!#(\w+)\s*(.*?)\s*$/.exec(line);
    switch (directive?.[1]) {
      case "if":
        stack.push({ live, outer: live });
        live = live && evaluateCondition(directive[2]!, environment);
        stack[stack.length - 1]!.live = live;
        break;
      case "else": {
        const block = stack.at(-1);
        if (block !== undefined) live = block.outer && !block.live;
        break;
      }
      case "endif": {
        const block = stack.pop();
        if (block !== undefined) live = block.outer;
        break;
      }
      case "include": {
        const path = directive[2]!;
        if (!live || depth >= MAX_DEPTH || !isSafeInclude(path)) break;
        const included = options.include?.(path);
        if (included !== undefined) {
          for (const sub of preprocess(included, options, depth + 1)) {
            out.push(sub);
          }
        }
        break;
      }
    }
  }
  return out;
}

/** The sub-lists a list `!#include`s from blocks whose condition holds. */
export function includesOf(
  text: string,
  environment?: Readonly<Record<string, boolean>>,
): string[] {
  const paths: string[] = [];
  preprocess(text, {
    environment,
    include: (path) => {
      if (!paths.includes(path)) paths.push(path);
      return undefined;
    },
  });
  return paths;
}

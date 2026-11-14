// What the network scriptlets share beyond `../helpers.js`.

import { lookUp } from "../helpers.js";

const { apply, construct } = Reflect;
const { defineProperty, getOwnPropertyDescriptor } = Object;
const random = Math.random;

/**
 * Like `wrapMethod`, but `new` calls go through `wrapper` too (with
 * `self` undefined), for methods that are also constructors.
 */
export function wrapCallable(
  owner: object,
  property: string,
  wrapper: (
    original: (...args: any[]) => any,
    self: unknown,
    args: any[],
  ) => unknown,
): boolean {
  const target = (owner as Record<string, unknown>)[property];
  if (typeof target !== "function") return false;
  (owner as Record<string, unknown>)[property] = new Proxy(target, {
    apply: (fn, self, args) =>
      wrapper((...inner) => apply(fn as any, self, inner), self, args),
    construct: (fn, args, newTarget) =>
      wrapper(
        (...inner) => construct(fn as any, inner, newTarget),
        undefined,
        args,
      ) as object,
  });
  return true;
}

/**
 * Puts a function in front of a getter, as a Proxy so that it still reads
 * as the browser's own. `wrapper` gets the original read and `this`.
 */
export function wrapGetter(
  owner: object,
  property: string,
  wrapper: (read: () => unknown, self: unknown) => unknown,
): boolean {
  const descriptor = getOwnPropertyDescriptor(owner, property);
  const get = descriptor?.get;
  if (get === undefined || descriptor?.configurable === false) return false;
  defineProperty(owner, property, {
    ...descriptor,
    get: new Proxy(get, {
      apply: (fn, self, args) => wrapper(() => apply(fn, self, args), self),
    }),
  });
  return true;
}

/** Like `wrapGetter`, for a setter: `wrapper` gets the original write. */
export function wrapSetter(
  owner: object,
  property: string,
  wrapper: (
    write: (value: unknown) => void,
    self: unknown,
    value: unknown,
  ) => void,
): boolean {
  const descriptor = getOwnPropertyDescriptor(owner, property);
  const set = descriptor?.set;
  if (set === undefined || descriptor?.configurable === false) return false;
  defineProperty(owner, property, {
    ...descriptor,
    set: new Proxy(set, {
      apply: (fn, self, args) =>
        wrapper((value) => apply(fn, self, [value]), self, args[0]),
    }),
  });
  return true;
}

/** Random letters and digits. */
export function randomText(length: number): string {
  let text = "";
  while (text.length < length) text += random().toString(36).slice(2);
  return text.slice(0, length);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** An argument position: zero-based, negative from the end. */
export function position(text: string, length: number): number | undefined {
  if (!/^-?\d+$/.test(text)) return undefined;
  const index = Number(text);
  return index < 0 ? length + index : index;
}

/** Wraps the method a chain like `a.b.c` names from `window`, if it exists. */
export function onMethod(
  chain: string,
  wrapper: Parameters<typeof wrapCallable>[2],
): boolean {
  const target = lookUp(chain);
  if (target === undefined) return false;
  const { owner, property } = target;
  // Storage keeps what is assigned to it as an item: wrap the method where
  // it lives, for this one object.
  if (typeof Storage === "function" && owner instanceof Storage) {
    return wrapCallable(Storage.prototype, property, (original, self, args) =>
      self === owner ? wrapper(original, self, args) : original(...args),
    );
  }
  return wrapCallable(owner, property, wrapper);
}

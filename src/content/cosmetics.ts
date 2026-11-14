// Applies a document's cosmetic filters in the page. This file is bundled
// into the preload: it can only import types, and other files of this folder.
import type { ProceduralPlan } from "../parser/types.js";
import {
  compileFilter,
  nameMatcher,
  type CompiledFilter,
} from "./procedural.js";

/** The cosmetic part of what main gives a document (`DocumentCosmetics`). */
export interface CosmeticsConfig {
  css: string;
  procedural: ProceduralPlan[];
  generic: boolean;
}

/** What the page-side code needs from where it runs. */
export interface CosmeticsHost {
  /** Adds a stylesheet the page can't read or remove. */
  insertCSS(css: string): void;
  /**
   * Gives the stylesheet of the generic filters that need one of these
   * classes or ids.
   */
  generic(classes: string[], ids: string[]): Promise<string>;
}

// How long changes to the page gather before they are looked at, in ms.
const DELAY = 30;

/**
 * Hides what a document's cosmetic filters select, and keeps doing it as
 * the page changes. Returns a function that stops it.
 */
export function startCosmetics(
  config: CosmeticsConfig,
  host: CosmeticsHost,
): () => void {
  if (config.css !== "") host.insertCSS(config.css);
  const filters: CompiledFilter[] = [];
  for (const plan of config.procedural) {
    try {
      filters.push(compileFilter(plan));
    } catch {
      // A filter this version can't run only loses itself.
    }
  }
  if (filters.length === 0 && !config.generic) return () => {};

  // Elements are marked with an attribute no page uses, and a stylesheet
  // rule hides or restyles what carries it.
  const token = `x${Math.random().toString(36).slice(2, 10)}`;
  const marks = new Map<
    string,
    { attribute: string; elements: Set<Element> }
  >();
  const mark = (style: string, elements: Set<Element>) => {
    let entry = marks.get(style);
    if (entry === undefined) {
      entry = { attribute: `${token}${marks.size}`, elements: new Set() };
      marks.set(style, entry);
      host.insertCSS(`[${entry.attribute}]{${style}}`);
    }
    for (const element of entry.elements) {
      if (!elements.has(element)) element.removeAttribute(entry.attribute);
    }
    for (const element of elements) {
      if (!entry.elements.has(element))
        element.setAttribute(entry.attribute, "");
    }
    entry.elements = elements;
  };

  const runFilters = () => {
    const selected = new Map<string, Set<Element>>();
    for (const style of marks.keys()) selected.set(style, new Set());
    for (const filter of filters) {
      const elements = filter.select();
      const [action, argument = ""] = filter.action ?? [];
      if (action === "remove") {
        for (const element of elements) element.remove();
      } else if (action === "remove-attr" || action === "remove-class") {
        const matches = nameMatcher(argument);
        for (const element of elements) {
          const names =
            action === "remove-attr"
              ? [...element.attributes].map((attribute) => attribute.name)
              : [...element.classList];
          for (const name of names) {
            if (!matches(name)) continue;
            if (action === "remove-attr") element.removeAttribute(name);
            else element.classList.remove(name);
          }
        }
      } else {
        const style = action === "style" ? argument : "display:none!important;";
        let set = selected.get(style);
        if (set === undefined) selected.set(style, (set = new Set()));
        for (const element of elements) set.add(element);
      }
    }
    // What a filter no longer selects loses its mark.
    for (const [style, elements] of selected) mark(style, elements);
  };

  // Generic filters are asked for by the classes and ids the page uses.
  const seen = new Set<string>();
  let unsurveyed: Element[] = [];
  const survey = () => {
    const classes: string[] = [];
    const ids: string[] = [];
    const note = (element: Element) => {
      if (element.id !== "" && !seen.has(`#${element.id}`)) {
        seen.add(`#${element.id}`);
        ids.push(element.id);
      }
      for (const name of element.classList) {
        if (seen.has(`.${name}`)) continue;
        seen.add(`.${name}`);
        classes.push(name);
      }
    };
    for (const root of unsurveyed) {
      note(root);
      for (const element of root.querySelectorAll("[class],[id]"))
        note(element);
    }
    unsurveyed = [];
    if (classes.length === 0 && ids.length === 0) return;
    host.generic(classes, ids).then(
      (css) => {
        if (css !== "") host.insertCSS(css);
      },
      () => {},
    );
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let stale = true;
  const run = () => {
    timer = undefined;
    if (config.generic) survey();
    if (stale && filters.length > 0) {
      stale = false;
      runFilters();
      // Marking elements is a change of the page too: don't answer it.
      observer.takeRecords();
    }
  };
  const schedule = () => {
    timer ??= setTimeout(run, DELAY);
  };

  const watched = new Set(filters.flatMap((filter) => [...filter.watched]));
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        const name = record.attributeName ?? "";
        if (name.startsWith(token)) continue;
        if (watched.has("*") || watched.has(name)) stale = true;
        if (config.generic && record.target instanceof Element) {
          unsurveyed.push(record.target);
        }
      } else {
        stale = true;
        if (!config.generic) continue;
        for (const node of record.addedNodes) {
          if (node instanceof Element) unsurveyed.push(node);
        }
      }
    }
    schedule();
  });
  const attributes = [...watched, ...(config.generic ? ["class", "id"] : [])];
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: attributes.length > 0,
    // Without a filter every attribute is watched.
    ...(watched.has("*") || attributes.length === 0
      ? {}
      : { attributeFilter: attributes }),
  });
  if (document.documentElement !== null) {
    unsurveyed.push(document.documentElement);
  }
  run();

  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}

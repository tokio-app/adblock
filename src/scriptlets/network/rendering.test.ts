import { describe, expect, test } from "vitest";
import { wait } from "../../../test/helpers/fakes.js";
import { createPage } from "../../../test/helpers/page.js";

describe("prevent-requestAnimationFrame", () => {
  test("defuses the callbacks that match, ! inverts", async () => {
    const page = await createPage();
    page.inject("norafif", "paywall");
    page.inject("no-requestAnimationFrame-if", "!/keep|paywall/");
    page.run(`
      window.log = [];
      window.id = requestAnimationFrame(function paywall() { log.push("paywall") });
      requestAnimationFrame(function keep() { log.push("keep") });
      requestAnimationFrame(function other() { log.push("other") });
    `);
    await wait(60);
    expect(page.run("log")).toEqual(["keep"]);
    expect(page.run("typeof id")).toBe("number");
  });

  test("without arguments nothing changes", async () => {
    const page = await createPage();
    const before = page.run("requestAnimationFrame");
    page.inject("prevent-requestAnimationFrame");
    expect(page.run("requestAnimationFrame")).toBe(before);
  });
});

describe("prevent-canvas", () => {
  test("getContext gives null for the types that match, or for all", async () => {
    const page = await createPage();
    // jsdom has no canvas: a stand-in that names the context it was asked for.
    page.run(
      "HTMLCanvasElement.prototype.getContext = function getContext(type) { return { type } }",
    );
    page.inject("prevent-canvas", "!2d");
    const context = (type: string) =>
      page.run(`document.createElement("canvas").getContext("${type}")`);
    expect(context("webgl")).toBeNull();
    expect(context("2d")).toEqual({ type: "2d" });
    page.inject("prevent-canvas");
    expect(context("2d")).toBeNull();
  });
});

describe("prevent-innerHTML", () => {
  test("drops the assignments that match, on the elements that match", async () => {
    const page = await createPage({
      html: "<!doctype html><body><div id=a></div><p id=b></p></body>",
    });
    page.inject("prevent-innerHTML", "div", "adblock");
    page.inject("prevent-innerHTML", "", "!/./");
    page.run(`
      a.innerHTML = "<b>adblock detected</b>";
      b.innerHTML = "<b>adblock detected</b>";
      a.innerHTML += "fine";
    `);
    expect(page.run("[a.innerHTML, b.innerHTML]")).toEqual([
      "fine",
      "<b>adblock detected</b>",
    ]);
    page.run("b.innerHTML = ''");
    expect(page.run("b.innerHTML")).toBe("<b>adblock detected</b>");
  });

  test("without arguments nothing changes", async () => {
    const page = await createPage();
    const before = page.run(
      "Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML').set",
    );
    page.inject("prevent-innerHTML");
    expect(
      page.run(
        "Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML').set",
      ),
    ).toBe(before);
  });
});

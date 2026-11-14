import { describe, expect, test } from "vitest";
import { createPage } from "../../../test/helpers/page.js";

describe("trusted-override-element-method", () => {
  test("calls on elements that match do nothing, or throw, or give a constant", async () => {
    const page = await createPage({
      html: `<!doctype html><a id=pop target=_blank style="x">a</a><a id=ok>b</a>`,
    });
    page.run(`
      window.clicks = [];
      document.addEventListener("click", (event) => clicks.push(event.target.id));
    `);
    page.inject(
      "trusted-override-element-method",
      "HTMLAnchorElement.prototype.click",
      'a[target="_blank"][style]',
    );
    page.inject(
      "trusted-override-element-method",
      "HTMLElement.prototype.focus",
      "#ok",
      "throw",
    );
    page.inject(
      "trusted-override-element-method",
      "Element.prototype.hasAttribute",
      "",
      "true",
    );
    page.run("pop.click(); ok.click()");
    expect(page.run("clicks")).toEqual(["ok"]);
    expect(() => page.run("ok.focus()")).toThrow(page.window.ReferenceError);
    expect(page.run("pop.focus()")).toBeUndefined();
    expect(page.run("ok.hasAttribute('nothing')")).toBe(true);
  });

  test("an invalid constant or debug changes nothing", async () => {
    const page = await createPage();
    const before = page.run("HTMLElement.prototype.click");
    page.inject(
      "trusted-override-element-method",
      "HTMLElement.prototype.click",
      "",
      "alert(1)",
    );
    page.inject(
      "trusted-override-element-method",
      "HTMLElement.prototype.click",
      "",
      "debug",
    );
    expect(page.run("HTMLElement.prototype.click")).toBe(before);
  });
});

describe("trusted-suppress-native-method", () => {
  test("aborts or prevents the calls whose arguments match", async () => {
    const page = await createPage();
    page.inject(
      "trusted-suppress-native-method",
      "localStorage.setItem",
      '/key/|"value"',
      "prevent",
    );
    page.inject(
      "trusted-suppress-native-method",
      "Object.prototype.hasOwnProperty",
      '"test"',
    );
    page.inject(
      "trusted-suppress-native-method",
      "Node.prototype.appendChild",
      '{"id":"ad"}',
      "prevent",
    );
    page.inject(
      "trusted-suppress-native-method",
      "Array.prototype.concat",
      '[1, "str", true]',
    );
    page.inject(
      "trusted-suppress-native-method",
      "sessionStorage.setItem",
      ' |"secret"',
      "abort",
      "sneaky",
    );
    page.run(`
      localStorage.setItem("my-key", "the value");
      localStorage.setItem("other", "the value");
      localStorage.setItem("third", "x");
      sessionStorage.setItem("my-key", "the value");
      const div = document.createElement("div"); div.id = "ad-1";
      document.body.appendChild(div);
      const p = document.createElement("p"); p.id = "content";
      document.body.appendChild(p);
      window.sneaky = () => sessionStorage.setItem("k", "a secret");
    `);
    expect(
      page.run(
        "[localStorage.getItem('my-key'), localStorage.getItem('other')]",
      ),
    ).toEqual([null, "the value"]);
    // The other storage keeps its method, and the wrapper isn't stored as an item.
    expect(page.run("sessionStorage.getItem('my-key')")).toBe("the value");
    expect(page.run("Object.keys(localStorage).sort()")).toEqual([
      "other",
      "third",
    ]);
    expect(page.run("document.body.children.length")).toBe(1);
    expect(() => page.run("({}).hasOwnProperty('test')")).toThrow(
      page.window.ReferenceError,
    );
    expect(page.run("({ a: 1 }).hasOwnProperty('a')")).toBe(true);
    expect(() => page.run("[0].concat([1, 'str', true, null])")).toThrow(
      page.window.ReferenceError,
    );
    expect(page.run("[0].concat([1, 'str'])")).toEqual([0, 1, "str"]);
    expect(() => page.run("sneaky()")).toThrow(page.window.ReferenceError);
    page.run("sessionStorage.setItem('k', 'a secret')");
    expect(page.run("sessionStorage.getItem('k')")).toBe("a secret");
  });

  test("exact values and the empty string", async () => {
    const page = await createPage();
    page.run("window.api = { f: (...args) => args.length }");
    page.inject(
      "trusted-suppress-native-method",
      "api.f",
      '""|5|null|undefined',
      "prevent",
    );
    expect(page.run("api.f('', 5, null, undefined)")).toBeUndefined();
    expect(page.run("api.f('x', 5, null, undefined)")).toBe(4);
    expect(page.run("api.f('', 5, null, 0)")).toBe(4);
  });

  test("without a signature nothing changes", async () => {
    const page = await createPage();
    const before = page.run("Node.prototype.appendChild");
    page.inject("trusted-suppress-native-method", "Node.prototype.appendChild");
    expect(page.run("Node.prototype.appendChild")).toBe(before);
  });
});

describe("call-nothrow", () => {
  test("a call that throws gives undefined, the others their result", async () => {
    const page = await createPage();
    page.inject("call-nothrow", "Object.defineProperty");
    expect(page.run("Object.defineProperty(1, 'x', {})")).toBeUndefined();
    expect(page.run("Object.defineProperty({}, 'x', { value: 2 }).x")).toBe(2);
  });
});

describe("trusted-prevent-dom-bypass", () => {
  test("a frame the page adds gets this window's method", async () => {
    const page = await createPage();
    page.run("window.open = function patchedOpen() { return 'patched' }");
    page.inject(
      "trusted-prevent-dom-bypass",
      "Element.prototype.append",
      "open",
    );
    page.run(`
      window.frame = document.createElement("iframe");
      document.body.append(frame);
      const wrapper = document.createElement("div");
      wrapper.innerHTML = "<iframe></iframe>";
      document.body.append(wrapper);
      window.inner = wrapper.querySelector("iframe");
    `);
    expect(page.run("frame.contentWindow.open()")).toBe("patched");
    expect(page.run("inner.contentWindow.open()")).toBe("patched");
  });

  test("without a method the frame's window is this one", async () => {
    const page = await createPage();
    page.inject("trusted-prevent-dom-bypass", "Node.prototype.appendChild");
    page.run(
      "window.frame = document.body.appendChild(document.createElement('iframe'))",
    );
    expect(page.run("frame.contentWindow === window")).toBe(true);
  });
});

import { describe, expect, test } from "vitest";
import { dataUrl } from "../../../test/helpers/fakes.js";
import { createPage, type TestPage } from "../../../test/helpers/page.js";

/** Sends a request from the page and gives what its load handler saw. */
function send(page: TestPage, method: string, url: string, type = "") {
  return page.run(`new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(${JSON.stringify(method)}, ${JSON.stringify(url)});
    xhr.responseType = ${JSON.stringify(type)};
    const states = [];
    xhr.onreadystatechange = () => states.push(xhr.readyState);
    xhr.onload = () => resolve({
      states, status: xhr.status, statusText: xhr.statusText, url: xhr.responseURL,
      response: xhr.response, text: xhr.responseType === "" ? xhr.responseText : undefined,
    });
    xhr.onerror = () => resolve("error");
    xhr.send();
  })`) as Promise<Record<string, unknown>>;
}

describe("prevent-xhr", () => {
  test("answers the requests whose URL matches with an empty body", async () => {
    const page = await createPage();
    page.inject("no-xhr-if", "adsbygoogle");
    const url = dataUrl("real ad script", "text/javascript;adsbygoogle");
    const prevented = await send(page, "GET", url);
    expect(prevented).toMatchObject({
      status: 200,
      statusText: "OK",
      url,
      response: "",
      text: "",
    });
    expect(prevented.states).toContain(4);
    const passed = await send(page, "GET", dataUrl("content"));
    expect(passed.text).toBe("content");
  });

  test("conditions: method and url pairs, all must match, ! inverts", async () => {
    const page = await createPage();
    page.inject("prevent-xhr", "method:/HEAD|POST/ url:blocked");
    page.inject("prevent-xhr", "!keep method:PUT");
    expect((await send(page, "POST", dataUrl("blocked"))).text).toBe("");
    expect((await send(page, "GET", dataUrl("blocked"))).text).toBe("blocked");
    expect((await send(page, "PUT", dataUrl("other"))).text).toBe("");
    expect((await send(page, "PUT", dataUrl("keep"))).text).toBe("keep");
  });

  test("the body directives, and the response type the page asked for", async () => {
    const page = await createPage();
    page.inject("no-xhr-if", "obj", "emptyObj");
    page.inject("no-xhr-if", "len", "length:11000");
    page.inject("no-xhr-if", "war", "war:noop.js");
    page.inject("no-xhr-if", "unknown", "some text");
    expect((await send(page, "GET", dataUrl("obj"), "json")).response).toEqual(
      {},
    );
    expect((await send(page, "GET", dataUrl("len"))).text).toHaveLength(11000);
    expect((await send(page, "GET", dataUrl("war"))).text).toBe("");
    expect((await send(page, "GET", dataUrl("unknown"))).text).toBe("");
  });

  test("a synchronous request is answered at once, and a reopened one goes out", async () => {
    const page = await createPage();
    page.inject("no-xhr-if", "blocked");
    const result = page.run(`
      const xhr = new XMLHttpRequest();
      xhr.open("GET", ${JSON.stringify(dataUrl("blocked"))}, false);
      xhr.send();
      const first = [xhr.readyState, xhr.responseText];
      xhr.open("GET", ${JSON.stringify(dataUrl("fine"))}, false);
      const reopened = xhr.readyState;
      xhr.send();
      [...first, reopened, xhr.responseText]
    `);
    expect(result).toEqual([4, "", 1, "fine"]);
  });

  test("without arguments nothing changes, and getters still read as native", async () => {
    const page = await createPage();
    const getter =
      "Function.prototype.toString.call(Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'status').get)";
    const before = [page.run("XMLHttpRequest.prototype.open")];
    page.inject("prevent-xhr");
    expect(page.run("XMLHttpRequest.prototype.open")).toBe(before[0]);
    page.inject("prevent-xhr", "x");
    // In a browser that is what the real one reads as too.
    expect(page.run(getter)).toBe("function () { [native code] }");
  });
});

describe("trusted-prevent-xhr", () => {
  test("an unknown directive is the body", async () => {
    const page = await createPage();
    page.inject("trusted-prevent-xhr", "outbrain", "window.ok = 1");
    expect((await send(page, "GET", dataUrl("outbrain"))).text).toBe(
      "window.ok = 1",
    );
  });
});

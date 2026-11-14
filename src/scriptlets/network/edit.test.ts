import { describe, expect, test } from "vitest";
import { dataUrl, stubFetch, wait, xhr } from "../../../test/helpers/fakes.js";
import { createPage } from "../../../test/helpers/page.js";

describe("json-edit", () => {
  test("removes what the query selects from JSON.parse's result", async () => {
    const page = await createPage();
    page.inject("json-edit", "v2:$..ads[?@.type=='video']");
    const text = JSON.stringify({
      ads: [{ type: "video" }, { type: "banner" }],
      id: 1,
    });
    expect(page.run(`JSON.parse(${JSON.stringify(text)})`)).toEqual({
      ads: [{ type: "banner" }],
      id: 1,
    });
    expect(page.run("JSON.parse('[1]')")).toEqual([1]);
  });

  test("can't assign, and an invalid query changes nothing", async () => {
    const page = await createPage();
    const before = page.run("JSON.parse");
    page.inject("json-edit", "$.ads=0");
    page.inject("json-edit", "legacy.syntax");
    page.inject("json-edit");
    expect(page.run("JSON.parse")).toBe(before);
  });

  test("the trusted one assigns, two filters both apply", async () => {
    const page = await createPage();
    page.inject("trusted-json-edit", "$.ads=false");
    page.inject("json-edit", "$.track");
    expect(page.run(`JSON.parse('{"ads":true,"track":1,"id":2}')`)).toEqual({
      ads: false,
      id: 2,
    });
  });
});

describe("json-edit and jsonl-edit on fetch", () => {
  test("edits the responses whose request matches", async () => {
    const page = await createPage();
    stubFetch(page.window, (url) =>
      url.includes("jsonl")
        ? '{"ad":1,"id":1}\n{"id":2}\nnot json\n'
        : '{"ad":1,"id":1}',
    );
    page.inject(
      "json-edit-fetch-response",
      "$.ad",
      "propsToMatch",
      "api.example",
    );
    page.inject(
      "trusted-jsonl-edit-fetch-response",
      "v2:$.ad;$",
      "propsToMatch",
      "jsonl",
    );
    const text = (url: string) =>
      page.run(`fetch("${url}").then((r) => r.text())`);
    await expect(text("https://api.example/")).resolves.toBe('{"id":1}');
    await expect(text("https://other.example/")).resolves.toBe(
      '{"ad":1,"id":1}',
    );
    await expect(text("https://other.example/jsonl")).resolves.toBe(
      '{"id":2}\nnot json\n',
    );
  });

  test("edits the body of the requests that match", async () => {
    const page = await createPage();
    const requests = stubFetch(page.window);
    page.inject(
      "trusted-json-edit-fetch-request",
      "$.consent=true",
      "propsToMatch",
      "method:POST",
    );
    await page.run(`Promise.all([
      fetch("https://x.example/a", { method: "POST", body: '{"consent":false}' }),
      fetch(new Request("https://x.example/b", { method: "POST", body: '{"consent":false}' })),
      fetch("https://x.example/c", { method: "PUT", body: '{"consent":false}' }),
    ])`);
    expect(
      requests.map((one) => `${one.url} ${String(one.body)}`).sort(),
    ).toEqual([
      'https://x.example/a {"consent":true}',
      'https://x.example/b {"consent":true}',
      'https://x.example/c {"consent":false}',
    ]);
  });
});

describe("json-edit and jsonl-edit on XMLHttpRequest", () => {
  test("edits the responses whose request matches", async () => {
    const page = await createPage();
    page.inject("json-edit-xhr-response", "$.ads", "propsToMatch", "graphql");
    page.inject("jsonl-edit-xhr-response", "$.ad", "propsToMatch", "stream");
    const json = dataUrl('{"ads":[1],"id":1}', "application/json;graphql");
    await expect(xhr(page, json)).resolves.toBe('{"id":1}');
    await expect(xhr(page, json, "json")).resolves.toEqual({ id: 1 });
    const lines = dataUrl('{"ad":1}\n{"id":2}', "text/plain;stream");
    await expect(xhr(page, lines)).resolves.toBe('{}\n{"id":2}');
    await expect(xhr(page, dataUrl('{"ads":1}'))).resolves.toBe('{"ads":1}');
  });

  test("edits the body of the requests that match", async () => {
    const page = await createPage();
    // jsdom doesn't send bodies to data: URLs: check what send() gets.
    page.run(`
      window.sent = [];
      XMLHttpRequest.prototype.send = function (body) { sent.push(body); };
    `);
    page.inject(
      "json-edit-xhr-request",
      "$.tracking",
      "propsToMatch",
      "method:POST",
    );
    page.run(`
      for (const method of ["POST", "PUT"]) {
        const xhr = new XMLHttpRequest();
        xhr.open(method, "${dataUrl("x")}");
        xhr.send('{"tracking":1,"q":2}');
      }
    `);
    expect(page.run("sent")).toEqual(['{"q":2}', '{"tracking":1,"q":2}']);
  });
});

describe("edit-outbound-object, edit-inbound-object and edit-this-object", () => {
  test("edit what a method returns", async () => {
    const page = await createPage();
    page.run("window.api = { config: () => ({ ads: true, id: 1 }) }");
    page.inject("edit-outbound-object", "api.config", "$.ads");
    page.inject("trusted-edit-outbound-object", "api.config", "$.id=2");
    expect(page.run("api.config()")).toEqual({ id: 2 });
  });

  test("edit an argument, by position from the start or the end", async () => {
    const page = await createPage();
    page.inject("edit-inbound-object", "JSON.stringify", "0", "$.secret");
    page.inject(
      "trusted-edit-inbound-object",
      "Object.assign",
      "-1",
      '$.ads={"off":true}',
    );
    expect(page.run("JSON.stringify({ secret: 1, id: 2 })")).toBe('{"id":2}');
    expect(page.run("Object.assign({}, { a: 1 }, { ads: 1 })")).toEqual({
      a: 1,
      ads: { off: true },
    });
    expect(page.run("JSON.stringify(5)")).toBe("5");
  });

  test("edit the object a method is called on", async () => {
    const page = await createPage();
    page.run(`
      window.Player = class { start() { return Object.keys(this) } };
      window.player = Object.assign(new Player(), { ad: 1, video: 2 });
    `);
    page.inject("edit-this-object", "Player.prototype.start", "$.ad");
    expect(page.run("player.start()")).toEqual(["video"]);
  });

  test("a method that doesn't exist, or an invalid query, changes nothing", async () => {
    const page = await createPage();
    page.inject("edit-outbound-object", "nothing.here", "$.a");
    page.inject("edit-inbound-object", "JSON.stringify", "0", "$[1:2]");
    expect(page.run("JSON.stringify({ a: 1 })")).toBe('{"a":1}');
  });
});

describe("edit-element-object", () => {
  test("edits the elements that match, as they arrive", async () => {
    const page = await createPage({
      html: "<!doctype html><div class=ad></div>",
    });
    page.run("document.querySelector('.ad').adConfig = 1");
    page.inject("edit-element-object", ".ad", "$.adConfig");
    page.inject(
      "trusted-edit-element-object",
      "img.track",
      'v2:$.["onload","onerror"]=call(["${obj}","removeAttribute","${key}"])',
      "1000",
    );
    expect(page.run("'adConfig' in document.querySelector('.ad')")).toBe(false);
    page.run(`
      const img = document.createElement("img");
      img.className = "track";
      img.setAttribute("onload", "x()");
      Object.assign(img, { onload: () => {}, onerror: () => {} });
      document.body.append(img);
    `);
    await wait(10);
    expect(
      page.run("document.querySelector('img').hasAttribute('onload')"),
    ).toBe(false);
  });
});

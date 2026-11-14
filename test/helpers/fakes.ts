import type { DOMWindow } from "jsdom";

/**
 * Gives the page a `fetch` (jsdom has none) that answers every request
 * from `answer`, without the network, and records what was asked.
 */
export function stubFetch(
  window: DOMWindow,
  answer: (url: string) => string = (url) => `body of ${url}`,
): { url: string; method?: string; body?: unknown }[] {
  const requests: { url: string; method?: string; body?: unknown }[] = [];
  Object.assign(window, { Response, Request, Headers });
  (window as any).fetch = async (input: unknown, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url =
      request?.url ?? new URL(String(input), window.location.href).href;
    requests.push({
      url,
      method: init?.method ?? request?.method,
      body: request?.body ? await request.text() : init?.body,
    });
    const response = new Response(answer(url), {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/plain" },
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  return requests;
}

/** A data: URL whose body is `text`, for XMLHttpRequest without the network. */
export function dataUrl(text: string, type = "text/plain"): string {
  return `data:${type},${encodeURIComponent(text)}`;
}

export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Sends an XMLHttpRequest from the page and gives the response it read. */
export function xhr(
  page: { run(code: string): unknown },
  url: string,
  type = "",
  method = "GET",
) {
  return page.run(`new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(${JSON.stringify(method)}, ${JSON.stringify(url)});
    xhr.responseType = ${JSON.stringify(type)};
    xhr.onload = () => resolve(xhr.response);
    xhr.send();
  })`);
}

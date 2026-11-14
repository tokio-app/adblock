import type { FetchLike } from "../../src/lists/manager.js";

export interface StubResponse {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

type Route =
  StubResponse | ((headers: Record<string, string>) => StubResponse) | Error;

export interface FetchStub extends FetchLike {
  /** Every request made, in order. */
  requests: { url: string; headers: Record<string, string> }[];
  /** URL → response. Change it between calls to change what a server says. */
  routes: Record<string, Route>;
}

/**
 * A `fetch` that never touches the network: it answers from `routes`, with a
 * 404 for a URL that has none, and records what it was asked.
 */
export function fetchStub(routes: Record<string, Route> = {}): FetchStub {
  const stub: FetchStub = Object.assign(
    async (url: string, init: { headers: Record<string, string> }) => {
      stub.requests.push({ url, headers: init.headers });
      const route = stub.routes[url];
      if (route instanceof Error) throw route;
      const response =
        typeof route === "function"
          ? route(init.headers)
          : (route ?? {
              status: 404,
            });
      const status = response.status ?? 200;
      const headers = new Headers(response.headers);
      return {
        status,
        ok: status >= 200 && status < 300,
        headers,
        text: async () => response.body ?? "",
      };
    },
    { requests: [], routes },
  );
  return stub;
}

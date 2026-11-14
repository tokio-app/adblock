import { expect, test } from "vitest";
import { ADBLOCK_SCHEME, adblockScheme } from "./scheme.js";

test("the scheme entry carries the privileges redirects need", () => {
  expect(adblockScheme).toEqual({
    scheme: "tokio-adblock",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  });
  expect(ADBLOCK_SCHEME).toBe("tokio-adblock");
});

import { describe, expect, test } from "bun:test";
import { PINAR_CLOUD_ORIGIN } from "./local-cloud-redirect";
import { pinarHomeLink } from "./pinar-home-menu";

describe("pinarHomeLink", () => {
  test("local runtime opens the local home directly", () => {
    expect(pinarHomeLink("local")).toEqual({
      href: "/",
      labelKey: "app.openLocalHome",
      testId: "open-local-home",
    });
  });

  test("cloud runtime opens the hosted home", () => {
    expect(pinarHomeLink("cloud")).toEqual({
      href: PINAR_CLOUD_ORIGIN,
      labelKey: "app.openRemoteHome",
      testId: "open-remote-home",
    });
  });
});

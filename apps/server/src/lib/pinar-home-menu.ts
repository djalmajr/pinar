import { PINAR_CLOUD_ORIGIN } from "./local-cloud-redirect";
import type { PinarRuntime } from "./server-header";

export interface PinarHomeMenuLink {
  href: string;
  labelKey: "app.openLocalHome" | "app.openRemoteHome";
  testId: string;
}

export function pinarHomeLink(runtime: PinarRuntime): PinarHomeMenuLink {
  if (runtime === "local") {
    return { href: "/", labelKey: "app.openLocalHome", testId: "open-local-home" };
  }
  return {
    href: PINAR_CLOUD_ORIGIN,
    labelKey: "app.openRemoteHome",
    testId: "open-remote-home",
  };
}

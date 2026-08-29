import { createFileRoute } from "@tanstack/react-router";
import { localCloudOnlyServerHandlers, throwIfLocalCloudLocation } from "@/lib/local-cloud-redirect";
import { PricingPage } from "@/pages/Pricing";

export const Route = createFileRoute("/pricing")({
  beforeLoad: ({ location }) => {
    throwIfLocalCloudLocation(location.href, location.pathname);
  },
  component: PricingPage,
  server: {
    handlers: localCloudOnlyServerHandlers(),
  },
});

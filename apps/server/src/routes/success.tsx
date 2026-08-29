import { createFileRoute } from "@tanstack/react-router";
import { localCloudOnlyServerHandlers, throwIfLocalCloudLocation } from "@/lib/local-cloud-redirect";
import { SuccessPage } from "@/pages/Success";

function SuccessRoute() {
  const { claim, sessionId } = Route.useSearch();
  return <SuccessPage checkoutClaim={claim} sessionId={sessionId} />;
}

export const Route = createFileRoute("/success")({
  beforeLoad: ({ location }) => {
    throwIfLocalCloudLocation(location.href, location.pathname);
  },
  component: SuccessRoute,
  server: {
    handlers: localCloudOnlyServerHandlers(),
  },
  validateSearch: (search) => ({
    claim: typeof search.claim === "string" ? search.claim : "",
    sessionId: typeof search.session_id === "string" ? search.session_id : "",
  }),
});

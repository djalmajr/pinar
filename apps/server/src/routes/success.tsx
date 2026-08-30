import { createFileRoute } from "@tanstack/react-router";
import { localCloudRedirectOrNext, throwIfLocalCloudLocation } from "@/lib/local-cloud-redirect";
import { SuccessPage } from "@/pages/Success";

function SuccessRoute() {
  const { claim, sessionId } = Route.useSearch();
  return <SuccessPage checkoutClaim={claim} sessionId={sessionId} />;
}

export const Route = createFileRoute("/success")({
  validateSearch: (search: Record<string, unknown>) => ({
    claim: typeof search.claim === "string" ? search.claim : "",
    sessionId: typeof search.session_id === "string" ? search.session_id : "",
  }),
  beforeLoad: ({ location }) => {
    throwIfLocalCloudLocation(location.href, location.pathname);
  },
  component: SuccessRoute,
  server: {
    handlers: {
      GET: ({ next, request }) => localCloudRedirectOrNext(request, next),
    },
  },
});

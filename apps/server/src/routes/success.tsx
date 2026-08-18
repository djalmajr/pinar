import { createFileRoute } from "@tanstack/react-router";
import { SuccessPage } from "@/pages/Success";

function SuccessRoute() {
  const { claim, sessionId } = Route.useSearch();
  return <SuccessPage checkoutClaim={claim} sessionId={sessionId} />;
}

export const Route = createFileRoute("/success")({
  component: SuccessRoute,
  validateSearch: (search) => ({
    claim: typeof search.claim === "string" ? search.claim : "",
    sessionId: typeof search.session_id === "string" ? search.session_id : "",
  }),
});

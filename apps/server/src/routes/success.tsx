import { createFileRoute } from "@tanstack/react-router";
import { SuccessPage } from "@/pages/Success";

function SuccessRoute() {
  const { sessionId } = Route.useSearch();
  return <SuccessPage sessionId={sessionId} />;
}

export const Route = createFileRoute("/success")({
  component: SuccessRoute,
  validateSearch: (search) => ({
    sessionId: typeof search.session_id === "string" ? search.session_id : "",
  }),
});

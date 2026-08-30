import { createFileRoute } from "@tanstack/react-router";
import { HistoryDashboard } from "@/pages/HistoryDashboard";
import { authorizeAppRequest } from "@/server/api";

function AppRoute() {
  const { session } = Route.useSearch();
  return <HistoryDashboard viewerSessionId={session} />;
}

export const Route = createFileRoute("/app")({
  component: AppRoute,
  server: {
    handlers: {
      GET: async ({ next, request }) => {
        if (await authorizeAppRequest(request)) return next();
        return new Response(null, {
          headers: {
            "Cache-Control": "no-store",
            Location: "/sign-in?returnTo=%2Fapp",
          },
          status: 302,
        });
      },
    },
  },
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search.session === "string" && search.session ? search.session : undefined,
  }),
});

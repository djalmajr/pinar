import { createFileRoute } from "@tanstack/react-router";
import { HistoryDashboard } from "@/pages/HistoryDashboard";
import { authorizeAppRequest } from "@/server/api";

export const Route = createFileRoute("/app")({
  component: HistoryDashboard,
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
});

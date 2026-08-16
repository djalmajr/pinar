import { createFileRoute } from "@tanstack/react-router";
import { HistoryDashboard } from "@/pages/HistoryDashboard";
import { authorizeHistoryRequest } from "@/server/api";

export const Route = createFileRoute("/history")({
  component: HistoryDashboard,
  server: {
    handlers: {
      GET: async ({ next, request }) => {
        if (await authorizeHistoryRequest(request)) return next();
        return new Response("Open Remote History from the Pinar extension.", {
          headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
          status: 401,
        });
      },
    },
  },
});

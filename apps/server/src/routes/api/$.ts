import { createFileRoute } from "@tanstack/react-router";
import { handleApiRequest } from "@/server/api";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: ({ request }) => handleApiRequest(request),
    },
  },
});

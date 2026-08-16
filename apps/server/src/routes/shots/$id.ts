import { createFileRoute } from "@tanstack/react-router";
import { handlePublicRequest } from "@/server/api";

export const Route = createFileRoute("/shots/$id")({
  server: {
    handlers: {
      GET: ({ request }) => handlePublicRequest(request),
    },
  },
});

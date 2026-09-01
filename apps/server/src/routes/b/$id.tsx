import { createFileRoute } from "@tanstack/react-router";
import { handlePublicRequest } from "@/server/api";

// A batch has no page of its own: it is a filter in the workspace. Only the
// markdown bundle is served here.
export const Route = createFileRoute("/b/$id")({
  server: {
    handlers: {
      GET: ({ next, params, request }) => (
        params.id.endsWith(".md") ? handlePublicRequest(request) : next()
      ),
    },
  },
});

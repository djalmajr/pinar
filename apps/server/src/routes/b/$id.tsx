import { createFileRoute } from "@tanstack/react-router";
import { handlePublicRequest } from "@/server/api";

// A batch has no page of its own: it is a filter in the workspace, so only the
// markdown bundle is served here. Falling through to `next()` for anything else
// hit a route with no component and answered 500, so every shape is handled by
// the API, which replies 404 for a path that is not the bundle.
export const Route = createFileRoute("/b/$id")({
  server: {
    handlers: {
      GET: ({ request }) => handlePublicRequest(request),
    },
  },
});

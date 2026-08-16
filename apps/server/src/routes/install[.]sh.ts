import { createFileRoute } from "@tanstack/react-router";
import { handlePublicRequest } from "@/server/api";

export const Route = createFileRoute("/install.sh")({
  server: { handlers: { GET: ({ request }) => handlePublicRequest(request) } },
});

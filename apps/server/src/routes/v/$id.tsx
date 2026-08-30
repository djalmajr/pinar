import { Navigate, createFileRoute } from "@tanstack/react-router";
import { WebViewer } from "@/pages/WebViewer";
import { pinarRuntime, shouldUseWorkspaceChrome } from "@/lib/server-header";
import { handlePublicRequest } from "@/server/api";

function ViewerRoute() {
  const { id } = Route.useParams();
  if (shouldUseWorkspaceChrome(pinarRuntime())) {
    return <Navigate replace search={{ session: id }} to="/app" />;
  }
  return <WebViewer sessionId={id} />;
}

export const Route = createFileRoute("/v/$id")({
  component: ViewerRoute,
  server: {
    handlers: {
      GET: ({ next, params, request }) => {
        return params.id.endsWith(".md") ? handlePublicRequest(request) : next();
      },
    },
  },
});

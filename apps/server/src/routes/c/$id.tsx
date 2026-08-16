import { createFileRoute } from "@tanstack/react-router";
import { AggregateViewer } from "@/pages/AggregateViewer";
import { handlePublicRequest } from "@/server/api";

function CollectionRoute() {
  const { id } = Route.useParams();
  return <AggregateViewer id={id} kind="collection" />;
}

export const Route = createFileRoute("/c/$id")({
  component: CollectionRoute,
  server: {
    handlers: {
      GET: ({ next, params, request }) => {
        return params.id.endsWith(".md") ? handlePublicRequest(request) : next();
      },
    },
  },
});

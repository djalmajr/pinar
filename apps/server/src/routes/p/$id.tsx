import { createFileRoute } from "@tanstack/react-router";
import { AggregateViewer } from "@/pages/AggregateViewer";
import { handlePublicRequest } from "@/server/api";

function ProjectRoute() {
  const { id } = Route.useParams();
  return <AggregateViewer id={id} kind="project" />;
}

export const Route = createFileRoute("/p/$id")({
  component: ProjectRoute,
  server: {
    handlers: {
      GET: ({ next, params, request }) => {
        return params.id.endsWith(".md") ? handlePublicRequest(request) : next();
      },
    },
  },
});

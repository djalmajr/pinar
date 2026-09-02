import { createFileRoute } from "@tanstack/react-router";
import { loadReleaseContent } from "@/lib/release-content";
import { seedLocalizedContent } from "@/lib/use-localized-content";
import { ReleaseDetailPage } from "@/pages/Releases";

function ReleaseRoute() {
  const { version } = Route.useParams();
  const { releaseContent } = Route.useLoaderData();
  seedLocalizedContent("releases", releaseContent.language, releaseContent);
  return <ReleaseDetailPage version={version} />;
}

export const Route = createFileRoute("/releases/$version")({
  component: ReleaseRoute,
  loader: async ({ context }) => ({
    releaseContent: await loadReleaseContent(context.language),
  }),
});

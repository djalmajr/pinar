import { createFileRoute } from "@tanstack/react-router";
import { loadReleaseContent } from "@/lib/release-content";
import { seedLocalizedContent } from "@/lib/use-localized-content";
import { ReleasesPage } from "@/pages/Releases";

function ReleasesRoute() {
  const { releaseContent } = Route.useLoaderData();
  seedLocalizedContent("releases", releaseContent.language, releaseContent);
  return <ReleasesPage />;
}

export const Route = createFileRoute("/releases/")({
  component: ReleasesRoute,
  loader: async ({ context }) => ({
    releaseContent: await loadReleaseContent(context.language),
  }),
});

import { createFileRoute } from "@tanstack/react-router";
import { loadHelpContent } from "@/lib/help-content";
import { seedLocalizedContent } from "@/lib/use-localized-content";
import { HelpHomePage } from "@/pages/Help";

function HelpHomeRoute() {
  const { helpContent } = Route.useLoaderData();
  seedLocalizedContent("help", helpContent.language, helpContent);
  return <HelpHomePage />;
}

export const Route = createFileRoute("/help/")({
  component: HelpHomeRoute,
  loader: async ({ context }) => ({
    helpContent: await loadHelpContent(context.language),
  }),
});

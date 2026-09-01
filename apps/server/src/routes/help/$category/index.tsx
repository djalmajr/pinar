import { createFileRoute } from "@tanstack/react-router";
import { loadHelpContent } from "@/lib/help-content";
import { seedLocalizedContent } from "@/lib/use-localized-content";
import { HelpCategoryPage } from "@/pages/Help";

function HelpCategoryRoute() {
  const { category } = Route.useParams();
  const { helpContent } = Route.useLoaderData();
  seedLocalizedContent("help", helpContent.language, helpContent);
  return <HelpCategoryPage categoryId={category} />;
}

export const Route = createFileRoute("/help/$category/")({
  component: HelpCategoryRoute,
  loader: async ({ context }) => ({
    helpContent: await loadHelpContent(context.language),
  }),
});

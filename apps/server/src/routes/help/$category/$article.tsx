import { createFileRoute } from "@tanstack/react-router";
import { loadHelpContent } from "@/lib/help-content";
import { seedLocalizedContent } from "@/lib/use-localized-content";
import { HelpArticlePage } from "@/pages/Help";

function HelpArticleRoute() {
  const { article, category } = Route.useParams();
  const { helpContent } = Route.useLoaderData();
  seedLocalizedContent("help", helpContent.language, helpContent);
  return <HelpArticlePage articleId={article} categoryId={category} />;
}

export const Route = createFileRoute("/help/$category/$article")({
  component: HelpArticleRoute,
  loader: async ({ context }) => ({
    helpContent: await loadHelpContent(context.language),
  }),
});

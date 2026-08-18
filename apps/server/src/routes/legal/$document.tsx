import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/pages/LegalDocument";

function LegalRoute() {
  const { document } = Route.useParams();
  return <LegalDocumentPage documentId={document} />;
}

export const Route = createFileRoute("/legal/$document")({
  component: LegalRoute,
});

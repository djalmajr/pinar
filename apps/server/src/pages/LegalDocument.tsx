import { Button, ScrollArea, Tabs, TabsContent, TabsList, TabsTrigger } from "@pinar/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { ServerFooter } from "@/components/ServerFooter";
import { ServerShell } from "@/components/ServerShell";
import {
  LegalDocumentIds,
  isLegalDocumentId,
  legalDocument,
  legalDocumentTitle,
} from "@/lib/legal-documents";
import { useServerI18n } from "@/lib/i18n";

interface LegalDocumentPageProps {
  documentId: string;
}

export function LegalDocumentPage({ documentId }: LegalDocumentPageProps) {
  const { language } = useServerI18n();
  const navigate = useNavigate();
  if (!isLegalDocumentId(documentId)) {
    return (
      <ServerShell>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
          <h1 className="text-2xl font-bold">{language === "pt" ? "Documento não encontrado" : "Document not found"}</h1>
          <Button render={<Link preload="intent" to="/" />} variant="outline">
            {language === "pt" ? "Voltar ao início" : "Back home"}
          </Button>
        </main>
      </ServerShell>
    );
  }
  const document = legalDocument(documentId, language);

  function selectDocument(nextDocumentId: string) {
    if (!isLegalDocumentId(nextDocumentId)) return;
    void navigate({ params: { document: nextDocumentId }, to: "/legal/$document" });
  }

  return (
    <ServerShell>
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-10">
          <div className="w-full">
            <header className="border-b pb-6">
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{document.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {language === "pt" ? "Versão e vigência" : "Version and effective date"}: {document.version}
            </p>
            </header>
            <Tabs className="gap-0" value={document.id} onValueChange={selectDocument}>
            <TabsList
              aria-label={language === "pt" ? "Documentos legais" : "Legal documents"}
              className="h-auto w-full flex-wrap justify-start gap-x-4 gap-y-2 border-b px-0 py-5 group-data-horizontal/tabs:h-auto"
              variant="line"
            >
              {LegalDocumentIds.map((legalDocumentId) => (
                <TabsTrigger className="h-8 flex-none px-0" key={legalDocumentId} value={legalDocumentId}>
                  {legalDocumentTitle(legalDocumentId, language)}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={document.id}>
              <article className="py-8 text-sm leading-7 text-foreground">
                <ReactMarkdown
                  components={{
                    a: ({ children, href }) => <a className="font-medium text-primary underline underline-offset-4" href={href} rel="noopener noreferrer" target="_blank">{children}</a>,
                    h2: ({ children }) => <h2 className="mb-3 mt-8 text-xl font-semibold tracking-tight first:mt-0">{children}</h2>,
                    h3: ({ children }) => <h3 className="mb-2 mt-6 text-base font-semibold">{children}</h3>,
                    li: ({ children }) => <li className="ml-5 list-disc pl-1">{children}</li>,
                    p: ({ children }) => <p className="mb-4 text-muted-foreground">{children}</p>,
                    ul: ({ children }) => <ul className="mb-4 space-y-1 text-muted-foreground">{children}</ul>,
                  }}
                >
                  {document.body}
                </ReactMarkdown>
              </article>
            </TabsContent>
            </Tabs>
          </div>
          <ServerFooter className="pt-4" />
        </main>
      </ScrollArea>
    </ServerShell>
  );
}

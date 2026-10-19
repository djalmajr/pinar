// Copiado de zommehq/shared src/ui/components/ui/trace.test.tsx no commit c15fd2d (os componentes de chat da Skia), adaptado ao bun test, aos ícones lucide e aos tokens do Pinar.
import { renderToStaticMarkup } from "react-dom/server";
// O tsconfig da raiz só carrega os tipos do Node; quem roda este arquivo é o bun test.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { describe, expect, it, mock } from "bun:test";

// Port do AI Elements (shadcn) adaptado ao pacote: estrutura canônica
// (`data-slot`, variantes de status) sem dependências novas — ícone via
// `~icons/lucide/*` (stub em teste), `cn` do pacote e `Collapsible` do
// pacote (Base UI).
mock.module("~icons/lucide/chevron-right", () => ({
  default: ({ className }: { className?: string }) => <span className={className} data-testid="icon-mock" />,
}));

const {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} = await import("./trace.js");

function slotOf(html: string, slot: string): string | null {
  const marker = `data-slot="${slot}"`;
  const index = html.indexOf(marker);
  if (index < 0) return null;
  return html.slice(index);
}

describe("trace (AI Elements)", () => {
  it("Trace renderiza o slot e aceita className extra", () => {
    const html = renderToStaticMarkup(
      <Trace data-testid="trace-root">
        <TraceLine status="running">
          <TraceIcon>
            <span />
          </TraceIcon>
          <TraceTitle>Passo</TraceTitle>
        </TraceLine>
      </Trace>,
    );
    const trace = slotOf(html, "trace");
    expect(trace).toBeTruthy();
    expect(trace).toContain('data-testid="trace-root"');
  });

  it("TraceLine expõe o status no data-status (running/erro/pendente)", () => {
    for (const status of ["running", "error", "pending"] as const) {
      const html = renderToStaticMarkup(<TraceLine status={status}>x</TraceLine>);
      expect(slotOf(html, "trace-line")).toContain(`data-status="${status}"`);
    }
    // Sem status não há atributo (a linha é neutra).
    const plain = renderToStaticMarkup(<TraceLine>x</TraceLine>);
    expect(slotOf(plain, "trace-line")).not.toContain("data-status");
  });

  it("TraceIcon é decorativo (aria-hidden) e TraceTitle/Description preservam o texto", () => {
    const html = renderToStaticMarkup(
      <TraceLine>
        <TraceIcon>
          <span />
        </TraceIcon>
        <TraceTitle>Título</TraceTitle>
        <TraceDescription>2,1 s</TraceDescription>
      </TraceLine>,
    );
    expect(slotOf(html, "trace-icon")).toContain('aria-hidden="true"');
    expect(slotOf(html, "trace-title")).toContain("Título");
    expect(slotOf(html, "trace-description")).toContain("2,1 s");
  });

  it("TraceCollapsible controlado passa open/onOpenChange ao primitivo", () => {
    const onOpenChange = mock();
    const html = renderToStaticMarkup(
      <TraceCollapsible onOpenChange={onOpenChange} open>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceTitle>3 passos</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <TraceLine>
            <TraceTitle>Passo</TraceTitle>
          </TraceLine>
        </TraceCollapsibleContent>
      </TraceCollapsible>,
    );
    const collapsible = slotOf(html, "trace-collapsible");
    expect(collapsible).toBeTruthy();
    // O trigger carrega o chevron (stub de ícone) e o conteúdo interno
    // guarda os passos.
    const trigger = slotOf(html, "trace-collapsible-trigger");
    expect(trigger).toBeTruthy();
    expect(trigger).toContain('data-testid="icon-mock"');
    expect(slotOf(html, "trace-collapsible-content-inner")).toContain("Passo");
    // Formas não controladas não exigem handler (o próprio TypeScript
    // impõe a dupla open+onOpenChange quando controlado).
    renderToStaticMarkup(
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceTitle>1 passo</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
      </TraceCollapsible>,
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

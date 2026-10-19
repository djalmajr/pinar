// Copiado de zommehq/shared src/ui/components/ui/message-scroller.test.tsx no commit c15fd2d (os componentes de chat da Skia), adaptado ao bun test, aos ícones lucide e aos tokens do Pinar.
import { renderToStaticMarkup } from "react-dom/server";
// O tsconfig da raiz só carrega os tipos do Node; quem roda este arquivo é o bun test.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { describe, expect, it, mock } from "bun:test";

// Os ícones `~icons/*` só resolvem sob o Vite (unplugin-icons): no bun test
// o módulo virtual vira um stub antes de o componente carregar.
mock.module("~icons/lucide/arrow-down", () => ({
  default: ({ className }: { className?: string }) => <span className={className} data-testid="icon-mock" />,
}));

const {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} = await import("./message-scroller.js");

// Composição com o `ScrollArea` do `@pinar/ui`: a opção `scrollArea`
// do `MessageScrollerViewport` renderiza o viewport do primitivo ATRAVÉS do
// `ScrollArea.Viewport` do Base UI (prop `render`), então a ref do
// `ScrollArea` e a do `MessageScroller` caem no mesmo nó DOM — um único
// elemento rolável para âncora, autoscroll e thumb. O padrão (sem a prop)
// segue idêntico ao anterior: sem partes do `ScrollArea`.
function openTagOf(html: string, marker: string): string {
  const index = html.indexOf(marker);
  expect(index, `marcador ${marker} ausente no HTML`).toBeGreaterThan(0);
  const tagStart = html.lastIndexOf("<", index);
  return html.slice(tagStart, html.indexOf(">", index));
}

function viewportOpenTag(html: string): string {
  return openTagOf(html, `data-slot="message-scroller-viewport"`);
}

function renderViewport(scrollArea?: boolean, testId = "viewport-teste") {
  return renderToStaticMarkup(
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport
          aria-label="Mensagens"
          data-testid={testId}
          preserveScrollOnPrepend
          scrollArea={scrollArea}
        >
          <MessageScrollerContent>
            <MessageScrollerItem messageId="m1">oi</MessageScrollerItem>
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>,
  );
}

describe("MessageScrollerViewport + ScrollArea", () => {
  it("padrão: sem partes do ScrollArea e sem ocultar a barra nativa", () => {
    const html = renderViewport(false);
    expect(html).not.toContain('data-slot="scroll-area-scrollbar"');
    expect(html).not.toContain('data-slot="scroll-area-thumb"');
    expect(viewportOpenTag(html)).not.toContain("base-ui-disable-scrollbar");
  });

  it("scrollArea: o viewport vira o viewport do ScrollArea (mesmo elemento rolável)", () => {
    const html = renderViewport(true);
    // O scroll element continua sendo o viewport do primitivo (testid,
    // aria-label e o slot intactos) — o Base UI não criou um segundo
    // elemento rolável em volta.
    expect(html).toContain('data-testid="viewport-teste"');
    expect(html).toContain('aria-label="Mensagens"');
    // A classe do Base UI que esconde a barra nativa está no MESMO nó
    // (scrollbar-width:none + ::-webkit-scrollbar display:none), e o
    // overflow do scroll area está no estilo.
    const openTag = viewportOpenTag(html);
    expect(openTag).toContain("base-ui-disable-scrollbar");
    expect(openTag).toContain("overflow:scroll");
    // `role="region"` sobrevive à injeção de `role="presentation"` do
    // Base UI (acessibilidade do primitivo preservada).
    expect(openTag).toContain('role="region"');
    expect(openTag).not.toContain('role="presentation"');
    // A barra (track + thumb) depende de medição no cliente (oculta sem
    // overflow; `keepMounted=false`), então não entra no SSR — a prova de
    // presença da barra no DOM fica para um teste com DOM real.
  });

  it("scrollArea: mantém as props do consumidor no mesmo elemento", () => {
    const html = renderViewport(true);
    const openTag = viewportOpenTag(html);
    // Classes próprias do viewport e do consumidor continuam no nó.
    expect(openTag).toContain("overflow-y-auto");
    // O wrapper do Root preenche o `MessageScroller` (size-full) e dá o
    // contexto de posicionamento da barra (relative).
    expect(html).toContain('data-slot="message-scroller-scroll-area"');
    const rootOpen = openTagOf(html, 'data-slot="message-scroller-scroll-area"');
    expect(rootOpen).toContain("size-full");
    expect(rootOpen).toContain("relative");
  });
});

// Prop `tooltip` do `MessageScrollerButton`: entra no Pick dos props do
// `TooltipButton` e é repassada ao botão padrão; `render` custom do consumidor
// continua vencendo (tooltip só no ramo padrão). O scroll/âncora e o
// comportamento do botão seguem do primitivo.
describe("MessageScrollerButton tooltip (opt-in)", () => {
  function renderButton(extra: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      <MessageScrollerProvider>
        <MessageScrollerViewport data-testid="viewport-teste">
          <MessageScrollerContent>
            <MessageScrollerItem />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton {...extra} />
      </MessageScrollerProvider>,
    );
  }

  it("sem tooltip: o botão padrão mantém o resultado atual (sr-only, sem trigger)", () => {
    const html = renderButton();

    expect(html).toContain('data-slot="message-scroller-button"');
    expect(html).toContain('sr-only">Scroll to end</span>');
    expect(html).not.toContain("tooltip-trigger");
  });

  it("com tooltip: o botão padrão ganha o trigger real do tooltip (único botão, children intactos)", () => {
    const html = renderButton({ tooltip: "Ir para o fim da conversa" });

    expect(html).toContain('data-slot="message-scroller-button"');
    expect(html).toContain('data-base-ui-tooltip-trigger=""');
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('sr-only">Scroll to end</span>');
    // Popup fechado: o texto da dica não aparece fora do botão.
    expect(html).not.toContain(">Ir para o fim da conversa</span>");
  });

  it("render custom do consumidor vence: sem tooltip no wrapper do render", () => {
    const html = renderButton({
      render: <a href="#fim" />,
      tooltip: "Ir para o fim da conversa",
      children: "Fim",
    });

    expect(html).toContain('href="#fim"');
    expect(html).not.toContain("tooltip-trigger");
    expect(html).toContain(">Fim</a>");
  });
});

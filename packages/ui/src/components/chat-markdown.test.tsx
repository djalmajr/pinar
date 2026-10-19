// Copiado de zommehq/shared src/ui/components/ds/chat-markdown.test.tsx no commit c15fd2d (os componentes de chat da Skia), adaptado ao bun test, aos ícones lucide e aos tokens do Pinar.
import { renderToStaticMarkup } from "react-dom/server";
// O tsconfig da raiz só carrega os tipos do Node; quem roda este arquivo é o bun test.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { describe, expect, it, mock } from "bun:test";

// Os ícones `~icons/*` só resolvem sob o Vite (unplugin-icons): no bun test
// cada módulo virtual vira um stub antes de o componente carregar.
for (const icon of ["check", "copy"]) {
  mock.module(`~icons/lucide/${icon}`, () => ({
    default: ({ className }: { className?: string }) => <span className={className} data-testid="icon-mock" />,
  }));
}

const { ChatMarkdown } = await import("./chat-markdown.js");

/**
 * `chat-markdown.tsx`: o teste estático cobre o que roda sem DOM —
 * GFM vira elementos sem `dangerouslySetInnerHTML`, links fora do allowlist
 * viram texto, HTML cru é descartado (sem `rehype-raw`), e tabela/bloco de
 * código entram no `ScrollArea` do kit. O comportamento em DOM (barra
 * horizontal visível com overflow) fica para um teste com DOM real.
 */
describe("chat-markdown", () => {
  it("lista, negrito, código e título viram elementos com estilo compacto", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown markdown={"## Título\n\n- **negrito**\n- `codigo`"} />,
    );
    expect(html).toContain("<h2");
    expect(html).toContain('class="text-sm font-semibold"');
    expect(html).toContain('<ul class="space-y-1 pl-5 list-disc">');
    expect(html).toContain("<strong");
    expect(html).toContain("negrito");
    expect(html).toContain("font-mono");
    expect(html).toContain("codigo");
  });

  it("link https abre em nova aba com noopener", () => {
    const html = renderToStaticMarkup(<ChatMarkdown markdown={"[site](https://exemplo.com)"} />);
    expect(html).toContain('href="https://exemplo.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("link javascript: não vira link (rótulo fica como texto)", () => {
    const html = renderToStaticMarkup(<ChatMarkdown markdown={"[x](javascript:alert(1))"} />);
    expect(html).not.toContain("<a");
    expect(html).toContain("x");
  });

  it("caminho relativo não vira link", () => {
    const html = renderToStaticMarkup(<ChatMarkdown markdown={"[x](/configuracoes)"} />);
    expect(html).not.toContain("<a");
    expect(html).toContain("x");
  });

  it("HTML cru (script/img) é descartado, sem virar elemento", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown markdown={"ola\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>"} />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("ola");
  });

  it("imagem não carrega recurso: vira só o texto alternativo", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown
        markdown={"![foto](https://example.invalid/pixel?c=1) e ![](https://example.invalid/x)"}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("example.invalid");
    expect(html).toContain("<span>foto</span>");
  });

  it("tabela GFM fica no scroll-area do kit, sem barra nativa e sem coluna cortada", () => {
    const markdown = "| a | b |\n|---|---|\n| 1 | 2 |";
    const html = renderToStaticMarkup(<ChatMarkdown markdown={markdown} />);
    expect(html).toContain('data-slot="scroll-area"');
    expect(html).toContain('data-slot="scroll-area-viewport"');
    // `overflow: scroll` (inline, no scroll chaining) e a classe que esconde
    // a barra nativa estão no viewport do Base UI.
    expect(html).toContain("overflow:scroll");
    expect(html).toContain("base-ui-disable-scrollbar");
    expect(html).toContain('class="w-max min-w-full border-collapse text-sm"');
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain(">a<");
    expect(html).toContain(">b<");
  });

  it("bloco de código fica no scroll-area do kit", () => {
    const html = renderToStaticMarkup(<ChatMarkdown markdown={"```js\nconst a = 1\n```"} />);
    expect(html).toContain('data-slot="scroll-area"');
    expect(html).toContain('data-slot="scroll-area-viewport"');
    expect(html).toContain("const a = 1");
    expect(html).toContain("base-ui-disable-scrollbar");
  });

  // Um único alvo de foco para a área rolável
  // do bloco de código. Na composição o `pre` vive dentro do `ScrollArea`
  // (que é o que rola) e sai da sequência de Tab: o viewport do kit — com
  // o anel de foco do próprio kit — é o único elemento com `tabindex` no
  // markup. Com código largo (overflow) o Base UI mede no DOM e mantém o
  // viewport na sequência (`tabIndex=0`); no markup SSR o atributo já
  // existe (com `-1`) e o valor só muda depois da medição.
  it("código largo: o pre sai da sequência de Tab e o viewport do kit é o único alvo, com o anel de foco", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown markdown={"```ts\nconst linhaLargaMuitoLonga = " + "x".repeat(120) + "\n```"} />,
    );
    // O `pre` (área do código) não tem `tabindex`: fora da sequência de
    // Tab nesta composição.
    const pre = /<pre[^>]*data-slot="code-block-content"[^>]*>/.exec(html)?.[0];
    expect(pre).toBeTruthy();
    expect(pre).not.toContain("tabindex");
    // O viewport do `ScrollArea` é o alvo: tem `tabindex` explícito
    // (Base UI gerencia o valor: `-1` no SSR, `0` com overflow no DOM) e
    // carrega o anel de foco do kit (indicador do `ScrollArea`).
    const viewport = /<div[^>]*data-slot="scroll-area-viewport"[^>]*>/.exec(html)?.[0];
    expect(viewport).toBeTruthy();
    expect(viewport).toContain("tabindex");
    expect(viewport).toContain("focus-visible:ring-[3px]");
    // Um único alvo para a área do código: dentro do `ScrollArea` (do
    // slot ao fim do `pre`), só o viewport tem `tabindex`. O botão copiar
    // é ação do bloco, não a área rolável.
    const inicioScrollArea = html.indexOf('data-slot="scroll-area"');
    const fimPre = html.indexOf("</pre>");
    expect(inicioScrollArea).toBeGreaterThan(-1);
    expect(fimPre).toBeGreaterThan(inicioScrollArea);
    expect((html.slice(inicioScrollArea, fimPre).match(/tabindex=/g) ?? []).length).toBe(1);
  });

  // O cabeçalho existe SEMPRE (mesmo sem linguagem), com a
  // linguagem à esquerda e as ações à direita no mesmo fluxo flex — o botão
  // copiar nunca fica posicionado sobre o código.
  it("cabeçalho do bloco de código existe com e sem linguagem, e o bloco tem borda sutil", () => {
    const comLinguagem = renderToStaticMarkup(<ChatMarkdown markdown={"```ts\nconst a = 1\n```"} />);
    const semLinguagem = renderToStaticMarkup(<ChatMarkdown markdown={"```\nbun test\n```"} />);
    for (const [html, temTitulo] of [
      [comLinguagem, true],
      [semLinguagem, false],
    ] as const) {
      expect(html).toContain('data-slot="code-block-header"');
      expect(html).toContain('data-slot="code-block-actions"');
      expect(html).toContain('data-slot="code-block-copy-button"');
      expect(html).toContain("border-border");
      if (temTitulo) {
        expect(html).toContain('data-slot="code-block-title"');
      } else {
        expect(html).not.toContain('data-slot="code-block-title"');
      }
    }
    expect(comLinguagem).toContain(">ts<");
    // Ações à direita, na mesma linha do cabeçalho (fluxo flex, sem absolute).
    expect(comLinguagem).toMatch(/data-slot="code-block-actions"[^>]*class="[^"]*ms-auto/);
  });

  it("container usa space-y-3 (respiro entre blocos)", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown markdown={"linha um\n\nlinha dois"} className="extra" />,
    );
    expect(html).toMatch(/class="[^"]*space-y-3[^"]*extra/);
  });
});

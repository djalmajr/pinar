// Copiado de zommehq/shared src/ui/components/ui/bubble.test.tsx no commit c15fd2d (os componentes de chat da Skia), adaptado ao bun test, aos ícones lucide e aos tokens do Pinar.
import { renderToStaticMarkup } from "react-dom/server";
// O tsconfig da raiz só carrega os tipos do Node; quem roda este arquivo é o bun test.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { describe, expect, it } from "bun:test";
import { Bubble, BubbleContent, BubbleReactions } from "./bubble.js";

// Raio do conteúdo da bolha: um kit com raio zero (`rounded-none`) deixaria
// as bolhas do chat de canto quadrado. O conteúdo padrão passa a
// `rounded-2xl` e o selo de reações a `rounded-full`; a variante `ghost`
// (sem fundo) continua sem raio.
function classOf(html: string, slot: string): string {
  const marker = `data-slot="${slot}"`;
  const index = html.indexOf(marker);
  expect(index, `slot ${slot} ausente no HTML`).toBeGreaterThan(0);
  const openTag = html.slice(index, html.indexOf(">", index));
  const match = openTag.match(/class="([^"]*)"/);
  return match?.[1] ?? "";
}

describe("raio da bolha", () => {
  it("BubbleContent padrão tem raio (rounded-2xl) e sem rounded-none", () => {
    const html = renderToStaticMarkup(
      <Bubble variant="muted">
        <BubbleContent>oi</BubbleContent>
      </Bubble>,
    );
    const contentClass = classOf(html, "bubble-content");
    expect(contentClass).toContain("rounded-2xl");
    expect(contentClass).not.toContain("rounded-none");
    // A bolha padrão não aplica override de raio ao conteúdo.
    expect(classOf(html, "bubble")).not.toContain(":rounded-none");
  });

  it("a variante ghost (sem fundo) mantém o conteúdo sem raio", () => {
    const html = renderToStaticMarkup(
      <Bubble variant="ghost">
        <BubbleContent>oi</BubbleContent>
      </Bubble>,
    );
    // O cva do ghost segue forçando `rounded-none` no conteúdo (sem fundo,
    // não tem raio): o override vive na classe da bolha como seletor de
    // descendente.
    expect(classOf(html, "bubble")).toContain("*:data-[slot=bubble-content]:rounded-none");
  });

  it("o selo de reações usa rounded-full", () => {
    const html = renderToStaticMarkup(<BubbleReactions>1</BubbleReactions>);
    const reactionsClass = classOf(html, "bubble-reactions");
    expect(reactionsClass).toContain("rounded-full");
    expect(reactionsClass).not.toContain("rounded-none");
  });
});

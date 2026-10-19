// O tsconfig da raiz só carrega os tipos do Node; quem roda este arquivo é o bun test.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.js";

function collapsible(open: boolean) {
  return (
    <Collapsible defaultOpen={open}>
      <CollapsibleTrigger>Passos</CollapsibleTrigger>
      <CollapsibleContent>Passo 1</CollapsibleContent>
    </Collapsible>
  );
}

describe("collapsible", () => {
  it("aberto: o trigger anuncia aria-expanded=true e o conteúdo aparece", () => {
    const html = renderToStaticMarkup(collapsible(true));
    expect(html).toContain('data-slot="collapsible"');
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*data-slot="collapsible-trigger"|<button[^>]*data-slot="collapsible-trigger"[^>]*aria-expanded="true"/);
    expect(html).toContain('data-slot="collapsible-content"');
    expect(html).toContain("Passo 1");
  });

  it("fechado: aria-expanded=false e o conteúdo não aparece", () => {
    const html = renderToStaticMarkup(collapsible(false));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Passo 1");
  });

  it("o mesmo markup em claro e escuro (sem estilo próprio)", () => {
    const light = renderToStaticMarkup(collapsible(true));
    expect(renderToStaticMarkup(<div className="dark">{collapsible(true)}</div>)).toBe(`<div class="dark">${light}</div>`);
  });
});

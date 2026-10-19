// O tsconfig da raiz só carrega os tipos do Node; quem roda este arquivo é o bun test.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Textarea } from "./textarea.js";

function textareaTag(html: string): string {
  return /<textarea[^>]*>/.exec(html)?.[0] ?? "";
}

describe("textarea", () => {
  it("renderiza o slot com os tokens do Pinar (raio, anel de foco e escuro)", () => {
    const tag = textareaTag(renderToStaticMarkup(<Textarea placeholder="Pergunte" />));
    expect(tag).toContain('data-slot="textarea"');
    expect(tag).toContain('placeholder="Pergunte"');
    expect(tag).toContain("rounded-lg");
    expect(tag).toContain("border-input");
    expect(tag).toContain("focus-visible:ring-3");
    expect(tag).toContain("dark:bg-input/30");
  });

  it("disabled é o atributo real, não só a classe", () => {
    const tag = textareaTag(renderToStaticMarkup(<Textarea disabled />));
    expect(tag).toMatch(/ disabled=""/);
  });

  it("a className do consumidor vence a padrão no conflito (twMerge)", () => {
    const tag = textareaTag(renderToStaticMarkup(<Textarea className="min-h-24" />));
    expect(tag).toContain("min-h-24");
    expect(tag).not.toContain("min-h-16");
  });

  it("o mesmo markup em claro e escuro (o escuro vem das variantes dark:)", () => {
    const light = renderToStaticMarkup(<Textarea />);
    expect(renderToStaticMarkup(<div className="dark"><Textarea /></div>)).toBe(`<div class="dark">${light}</div>`);
  });
});

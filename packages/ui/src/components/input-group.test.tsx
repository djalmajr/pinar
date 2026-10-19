// O tsconfig da raiz só carrega os tipos do Node; quem roda este arquivo é o bun test.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group.js";

function tagOf(html: string, marker: string): string {
  const index = html.indexOf(marker);
  expect(index, `marcador ${marker} ausente no HTML`).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf("<", index), html.indexOf(">", index));
}

function composer() {
  return (
    <InputGroup>
      <InputGroupTextarea placeholder="Pergunte" />
      <InputGroupAddon align="block-end">
        <InputGroupText>0/500</InputGroupText>
        <InputGroupButton type="submit" aria-label="Enviar">
          ok
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

describe("input-group", () => {
  it("o grupo tem role=group e o textarea vira o controle do grupo", () => {
    const html = renderToStaticMarkup(composer());
    expect(tagOf(html, 'data-slot="input-group"')).toContain('role="group"');
    const textarea = tagOf(html, "<textarea");
    expect(textarea).toContain('data-slot="input-group-control"');
    expect(textarea).toContain("resize-none");
    expect(textarea).toContain('placeholder="Pergunte"');
  });

  it("o addon expõe o alinhamento e o botão mantém o type pedido", () => {
    const html = renderToStaticMarkup(composer());
    expect(tagOf(html, 'data-slot="input-group-addon"')).toContain('data-align="block-end"');
    const button = tagOf(html, "<button");
    expect(button).toContain('type="submit"');
    expect(button).toContain('aria-label="Enviar"');
    expect(button).toContain('data-size="xs"');
  });

  it("o botão é type=button por padrão (não envia formulário)", () => {
    const html = renderToStaticMarkup(<InputGroupButton>x</InputGroupButton>);
    expect(tagOf(html, "<button")).toContain('type="button"');
  });

  it("o input vira o controle do grupo, sem borda própria", () => {
    const html = renderToStaticMarkup(
      <InputGroup>
        <InputGroupInput placeholder="Buscar" />
      </InputGroup>,
    );
    const input = tagOf(html, "<input");
    expect(input).toContain('data-slot="input-group-control"');
    expect(input).toContain("border-0");
  });

  it("usa os tokens do Pinar e o mesmo markup em claro e escuro", () => {
    const light = renderToStaticMarkup(composer());
    const group = tagOf(light, 'data-slot="input-group"');
    expect(group).toContain("rounded-lg");
    expect(group).toContain("ring-3");
    expect(group).toContain("dark:bg-input/30");
    expect(renderToStaticMarkup(<div className="dark">{composer()}</div>)).toBe(`<div class="dark">${light}</div>`);
  });
});

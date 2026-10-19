// O tsconfig da raiz só carrega os tipos do Node; quem roda este arquivo é o bun test.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Os ícones `~icons/*` só resolvem sob o Vite (unplugin-icons): no bun test
// o módulo virtual vira um stub que repassa as props ao `svg`.
mock.module("~icons/lucide/loader-circle", () => ({
  default: (props: Record<string, unknown>) => <svg data-testid="icon-mock" {...props} />,
}));

const { Spinner } = await import("./spinner.js");

describe("spinner", () => {
  it("renderiza o ícone lucide girando, no tamanho padrão", () => {
    const html = renderToStaticMarkup(<Spinner />);
    expect(html).toContain('data-testid="icon-mock"');
    expect(html).toContain('class="size-4 animate-spin"');
  });

  it("funde a className do consumidor e repassa as demais props ao svg", () => {
    const html = renderToStaticMarkup(<Spinner aria-label="Carregando" className="size-6 text-muted-foreground" role="status" />);
    expect(html).toContain('class="animate-spin size-6 text-muted-foreground"');
    expect(html).toContain('aria-label="Carregando"');
    expect(html).toContain('role="status"');
  });

  it("o mesmo markup em claro e escuro (a cor vem de currentColor)", () => {
    const light = renderToStaticMarkup(<Spinner />);
    expect(renderToStaticMarkup(<div className="dark"><Spinner /></div>)).toBe(`<div class="dark">${light}</div>`);
  });
});

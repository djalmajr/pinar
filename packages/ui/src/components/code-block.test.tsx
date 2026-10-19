// Copiado de zommehq/shared src/ui/components/ui/code-block.test.tsx no commit c15fd2d (os componentes de chat da Skia), adaptado ao bun test, aos ícones lucide e aos tokens do Pinar.
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// O tsconfig da raiz só carrega os tipos do Node; quem roda este arquivo é o bun test.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";

// Os ícones `~icons/*` só resolvem sob o Vite (unplugin-icons): no bun test
// cada módulo virtual vira um stub antes de o componente carregar.
for (const icon of ["check", "copy"]) {
  mock.module(`~icons/lucide/${icon}`, () => ({
    default: ({ className }: { className?: string }) => <span className={className} data-testid="icon-mock" />,
  }));
}

// O módulo real do highlighter fica guardado para o mock do segundo
// `describe` (abaixo), que delega a ele as linguagens fora do cenário.
const actual = { ...(await import("../lib/highlighter.js")) };

const { useHighlightedCode } = await import("../hooks/use-highlighted-code.js");
const { highlightCode, loadHighlighter } = await import("../lib/highlighter.js");
const { ChatMarkdown } = await import("./chat-markdown.js");
const { CodeBlock, CodeBlockContent, CodeBlockCopyButton, copyCode } = await import("./code-block.js");

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

/** Troca o `navigator` global até o próximo `afterEach`. */
function stubNavigator(value: unknown) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value, writable: true });
}

/** SSR dos nós de destaque em um elemento raiz (`ReactElement` para o `renderToStaticMarkup`). */
function toMarkup(nodes: ReactNode): string {
  return renderToStaticMarkup(<span data-test-root="true">{nodes}</span>);
}

/** Percorre a árvore de nós React procurando `dangerouslySetInnerHTML`. */
function usesDangerouslySetInnerHTML(node: ReactNode): boolean {
  if (Array.isArray(node)) {
    return node.some(usesDangerouslySetInnerHTML);
  }
  if (typeof node !== "object" || node === null) {
    return false;
  }
  const element = node as ReactElement;
  if (typeof element.type !== "string" && typeof element.type !== "function") {
    return false;
  }
  if ((element.props as { dangerouslySetInnerHTML?: unknown })?.dangerouslySetInnerHTML != null) {
    return true;
  }
  return usesDangerouslySetInnerHTML((element.props as { children?: ReactNode }).children);
}

describe("code-block", () => {
  afterEach(() => {
    if (realNavigator) {
      Object.defineProperty(globalThis, "navigator", realNavigator);
    }
  });

  it("destaca uma linguagem conhecida (ts) como spans com variáveis do tema", async () => {
    const lines = await highlightCode("const x = 1", "ts");
    expect(lines).toBeTruthy();
    const html = toMarkup(lines);
    expect(html).toContain("const");
    expect(html).toContain("--shiki-light");
    expect(html).toContain("--shiki-dark");
    // O destaque devolve nós React, nunca HTML em string.
    expect(usesDangerouslySetInnerHTML(lines)).toBe(false);
  });

  it("linguagem desconhecida cai no texto puro", async () => {
    expect(await highlightCode("ola mundo", "not-a-language")).toBeNull();
    // Inherited names are not languages, and they leave the highlighter usable.
    for (const inherited of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(await loadHighlighter(inherited), inherited).toBeNull();
      expect(await highlightCode("x", inherited), inherited).toBeNull();
    }
    expect(await highlightCode("<b>ola</b>", "html")).not.toBeNull();
    expect(await loadHighlighter("tcl")).toBeNull();
  });

  it("alias de linguagem (js → javascript) também destaca", async () => {
    const lines = await highlightCode("let a = 1", "js");
    expect(lines).toBeTruthy();
    expect(toMarkup(lines)).toContain("let");
  });

  it("o botão copiar renderiza o rótulo por prop (default em português)", () => {
    const html = renderToStaticMarkup(<CodeBlockCopyButton value="x" />);
    expect(html).toContain('data-slot="code-block-copy-button"');
    expect(html).toContain('aria-label="Copiar código"');
    const custom = renderToStaticMarkup(
      <CodeBlockCopyButton value="x" copyLabel="Copiar" copiedLabel="Feito" />,
    );
    expect(custom).toContain('aria-label="Copiar"');
  });

  it("copyCode chama navigator.clipboard.writeText com o código exato", async () => {
    const writeText = mock().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } });
    await expect(copyCode("const x = 1")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("const x = 1");
  });

  it("copyCode devolve false quando o clipboard recusa (sem lançar)", async () => {
    const writeText = mock()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("denied"));
    stubNavigator({ clipboard: { writeText } });
    await expect(copyCode("a")).resolves.toBe(true);
    await expect(copyCode("b")).resolves.toBe(false);
  });

  it("injeção de img dentro do código não vira elemento (nem highlightada)", async () => {
    const payload = "<img src=x onerror=alert(1)>";
    const lines = await highlightCode(payload, "html");
    expect(lines).toBeTruthy();
    const html = toMarkup(lines);
    // O `<img` tokeniza em spans separados (`<` + `img` …), mas nunca vira
    // elemento: nem escapado contíguo, nem tag real.
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;");
    expect(html).toContain("onerror");
    expect(usesDangerouslySetInnerHTML(lines)).toBe(false);
  });

  it("injeção de img sem linguagem (texto puro) não vira elemento", () => {
    const payload = "<img src=x onerror=alert(1)>";
    const html = renderToStaticMarkup(
      <CodeBlock>
        <CodeBlockContent>{payload}</CodeBlockContent>
      </CodeBlock>,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  // Os dois casos do `pre` focável. Por padrão
  // o `pre` entra na sequência de Tab (`tabindex="0"`): usado sem
  // `ScrollArea` ele é a área rolável e o alvo de foco do bloco. Com
  // `focusable={false}` (a composição do `ChatMarkdown`, onde o
  // `ScrollArea` rola e o viewport é o alvo) o `pre` sai da sequência —
  // sem `tabindex` algum.
  it("pre focável por padrão; focusable={false} retira o tabindex", () => {
    const padrao = renderToStaticMarkup(
      <CodeBlockContent>
        <code>const a = 1</code>
      </CodeBlockContent>,
    );
    expect(/<pre[^>]*>/.exec(padrao)?.[0]).toContain('tabindex="0"');

    const semFoco = renderToStaticMarkup(
      <CodeBlockContent focusable={false}>
        <code>const a = 1</code>
      </CodeBlockContent>,
    );
    expect(/<pre[^>]*>/.exec(semFoco)?.[0]).not.toContain("tabindex");
  });
});

// Sem highlighter o bloco precisa mostrar TODAS as linhas do código
// (fechadas e a aberta), como texto puro, no mesmo layout. O ambiente de
// teste é o bun sem DOM (sem jsdom/happy-dom): o render
// estático é o estado "sem highlighter carregado" — os efeitos não rodam,
// então ele é o mesmo estado observável do carregamento pendente e do que
// falha. O disparo do `onError` com `highlight-load` vive no efeito de
// carregamento e fica para o consumidor.
describe("code block sem highlighter mostra todas as linhas", () => {
  // Sem highlighter (carregamento pendente, falha ou linguagem desconhecida)
  // o hook não pode perder as linhas fechadas — só a `openText` (o que vem
  // depois da última quebra) chegaria ao `pre`. O mock ancora os dois
  // cenários com carregamento simulado — a promessa de `ts` nunca resolve
  // (pendente) e a de `js` rejeita (falha) — e delega as demais linguagens ao
  // módulo real. Diferente do `vi.mock` da origem (no topo do arquivo), o
  // `mock.module` do bun também troca a referência interna do módulo: ativo
  // no arquivo todo, faria o `highlightCode` real dos testes de destaque
  // acima chamar o `loadHighlighter` simulado. Por isso ele vale só neste
  // `describe`, e o `afterAll` devolve o módulo real (o bun test divide o
  // registro de módulos entre os arquivos do mesmo processo).
  beforeAll(() => {
    mock.module("../lib/highlighter.js", () => ({
      ...actual,
      loadHighlighter: (language: string) => {
        if (language === "ts") {
          return new Promise<never>(() => {});
        }
        if (language === "js") {
          return Promise.reject(new Error("falha simulada do carregamento"));
        }
        return actual.loadHighlighter(language);
      },
    }));
  });
  afterAll(() => {
    mock.module("../lib/highlighter.js", () => actual);
  });

  /** As linhas do `pre` do `ChatMarkdown`, em ordem (conteúdo de cada `CodeBlockLine`). */
  function preLines(html: string): string[] {
    const pre = /<pre[^>]*data-slot="code-block-content"[^>]*>[\s\S]*?<\/pre>/.exec(html)?.[0] ?? "";
    return [...pre.matchAll(/data-slot="code-block-line-content"[^>]*>([\s\S]*?)<\/span>/g)].map(
      (match) => match[1] ?? "",
    );
  }

  /** Wrapper mínimo do hook para inspecionar o retorno direto (fora do markdown). */
  function HookLines({ code, language }: { code: string; language: string }) {
    const lines = useHighlightedCode(code, language);
    return (
      <div>
        {lines.map((line, index) => (
          <span data-hook-line="true" key={index}>
            {line}
          </span>
        ))}
      </div>
    );
  }

  function hookLines(html: string): string[] {
    return [...html.matchAll(/<span data-hook-line="true">([\s\S]*?)<\/span>/g)].map(
      (match) => match[1] ?? "",
    );
  }

  it("fence sem linguagem com várias linhas: todas as linhas ficam visíveis no pre, na ordem, com a vazia do meio", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown markdown={"```\nlinha um\n\nlinha três\n```"} />,
    );
    // Linha vazia no meio: o `CodeBlockLine` guarda um `\n` (a cópia da
    // seleção preserva a linha em branco).
    expect(preLines(html)).toEqual(["linha um", "\n", "linha três"]);
  });

  it("hook sem highlighter devolve exatamente as linhas de `code` separadas por quebra (fechadas e a aberta)", () => {
    const html = renderToStaticMarkup(<HookLines code={"um\n\ndois\ntrês"} language="" />);
    expect(hookLines(html)).toEqual(["um", "", "dois", "três"]);
  });

  it("linguagem conhecida com carregamento pendente (promessa que não resolve): as linhas ficam visíveis em texto puro", () => {
    const onError = mock();
    const html = renderToStaticMarkup(
      <ChatMarkdown markdown={"```ts\nconst a = 1\n\nconst b = 2\n```"} onError={onError} />,
    );
    expect(preLines(html)).toEqual(["const a = 1", "\n", "const b = 2"]);
    // Sem destaque enquanto o carregamento não termina.
    expect(html).not.toContain("--shiki-light");
    // Nenhuma falha síncrona no render: o aviso `highlight-load` é do efeito
    // de carregamento, não do render.
    expect(onError).not.toHaveBeenCalled();
  });

  it("carregamento que falha: as linhas continuam visíveis em texto puro (estado observável sem DOM)", () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown markdown={"```js\nlet a = 1\n\nlet b = 2\n```"} />,
    );
    expect(preLines(html)).toEqual(["let a = 1", "\n", "let b = 2"]);
    expect(html).not.toContain("--shiki-light");
  });

  it("streaming sem highlighter: o texto cresce e todas as linhas presentes continuam visíveis", () => {
    // Sem highlighter o retorno é função do texto corrente (não há estado de
    // linha para esse caminho): cada snapshot do streaming cobre o estado
    // correspondente — tudo o que já chegou fica visível.
    const snapshots = [
      "lembrete",
      "lembrete\n\ndata: 20/10",
      "lembrete\n\ndata: 20/10\n\nhorário: 14h",
      "lembrete\n\ndata: 20/10\n\nhorário: 14h\n\naté logo",
    ];
    for (const code of snapshots) {
      const html = renderToStaticMarkup(<HookLines code={code} language="" />);
      expect(hookLines(html)).toEqual(code.split("\n"));
    }
  });

  it("código vazio: sem linha nenhuma, como hoje", () => {
    const html = renderToStaticMarkup(<HookLines code="" language="" />);
    expect(hookLines(html)).toEqual([]);
  });
});

// Copiado de zommehq/shared src/ui/components/ds/chat-markdown.tsx no commit c15fd2d (os componentes de chat da Skia), adaptado aos ícones lucide e aos tokens do Pinar.
import { type HTMLAttributes, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useHighlightedCode } from "../hooks/use-highlighted-code.js";
import { cn } from "../lib/utils.js";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  type CodeBlockErrorEvent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "./code-block.js";
import { ScrollArea, ScrollBar } from "./scroll-area.js";

export interface ChatMarkdownProps {
  className?: string;
  /** Texto em Markdown (GFM). */
  markdown: string;
  /** Rótulo do botão de copiar dos blocos de código (i18n do app). */
  copyLabel?: string;
  /** Rótulo do botão de copiar depois da cópia. */
  copiedLabel?: string;
  /** Rótulo do botão de copiar quando a cópia falha. */
  copyFailedLabel?: string;
  /**
   * Falhas dos blocos de código (cópia e carregamento do highlighter).
   * O evento tem só identificação opaca (operação + linguagem do fence);
   * nunca o texto do código nem o conteúdo da mensagem.
   */
  onError?: (event: CodeBlockErrorEvent) => void;
}

/**
 * Markdown compacto para chat (estilo enxuto).
 *
 * Segurança: sem `dangerouslySetInnerHTML` e sem `rehype-raw` — o HTML que
 * vier no texto é descartado (default `skipHtml` do `react-markdown`), nunca
 * interpretado como elemento. Links só para `http:`, `https:` e `mailto:`
 * (com `target="_blank" rel="noopener noreferrer"`); demais protocolos ficam
 * como texto puro. Blocos de código (fences) usam o `CodeBlock` do kit:
 * destaque de sintaxe pelo shiki (motor JavaScript, sem WASM), carregado sob
 * demanda por `import()`; o highlighter devolve nós React (tokens viram
 * `<span>` com variáveis CSS `--shiki-light`/`--shiki-dark`), nunca HTML em
 * string. Linguagem desconhecida — e o tempo em que o shiki carrega — renderiza
 * o texto puro no mesmo layout. Tabelas e blocos de código rolam no
 * `ScrollArea` do kit com barra horizontal (sem barra nativa); nenhuma coluna
 * é cortada.
 */

const ALLOWED_LINK_PROTOCOL = /^(?:https?:|mailto:)/i;

/** Nó hast mínimo que o `react-markdown` passa como `node`. */
interface HastNode {
  properties?: { className?: string | string[] };
  children?: HastNode[];
  value?: unknown;
}

/** Extrai o texto e a linguagem (fence `` ```lang ``) do bloco `pre`. */
function fenceFromPre(node: HastNode | undefined): {
  code: string;
  language: string | undefined;
} {
  const codeEl = node?.children?.[0];
  const code = (codeEl?.children ?? [])
    .map((child) => (typeof child?.value === "string" ? child.value : ""))
    .join("")
    // O CommonMark preserva o `\n` final do fence; sem ele a linha fantasma
    // aparece no fim do bloco e o copiado diverge do exibido.
    .replace(/\n$/, "");
  const rawClass = codeEl?.properties?.className;
  const classes = Array.isArray(rawClass)
    ? rawClass
    : typeof rawClass === "string"
      ? rawClass.split(/\s+/)
      : [];
  const language = classes
    .map((name) => /^language-(.+)$/.exec(name)?.[1])
    .find((name) => name !== undefined);
  return { code, language };
}

/**
 * Fence do Markdown no `CodeBlock` do kit. O destaque chega assim que o
 * shiki carrega (linguagem sob demanda); durante o streaming as linhas
 * fechadas destacam imediatamente e a linha aberta é re-destacada com
 * debounce (texto puro enquanto o debounce espera).
 *
 * O cabeçalho existe SEMPRE — com a linguagem (quando houver) à esquerda
 * e as ações à direita, em fluxo flex: o botão copiar nunca fica
 * posicionado sobre o código e é sempre visível em toque.
 */
function MarkdownCodeBlock({
  code,
  copyFailedLabel,
  copyLabel,
  copiedLabel,
  language,
  onError,
}: {
  code: string;
  language: string | undefined;
  copyLabel?: string;
  copiedLabel?: string;
  copyFailedLabel?: string;
  onError?: (event: CodeBlockErrorEvent) => void;
}) {
  const lines = useHighlightedCode(code, language ?? "", onError);
  return (
    <CodeBlock className="rounded-md border border-border bg-muted dark:bg-muted">
      <CodeBlockHeader>
        {language !== undefined ? <CodeBlockTitle>{language}</CodeBlockTitle> : null}
        <CodeBlockActions>
          <CodeBlockCopyButton
            copyFailedLabel={copyFailedLabel}
            copyLabel={copyLabel}
            copiedLabel={copiedLabel}
            language={language}
            onError={onError}
            value={code}
          />
        </CodeBlockActions>
      </CodeBlockHeader>
      <ScrollArea className="max-w-full">
        {/* O `pre` está no `ScrollArea` (que é o que rola): com
            `focusable={false}` ele sai da sequência de Tab e o viewport do
            kit — com o anel de foco do próprio kit — é o único alvo para a
            área do código. Usado sem `ScrollArea`, o `CodeBlock` mantém o
            `pre` focável, porque ali o `pre` é a área rolável. */}
        <CodeBlockContent className="overflow-visible" focusable={false}>
          {lines.map((line, index) => (
            <CodeBlockLine key={index}>{line}</CodeBlockLine>
          ))}
        </CodeBlockContent>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </CodeBlock>
  );
}

function buildComponents(
  copyFailedLabel: string | undefined,
  copyLabel: string | undefined,
  copiedLabel: string | undefined,
  onError: ((event: CodeBlockErrorEvent) => void) | undefined,
): Components {
  return {
    // Imagem nunca carrega: uma URL externa vazaria IP e dados do chat sem
    // clique. Mostra só o texto alternativo.
    img: ({ alt }) => (alt ? <span>{alt}</span> : null),
    a: ({ children, href, ...props }) => {
      if (typeof href !== "string" || !ALLOWED_LINK_PROTOCOL.test(href)) {
        // Outros protocolos (javascript:, caminhos relativos, …) não viram
        // link: o rótulo fica como texto.
        return <>{children}</>;
      }
      return (
        <a
          {...props}
          className="text-primary underline underline-offset-2"
          href={href}
          rel="noopener noreferrer"
          target="_blank"
        >
          {children}
        </a>
      );
    },
    blockquote: ({ children }) => (
      <blockquote className="border-border pl-3 text-muted-foreground">
        <div className="border-l-2">{children}</div>
      </blockquote>
    ),
    // Só o código INLINE: o fence sai pelo `pre` abaixo (CodeBlock).
    code: ({ children }) => (
      <code className="rounded-md bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
    h1: ({ children }) => <h1 className="text-base font-semibold">{children}</h1>,
    h2: ({ children }) => <h2 className="text-sm font-semibold">{children}</h2>,
    h3: ({ children }) => <h3 className="text-sm font-medium">{children}</h3>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    ol: ({ children }) => <ol className="space-y-1 pl-5 list-decimal">{children}</ol>,
    pre: ({ node }) => {
      const { code, language } = fenceFromPre(node as HastNode);
      return (
        <MarkdownCodeBlock
          code={code}
          copyFailedLabel={copyFailedLabel}
          copyLabel={copyLabel}
          copiedLabel={copiedLabel}
          language={language}
          onError={onError}
        />
      );
    },
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    table: ({ children }) => (
      // Tabela inteira acessível por rolagem dentro do bloco: `w-max` deixa a
      // largura natural, `min-w-full` segura tabelas estreitas; as células
      // usam `whitespace-nowrap` (abaixo) para nenhuma coluna ser cortada.
      <ScrollArea className="max-w-full">
        <table className="w-max min-w-full border-collapse text-sm">{children}</table>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    ),
    td: ({ children }) => (
      <td className="border-border px-2 py-1 align-top whitespace-nowrap">{children}</td>
    ),
    th: ({ children }) => (
      <th className="border-border bg-muted/50 px-2 py-1 text-left font-semibold whitespace-nowrap">
        {children}
      </th>
    ),
    ul: ({ children }) => <ul className="space-y-1 pl-5 list-disc">{children}</ul>,
  };
}

export function ChatMarkdown({
  className,
  copyFailedLabel,
  copyLabel,
  copiedLabel,
  markdown,
  onError,
  ...props
}: // `Omit` do `onError` nativo (DOM media handler): a prop do componente tem
// o mesmo nome, mas carrega a falha do bloco de código (operação +
// linguagem), não um handler de evento DOM.
ChatMarkdownProps & Omit<HTMLAttributes<HTMLDivElement>, "onError">) {
  const components = useMemo(
    () => buildComponents(copyFailedLabel, copyLabel, copiedLabel, onError),
    [copyFailedLabel, copyLabel, copiedLabel, onError],
  );
  return (
    // `space-y-3` dá o respiro entre blocos (só empurra irmãos: a primeira e
    // a última margem não somam ao padding externo, ex.: a bolha do chat).
    <div className={cn("space-y-3", className)} {...props}>
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

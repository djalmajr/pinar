// Copiado de zommehq/shared src/ui/components/ui/code-block.tsx no commit c15fd2d (os componentes de chat da Skia), adaptado aos ícones lucide e aos tokens do Pinar.
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import CheckIcon from "~icons/lucide/check";
import CopyIcon from "~icons/lucide/copy";
import { cn } from "../lib/utils.js";
import { TooltipButton } from "./tooltip-button.js";

/**
 * Falha de um bloco de código, identificada de forma opaca para o
 * consumidor (telemetria): só a operação e a linguagem do fence — nunca o
 * texto do código nem o conteúdo da mensagem.
 */
export type CodeBlockErrorEvent = {
  /** Operação que falhou. */
  operation: "copy" | "highlight-load";
  /** Linguagem do fence, quando houver. */
  language?: string;
};

/**
 * Cópia para a área de transferência. O rótulo (i18n) e a reação ao
 * fracasso (telemetria) ficam a cargo do consumidor. Falha de
 * cópia devolve `false` (o botão só anuncia "copiado" em sucesso).
 */
export async function copyCode(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

// O anel de foco fica no elemento focável, não no bloco: um seletor
// `has-[>…]` no bloco nunca alcançaria o alvo aninhado e o foco seria
// invisível. O alvo é o `pre` do `CodeBlockContent`
// quando o bloco é a própria área rolável (uso standalone) e o viewport
// do `ScrollArea` quando a composição do `ChatMarkdown` entrega o `pre`
// com `focusable={false}` — ali o viewport rola e é o único alvo de Tab
// (sem duas paradas de Tab para a mesma área).
const codeBlockVariants = cva(
  "group/code-block relative flex w-full min-w-0 flex-col overflow-hidden rounded-lg text-sm data-[size=sm]:text-xs",
  {
    variants: {
      variant: {
        default: "border border-input text-foreground dark:bg-input/30",
        destructive: "border border-destructive/30 text-destructive dark:border-destructive/40",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function CodeBlock({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof codeBlockVariants> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="code-block"
      data-variant={variant}
      data-size={size}
      className={cn(codeBlockVariants({ variant }), className)}
      {...props}
    />
  );
}

function CodeBlockHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-header"
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-2 px-3 pt-3 text-muted-foreground group-data-[size=sm]/code-block:px-2 group-data-[size=sm]/code-block:pt-2 group-data-[variant=destructive]/code-block:text-destructive *:has-[>[data-slot=code-block-title]]:min-w-0",
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-title"
      className={cn(
        "min-w-0 truncate font-sans text-xs font-medium text-foreground group-data-[variant=destructive]/code-block:text-destructive [&_svg]:pointer-events-none [&_svg]:inline-block [&_svg]:align-middle [&_svg:not([class*='size-'])]:size-3.5 *:[svg]:me-1.5",
        className,
      )}
      {...props}
    />
  );
}

// As ações ficam SEMPRE na linha de cabeçalho, em fluxo flex à direita —
// nunca posicionadas sobre o código (que cobria a primeira linha em fence
// sem linguagem) e sempre visíveis em toque, sem depender de hover.
function CodeBlockActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-actions"
      className={cn(
        "ms-auto flex shrink-0 items-center gap-1 group-data-[size=sm]/code-block:gap-0.5",
        className,
      )}
      {...props}
    />
  );
}

type CopyState = "idle" | "copied" | "failed";

function CodeBlockCopyButton({
  value,
  copyLabel = "Copiar código",
  copiedLabel = "Copiado",
  copyFailedLabel = "Não foi possível copiar",
  language,
  onError,
  variant = "ghost",
  size = "icon-xs",
  className,
  onClick,
  ...props
}: // `Omit` do `onError` nativo (Base UI/DOM): a prop do componente tem o
// mesmo nome, mas carrega a falha da cópia (identificação opaca), não um
// handler de evento DOM.
Omit<React.ComponentProps<typeof TooltipButton>, "onError" | "tooltip"> & {
  value: string;
  /** Rótulo acessível/tooltip no estado inicial (i18n do consumidor). */
  copyLabel?: string;
  /** Rótulo acessível/tooltip após a cópia. */
  copiedLabel?: string;
  /** Rótulo acessível/tooltip quando a cópia falha (i18n do consumidor). */
  copyFailedLabel?: string;
  /** Linguagem do fence, para o evento de erro (identificação opaca). */
  language?: string;
  /** Chamado quando a cópia falha (sem o texto do código). */
  onError?: (event: CodeBlockErrorEvent) => void;
}) {
  const [state, setState] = React.useState<CopyState>("idle");
  const label = state === "copied" ? copiedLabel : state === "failed" ? copyFailedLabel : copyLabel;

  React.useEffect(() => {
    if (state === "idle") {
      return;
    }

    const timeout = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timeout);
  }, [state]);

  return (
    <>
      <TooltipButton
        data-slot="code-block-copy-button"
        data-copied={state === "copied" || undefined}
        data-copy-failed={state === "failed" || undefined}
        variant={variant}
        size={size}
        aria-label={label}
        // Botão só de ícone: o `Tooltip` do `@pinar/ui` sobre o MESMO botão
        // (`TooltipButton`); o `aria-label` não o substitui.
        tooltip={label}
        className={cn(className)}
        onClick={(event) => {
          onClick?.(event);
          // Falha de cópia não some: avisa o app
          // (`onError`, só a operação/linguagem, nunca o texto) e mostra o
          // rótulo de erro, anunciado na região `aria-live`.
          void copyCode(value).then((ok) => {
            if (ok) {
              setState("copied");
            } else {
              onError?.({ language, operation: "copy" });
              setState("failed");
            }
          });
        }}
        {...props}
      >
        {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      </TooltipButton>
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? copiedLabel : state === "failed" ? copyFailedLabel : ""}
      </span>
    </>
  );
}

function CodeBlockContent({
  className,
  children,
  style,
  wrap = false,
  lineNumbers = false,
  startLine = 1,
  focusable = true,
  ...props
}: React.ComponentProps<"pre"> & {
  wrap?: boolean;
  lineNumbers?: boolean;
  startLine?: number;
  /**
   * O `pre` entra na sequência de Tab (`tabIndex=0`) por padrão: usado sem
   * `ScrollArea` ele é a área rolável e o alvo de foco do bloco. Com
   * `false`, o `pre` sai da sequência de Tab (sem `tabIndex`): é o caso da
   * composição do `ChatMarkdown`, onde o `pre` vive dentro de um
   * `ScrollArea` e o viewport é o único alvo (ele é o que rola e tem o
   * anel de foco do kit).
   */
  focusable?: boolean;
}) {
  return (
    <pre
      data-slot="code-block-content"
      data-wrap={wrap || undefined}
      data-numbered={lineNumbers || undefined}
      dir="ltr"
      tabIndex={focusable ? 0 : undefined}
      style={{ counterReset: `line ${startLine - 1}`, ...style }}
      // O `pre` é o alvo de foco quando é a área rolável (uso standalone,
      // `focusable` por padrão): anel do kit `ring` direto no elemento
      // focável. Com `focusable={false}` o `tabIndex` sai e o viewport do
      // `ScrollArea` é o único alvo de Tab.
      className={cn(
        "min-h-0 min-w-0 scroll-fade-x scrollbar-thin overflow-auto px-3 py-3 text-start font-mono leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/50 group-has-data-[slot=code-block-footer]/code-block:pb-2 group-has-data-[slot=code-block-header]/code-block:pt-2 group-data-[size=sm]/code-block:px-2 group-data-[size=sm]/code-block:py-2 group-data-[size=sm]/code-block:group-has-data-[slot=code-block-header]/code-block:pt-1.5 data-wrap:scroll-fade-y data-wrap:wrap-break-word data-wrap:whitespace-pre-wrap",
        className,
      )}
      {...props}
    >
      <code
        data-slot="code-block-code"
        className="grid min-h-lh min-w-max content-start in-data-numbered:grid-cols-[auto_1fr] in-data-wrap:min-w-0"
      >
        {lineNumbers && typeof children === "string"
          ? children
              .replace(/\n$/, "")
              .split("\n")
              .map((line, index) => <CodeBlockLine key={index}>{line}</CodeBlockLine>)
          : children}
      </code>
    </pre>
  );
}

const codeBlockLineVariants = cva(
  "relative -mx-3 block min-h-lh px-3 group-data-[size=sm]/code-block:-mx-2 group-data-[size=sm]/code-block:px-2 before:min-w-6 before:text-end before:text-muted-foreground after:absolute after:start-1 after:top-0 after:text-muted-foreground after:select-none in-data-numbered:col-span-2 in-data-numbered:grid in-data-numbered:grid-cols-subgrid in-data-numbered:gap-x-3 in-data-numbered:[counter-increment:line] in-data-numbered:before:content-[counter(line)] in-data-numbered:before:select-none in-data-numbered:supports-[content:counter(line)_/_'']:before:content-[counter(line)_/_'']",
  {
    variants: {
      variant: {
        default: "",
        added: "bg-muted after:content-['+']",
        removed: "bg-destructive/10 after:text-destructive after:content-['−']",
        highlighted: "bg-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function CodeBlockLine({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof codeBlockLineVariants>) {
  // An empty line holds a newline so copying a selection keeps blank lines.
  const empty =
    children === undefined ||
    children === null ||
    children === "" ||
    (Array.isArray(children) && children.length === 0);

  return (
    <span
      data-slot="code-block-line"
      data-variant={variant}
      className={cn(codeBlockLineVariants({ variant }), className)}
      {...props}
    >
      <span data-slot="code-block-line-content" className="min-w-0">
        {empty ? "\n" : children}
      </span>
    </span>
  );
}

function CodeBlockFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-footer"
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-2 px-3 pb-3 text-muted-foreground group-data-[size=sm]/code-block:px-2 group-data-[size=sm]/code-block:pb-2",
        className,
      )}
      {...props}
    />
  );
}

export {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFooter,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
};

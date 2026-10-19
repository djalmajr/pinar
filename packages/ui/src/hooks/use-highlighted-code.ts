// Copiado de zommehq/shared src/ui/hooks/use-highlighted-code.ts no commit c15fd2d (os componentes de chat da Skia), adaptado aos ícones lucide e aos tokens do Pinar.
import * as React from "react";

import type { CodeBlockErrorEvent } from "../components/code-block.js";

type HighlighterModule = typeof import("../lib/highlighter.js");
type Highlighter = NonNullable<Awaited<ReturnType<HighlighterModule["loadHighlighter"]>>>;

/**
 * O módulo inteiro do highlighter (shiki + motor) fica fora do chunk de
 * quem usa o hook: carrega uma única vez, por `import()` dinâmico, na primeira vez
 * que há um bloco de código, com cache no escopo do módulo. Até carregar —
 * e se o carregamento falhar — o hook mantém o texto puro no mesmo layout.
 */
let highlighterModule: Promise<HighlighterModule> | null = null;

function loadHighlighterModule(): Promise<HighlighterModule> {
  highlighterModule ??= import("../lib/highlighter.js");
  return highlighterModule;
}

/**
 * A linha aberta só é re-destacada este tempo após a última mudança:
 * destacar a cada chunk retokenizaria todos os prefixos da linha (trabalho
 * quadrático numa linha longa). Durante a espera ela aparece como texto
 * puro; as linhas que fecham (`\n`) destacam imediatamente.
 */
const OPEN_LINE_HIGHLIGHT_DELAY_MS = 150;

export function useHighlightedCode(
  value: string,
  language: string,
  onError?: (event: CodeBlockErrorEvent) => void,
) {
  // A trailing newline would render as an extra empty line.
  const code = value.endsWith("\n") ? value.slice(0, -1) : value;

  const [loaded, setLoaded] = React.useState<{
    highlighter: Highlighter;
    language: string;
  } | null>(null);
  const highlighter = loaded?.language === language ? loaded.highlighter : null;

  const onErrorRef = React.useRef(onError);
  React.useEffect(() => {
    onErrorRef.current = onError;
  });

  React.useEffect(() => {
    let cancelled = false;

    loadHighlighterModule()
      .then((module) => module.loadHighlighter(language))
      .then((next) => {
        if (!cancelled && next != null) {
          setLoaded({ highlighter: next, language });
        }
      })
      .catch(() => {
        // Falha do `import()` ou do carregamento da
        // linguagem não quebra o bloco — o texto puro é o fallback — mas é
        // avisada ao app com identificação opaca (operação + linguagem do
        // fence); nunca vai o texto do código.
        if (!cancelled) {
          onErrorRef.current?.({
            language: language === "" ? undefined : language,
            operation: "highlight-load",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [language]);

  // The complete lines, highlighted. While the code streams, only the lines
  // that close are tokenized, starting from the grammar state of the last
  // one (the closed lines are never re-tokenized).
  const [done, setDone] = React.useState<{
    highlighter: Highlighter | null;
    lines: React.ReactNode[];
    state?: Parameters<NonNullable<Highlighter>["highlight"]>[1];
    text: string;
  }>({ highlighter: null, lines: [], state: undefined, text: "" });

  let next = done;

  if (next.highlighter !== highlighter || !code.startsWith(next.text)) {
    next = { highlighter, lines: [], state: undefined, text: "" };
  }

  const end = code.lastIndexOf("\n") + 1;

  if (highlighter && end > next.text.length) {
    const result = highlighter.highlight(code.slice(next.text.length, end - 1), next.state);

    next = {
      highlighter,
      lines: [...next.lines, ...result.lines],
      state: result.state,
      text: code.slice(0, end),
    };
  }

  if (next !== done) {
    setDone(next);
  }

  // The last line is still being written. It is NOT tokenized on every
  // change (that re-tokenizes every prefix of the line — quadratic work);
  // the highlight is debounced and, while the timer is pending, the line
  // shows as plain text.
  const openText = code.slice(end);
  const [open, setOpen] = React.useState<{
    node: React.ReactNode;
    text: string;
  } | null>(null);

  React.useEffect(() => {
    if (!highlighter || openText === "") {
      setOpen(null);
      return;
    }

    // Cada mudança cancela o destaque pendente (debounce de
    // `OPEN_LINE_HIGHLIGHT_DELAY_MS` a partir da última mudança).
    const timer = setTimeout(() => {
      setOpen({
        node: highlighter.highlight(openText, done.state).lines[0] ?? "",
        text: openText,
      });
    }, OPEN_LINE_HIGHLIGHT_DELAY_MS);

    return () => {
      clearTimeout(timer);
      setOpen(null);
    };
  }, [done, highlighter, openText]);

  return React.useMemo(() => {
    // Sem highlighter (carregamento pendente, falha ou linguagem
    // desconhecida): todas as linhas do código — as fechadas e a aberta —
    // como texto puro, no mesmo layout. As linhas fechadas só entram em
    // `next.lines` com o highlighter; sem este ramo, o retorno seria só a
    // `openText` (depois da última quebra) e o resto do bloco se perderia.
    if (highlighter == null) {
      return code.length > 0 ? code.split("\n") : [];
    }

    const lines: React.ReactNode[] = [...next.lines];

    if (openText.length > 0) {
      // O nó destacado só vale para o texto no qual foi calculado; qualquer
      // texto mais novo fica como texto puro até o debounce destacá-lo.
      lines.push(open !== null && open.text === openText ? open.node : openText);
    }

    return lines;
  }, [code, highlighter, next, open, openText]);
}

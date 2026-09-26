import {
  captureFromSession,
  formatClipboardText,
  formatAgentResultsMarkdown,
  formatBatchHandoff,
  formatHandoffBundle,
  formatPinReviewsMarkdown,
  isPinAwaitingAgent,
  pinReviewStatusFor,
  screenshotDeliveryEnabled,
  type AgentExecution,
  type HandoffMode,
  type PinReview,
  type PinReviewStatus,
  type ProjectTreeCollection,
  type ProjectTreeProject,
  type Session,
  type SupportedLanguage,
} from "@pinar/shared";

export interface MarkdownDelivery {
  handoffMode?: HandoffMode;
  includeScreenshot?: boolean;
  includeViewerContent?: boolean;
  language?: SupportedLanguage | null;
  shareToken?: string;
  viewerContent?: ViewerContent;
}

export interface ViewerContent {
  executions: Record<string, AgentExecution[]>;
  reviews: Record<string, PinReview[]>;
}

const viewerReferenceCopy: Record<SupportedLanguage, { description: string; heading: string }> = {
  de: {
    description: "Die gefilterten kanonischen Blöcke oben sind für umsetzbare Aufgaben maßgeblich. Das vollständige Viewer-Markdown unten enthält auch erledigte Pins, Reviews und Agentenergebnisse und dient nur als Referenz.",
    heading: "## Nur als Referenz: vollständiges Viewer-Markdown",
  },
  en: {
    description: "The filtered canonical blocks above are authoritative for actionable work. The full viewer Markdown below includes completed pins, reviews, and agent results for reference only; do not rework completed pins.",
    heading: "## Reference only: full viewer Markdown",
  },
  es: {
    description: "Los bloques canónicos filtrados de arriba son la fuente autorizada para el trabajo accionable. El Markdown completo del visor incluye también pins completados, revisiones y resultados del agente, y es solo de referencia; no repitas pins completados.",
    heading: "## Solo como referencia: Markdown completo del visor",
  },
  fr: {
    description: "Les blocs canoniques filtrés ci-dessus font autorité pour le travail à effectuer. Le Markdown complet du viewer inclut aussi les pins terminés, les revues et les résultats de l’agent, à titre de référence uniquement ; ne reprenez pas les pins terminés.",
    heading: "## Référence uniquement : Markdown complet du viewer",
  },
  ja: {
    description: "上の絞り込まれた正規ブロックが実行対象の正しい情報です。以下の完全なビューアーMarkdownには完了したピン、レビュー、エージェント結果も含まれ、参照専用です。完了したピンを再対応しないでください。",
    heading: "## 参照専用: 完全なビューアーMarkdown",
  },
  pt: {
    description: "Os blocos canônicos filtrados acima são a fonte de verdade para o trabalho acionável. O Markdown completo do viewer abaixo inclui pins concluídos, revisões e resultados do agente e serve apenas como referência; não refaça pins concluídos.",
    heading: "## Somente referência: Markdown completo do viewer",
  },
  zh: {
    description: "上方经过筛选的规范代码块是可执行工作的权威来源。下面的完整查看器 Markdown 还包含已完成的图钉、评审和代理结果，仅供参考；不要重复处理已完成的图钉。",
    heading: "## 仅供参考：完整查看器 Markdown",
  },
};

function deliverScreenshot(session: Session, delivery?: MarkdownDelivery) {
  return screenshotDeliveryEnabled(delivery?.includeScreenshot, session);
}

function withShareToken(url: string, shareToken?: string) {
  if (!shareToken) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(shareToken)}`;
}

export function formatSessionMarkdown(
  session: Session,
  viewerUrl: string,
  executions: AgentExecution[] = [],
  reviews: PinReview[] = [],
  delivery?: MarkdownDelivery,
) {
  const parts = [formatHandoffBundle(
    captureFromSession(
      delivery?.shareToken && session.shotUrl
        ? { ...session, shotUrl: withShareToken(session.shotUrl, delivery.shareToken) }
        : session,
      { deliverScreenshot: deliverScreenshot(session, delivery) },
    ),
    viewerUrl,
  ).plain.trim()];
  const results = formatAgentResultsMarkdown(executions);
  const reviewMarkdown = formatPinReviewsMarkdown(reviews);
  if (results) parts.push(results);
  if (reviewMarkdown) parts.push(reviewMarkdown);
  return parts.join("\n\n");
}

function actionablePins(session: Session, reviews: PinReview[]) {
  const statusByPinId = Object.fromEntries(reviews.map((review) => [review.pinId, review.status]));
  return session.pins.filter((pin) => isPinAwaitingAgent(
    pinReviewStatusFor(String(pin.pinId || pin.id || ""), statusByPinId),
  ));
}

export function viewerReferenceMarkdown(markdown: string) {
  return markdown.replace(/```pinar-visual-context[^\r\n]*\r?\n([\s\S]*?)\r?\n```/g, (_match, payload: string) => {
    try {
      return [
        "```pinar-viewer-reference",
        JSON.stringify({ context: JSON.parse(payload), referenceOnly: true, source: "pinar-viewer" }),
        "```",
      ].join("\n");
    } catch {
      return ["```pinar-viewer-reference", payload, "```"].join("\n");
    }
  });
}

function referenceSessionMarkdown(
  session: Session,
  origin: string,
  executions: AgentExecution[],
  reviews: PinReview[],
  delivery?: MarkdownDelivery,
) {
  const pins = session.pins;
  if (!pins.length) return "";
  const statusByPinId = Object.fromEntries(reviews.map((review) => [review.pinId, review.status]));
  const statuses = [`### ${session.page.title || session.page.url || session.id}`, ""];
  for (const [index, pin] of pins.entries()) {
    const pinId = String(pin.pinId || pin.id || "");
    statuses.push(`${pin.number || index + 1}. ${pin.comment} — status: ${pinReviewStatusFor(pinId, statusByPinId)}`);
  }
  const fullViewerMarkdown = viewerReferenceMarkdown(formatSessionMarkdown(
    session,
    withShareToken(`${origin}/v/${session.id}`, delivery?.shareToken),
    executions,
    reviews,
    delivery,
  ));
  return [...statuses, "", fullViewerMarkdown].join("\n").trim();
}

function appendViewerReference(primary: string, references: string[], language?: SupportedLanguage | null) {
  if (!references.length) return primary;
  const copy = viewerReferenceCopy[language ?? "en"] || viewerReferenceCopy.en;
  return [primary.trim(), "", copy.heading, "", copy.description, "", references.join("\n\n")].join("\n").trim();
}

export function formatSessionHandoffMarkdown(
  session: Session,
  viewerUrl: string,
  executions: AgentExecution[] = [],
  reviews: PinReview[] = [],
  delivery?: MarkdownDelivery,
) {
  const primarySession = delivery?.includeViewerContent
    ? { ...session, pins: actionablePins(session, reviews) }
    : session;
  const primary = formatClipboardText(
    primarySession.page,
    primarySession.pins,
    primarySession.shotUrl,
    viewerUrl,
    primarySession.captureId || primarySession.id,
    deliverScreenshot(session, delivery),
    delivery?.handoffMode ?? "compact",
    delivery?.language ?? "en",
  );
  if (!delivery?.includeViewerContent) return primary;
  const origin = new URL(viewerUrl).origin;
  const reference = referenceSessionMarkdown(session, origin, executions, reviews, delivery);
  return appendViewerReference(primary, reference ? [reference] : [], delivery.language);
}

function appendSession(lines: string[], session: Session, origin: string, delivery?: MarkdownDelivery) {
  const title = session.page.title || "(untitled)";
  const viewerUrl = withShareToken(`${origin}/v/${session.id}`, delivery?.shareToken);
  const markdownUrl = withShareToken(`${origin}/v/${session.id}.md`, delivery?.shareToken);
  lines.push(`### [${title}](${viewerUrl})`);
  lines.push("");
  lines.push(`Page: ${session.page.url || "(unknown)"}`);
  lines.push(`Markdown: ${markdownUrl}`);
  if (session.shotUrl && deliverScreenshot(session, delivery)) {
    lines.push(`Screenshot: ${withShareToken(session.shotUrl, delivery?.shareToken)}`);
  }
  lines.push("");
  for (const [index, pin] of session.pins.entries()) {
    lines.push(`${pin.number || index + 1}. ${pin.comment}`);
    if (pin.pinId || pin.id) lines.push(`   - pinId: ${pin.pinId || pin.id}`);
    if (pin.domPath) lines.push(`   - DOM: ${pin.domPath}`);
    if (pin.selector) lines.push(`   - Selector: ${pin.selector}`);
    if (pin.innerText) lines.push(`   - Text: "${pin.innerText.replace(/\n+/g, " ").trim()}"`);
  }
  lines.push("");
}

export function formatCollectionMarkdown(
  collection: ProjectTreeCollection,
  origin: string,
  delivery?: MarkdownDelivery,
) {
  const lines = [
    `# ${collection.name}`,
    "",
    `Collection viewer: ${withShareToken(`${origin}/c/${collection.id}`, delivery?.shareToken)}`,
    "",
  ];
  for (const session of collection.sessions) appendSession(lines, session, origin, delivery);
  return lines.join("\n").trim();
}

// A batch is handed to an agent as work, not as an archive: only the pins the
// review state still expects the agent to act on. Screenshots follow the same
// delivery preference as every other export.
/**
 * The batch bundle is an agent handoff, not a projection: the same instruction
 * block and `pinar-visual-context` fences a single capture produces, one fence
 * per page. Only pins the review state still expects the agent to act on are
 * included, and a page with none left is dropped rather than handed over empty.
 */
export function formatBatchMarkdown(
  batch: { id: string; label: string },
  sessions: Session[],
  statusByPinId: Record<string, PinReviewStatus>,
  origin: string,
  delivery?: MarkdownDelivery,
) {
  const captures = [];
  const references: string[] = [];
  const effectiveStatusByPinId = { ...statusByPinId };
  if (delivery?.includeViewerContent) {
    for (const session of sessions) {
      for (const review of delivery.viewerContent?.reviews[session.id] ?? []) {
        effectiveStatusByPinId[review.pinId] = review.status;
      }
    }
  }
  for (const session of sessions) {
    const reviews = delivery?.viewerContent?.reviews[session.id] ?? [];
    const pins = session.pins.filter((pin) => isPinAwaitingAgent(
      pinReviewStatusFor(String(pin.pinId || pin.id || ""), effectiveStatusByPinId),
    ));
    if (delivery?.includeViewerContent) {
      const reference = referenceSessionMarkdown(
        session,
        origin,
        delivery.viewerContent?.executions[session.id] ?? [],
        reviews,
        delivery,
      );
      if (reference) references.push(reference);
    }
    if (!pins.length) continue;
    captures.push({
      capture: captureFromSession(
        {
          ...session,
          ...(delivery?.shareToken && session.shotUrl
            ? { shotUrl: withShareToken(session.shotUrl, delivery.shareToken) }
            : {}),
          pins,
        },
        { deliverScreenshot: deliverScreenshot(session, delivery) },
      ),
      viewerUrl: withShareToken(`${origin}/v/${session.id}.md`, delivery?.shareToken),
    });
  }
  const markdown = formatBatchHandoff(
    batch.label,
    captures,
    delivery?.handoffMode === "full" ? "full" : "compact",
    delivery?.language ?? "en",
  ).trim();
  if (!delivery?.includeViewerContent) return markdown;
  return appendViewerReference(markdown, references, delivery.language);
}

export function formatProjectMarkdown(
  project: ProjectTreeProject,
  origin: string,
  delivery?: MarkdownDelivery,
) {
  const lines = [
    `# ${project.name}`,
    "",
    `Project viewer: ${withShareToken(`${origin}/p/${project.id}`, delivery?.shareToken)}`,
    "",
  ];
  for (const collection of project.collections) {
    lines.push(`## [${collection.name}](${withShareToken(`${origin}/c/${collection.id}`, delivery?.shareToken)})`);
    lines.push("");
    for (const session of collection.sessions) appendSession(lines, session, origin, delivery);
  }
  return lines.join("\n").trim();
}

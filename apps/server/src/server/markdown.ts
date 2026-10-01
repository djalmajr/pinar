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

const viewerHistoryCopy: Record<SupportedLanguage, { description: string; heading: string }> = {
  de: {
    description: "Nur Kontext, nicht umsetzbar: Umsetzbar sind allein die kanonischen Blöcke oben. Erledigte Pins nicht erneut bearbeiten. Den vollständigen Kontext gibt es über den Link im Kopfbereich.",
    heading: "## Ergänzender Verlauf (nicht umsetzbar)",
  },
  en: {
    description: "Context only, not actionable: the canonical blocks above are the only work to do. Do not rework completed pins. The full context is available from the link in the header.",
    heading: "## Complementary history (not actionable)",
  },
  es: {
    description: "Solo contexto, no accionable: el único trabajo son los bloques canónicos de arriba. No repitas pins completados. El contexto completo está disponible en el enlace del encabezado.",
    heading: "## Historial complementario (no accionable)",
  },
  fr: {
    description: "Contexte uniquement, non actionnable : le seul travail à effectuer figure dans les blocs canoniques ci-dessus. Ne reprenez pas les pins terminés. Le contexte complet est disponible via le lien de l’en-tête.",
    heading: "## Historique complémentaire (non actionnable)",
  },
  ja: {
    description: "文脈のみで実行対象ではありません。実行対象は上の正規ブロックだけです。完了したピンを再対応しないでください。完全なコンテキストはヘッダーのリンクから参照できます。",
    heading: "## 補足履歴（実行対象外）",
  },
  pt: {
    description: "Somente contexto, não acionável: o único trabalho a fazer está nos blocos canônicos acima. Não refaça pins concluídos. O contexto completo está disponível no link do cabeçalho.",
    heading: "## Histórico complementar (não acionável)",
  },
  zh: {
    description: "仅供上下文参考，不可执行：需要处理的工作只在上方的规范代码块中。不要重复处理已完成的图钉。完整上下文可通过页眉中的链接获取。",
    heading: "## 补充历史（不可执行）",
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

function statusLookup(reviews: PinReview[]) {
  return Object.fromEntries(reviews.map((review) => [review.pinId, review.status]));
}

function actionablePins(session: Session, reviews: PinReview[]) {
  const statusByPinId = statusLookup(reviews);
  return session.pins.filter((pin) => isPinAwaitingAgent(
    pinReviewStatusFor(String(pin.pinId || pin.id || ""), statusByPinId),
  ));
}

// Every value in the complementary history comes from captured pages, users or
// agents. It is flattened to one line (any Unicode whitespace, including line
// and paragraph separators, becomes a space) and fence markers are defused, so
// no field can open a heading, list item or fenced block of its own; a false
// `pinar-visual-context` fence would otherwise be read as a second capture.
function oneLine(value: unknown, max = 160) {
  const flat = String(value ?? "")
    .replace(/[\s\u0085\u2028\u2029]+/g, " ")
    .replace(/`{3,}/g, (run) => "ˋ".repeat(run.length))
    .replace(/~{3,}/g, (run) => "∼".repeat(run.length))
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Complementary history for one page: only what the canonical block cannot
 * carry. Completed pins (with their comment, since they are absent from the
 * block), agent results, and review movement on open pins. An open pin is
 * referenced by number and id, never re-quoted. Returns "" when there is
 * nothing to add so a single fresh pin produces no extra section.
 */
function complementaryPageHistory(
  session: Session,
  executions: AgentExecution[],
  reviews: PinReview[],
  statusByPinId: Record<string, PinReviewStatus> = statusLookup(reviews),
) {
  const reviewByPinId = new Map(reviews.map((review) => [review.pinId, review]));
  const lines: string[] = [];
  for (const [index, pin] of session.pins.entries()) {
    const pinId = String(pin.pinId || pin.id || "");
    const status = pinReviewStatusFor(pinId, statusByPinId);
    const concluded = !isPinAwaitingAgent(status);
    const review = reviewByPinId.get(pinId);
    const last = review?.timeline[review.timeline.length - 1];
    const results = executions.flatMap((execution) => execution.results
      .filter((result) => result.pinId === pinId)
      .map((result) => ({ agent: execution.agent, result })));
    if (!concluded && !results.length && !last) continue;
    const label = `#${oneLine(pin.number || index + 1, 16)}${pinId ? ` (${oneLine(pinId, 80)})` : ""}`;
    lines.push(concluded
      ? `- ${label}: ${oneLine(pin.comment)} — ${oneLine(status, 32)}`
      : `- ${label}: ${oneLine(status, 32)}`);
    if (last) lines.push(`  - review: ${oneLine(last.fromStatus, 32)} → ${oneLine(last.toStatus, 32)}`);
    for (const { agent, result } of results) {
      lines.push(`  - ${oneLine(agent, 80)}: ${oneLine(result.status, 32)} — ${oneLine(result.summary)}`);
      if (result.reason) lines.push(`    - reason: ${oneLine(result.reason)}`);
      if (result.files.length) lines.push(`    - files: ${result.files.map((file) => oneLine(file, 240)).join(", ")}`);
      if (result.commit) lines.push(`    - commit: ${oneLine(result.commit, 80)}`);
      if (result.pullRequest) lines.push(`    - pullRequest: ${oneLine(result.pullRequest, 240)}`);
    }
  }
  if (!lines.length) return "";
  return [`### ${oneLine(session.page.title || session.page.url || session.id)}`, "", ...lines].join("\n");
}

function appendComplementaryHistory(primary: string, histories: string[], language?: SupportedLanguage | null) {
  const present = histories.filter(Boolean);
  if (!present.length) return primary;
  const copy = viewerHistoryCopy[language ?? "en"] || viewerHistoryCopy.en;
  return [primary.trim(), "", copy.heading, "", copy.description, "", present.join("\n\n")].join("\n").trim();
}

export function formatSessionHandoffMarkdown(
  session: Session,
  viewerUrl: string,
  executions: AgentExecution[] = [],
  reviews: PinReview[] = [],
  delivery?: MarkdownDelivery,
) {
  // The copy is work for an agent: completed pins never enter the canonical
  // block, whether or not the complementary history is requested.
  const primarySession = { ...session, pins: actionablePins(session, reviews) };
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
  return appendComplementaryHistory(
    primary,
    [complementaryPageHistory(session, executions, reviews)],
    delivery.language,
  );
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
      references.push(complementaryPageHistory(
        session,
        delivery.viewerContent?.executions[session.id] ?? [],
        reviews,
        effectiveStatusByPinId,
      ));
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
  return appendComplementaryHistory(markdown, references, delivery.language);
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

import {
  captureFromSession,
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
} from "@pinar/shared";

export type MarkdownDelivery = { handoffMode?: HandoffMode; includeScreenshot?: boolean };

function deliverScreenshot(session: Session, delivery?: MarkdownDelivery) {
  return screenshotDeliveryEnabled(delivery?.includeScreenshot, session);
}

export function formatSessionMarkdown(
  session: Session,
  viewerUrl: string,
  executions: AgentExecution[] = [],
  reviews: PinReview[] = [],
  delivery?: MarkdownDelivery,
) {
  const parts = [formatHandoffBundle(
    captureFromSession(session, { deliverScreenshot: deliverScreenshot(session, delivery) }),
    viewerUrl,
  ).plain.trim()];
  const results = formatAgentResultsMarkdown(executions);
  const reviewMarkdown = formatPinReviewsMarkdown(reviews);
  if (results) parts.push(results);
  if (reviewMarkdown) parts.push(reviewMarkdown);
  return parts.join("\n\n");
}

function appendSession(lines: string[], session: Session, origin: string, delivery?: MarkdownDelivery) {
  const title = session.page.title || "(untitled)";
  lines.push(`### [${title}](${origin}/v/${session.id})`);
  lines.push("");
  lines.push(`Page: ${session.page.url || "(unknown)"}`);
  lines.push(`Markdown: ${origin}/v/${session.id}.md`);
  if (session.shotUrl && deliverScreenshot(session, delivery)) lines.push(`Screenshot: ${session.shotUrl}`);
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
    `Collection viewer: ${origin}/c/${collection.id}`,
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
  for (const session of sessions) {
    const pins = session.pins.filter((pin) => isPinAwaitingAgent(
      pinReviewStatusFor(String(pin.pinId || pin.id || ""), statusByPinId),
    ));
    if (!pins.length) continue;
    captures.push({
      capture: captureFromSession({ ...session, pins }, { deliverScreenshot: deliverScreenshot(session, delivery) }),
      viewerUrl: `${origin}/v/${session.id}.md`,
    });
  }
  return formatBatchHandoff(batch.label, captures, delivery?.handoffMode === "full" ? "full" : "compact").trim();
}

export function formatProjectMarkdown(
  project: ProjectTreeProject,
  origin: string,
  delivery?: MarkdownDelivery,
) {
  const lines = [
    `# ${project.name}`,
    "",
    `Project viewer: ${origin}/p/${project.id}`,
    "",
  ];
  for (const collection of project.collections) {
    lines.push(`## [${collection.name}](${origin}/c/${collection.id})`);
    lines.push("");
    for (const session of collection.sessions) appendSession(lines, session, origin, delivery);
  }
  return lines.join("\n").trim();
}

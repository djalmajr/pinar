import {
  captureFromSession,
  formatAgentResultsMarkdown,
  formatHandoffBundle,
  formatPinReviewsMarkdown,
  type AgentExecution,
  type PinReview,
  type ProjectTreeCollection,
  type ProjectTreeProject,
  type Session,
} from "@pinar/shared";

export function formatSessionMarkdown(
  session: Session,
  viewerUrl: string,
  executions: AgentExecution[] = [],
  reviews: PinReview[] = [],
) {
  const parts = [formatHandoffBundle(captureFromSession(session), viewerUrl).plain.trim()];
  const results = formatAgentResultsMarkdown(executions);
  const reviewMarkdown = formatPinReviewsMarkdown(reviews);
  if (results) parts.push(results);
  if (reviewMarkdown) parts.push(reviewMarkdown);
  return parts.join("\n\n");
}

function appendSession(lines: string[], session: Session, origin: string) {
  const title = session.page.title || "(untitled)";
  lines.push(`### [${title}](${origin}/v/${session.id})`);
  lines.push("");
  lines.push(`Page: ${session.page.url || "(unknown)"}`);
  lines.push(`Markdown: ${origin}/v/${session.id}.md`);
  if (session.shotUrl) lines.push(`Screenshot: ${session.shotUrl}`);
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

export function formatCollectionMarkdown(collection: ProjectTreeCollection, origin: string) {
  const lines = [
    `# ${collection.name}`,
    "",
    `Collection viewer: ${origin}/c/${collection.id}`,
    "",
  ];
  for (const session of collection.sessions) appendSession(lines, session, origin);
  return lines.join("\n").trim();
}

export function formatProjectMarkdown(project: ProjectTreeProject, origin: string) {
  const lines = [
    `# ${project.name}`,
    "",
    `Project viewer: ${origin}/p/${project.id}`,
    "",
  ];
  for (const collection of project.collections) {
    lines.push(`## [${collection.name}](${origin}/c/${collection.id})`);
    lines.push("");
    for (const session of collection.sessions) appendSession(lines, session, origin);
  }
  return lines.join("\n").trim();
}

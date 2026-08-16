import type { ProjectTreeCollection, ProjectTreeProject, Session } from "@pinar/shared";

export function formatSessionMarkdown(session: Session, viewerUrl: string) {
  const lines = [
    `Page: ${session.page?.title || "(untitled)"}`,
    `URL: ${session.page?.url || "(unknown)"}`,
    `Viewer: ${viewerUrl}`,
  ];
  if (session.shotUrl) lines.push(`Screenshot: ${session.shotUrl}`);
  lines.push("");
  for (const [index, pin] of (session.pins || []).entries()) {
    lines.push(`Pin #${pin.number || index + 1}:`);
    lines.push(`Comment: ${pin.comment}`);
    if (pin.domPath) lines.push(`DOM: ${pin.domPath}`);
    if (pin.selector) lines.push(`Selector: ${pin.selector}`);
    if (pin.innerText) lines.push(`Text: "${pin.innerText.replace(/\n+/g, " ").trim()}"`);
    lines.push("");
  }
  return lines.join("\n").trim();
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

import { acceptedDiagnosis, describeEvidenceItem, renderSnapshotOutline, type Pin } from "@pinar/shared";

function appendCodeBlock(lines: string[], title: string, value?: string | null, language = "text") {
  if (!value) return;
  const fence = value.includes("```") ? "````" : "```";
  lines.push("", `## ${title}`, "", `${fence}${language}`, value, fence);
}

function appendDiagnosis(lines: string[], pin: Pin) {
  const diagnosis = acceptedDiagnosis(pin.diagnosis);
  if (!diagnosis) return;
  lines.push("", "## Diagnosis", "", `- **Confidence:** ${diagnosis.confidence}`, `- **Cause:** ${diagnosis.cause}`);
  if (diagnosis.properties.length) lines.push(`- **Properties:** ${diagnosis.properties.map((property) => `\`${property}\``).join(", ")}`);
  if (diagnosis.fix) lines.push("", "```css", diagnosis.fix, "```");
}

function appendEvidence(lines: string[], pin: Pin) {
  if (!pin.evidence?.items.length) return;
  lines.push("", "## Technical evidence", "");
  for (const item of pin.evidence.items) lines.push(`- \`${item.grade}\` ${describeEvidenceItem(item)}`);
  const environment = pin.evidence.environment;
  if (environment) {
    const facts = [
      environment.browser,
      environment.viewport ? `${environment.viewport.width}×${environment.viewport.height}` : "",
      environment.devicePixelRatio ? `dpr ${environment.devicePixelRatio}` : "",
      environment.language,
      environment.theme,
      environment.online === false ? "offline" : "",
    ].filter(Boolean);
    if (facts.length) lines.push("", `- **Environment:** ${facts.join(" · ")}`);
  }
}

function appendStructure(lines: string[], pin: Pin) {
  if (!pin.snapshot) return;
  const outline = renderSnapshotOutline(pin.snapshot.root).join("\n");
  const summary = `${pin.snapshot.nodeCount} nodes${pin.snapshot.truncated ? ", truncated" : ""}`;
  lines.push("", "## Structure", "", `- **Nodes:** ${summary}`);
  if (pin.snapshot.fonts.length) {
    lines.push(`- **Fonts:** ${pin.snapshot.fonts.map((font) => [font.family, font.weight, font.style].filter(Boolean).join(" ")).join(", ")}`);
  }
  if (pin.snapshot.icons.length) lines.push(`- **Icons:** ${pin.snapshot.icons.map((icon) => icon.name).join(", ")}`);
  const fence = outline.includes("```") ? "````" : "```";
  lines.push("", `${fence}html`, outline, fence);
}

export function formatPinMarkdown(pin: Pin, number: number) {
  const coordinates = pin.coords || pin.anchor;
  const box = pin.areaBox || pin.box;
  const isArea = pin.type === "area" || pin.kind === "area";
  const lines = [
    `# Pin ${number}`,
    "",
    "## Comment",
    "",
    pin.comment || "_No comment provided._",
    "",
    "## Context",
    "",
    `- **Type:** ${isArea ? "Area selection" : "Element"}`,
  ];
  if (pin.pinId || pin.id) lines.push(`- **Pin ID:** \`${pin.pinId || pin.id}\``);

  const element = pin.tag || pin.label;
  if (element) lines.push(`- **Element:** \`${element}\``);
  if (coordinates) lines.push(`- **Coordinates:** \`x=${coordinates.x}, y=${coordinates.y}\``);
  if (box) lines.push(`- **Area:** \`${box.width} × ${box.height}px at x=${box.x}, y=${box.y}\``);
  if (pin.location) {
    lines.push(`- **Location:** ${pin.location.confidence} (${pin.location.strategy})`);
    if (pin.location.warning === "cross-origin-frame") {
      lines.push("- **Warning:** cross-origin iframe is not readable");
    }
  }

  appendDiagnosis(lines, pin);
  appendEvidence(lines, pin);
  appendCodeBlock(lines, "Selector", pin.selector, "css");
  appendCodeBlock(lines, "DOM path", pin.domPath || pin.path);
  appendCodeBlock(lines, "Visible text", pin.innerText || pin.text);
  appendStructure(lines, pin);

  return `${lines.join("\n")}\n`;
}

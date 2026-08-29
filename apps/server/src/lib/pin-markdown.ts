import type { Pin } from "@pinar/shared";

function appendCodeBlock(lines: string[], title: string, value?: string | null, language = "text") {
  if (!value) return;
  const fence = value.includes("```") ? "````" : "```";
  lines.push("", `## ${title}`, "", `${fence}${language}`, value, fence);
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

  appendCodeBlock(lines, "Selector", pin.selector, "css");
  appendCodeBlock(lines, "DOM path", pin.domPath || pin.path);
  appendCodeBlock(lines, "Visible text", pin.innerText || pin.text);

  return `${lines.join("\n")}\n`;
}

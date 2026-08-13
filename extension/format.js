export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pinTitle(pin, index) {
  const kind = pin.kind === "area" ? "area" : "element";
  const label = pin.label?.trim();
  return `${index + 1}. ${kind}${label ? ` — ${label}` : ""}`;
}

function pinPlain(pin, index, crop) {
  const lines = [`## ${pinTitle(pin, index)}`, ""];
  lines.push(`Comment: ${pin.comment?.trim() || "(none)"}`);
  if (pin.path) lines.push(`DOM path: \`${pin.path}\``);
  if (pin.selector) lines.push(`Selector: \`${pin.selector}\``);
  if (pin.text) lines.push(`Visible text: ${JSON.stringify(pin.text)}`);
  if (pin.anchor) lines.push(`Pin: x=${pin.anchor.x}, y=${pin.anchor.y}`);
  if (pin.box) {
    lines.push(`Box: x=${pin.box.x}, y=${pin.box.y}, w=${pin.box.width}, h=${pin.box.height}`);
  }
  if (crop?.startsWith("data:")) lines.push("", `![Pin ${index + 1}](${crop})`);
  else if (crop) lines.push(`Screenshot: ${crop}`);
  return lines.join("\n");
}

function pinHtml(pin, index, crop) {
  const parts = [`<h2>${escapeHtml(pinTitle(pin, index))}</h2>`];
  parts.push(`<p><strong>Comment:</strong> ${escapeHtml(pin.comment?.trim() || "(none)")}</p>`);
  if (pin.path) {
    parts.push(`<p><strong>DOM path:</strong> <code>${escapeHtml(pin.path)}</code></p>`);
  }
  if (pin.selector) {
    parts.push(`<p><strong>Selector:</strong> <code>${escapeHtml(pin.selector)}</code></p>`);
  }
  if (pin.text) {
    parts.push(`<p><strong>Visible text:</strong> ${escapeHtml(pin.text)}</p>`);
  }
  if (pin.anchor) {
    parts.push(`<p><strong>Pin:</strong> x=${pin.anchor.x}, y=${pin.anchor.y}</p>`);
  }
  if (pin.box) {
    parts.push(
      `<p><strong>Box:</strong> x=${pin.box.x}, y=${pin.box.y}, w=${pin.box.width}, h=${pin.box.height}</p>`,
    );
  }
  if (crop?.startsWith("data:")) {
    parts.push(
      `<figure><img alt="Pin ${index + 1} crop" src="${crop}" style="max-width:100%;height:auto"/><figcaption>Pin ${index + 1} screenshot</figcaption></figure>`,
    );
  } else if (crop) {
    parts.push(`<p><strong>Screenshot:</strong> <code>${escapeHtml(crop)}</code></p>`);
  }
  return parts.join("\n");
}

export function formatClipboard({ page = {}, pins = [], pinCrops = {}, sentAt } = {}) {
  const when = sentAt || new Date().toISOString();
  const url = page.url || "(unknown)";
  const title = page.title || "(untitled)";
  const header = [
    "# Visual feedback",
    "",
    `URL: ${url}`,
    `Title: ${title}`,
    `Copied: ${when}`,
    `Pins: ${pins.length}`,
    "",
    "Each pin is an instruction about that DOM node. Use the DOM path and selector to find the matching source.",
  ];
  const pinBlocks = pins.map((pin, index) => pinPlain(pin, index, pinCrops[pin.id])).join("\n\n");
  const plain = `${[...header, "", pinBlocks].join("\n")}\n`;

  const htmlParts = [
    `<meta charset="utf-8"/>`,
    `<h1>Visual feedback</h1>`,
    `<p><strong>URL:</strong> ${escapeHtml(url)}<br/><strong>Title:</strong> ${escapeHtml(title)}<br/><strong>Copied:</strong> ${escapeHtml(when)}</p>`,
    `<p>Each pin is an instruction about that DOM node. Use the DOM path and selector to find the matching source.</p>`,
  ];
  pins.forEach((pin, index) => {
    htmlParts.push(pinHtml(pin, index, pinCrops[pin.id]));
  });

  return { html: htmlParts.join("\n"), plain };
}

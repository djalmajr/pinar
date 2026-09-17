import type { Box, ElementSnapshot, Pin, Session, SnapshotFont, SnapshotNode } from "@pinar/shared";

/**
 * Bounds for the pin-diagnosis prompt. The model gets a compact, untrusted
 * description of the pinned element; the total stays around 4k tokens.
 */
export const DIAGNOSIS_PROMPT_LIMITS = {
  maxAttributeLength: 80,
  maxCharacters: 14_000,
  maxCommentLength: 1_000,
  maxDepth: 6,
  maxNodes: 60,
  maxSiblings: 12,
  maxStyleLength: 120,
  maxTextLength: 160,
  maxTitleLength: 200,
  maxUrlLength: 500,
} as const;

/** Only the properties that explain layout, spacing and clipping of a neighbour. */
export const BOX_MODEL_PROPERTIES = [
  "align-self",
  "border-bottom-width",
  "border-left-width",
  "border-right-width",
  "border-top-width",
  "bottom",
  "box-sizing",
  "display",
  "flex",
  "flex-basis",
  "flex-grow",
  "flex-shrink",
  "float",
  "font-size",
  "gap",
  "height",
  "left",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "order",
  "overflow",
  "overflow-x",
  "overflow-y",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "position",
  "right",
  "top",
  "vertical-align",
  "width",
] as const;

const PROMPT_ATTRIBUTES = ["aria-label", "class", "id", "role", "type"] as const;

export interface DiagnosisPromptNode {
  attrs?: Record<string, string>;
  children?: DiagnosisPromptNode[];
  styles?: Record<string, string>;
  tag: string;
  text?: string;
  truncated?: boolean;
}

export interface DiagnosisPromptSibling {
  styles?: Record<string, string>;
  tag: string;
  text?: string;
}

export interface DiagnosisPromptContext {
  parent?: DiagnosisPromptNode;
  siblings?: DiagnosisPromptSibling[];
}

export interface DiagnosisPromptLocation {
  confidence?: string;
  domPath?: string;
  selector?: string;
  strategy?: string;
}

export interface DiagnosisPromptPin {
  box?: Box;
  kind?: string;
  location?: DiagnosisPromptLocation;
  number: number;
  tag?: string;
}

export interface DiagnosisPromptTarget {
  fonts: SnapshotFont[];
  nodeCount: number;
  root: DiagnosisPromptNode;
  truncated: boolean;
}

export interface DiagnosisPromptInput {
  comment: string;
  context?: DiagnosisPromptContext;
  page: { title: string; url: string };
  pin: DiagnosisPromptPin;
  target: DiagnosisPromptTarget;
}

interface NodeBudget {
  nodes: number;
}

function pickAttributes(attrs: Record<string, string> | undefined) {
  if (!attrs) return undefined;
  const entries = PROMPT_ATTRIBUTES
    .filter((name) => attrs[name])
    .map((name) => [name, attrs[name].slice(0, DIAGNOSIS_PROMPT_LIMITS.maxAttributeLength)] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function boundStyles(styles: Record<string, string> | undefined, allowed?: ReadonlySet<string>) {
  if (!styles) return undefined;
  const entries = Object.entries(styles)
    .filter(([property]) => !allowed || allowed.has(property))
    .map(([property, value]) => [property, value.slice(0, DIAGNOSIS_PROMPT_LIMITS.maxStyleLength)] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function boundText(text: string | undefined) {
  if (!text) return undefined;
  const compact = text.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, DIAGNOSIS_PROMPT_LIMITS.maxTextLength) : undefined;
}

function promptNode(node: SnapshotNode, depth: number, budget: NodeBudget): DiagnosisPromptNode {
  budget.nodes -= 1;
  const result: DiagnosisPromptNode = { tag: node.tag };
  const attrs = pickAttributes(node.attrs);
  const styles = boundStyles(node.styles);
  const text = boundText(node.text);
  if (attrs) result.attrs = attrs;
  if (styles) result.styles = styles;
  if (text) result.text = text;
  if (node.truncated) result.truncated = true;
  const children = node.children ?? [];
  if (!children.length) return result;
  if (depth >= DIAGNOSIS_PROMPT_LIMITS.maxDepth) {
    result.truncated = true;
    return result;
  }
  const kept: DiagnosisPromptNode[] = [];
  for (const child of children) {
    if (budget.nodes <= 0) {
      result.truncated = true;
      break;
    }
    kept.push(promptNode(child, depth + 1, budget));
  }
  if (kept.length) result.children = kept;
  return result;
}

const BOX_MODEL_SET: ReadonlySet<string> = new Set(BOX_MODEL_PROPERTIES);

function promptSibling(node: SnapshotNode): DiagnosisPromptSibling {
  const sibling: DiagnosisPromptSibling = { tag: node.tag };
  const styles = boundStyles(node.styles, BOX_MODEL_SET);
  const text = boundText(node.text);
  if (styles) sibling.styles = styles;
  if (text) sibling.text = text;
  return sibling;
}

function promptContext(snapshot: ElementSnapshot): DiagnosisPromptContext | undefined {
  const context: DiagnosisPromptContext = {};
  if (snapshot.context?.parent) {
    const parent = promptNode({ ...snapshot.context.parent, children: undefined }, 0, { nodes: 1 });
    delete parent.truncated;
    context.parent = parent;
  }
  const siblings = (snapshot.context?.siblings ?? []).slice(0, DIAGNOSIS_PROMPT_LIMITS.maxSiblings).map(promptSibling);
  if (siblings.length) context.siblings = siblings;
  return context.parent || context.siblings ? context : undefined;
}

function promptLocation(pin: Pin): DiagnosisPromptLocation | undefined {
  const location: DiagnosisPromptLocation = {};
  if (pin.selector) location.selector = pin.selector.slice(0, DIAGNOSIS_PROMPT_LIMITS.maxUrlLength);
  const domPath = pin.domPath || pin.path;
  if (domPath) location.domPath = domPath.slice(0, DIAGNOSIS_PROMPT_LIMITS.maxUrlLength);
  if (pin.location) {
    location.confidence = pin.location.confidence;
    location.strategy = pin.location.strategy;
  }
  return Object.keys(location).length ? location : undefined;
}

function roundedBox(box: Box | undefined): Box | undefined {
  if (!box) return undefined;
  return {
    height: Math.round(box.height),
    width: Math.round(box.width),
    x: Math.round(box.x),
    y: Math.round(box.y),
  };
}

function pruneDeepest(node: DiagnosisPromptNode): boolean {
  if (!node.children?.length) return false;
  const deepest = node.children.some((child) => child.children?.length);
  if (deepest) {
    for (const child of node.children) if (pruneDeepest(child)) return true;
  }
  delete node.children;
  node.truncated = true;
  return true;
}

function serializedLength(input: DiagnosisPromptInput) {
  return JSON.stringify(input).length;
}

/**
 * The prompt input for a pin that carries an element snapshot. Page content is
 * copied as-is (redacted placeholders included) and only bounded, never
 * rewritten; the model is told to treat all of it as untrusted data. Returns
 * null when the pin has no snapshot.
 */
export function diagnosisPromptInput(pin: Pin, session: Session): DiagnosisPromptInput | null {
  const snapshot = pin.snapshot;
  if (!snapshot) return null;
  const budget: NodeBudget = { nodes: DIAGNOSIS_PROMPT_LIMITS.maxNodes };
  const root = promptNode(snapshot.root, 0, budget);
  const promptPin: DiagnosisPromptPin = { number: pin.number };
  const box = roundedBox(pin.box || pin.documentBox || pin.areaBox);
  const location = promptLocation(pin);
  if (box) promptPin.box = box;
  if (pin.kind) promptPin.kind = pin.kind;
  if (location) promptPin.location = location;
  if (pin.tag) promptPin.tag = pin.tag;
  const input: DiagnosisPromptInput = {
    comment: String(pin.comment || "").slice(0, DIAGNOSIS_PROMPT_LIMITS.maxCommentLength),
    page: {
      title: String(session.page.title || "").slice(0, DIAGNOSIS_PROMPT_LIMITS.maxTitleLength),
      url: String(session.page.url || "").slice(0, DIAGNOSIS_PROMPT_LIMITS.maxUrlLength),
    },
    pin: promptPin,
    target: {
      fonts: snapshot.fonts.slice(0, 8).map((font) => {
        const entry: SnapshotFont = { family: font.family };
        if (font.style) entry.style = font.style;
        if (font.weight) entry.weight = font.weight;
        return entry;
      }),
      nodeCount: snapshot.nodeCount,
      root,
      truncated: snapshot.truncated || budget.nodes <= 0,
    },
  };
  const context = promptContext(snapshot);
  if (context) input.context = context;

  // Shrink from the least useful detail inwards until the prompt fits.
  if (serializedLength(input) > DIAGNOSIS_PROMPT_LIMITS.maxCharacters && input.context?.siblings) {
    input.context.siblings = input.context.siblings.slice(0, 4);
  }
  if (serializedLength(input) > DIAGNOSIS_PROMPT_LIMITS.maxCharacters && input.context) {
    delete input.context;
  }
  while (serializedLength(input) > DIAGNOSIS_PROMPT_LIMITS.maxCharacters && pruneDeepest(input.target.root)) {
    input.target.truncated = true;
  }
  return input;
}

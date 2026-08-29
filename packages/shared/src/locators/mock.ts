import { parseSimpleSelector, splitChildSelector } from "./css.js";
import type { LocateBox, LocateElement, LocateRoot } from "./types.js";

export interface MockAttrs {
  box?: LocateBox;
  class?: string;
  frame?: LocateRoot | null;
  id?: string;
  name?: string;
  role?: string;
  text?: string;
  [name: string]: unknown;
}

export interface MockNode {
  attrs: Record<string, string>;
  box: LocateBox;
  children: MockNode[];
  frame?: LocateRoot | null;
  hasFrame?: boolean;
  tag: string;
  text: string;
}

function asBox(value: unknown, fallback: LocateBox): LocateBox {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (![x, y, width, height].every(Number.isFinite)) return fallback;
  return { height, width, x, y };
}

export function el(tag: string, attrs: MockAttrs = {}, children: Array<MockNode | string> = []): MockNode {
  const {
    box,
    class: className,
    frame,
    id,
    name,
    role,
    text,
    ...rest
  } = attrs;
  const next: Record<string, string> = {};
  if (typeof className === "string") next.class = className;
  if (typeof id === "string") next.id = id;
  if (typeof name === "string") next.name = name;
  if (typeof role === "string") next.role = role;
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === "string") next[key] = value;
  }
  const childNodes = children.map((child, index) => {
    if (typeof child === "string") {
      return {
        attrs: {},
        box: { height: 0, width: 0, x: 0, y: 0 },
        children: [],
        tag: "#text",
        text: child,
      } satisfies MockNode;
    }
    return {
      ...child,
      box: child.box.width || child.box.height
        ? child.box
        : asBox(undefined, { height: 24, width: 80, x: 8 + index * 12, y: 8 + index * 12 }),
    };
  });
  return {
    attrs: next,
    box: asBox(box, { height: 32, width: 96, x: 16, y: 16 }),
    children: childNodes,
    frame: frame === undefined ? undefined : frame,
    hasFrame: frame !== undefined,
    tag,
    text: typeof text === "string" ? text : "",
  };
}

function visibleText(node: MockNode): string {
  if (node.tag === "#text") return node.text;
  if (node.text) return node.text;
  return node.children.map(visibleText).join(" ");
}

function classesOf(node: MockNode) {
  return (node.attrs.class || "").split(/\s+/).filter(Boolean);
}

function nthOfType(node: MockNode, parent: MockNode | null) {
  if (!parent) return 1;
  const tag = node.tag.toLowerCase();
  let index = 0;
  for (const child of parent.children) {
    if (child.tag === "#text" || child.tag.toLowerCase() !== tag) continue;
    index += 1;
    if (child === node) return index;
  }
  return index || 1;
}

function matchesSimple(node: MockNode, selector: string, parent: MockNode | null) {
  if (node.tag === "#text") return false;
  const parsed = parseSimpleSelector(selector);
  if (!parsed) return false;
  if (parsed.tag && node.tag.toLowerCase() !== parsed.tag) return false;
  if (parsed.id && node.attrs.id !== parsed.id) return false;
  if (parsed.classes.some((name) => !classesOf(node).includes(name))) return false;
  if (parsed.attr) {
    const actual = node.attrs[parsed.attr.name];
    if (parsed.attr.value === undefined) {
      if (actual == null) return false;
    } else if (actual !== parsed.attr.value) return false;
  }
  if (parsed.nthOfType && nthOfType(node, parent) !== parsed.nthOfType) return false;
  return true;
}

function collect(node: MockNode, parent: MockNode | null, out: Array<{ node: MockNode; parent: MockNode | null }>) {
  if (node.tag !== "#text") out.push({ node, parent });
  for (const child of node.children) collect(child, node, out);
}

function wrap(
  node: MockNode,
  parent: MockNode | null,
  parentElement: LocateElement | null,
  owner: LocateRoot,
  cache: WeakMap<MockNode, LocateElement>,
): LocateElement {
  const cached = cache.get(node);
  if (cached) return cached;
  const element: LocateElement = {
    get children() {
      return node.children
        .filter((child) => child.tag !== "#text")
        .map((child) => wrap(child, node, element, owner, cache));
    },
    classList: {
      contains(token: string) {
        return classesOf(node).includes(token);
      },
      *[Symbol.iterator]() {
        yield* classesOf(node);
      },
    },
    get contentDocument() {
      if (!node.hasFrame) return null;
      return node.frame ?? null;
    },
    get id() {
      return node.attrs.id || "";
    },
    parentElement,
    get tagName() {
      return node.tag.toUpperCase();
    },
    get textContent() {
      return visibleText(node);
    },
    getAttribute(name: string) {
      if (name === "class") return node.attrs.class || null;
      return node.attrs[name] ?? null;
    },
    getBoundingClientRect() {
      return { left: node.box.x, top: node.box.y, ...node.box };
    },
  };
  cache.set(node, element);
  return element;
}

function queryAllFrom(
  html: MockNode,
  selector: string,
  owner: LocateRoot,
  cache: WeakMap<MockNode, LocateElement>,
): LocateElement[] {
  const parts = splitChildSelector(selector);
  if (!parts.length) return [];
  const all: Array<{ node: MockNode; parent: MockNode | null }> = [];
  collect(html, null, all);
  let current = all.filter((item) => matchesSimple(item.node, parts[0] || "", item.parent));
  for (const part of parts.slice(1)) {
    const next: Array<{ node: MockNode; parent: MockNode | null }> = [];
    for (const item of current) {
      for (const child of item.node.children) {
        if (matchesSimple(child, part, item.node)) next.push({ node: child, parent: item.node });
      }
    }
    current = next;
  }
  return current.map((item) => {
    const parentElement = item.parent ? wrap(item.parent, null, null, owner, cache) : null;
    return wrap(item.node, item.parent, parentElement, owner, cache);
  });
}

export function documentOf(bodyChildren: MockNode[]): LocateRoot {
  const body = el("body", {}, bodyChildren);
  const html = el("html", {}, [el("head", {}, []), body]);
  const cache = new WeakMap<MockNode, LocateElement>();
  const root: LocateRoot = {
    get body() {
      const htmlElement = wrap(html, null, null, root, cache);
      return wrap(body, html, htmlElement, root, cache);
    },
    querySelector(selectors: string) {
      return this.querySelectorAll(selectors)[0] ?? null;
    },
    querySelectorAll(selectors: string) {
      return queryAllFrom(html, selectors, root, cache);
    },
  };
  return root;
}

export function elementKey(element: LocateElement) {
  return element.getAttribute("data-key")
    || (element.id ? `#${element.id}` : "")
    || element.getAttribute("data-testid")
    || element.tagName.toLowerCase();
}

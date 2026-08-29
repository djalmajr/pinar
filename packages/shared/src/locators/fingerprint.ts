import { escapeCssIdent, isStableClassName, normalizeVisibleText } from "./css.js";
import type { LocateElement, LocateRoot, VisualFingerprint } from "./types.js";

function classNames(element: LocateElement) {
  return [...element.classList].filter(isStableClassName);
}

function testIdOf(element: LocateElement) {
  return element.getAttribute("data-testid") || element.getAttribute("data-test") || undefined;
}

function nthOfType(element: LocateElement) {
  const parent = element.parentElement;
  if (!parent) return 1;
  const tag = element.tagName.toLowerCase();
  let index = 0;
  for (const child of parent.children) {
    if (child.tagName.toLowerCase() !== tag) continue;
    index += 1;
    if (child === element) return index;
  }
  return index || 1;
}

export function captureFingerprint(element: LocateElement): VisualFingerprint {
  const id = element.id || undefined;
  const name = element.getAttribute("aria-label") || element.getAttribute("name") || undefined;
  return {
    classes: classNames(element),
    id,
    name,
    nthOfType: nthOfType(element),
    role: element.getAttribute("role") || undefined,
    tag: element.tagName.toLowerCase(),
    testId: testIdOf(element),
    text: normalizeVisibleText(element.textContent),
  };
}

export function stableSelector(root: LocateRoot, element: LocateElement) {
  const fingerprint = captureFingerprint(element);
  const candidates: string[] = [];
  if (fingerprint.id) candidates.push(`#${escapeCssIdent(fingerprint.id)}`);
  if (fingerprint.testId) {
    candidates.push(`[data-testid="${fingerprint.testId.replaceAll('"', '\\"')}"]`);
  }
  if (fingerprint.name && fingerprint.tag) {
    candidates.push(`${fingerprint.tag}[name="${fingerprint.name.replaceAll('"', '\\"')}"]`);
  }
  for (const selector of candidates) {
    try {
      if ([...root.querySelectorAll(selector)].length === 1 && root.querySelector(selector) === element) {
        return selector;
      }
    } catch {
      /* Ignore selectors the host CSS parser rejects. */
    }
  }
  return null;
}

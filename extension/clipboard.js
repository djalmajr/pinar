/**
 * Decides which MIME flavors a clipboard write publishes.
 *
 * Publishing `text/html` is only correct when the caller actually produced
 * HTML. A contenteditable target - every agent composer - prefers `text/html`
 * when it is offered, so handing it raw Markdown collapses the newlines and
 * lets the parser eat anything that looks like a tag. A batch bundle is full of
 * DOM paths and selectors, so that silently destroys the payload while the
 * write itself reports success.
 */
export function clipboardFlavors({ html, plain }) {
  const text = typeof plain === "string" ? plain : "";
  const markup = typeof html === "string" && html !== "" ? html : null;
  const flavors = { "text/plain": text };
  if (markup !== null) flavors["text/html"] = markup;
  return flavors;
}

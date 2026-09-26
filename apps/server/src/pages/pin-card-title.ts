import type { Pin, PinLocation } from "@pinar/shared";

export function cardOmitsLocationMethod(location?: PinLocation) {
  return !location || location.confidence === "exact" || location.confidence === "probable";
}

function isBareGeneratedId(value: string) {
  return /^#?_r[_a-z0-9]*$/i.test(value);
}

function readSelectorShape(selector?: string) {
  const leaf = selector?.split(">").pop()?.trim() ?? "";
  const simple = leaf.replace(/:nth-of-type\(\d+\)/gi, "").replace(/\[[^\]]*\]/g, "");
  const match = /^(?<tag>[a-z][\w-]*)?(?<id>#[^\s.#:[]+)?(?<classes>(?:\.[^\s.#:[]+)+)?/i.exec(simple);
  return {
    className: match?.groups?.classes?.split(".").filter(Boolean)[0],
    id: match?.groups?.id?.slice(1),
    tag: match?.groups?.tag?.toLowerCase(),
  };
}

function htmlTagName(value: string | undefined, id?: string) {
  if (!value || isBareGeneratedId(value)) return undefined;
  if (id && (value === id || value === `#${id}`)) return undefined;
  if (!/^[a-z][a-z0-9-]*$/.test(value)) return undefined;
  return value;
}

export function pinCardTitle(pin: Pin, labels: { area: string; element: string }) {
  if (pin.type === "area" || pin.kind === "area") return labels.area;
  const fromSelector = readSelectorShape(pin.selector);
  const id = fromSelector.id || pin.fingerprint?.id;
  const tag = fromSelector.tag || pin.fingerprint?.tag || htmlTagName(pin.tag, id);
  const className = fromSelector.className || pin.fingerprint?.classes?.find(Boolean);
  if (tag && id) return `${tag}#${id}`;
  if (tag && className) return `${tag}.${className}`;
  if (tag) return tag;
  if (pin.tag && !isBareGeneratedId(pin.tag)) return pin.tag;
  return labels.element;
}

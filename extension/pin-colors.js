export const PinColors = [
  "#2563EB",
  "#0369A1",
  "#0E7490",
  "#0F766E",
  "#15803D",
  "#4D7C0F",
  "#A16207",
  "#C2410C",
  "#B91C1C",
  "#BE185D",
  "#7E22CE",
  "#4338CA",
];

export function getPinColor(number = 1) {
  const safeNumber = Number.isFinite(number) ? Math.max(1, Math.trunc(number)) : 1;
  return PinColors[(safeNumber - 1) % PinColors.length];
}

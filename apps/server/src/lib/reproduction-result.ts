import { asReproduction, type Reproduction } from "@pinar/shared";

export function mergeGeneratedReproduction(
  reproduction: Reproduction,
  generated: unknown,
): Reproduction | null {
  const merged = asReproduction({ ...reproduction, generated });
  return merged?.generated ? merged : null;
}

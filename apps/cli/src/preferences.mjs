import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DELIVERY_PREFERENCES,
  mergeDeliveryPreferences,
  parseDeliveryPreferences,
} from "../../../packages/shared/src/types/index.ts";
import { ensurePinarHome, pinarHome } from "./paths.mjs";

const PREFERENCES_FILE = "preferences.json";

export function preferencesPath(root = pinarHome()) {
  return join(root, PREFERENCES_FILE);
}

export function readDeliveryPreferences(root = pinarHome()) {
  const path = preferencesPath(root);
  if (!existsSync(path)) return { ...DEFAULT_DELIVERY_PREFERENCES };
  try {
    return parseDeliveryPreferences(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { ...DEFAULT_DELIVERY_PREFERENCES };
  }
}

export function writeDeliveryPreferences(patch, root = pinarHome()) {
  ensurePinarHome(root);
  const next = mergeDeliveryPreferences(readDeliveryPreferences(root), patch);
  writeFileSync(preferencesPath(root), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

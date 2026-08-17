import { icons as lucideIconSet } from "@iconify-json/lucide";
import type { ProjectIcon } from "../types/index.js";

export const PROJECT_ICON_OPTIONS: readonly ProjectIcon[] = Object.freeze(
  Object.entries(lucideIconSet.icons)
    .filter(([, icon]) => icon.hidden !== true)
    .map(([name]) => name),
);

export const PROJECT_ICONS: readonly ProjectIcon[] = Object.freeze([
  ...PROJECT_ICON_OPTIONS,
  ...Object.keys(lucideIconSet.aliases ?? {}),
]);

const PROJECT_ICON_SET = new Set(PROJECT_ICONS);

export const DEFAULT_PROJECT_ICON: ProjectIcon = "folder-kanban";
export const PERSONAL_PROJECT_ICON: ProjectIcon = "user-round";

export function getProjectIconData(name: ProjectIcon) {
  const direct = lucideIconSet.icons[name];
  if (direct) return direct;
  const alias = lucideIconSet.aliases?.[name];
  return alias ? lucideIconSet.icons[alias.parent] : undefined;
}

export const PROJECT_ICON_HEIGHT = lucideIconSet.height ?? 24;
export const PROJECT_ICON_WIDTH = lucideIconSet.width ?? 24;

export function isProjectIcon(value: unknown): value is ProjectIcon {
  return typeof value === "string" && PROJECT_ICON_SET.has(value);
}

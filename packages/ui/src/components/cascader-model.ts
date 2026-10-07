import type { ReactNode } from "react";

export interface CascaderOption {
  children?: CascaderOption[];
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  selectable?: boolean;
  value: string;
}

function normalizeCascaderText(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

export function isCascaderSelectable(option: CascaderOption): boolean {
  if (option.disabled) return false;
  if (option.selectable !== undefined) return option.selectable;
  return !option.children?.length;
}

export function findCascaderPath(options: CascaderOption[], value: string[] | null): CascaderOption[] | null {
  if (!value?.length) return null;
  const path: CascaderOption[] = [];
  let level: CascaderOption[] = options;
  for (const step of value) {
    const option = level.find((item) => item.value === step);
    if (!option) return null;
    path.push(option);
    level = option.children ?? [];
  }
  return path;
}

export function truncateCascaderPath(options: CascaderOption[], values: string[]): string[] {
  const prefix: string[] = [];
  let level: CascaderOption[] = options;
  for (const step of values) {
    const option = level.find((item) => item.value === step);
    if (!option) break;
    prefix.push(step);
    level = option.children ?? [];
  }
  return prefix;
}

export function searchCascaderPaths(options: CascaderOption[], query: string): CascaderOption[][] {
  const needle = normalizeCascaderText(query.trim());
  if (!needle) return [];
  const results: CascaderOption[][] = [];
  const walk = (level: CascaderOption[], path: CascaderOption[]): void => {
    for (const option of level) {
      if (option.disabled) continue;
      const nextPath = [...path, option];
      if (isCascaderSelectable(option) && nextPath.some((item) => normalizeCascaderText(item.label).includes(needle))) {
        results.push(nextPath);
      }
      if (option.children?.length) walk(option.children, nextPath);
    }
  };
  walk(options, []);
  return results;
}

import { useEffect, useMemo, useRef, useState, type SVGProps, type UIEvent } from "react";
import type { ProjectIcon } from "@pinar/shared";
import {
  DEFAULT_PROJECT_ICON,
  PROJECT_ICON_OPTIONS,
  PROJECT_ICON_HEIGHT,
  PROJECT_ICON_WIDTH,
  getProjectIconData,
} from "@pinar/shared/project-icons";
import { Button, Input } from "@pinar/ui";
import SearchIcon from "~icons/lucide/search";

interface ProjectIconGlyphProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  icon: ProjectIcon;
}

interface ProjectIconPickerProps {
  emptyMessage: string;
  label: string;
  searchPlaceholder: string;
  value: ProjectIcon;
  onValueChange: (icon: ProjectIcon) => void;
}

const GRID_CELL_WIDTH = 40;
const GRID_HEIGHT = 240;
const GRID_OVERSCAN_ROWS = 3;
const GRID_ROW_HEIGHT = 40;

function iconLabel(name: ProjectIcon) {
  return name
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function ProjectIconGlyph({ icon, ...props }: ProjectIconGlyphProps) {
  const data = getProjectIconData(icon) ?? getProjectIconData(DEFAULT_PROJECT_ICON);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${data?.width ?? PROJECT_ICON_WIDTH} ${data?.height ?? PROJECT_ICON_HEIGHT}`}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
      dangerouslySetInnerHTML={{ __html: data?.body ?? "" }}
    />
  );
}

export function ProjectIconPicker({
  emptyMessage,
  label,
  searchPlaceholder,
  value,
  onValueChange,
}: ProjectIconPickerProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(8);
  const [scrollTop, setScrollTop] = useState(0);
  const [search, setSearch] = useState("");
  const options = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return PROJECT_ICON_OPTIONS;
    const terms = query.split(/\s+/).filter(Boolean);
    return PROJECT_ICON_OPTIONS.filter((name) => terms.every((term) => name.includes(term)));
  }, [search]);
  const rowCount = Math.ceil(options.length / columnCount);
  const firstRow = Math.max(0, Math.floor(scrollTop / GRID_ROW_HEIGHT) - GRID_OVERSCAN_ROWS);
  const visibleRowCount = Math.ceil(GRID_HEIGHT / GRID_ROW_HEIGHT) + (GRID_OVERSCAN_ROWS * 2);
  const lastRow = Math.min(rowCount, firstRow + visibleRowCount);
  const visibleOptions = options.slice(firstRow * columnCount, lastRow * columnCount);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const nextColumnCount = Math.max(
        4,
        Math.floor((entry.contentRect.width - 16) / GRID_CELL_WIDTH),
      );
      setColumnCount(nextColumnCount);
    });
    observer.observe(scrollArea);
    return () => observer.disconnect();
  }, [options.length > 0]);

  function updateScroll(event: UIEvent<HTMLDivElement>) {
    setScrollTop(event.currentTarget.scrollTop);
  }

  function updateSearch(nextSearch: string) {
    setSearch(nextSearch);
    setScrollTop(0);
    scrollAreaRef.current?.scrollTo({ top: 0 });
  }

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <div
          aria-label={iconLabel(value)}
          className="flex size-9 shrink-0 items-center justify-center"
          role="img"
        >
          <ProjectIconGlyph className="size-6" icon={value} />
        </div>
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={searchPlaceholder}
            className="pl-9"
            placeholder={searchPlaceholder}
            type="search"
            value={search}
            onChange={(event) => updateSearch(event.target.value)}
          />
        </div>
      </div>
      {options.length === 0 ? (
        <div className="flex h-60 items-center justify-center rounded-lg border text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div
          aria-label={label}
          className="h-60 overflow-y-auto rounded-lg border bg-muted/20"
          ref={scrollAreaRef}
          onScroll={updateScroll}
        >
          <div
            className="relative"
            style={{ height: `${rowCount * GRID_ROW_HEIGHT + 16}px` }}
          >
            <div
              className="absolute inset-x-0 grid justify-items-center gap-2 px-2"
              style={{
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                transform: `translateY(${firstRow * GRID_ROW_HEIGHT + 8}px)`,
              }}
            >
              {visibleOptions.map((name) => {
                const optionLabel = iconLabel(name);
                return (
                  <Button
                    aria-label={optionLabel}
                    aria-pressed={value === name}
                    key={name}
                    size="icon"
                    title={optionLabel}
                    type="button"
                    variant={value === name ? "secondary" : "ghost"}
                    onClick={() => onValueChange(name)}
                  >
                    <ProjectIconGlyph icon={name} />
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

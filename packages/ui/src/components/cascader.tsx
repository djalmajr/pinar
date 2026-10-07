import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import IconCheck from "~icons/lucide/check";
import IconChevronDown from "~icons/lucide/chevron-down";
import IconChevronRight from "~icons/lucide/chevron-right";
import { cn } from "../lib/utils.js";
import { type CascaderOption, findCascaderPath, isCascaderSelectable, searchCascaderPaths, truncateCascaderPath } from "./cascader-model.js";

export interface CascaderProps {
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  emptyText: string;
  options: CascaderOption[];
  placeholder?: string;
  searchPlaceholder: string;
  separator?: string;
  value: string[] | null;
  onValueChange: (path: string[], selected: CascaderOption[]) => void;
}

export function Cascader({
  "aria-label": ariaLabel,
  className,
  disabled = false,
  emptyText,
  options,
  placeholder,
  searchPlaceholder,
  separator = " / ",
  value,
  onValueChange,
}: CascaderProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [openValues, setOpenValues] = React.useState<string[]>([]);
  const [active, setActive] = React.useState<{ column: number; value: string } | null>(null);
  const [activeResult, setActiveResult] = React.useState<number | null>(null);
  // The active item is painted only while the keyboard drives it; the mouse uses CSS hover.
  const [keyboardNav, setKeyboardNav] = React.useState(false);
  const rootId = React.useId();
  const triggerId = React.useId();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const activeElementRef = React.useRef<HTMLElement | null>(null);

  const searching = search.length > 0;
  const results = searching ? searchCascaderPaths(options, search) : [];
  const selectedPath = findCascaderPath(options, value);

  const openChain = findCascaderPath(options, openValues) ?? [];
  const columns: CascaderOption[][] = [options, ...openChain.map((option) => option.children ?? [])];

  let activePosition: { column: number; index: number; option: CascaderOption } | null = null;
  if (!searching && active) {
    // A stale active (options changed while the popup is open) may point at a column that no longer exists: render as no active item.
    const columnOptions = columns[active.column];
    if (columnOptions) {
      const index = columnOptions.findIndex((option) => option.value === active.value);
      if (index >= 0 && !columnOptions[index].disabled) {
        activePosition = { column: active.column, index, option: columnOptions[index] };
      }
    }
  }

  const activeResultIndex = searching && activeResult !== null && activeResult < results.length ? activeResult : null;

  const activeDescendantId = searching
    ? activeResultIndex !== null
      ? `${rootId}-result-${activeResultIndex}`
      : undefined
    : activePosition
      ? `${rootId}-item-${activePosition.column}-${activePosition.index}`
      : undefined;

  const closePopup = () => {
    setSearch("");
    setOpenValues([]);
    setActive(null);
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const path = findCascaderPath(options, value);
      if (path) {
        setOpenValues(path.filter((option) => option.children?.length).map((option) => option.value));
        setActive({ column: path.length - 1, value: path[path.length - 1].value });
      } else {
        setOpenValues([]);
        const first = options.findIndex((option) => !option.disabled);
        setActive(first >= 0 ? { column: 0, value: options[first].value } : null);
      }
      setActiveResult(null);
      setKeyboardNav(false);
      setOpen(true);
      return;
    }
    closePopup();
  };

  const activateColumnOption = (column: number, index: number) => {
    const option = columns[column][index];
    if (!option || option.disabled) return;
    // Like antd's default expandTrigger="click": hovering or moving with ↑/↓ only
    // highlights; a click, → or Enter opens the children column.
    setActive({ column, value: option.value });
  };

  // Single selection rule for columns and search results: commit the path, then keep the
  // popup open on the new children column for a mid-level node, or close via the normal close path.
  const commitPath = (optionPath: CascaderOption[]) => {
    onValueChange(optionPath.map((option) => option.value), optionPath);
    const last = optionPath[optionPath.length - 1];
    const children = last.children;
    if (children?.length) {
      setSearch("");
      setOpenValues(optionPath.map((option) => option.value));
      const firstChild = children.findIndex((item) => !item.disabled);
      setActive(firstChild >= 0 ? { column: optionPath.length, value: children[firstChild].value } : null);
      return;
    }
    closePopup();
  };

  const chooseColumnOption = (column: number, index: number) => {
    const option = columns[column][index];
    if (!option || option.disabled) return;
    if (isCascaderSelectable(option)) {
      commitPath([...openChain.slice(0, column), option]);
      return;
    }
    // Non-selectable node with children: only open the children column.
    const hasChildren = !!option.children?.length;
    if (hasChildren) {
      setActive({ column, value: option.value });
      setOpenValues([...openChain.slice(0, column).map((item) => item.value), option.value]);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key.startsWith("Arrow")) setKeyboardNav(true);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (searching) {
        if (results.length === 0) return;
        if (activeResultIndex === null) {
          setActiveResult(direction === 1 ? 0 : results.length - 1);
          return;
        }
        const next = activeResultIndex + direction;
        if (next >= 0 && next < results.length) setActiveResult(next);
        return;
      }
      if (!activePosition) {
        if (direction === 1) {
          const first = columns[0].findIndex((option) => !option.disabled);
          if (first >= 0) setActive({ column: 0, value: columns[0][first].value });
        }
        return;
      }
      const columnOptions = columns[activePosition.column];
      let next = activePosition.index + direction;
      while (next >= 0 && next < columnOptions.length && columnOptions[next].disabled) next += direction;
      if (next >= 0 && next < columnOptions.length) activateColumnOption(activePosition.column, next);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      // The search caret needs the horizontal arrows while there is text.
      if (searching) return;
      event.preventDefault();
      if (!activePosition) return;
      if (event.key === "ArrowLeft") {
        if (activePosition.column > 0) {
          setActive({ column: activePosition.column - 1, value: openChain[activePosition.column - 1].value });
        }
        return;
      }
      const option = activePosition.option;
      const children = option.children;
      if (option.disabled || !children?.length) return;
      const parentValues = openChain.slice(0, activePosition.column).map((item) => item.value);
      setOpenValues([...parentValues, option.value]);
      const firstChild = children.findIndex((item) => !item.disabled);
      if (firstChild >= 0) setActive({ column: activePosition.column + 1, value: children[firstChild].value });
      return;
    }
    if (event.key === "Enter") {
      if (searching) {
        if (activeResultIndex !== null) {
          event.preventDefault();
          commitPath(results[activeResultIndex]);
        }
        return;
      }
      if (activePosition) {
        event.preventDefault();
        chooseColumnOption(activePosition.column, activePosition.index);
      }
    }
  };

  React.useEffect(() => {
    if (!open) return;
    activeElementRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open, active, activeResultIndex, openValues, searching]);

  // When options change while the popup is open, cut the open columns to the longest prefix
  // that still exists and drop a stale active whose column is gone.
  React.useEffect(() => {
    const truncated = truncateCascaderPath(options, openValues);
    if (truncated.length !== openValues.length) setOpenValues(truncated);
    const chain = findCascaderPath(options, truncated) ?? [];
    const nextColumns = [options, ...chain.map((option) => option.children ?? [])];
    if (active && !nextColumns[active.column]) setActive(null);
  }, [options]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange} triggerId={triggerId}>
      <PopoverPrimitive.Trigger
        disabled={disabled}
        id={triggerId}
        render={
          <button
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            data-slot="cascader-trigger"
            className={cn(
              "flex h-8 w-fit max-w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
              className,
            )}
          >
            <span className={cn("min-w-0 flex-1 truncate text-left", !selectedPath && "text-muted-foreground")}>
              {selectedPath ? selectedPath.map((option) => option.label).join(separator) : placeholder}
            </span>
            <IconChevronDown className="pointer-events-none size-4 text-muted-foreground" />
          </button>
        }
      />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner align="start" className="isolate z-50" collisionPadding={16} side="bottom" sideOffset={4}>
          <PopoverPrimitive.Popup
            data-slot="cascader-content"
            initialFocus={searchInputRef}
            onKeyDown={handleKeyDown}
            onMouseMove={() => setKeyboardNav(false)}
            className="isolate z-50 flex max-w-(--available-width) flex-col origin-(--transform-origin) overflow-x-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
          >
            <input
              ref={searchInputRef}
              type="search"
              data-slot="cascader-search"
              aria-activedescendant={activeDescendantId}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActiveResult(0);
                setKeyboardNav(true);
              }}
              className="m-2 mb-0 h-8 min-w-0 rounded-md border border-input bg-transparent px-2.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30"
            />
            <div className="flex min-w-0 items-stretch overflow-x-auto">
              {searching ? (
                results.length > 0 ? (
                  <div
                    role="listbox"
                    aria-label={ariaLabel}
                    data-slot="cascader-results"
                    className="min-w-48 max-h-72 shrink-0 overflow-y-auto p-1"
                  >
                    {results.map((optionPath, index) => {
                      const last = optionPath[optionPath.length - 1];
                      const isActive = activeResultIndex === index;
                      const isSelected =
                        value !== null && optionPath.length === value.length && optionPath.every((option, optionIndex) => option.value === value[optionIndex]);
                      return (
                        <div
                          key={index}
                          id={`${rootId}-result-${index}`}
                          role="option"
                          aria-selected={isSelected}
                          ref={isActive ? (element) => {
                            activeElementRef.current = element;
                          } : undefined}
                          onMouseEnter={() => setActiveResult(index)}
                          onClick={() => commitPath(optionPath)}
                          className={cn(
                            "flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-1.5 pl-1.5 text-sm select-none hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                            isSelected && "font-semibold",
                            isActive && keyboardNav && "bg-accent text-accent-foreground",
                          )}
                        >
                          {last.icon != null && <span className="flex shrink-0 items-center">{last.icon}</span>}
                          <span className="min-w-0 flex-1 truncate">{optionPath.map((option) => option.label).join(separator)}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div data-slot="cascader-empty" className="w-full px-3 py-2 text-center text-sm text-muted-foreground">
                    {emptyText}
                  </div>
                )
              ) : options.length > 0 ? (
                <>
                  {columns.map((columnOptions, columnIndex) => (
                    <div
                      key={columnIndex === 0 ? "root" : openChain[columnIndex - 1].value}
                      role="listbox"
                      aria-label={`${ariaLabel} — ${columnIndex + 1}`}
                      data-slot="cascader-column"
                      className={cn("w-max min-w-40 max-w-72 shrink-0 max-h-72 overflow-y-auto p-1", columnIndex > 0 && "border-l")}
                    >
                      {columnOptions.map((option, optionIndex) => {
                        const isSelected = selectedPath?.[columnIndex] === option;
                        const isLastSelected = selectedPath !== null && columnIndex === selectedPath.length - 1 && option === selectedPath[columnIndex];
                        const hasChildren = !!option.children?.length;
                        const isActive = activePosition?.column === columnIndex && activePosition.index === optionIndex;
                        // Like antd: the item whose children fill the next column stays marked.
                        const isExpanded = hasChildren && openChain[columnIndex] === option && columnIndex < openChain.length;
                        return (
                          <div
                            key={option.value}
                            id={`${rootId}-item-${columnIndex}-${optionIndex}`}
                            role="option"
                            aria-selected={isSelected}
                            aria-disabled={option.disabled ? true : undefined}
                            ref={isActive ? (element) => {
                              activeElementRef.current = element;
                            } : undefined}
                            onMouseEnter={() => activateColumnOption(columnIndex, optionIndex)}
                            onClick={() => chooseColumnOption(columnIndex, optionIndex)}
                            className={cn(
                              "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-1.5 pl-1.5 text-sm select-none hover:bg-accent hover:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                              (isSelected || isExpanded) && "font-semibold",
                              isActive && keyboardNav && "bg-accent text-accent-foreground",
                              option.disabled && "pointer-events-none opacity-50",
                            )}
                          >
                            {option.icon != null && <span className="flex shrink-0 items-center">{option.icon}</span>}
                            <span className="min-w-0 flex-1 truncate">{option.label}</span>
                            {isLastSelected && <IconCheck />}
                            {hasChildren && <IconChevronRight className="text-muted-foreground" />}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </>
              ) : (
                <div data-slot="cascader-empty" className="w-full px-3 py-2 text-center text-sm text-muted-foreground">
                  {emptyText}
                </div>
              )}
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

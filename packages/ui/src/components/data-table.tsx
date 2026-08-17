import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type Column,
  type ColumnFiltersState,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type SortingState,
  type VisibilityState,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import ArrowDownIcon from "~icons/lucide/arrow-down";
import ArrowUpIcon from "~icons/lucide/arrow-up";
import ChevronLeftIcon from "~icons/lucide/chevron-left";
import ChevronRightIcon from "~icons/lucide/chevron-right";
import ChevronsUpDownIcon from "~icons/lucide/chevrons-up-down";
import Columns3Icon from "~icons/lucide/columns-3";
import ListFilterIcon from "~icons/lucide/list-filter";
import XIcon from "~icons/lucide/x";
import { cn } from "../lib/utils.js";
import { Badge } from "./badge.js";
import { Button } from "./button.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import { ScrollArea } from "./scroll-area.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table.js";

type DataTableFilterOption = {
  label: string;
  value: string;
};

type ColumnMeta = {
  align?: "center" | "left" | "right";
  filterLabel?: string;
  filterOptions?: DataTableFilterOption[];
  label?: string;
};

type DataTableLabels = {
  clearFilter?: string;
  columns?: string;
  nextPage?: string;
  pageStatus?: (page: number, pageCount: number) => string;
  previousPage?: string;
  resetFilters?: string;
  rowsPerPage?: string;
};

type DataTableProps<TData extends RowData> = ComponentProps<"div"> & {
  columns: ColumnDef<TData>[];
  data: TData[];
  emptyMessage?: string;
  getRowId?: (row: TData) => string;
  initialSorting?: SortingState;
  labels?: DataTableLabels;
  pageSizeOptions?: readonly number[];
  pagination?: PaginationState;
  toolbar?: ReactNode;
  toolbarActions?: ReactNode;
  onPaginationChange?: OnChangeFn<PaginationState>;
  onRowClick?: (row: TData) => void;
};

type PaginationControlsProps = ComponentProps<"div"> & {
  labels?: DataTableLabels;
  pageCount: number;
  pageIndex: number;
  pageSize: number;
  pageSizeOptions?: readonly number[];
  onPageIndexChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

const DEFAULT_PAGE_SIZE_OPTIONS = [15, 30, 60, 100] as const;

function alignmentClass(align: ColumnMeta["align"]) {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

function PaginationControls({
  className,
  labels,
  pageCount,
  pageIndex,
  pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageIndexChange,
  onPageSizeChange,
  ...props
}: PaginationControlsProps) {
  const pageSizeItems = pageSizeOptions.map((option) => ({
    label: String(option),
    value: String(option),
  }));
  const nextPageLabel = labels?.nextPage ?? "Next page";
  const previousPageLabel = labels?.previousPage ?? "Previous page";
  const pageStatus = labels?.pageStatus?.(pageIndex + 1, pageCount)
    ?? `Page ${pageIndex + 1} of ${pageCount}`;

  return (
    <div
      className={cn("flex flex-wrap items-center justify-end gap-3", className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{pageStatus}</span>
        <Button
          aria-label={previousPageLabel}
          disabled={pageIndex === 0}
          size="icon-sm"
          title={previousPageLabel}
          variant="outline"
          onClick={() => onPageIndexChange(pageIndex - 1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          aria-label={nextPageLabel}
          disabled={pageIndex >= pageCount - 1}
          size="icon-sm"
          title={nextPageLabel}
          variant="outline"
          onClick={() => onPageIndexChange(pageIndex + 1)}
        >
          <ChevronRightIcon />
        </Button>
        <Select
          items={pageSizeItems}
          value={String(pageSize)}
          onValueChange={(value) => {
            const nextPageSize = Number(value);
            if (pageSizeOptions.includes(nextPageSize)) onPageSizeChange(nextPageSize);
          }}
        >
          <SelectTrigger
            aria-label={labels?.rowsPerPage ?? "Rows per page"}
            className="w-16"
            size="sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false} className="min-w-16">
            <SelectGroup>
              {pageSizeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function DataTableFacetedFilter<TData extends RowData>({
  column,
  labels,
}: {
  column: Column<TData>;
  labels?: DataTableLabels;
}) {
  const meta = column.columnDef.meta as ColumnMeta | undefined;
  const options = meta?.filterOptions ?? [];
  const selectedValues = new Set((column.getFilterValue() as string[] | undefined) ?? []);
  const filterLabel = meta?.filterLabel ?? meta?.label ?? column.id;

  function toggleValue(value: string) {
    const nextValues = new Set(selectedValues);
    if (nextValues.has(value)) nextValues.delete(value);
    else nextValues.add(value);
    column.setFilterValue(nextValues.size > 0 ? Array.from(nextValues) : undefined);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button className="border-dashed font-normal" size="default" variant="outline" />
        }
      >
        <ListFilterIcon data-icon="inline-start" />
        {filterLabel}
        {selectedValues.size > 0 ? (
          <Badge className="rounded-md px-1 font-normal" variant="secondary">
            {selectedValues.size}
          </Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{filterLabel}</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              checked={selectedValues.has(option.value)}
              key={option.value}
              onClick={() => toggleValue(option.value)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {selectedValues.size > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => column.setFilterValue(undefined)}>
                <XIcon />
                {labels?.clearFilter ?? "Clear filter"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DataTableViewOptions<TData extends RowData>({
  columns,
  labels,
}: {
  columns: Column<TData>[];
  labels?: DataTableLabels;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button aria-label={labels?.columns ?? "Columns"} variant="outline" />}
      >
        <Columns3Icon data-icon="inline-start" />
        {labels?.columns ?? "Columns"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{labels?.columns ?? "Columns"}</DropdownMenuLabel>
          {columns.map((column) => {
            const meta = column.columnDef.meta as ColumnMeta | undefined;
            return (
              <DropdownMenuCheckboxItem
                checked={column.getIsVisible()}
                key={column.id}
                onClick={() => column.toggleVisibility(!column.getIsVisible())}
              >
                {meta?.label ?? column.id}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DataTable<TData extends RowData>({
  className,
  columns,
  data,
  emptyMessage = "No results.",
  getRowId,
  initialSorting = [],
  labels,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  pagination: controlledPagination,
  toolbar,
  toolbarActions,
  onPaginationChange,
  onRowClick,
  ...props
}: DataTableProps<TData>) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [internalPagination, setInternalPagination] = useState<PaginationState>(() => ({
    pageIndex: 0,
    pageSize: pageSizeOptions[0] ?? DEFAULT_PAGE_SIZE_OPTIONS[0],
  }));
  const [sorting, setSorting] = useState<SortingState>(() => initialSorting);
  const pagination = controlledPagination ?? internalPagination;
  const updatePagination = onPaginationChange ?? setInternalPagination;
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: updatePagination,
    onSortingChange: setSorting,
    state: { columnFilters, columnVisibility, pagination, sorting },
  });
  const filterableColumns = useMemo(
    () =>
      table.getAllColumns().filter((column) => {
        const meta = column.columnDef.meta as ColumnMeta | undefined;
        return column.getCanFilter() && Boolean(meta?.filterOptions?.length);
      }),
    [table],
  );
  const hideableColumns = table.getAllColumns().filter((column) => column.getCanHide());
  const hasFilters = table.getState().columnFilters.length > 0;
  const visibleColumnCount = table.getVisibleFlatColumns().length;

  return (
    <div className={cn("flex w-full flex-col gap-2.5 overflow-hidden", className)} {...props}>
      <div
        aria-orientation="horizontal"
        className="flex min-w-0 flex-row items-center gap-2 overflow-x-auto"
        role="toolbar"
      >
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
          {toolbar}
          {filterableColumns.map((column) => (
            <DataTableFacetedFilter column={column} key={column.id} labels={labels} />
          ))}
          {hasFilters ? (
            <Button
              className="border-dashed font-normal"
              variant="outline"
              onClick={() => table.resetColumnFilters()}
            >
              <XIcon data-icon="inline-start" />
              {labels?.resetFilters ?? "Reset"}
            </Button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 sm:ml-auto">
          {hideableColumns.length > 0 ? (
            <DataTableViewOptions columns={hideableColumns} labels={labels} />
          ) : null}
          {toolbarActions}
        </div>
      </div>
      <div className="w-full overflow-hidden rounded-lg border bg-background">
        <ScrollArea className="w-full">
          <Table className="min-w-[760px] table-fixed">
            <TableHeader className="sticky top-0 z-10 bg-background">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const align = (header.column.columnDef.meta as ColumnMeta | undefined)?.align;
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        className={cn("h-9", alignmentClass(align))}
                        colSpan={header.colSpan}
                        key={header.id}
                        style={header.column.columnDef.size ? { width: header.column.columnDef.size } : undefined}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            className={cn(
                              "inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 font-medium hover:bg-muted",
                              align === "right" && "ml-auto",
                              align === "center" && "mx-auto",
                            )}
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sorted === "asc" ? (
                              <ArrowUpIcon />
                            ) : sorted === "desc" ? (
                              <ArrowDownIcon />
                            ) : (
                              <ChevronsUpDownIcon className="text-muted-foreground" />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    className={cn(onRowClick && "cursor-pointer")}
                    key={row.id}
                    onClick={(event) => {
                      if (!onRowClick) return;
                      const target = event.target as HTMLElement;
                      if (!target.closest("a, button, input, [role=button], [role=menuitem], [data-no-row-click]")) {
                        onRowClick(row.original);
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const align = (cell.column.columnDef.meta as ColumnMeta | undefined)?.align;
                      return (
                        <TableCell
                          className={alignmentClass(align)}
                          key={cell.id}
                          style={cell.column.columnDef.size ? { width: cell.column.columnDef.size } : undefined}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={visibleColumnCount}>
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
      {table.getFilteredRowModel().rows.length > 0 ? (
        <PaginationControls
          labels={labels}
          pageCount={table.getPageCount()}
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          pageSizeOptions={pageSizeOptions}
          onPageIndexChange={table.setPageIndex}
          onPageSizeChange={table.setPageSize}
        />
      ) : null}
    </div>
  );
}

export {
  DataTable,
  PaginationControls,
  type DataTableFilterOption,
  type DataTableLabels,
  type DataTableProps,
  type ColumnDef,
  type PaginationControlsProps,
  type PaginationState,
  type SortingState,
};

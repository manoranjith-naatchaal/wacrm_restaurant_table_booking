"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  ChevronDown,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { SortDir } from "@/hooks/use-table-sort";
import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SortableHeadProps {
  label: string;
  /** This column's sort key. */
  columnKey: string;
  /** Currently-active sort key + direction (from useTableSort). */
  sortKey: string;
  sortDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}

/** A `TableHead` whose label is a button that toggles column sort. */
export function SortableHead({
  label,
  columnKey,
  sortKey,
  sortDir,
  onSort,
  className,
}: SortableHeadProps) {
  const active = sortKey === columnKey;
  const Icon = !active ? ChevronsUpDown : sortDir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        aria-label={`Sort by ${label}`}
        className={cn(
          "hover:text-foreground -mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon
          className={cn("size-3.5", active ? "opacity-100" : "opacity-50")}
        />
      </button>
    </TableHead>
  );
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

interface DataTablePaginationProps {
  /** Zero-based current page. */
  page: number;
  pageCount: number;
  pageSize: number;
  /** Total rows across all pages (post-filter). */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}

/** Shared table footer: rows-per-page, range readout, and pager. */
export function DataTablePagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
}: DataTablePaginationProps) {
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(page * pageSize + pageSize, total);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <span className="hidden sm:inline">Rows per page</span>
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v ?? pageSize))}
        >
          <SelectTrigger size="sm" className="w-18">
            <SelectValue>{(v) => String(v ?? pageSize)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((opt) => (
              <SelectItem key={opt} value={String(opt)}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>
          {start}–{end} of {total}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onPageChange(Math.max(0, page - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="text-muted-foreground text-sm">
          Page {page + 1} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useState } from "react";

export type SortDir = "asc" | "desc";

export interface SortState<K extends string = string> {
  key: K;
  dir: SortDir;
}

/**
 * Client-side column sort state for the data tables. Clicking the
 * active column flips direction; clicking a new column sorts it
 * ascending. Pair with `compareValues` + a per-column accessor.
 */
export function useTableSort<K extends string = string>(
  initialKey: K,
  initialDir: SortDir = "asc",
) {
  const [sort, setSort] = useState<SortState<K>>({
    key: initialKey,
    dir: initialDir,
  });

  const toggleSort = useCallback((key: K) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }, []);

  return { sortKey: sort.key, sortDir: sort.dir, toggleSort };
}

/**
 * Stable comparator for mixed primitive cell values. Empties
 * (null/undefined/"") sort last; numbers compare numerically;
 * everything else uses a locale, numeric-aware string compare.
 * Direction is applied by the caller.
 */
export function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b ? 0 : a ? -1 : 1;
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

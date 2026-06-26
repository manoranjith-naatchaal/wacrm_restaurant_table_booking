// ============================================================
// Availability resolver (pure, no I/O).
//
// Resolves the bookable time windows for a single calendar date by
// layering the recurring weekly slots with date-specific exceptions:
//
//   1. Base    = active booking_slots for the date's weekday.
//   2. + add   = every `open_special` exception window.
//   3. - block = every `closed_time` exception window.
//   4. closed-all-day wins → if any `closed_all_day` covers the date,
//      the result is empty regardless of everything else.
//
// All interval math runs in minutes-since-midnight. Times come from
// the DB as "HH:MM" or "HH:MM:SS"; both are accepted.
// ============================================================

export interface SlotLike {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface ExceptionLike {
  kind: 'closed_all_day' | 'closed_time' | 'open_special';
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
}

/** A bookable window, "HH:MM"–"HH:MM". */
export interface Interval {
  start: string;
  end: string;
}

export interface DayAvailability {
  /** True when the date is fully closed (no bookable windows). */
  closed: boolean;
  /** Merged, sorted open windows. Empty when closed. */
  windows: Interval[];
}

interface MinInterval {
  start: number;
  end: number;
}

function toMin(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 0 = Sunday … 6 = Saturday for an ISO "YYYY-MM-DD" (local). */
export function weekdayOf(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function covers(ex: ExceptionLike, dateIso: string): boolean {
  return ex.start_date <= dateIso && ex.end_date >= dateIso;
}

/** Merge overlapping/adjacent intervals into a sorted, disjoint set. */
function merge(intervals: MinInterval[]): MinInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: MinInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Subtract a single blocked interval from a set of open intervals. */
function subtractOne(open: MinInterval[], block: MinInterval): MinInterval[] {
  const out: MinInterval[] = [];
  for (const cur of open) {
    // No overlap → keep as-is.
    if (block.end <= cur.start || block.start >= cur.end) {
      out.push(cur);
      continue;
    }
    // Left remainder.
    if (block.start > cur.start) {
      out.push({ start: cur.start, end: block.start });
    }
    // Right remainder.
    if (block.end < cur.end) {
      out.push({ start: block.end, end: cur.end });
    }
  }
  return out;
}

export function getOpenWindowsForDate(
  dateIso: string,
  slots: SlotLike[],
  exceptions: ExceptionLike[]
): DayAvailability {
  const onDate = exceptions.filter((e) => covers(e, dateIso));

  // Closed-all-day wins outright.
  if (onDate.some((e) => e.kind === 'closed_all_day')) {
    return { closed: true, windows: [] };
  }

  const weekday = weekdayOf(dateIso);

  const base: MinInterval[] = slots
    .filter((s) => s.is_active && s.day_of_week === weekday)
    .map((s) => ({ start: toMin(s.start_time), end: toMin(s.end_time) }));

  const special: MinInterval[] = onDate
    .filter((e) => e.kind === 'open_special' && e.start_time && e.end_time)
    .map((e) => ({
      start: toMin(e.start_time as string),
      end: toMin(e.end_time as string),
    }));

  let open = merge([...base, ...special]);

  const blocks: MinInterval[] = onDate
    .filter((e) => e.kind === 'closed_time' && e.start_time && e.end_time)
    .map((e) => ({
      start: toMin(e.start_time as string),
      end: toMin(e.end_time as string),
    }));

  for (const block of blocks) {
    open = subtractOne(open, block);
  }

  const windows = open
    .filter((i) => i.end > i.start)
    .map((i) => ({ start: toHHMM(i.start), end: toHHMM(i.end) }));

  return { closed: windows.length === 0, windows };
}

/**
 * True iff a booking starting at `startTime` falls inside an open
 * window for the date. The start must be >= a window start and
 * strictly < its end (you can't start a booking at closing time).
 */
export function isStartTimeAvailable(
  dateIso: string,
  startTime: string,
  slots: SlotLike[],
  exceptions: ExceptionLike[]
): boolean {
  const { windows } = getOpenWindowsForDate(dateIso, slots, exceptions);
  const t = toMin(startTime);
  return windows.some((w) => t >= toMin(w.start) && t < toMin(w.end));
}

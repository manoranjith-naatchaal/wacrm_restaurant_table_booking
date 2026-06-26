'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarX2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import type { BookingException, BookingExceptionKind } from '@/types';
import { useCan } from '@/hooks/use-can';
import { compareValues, useTableSort } from '@/hooks/use-table-sort';
import { Button } from '@/components/ui/button';
import {
  DataTablePagination,
  SortableHead,
} from '@/components/ui/data-table';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type KindFilter = 'all' | BookingExceptionKind;
type ScopeFilter = 'upcoming' | 'past' | 'all';
type SortKey = 'date' | 'type' | 'reason';

const KIND_META: Record<
  BookingExceptionKind,
  { label: string; className: string; timed: boolean }
> = {
  closed_all_day: {
    label: 'Closed all day',
    className: 'border-red-600/40 bg-red-500/10 text-red-300',
    timed: false,
  },
  closed_time: {
    label: 'Closed (time)',
    className: 'border-amber-600/40 bg-amber-500/10 text-amber-300',
    timed: true,
  },
  open_special: {
    label: 'Special open',
    className: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300',
    timed: true,
  },
};

interface FormState {
  kind: BookingExceptionKind;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  reason: string;
}

const EMPTY_FORM: FormState = {
  kind: 'closed_all_day',
  start_date: '',
  end_date: '',
  start_time: '12:00',
  end_time: '14:00',
  reason: '',
};

/** Local today as "YYYY-MM-DD" (no UTC drift). */
function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "2026-06-20" → "Jun 20, 2026" (parsed as local, no TZ shift). */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateRange(start: string, end: string): string {
  return start === end
    ? formatDate(start)
    : `${formatDate(start)} – ${formatDate(end)}`;
}

/** "13:00" or "13:00:00" → "1:00 PM". */
function formatTime(value: string | null): string {
  if (!value) return '';
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return value;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export default function ExceptionsPage() {
  const canEdit = useCan('edit-settings');
  const [rows, setRows] = useState<BookingException[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('upcoming');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const { sortKey, sortDir, toggleSort } = useTableSort<SortKey>('date');

  const handleSort = useCallback(
    (key: string) => {
      toggleSort(key as SortKey);
      setPage(0);
    },
    [toggleSort]
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BookingException | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<BookingException | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/exceptions');
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const json = (await res.json()) as { exceptions: BookingException[] };
      setRows(json.exceptions ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't load closures.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayIso();
    return rows.filter((r) => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      if (scopeFilter === 'upcoming' && r.end_date < today) return false;
      if (scopeFilter === 'past' && r.end_date >= today) return false;
      if (!q) return true;
      return (
        (r.reason ?? '').toLowerCase().includes(q) ||
        r.start_date.includes(q) ||
        r.end_date.includes(q) ||
        KIND_META[r.kind].label.toLowerCase().includes(q)
      );
    });
  }, [rows, search, kindFilter, scopeFilter]);

  const sorted = useMemo(() => {
    const getValue = (r: BookingException) => {
      switch (sortKey) {
        case 'type':
          return KIND_META[r.kind].label;
        case 'reason':
          return r.reason;
        default:
          return r.start_date;
      }
    };
    return [...filtered].sort((a, b) => {
      const r = compareValues(getValue(a), getValue(b));
      return sortDir === 'asc' ? r : -r;
    });
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageItems = sorted.slice(
    clampedPage * pageSize,
    clampedPage * pageSize + pageSize
  );

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, start_date: todayIso() });
    setDialogOpen(true);
  }

  function openEdit(row: BookingException) {
    setEditing(row);
    setForm({
      kind: row.kind,
      start_date: row.start_date,
      end_date: row.end_date === row.start_date ? '' : row.end_date,
      start_time: row.start_time?.slice(0, 5) ?? '12:00',
      end_time: row.end_time?.slice(0, 5) ?? '14:00',
      reason: row.reason ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.start_date) {
      toast.error('Pick a start date.');
      return;
    }
    const endDate = form.end_date || form.start_date;
    if (endDate < form.start_date) {
      toast.error("End date can't be before the start date.");
      return;
    }
    const timed = KIND_META[form.kind].timed;
    if (timed && form.end_time <= form.start_time) {
      toast.error('End time must be after start time.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        kind: form.kind,
        start_date: form.start_date,
        end_date: endDate,
        start_time: timed ? form.start_time : null,
        end_time: timed ? form.end_time : null,
        reason: form.reason.trim() || null,
      };
      const res = await fetch(
        editing ? `/api/exceptions/${editing.id}` : '/api/exceptions',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Save failed: ${res.status}`);
      }
      setDialogOpen(false);
      toast.success(editing ? 'Exception updated.' : 'Exception added.');
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/exceptions/${pendingDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed: ${res.status}`);
      }
      setRows((prev) => prev.filter((r) => r.id !== pendingDelete.id));
      toast.success('Exception deleted.');
      setPendingDelete(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't delete.";
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  const isTimed = KIND_META[form.kind].timed;

  // Other exceptions whose date range intersects the one being edited.
  // Date-range overlap only — informational; a full conflict resolution
  // (time-window math, "closed wins") happens later in Reservations.
  const overlapping = useMemo(() => {
    if (!form.start_date) return [];
    const end = form.end_date || form.start_date;
    if (end < form.start_date) return [];
    return rows.filter(
      (r) =>
        r.id !== editing?.id &&
        r.start_date <= end &&
        r.end_date >= form.start_date
    );
  }, [rows, form.start_date, form.end_date, editing]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarX2 className="text-primary h-5 w-5" />
            <h1 className="text-foreground text-2xl font-semibold">
              Special Hours
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            One-off changes to your weekly schedule — holidays, partial
            closures, or special opening hours. These override your slots.
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="manage closures"
          onClick={openCreate}
        >
          <Plus className="h-4 w-4" />
          Add exception
        </GatedButton>
      </header>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState canEdit={canEdit} onCreate={openCreate} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search by reason or date..."
                className="bg-card pl-8"
              />
            </div>
            <Select
              value={kindFilter}
              onValueChange={(v) => {
                setKindFilter((v as KindFilter) ?? 'all');
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue>
                  {(v) =>
                    v == null || v === 'all'
                      ? 'All types'
                      : KIND_META[v as BookingExceptionKind].label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="closed_all_day">Closed all day</SelectItem>
                <SelectItem value="closed_time">Closed (time)</SelectItem>
                <SelectItem value="open_special">Special open</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={scopeFilter}
              onValueChange={(v) => {
                setScopeFilter((v as ScopeFilter) ?? 'upcoming');
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue>
                  {(v) =>
                    v === 'past'
                      ? 'Past'
                      : v === 'all'
                        ? 'All dates'
                        : 'Upcoming'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="past">Past</SelectItem>
                <SelectItem value="all">All dates</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
              No exceptions match your search or filters.
            </div>
          ) : (
            <>
              <div className="border-border rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead
                        label="Date(s)"
                        columnKey="date"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHead
                        label="Type"
                        columnKey="type"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <TableHead>Time</TableHead>
                      <SortableHead
                        label="Reason"
                        columnKey="reason"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((row) => {
                      const meta = KIND_META[row.kind];
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="text-foreground font-medium whitespace-nowrap">
                            {formatDateRange(row.start_date, row.end_date)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={meta.className}>
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {meta.timed
                              ? `${formatTime(row.start_time)} – ${formatTime(row.end_time)}`
                              : 'All day'}
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[16rem] truncate">
                            {row.reason || '—'}
                          </TableCell>
                          <TableCell>
                            {canEdit && (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label="Actions"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  }
                                />
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => openEdit(row)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => setPendingDelete(row)}
                                    className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {sorted.length > 0 && (
                <DataTablePagination
                  page={clampedPage}
                  pageCount={pageCount}
                  pageSize={pageSize}
                  total={sorted.length}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(0);
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit exception' : 'Add exception'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Override your weekly schedule for specific dates.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="exc-kind">Type</Label>
              <Select
                value={form.kind}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    kind: (v as BookingExceptionKind) ?? f.kind,
                  }))
                }
              >
                <SelectTrigger id="exc-kind" className="bg-muted w-full">
                  <SelectValue>
                    {(v) =>
                      v == null
                        ? 'Select a type'
                        : KIND_META[v as BookingExceptionKind].label
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="closed_all_day">Closed all day</SelectItem>
                  <SelectItem value="closed_time">
                    Closed for a time window
                  </SelectItem>
                  <SelectItem value="open_special">
                    Special opening hours
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="exc-start-date">Start date</Label>
                <Input
                  id="exc-start-date"
                  type="date"
                  value={form.start_date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, start_date: e.target.value }))
                  }
                  className="bg-muted"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exc-end-date">
                  End date
                  <span className="text-muted-foreground text-xs font-normal">
                    optional
                  </span>
                </Label>
                <Input
                  id="exc-end-date"
                  type="date"
                  value={form.end_date}
                  min={form.start_date || undefined}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, end_date: e.target.value }))
                  }
                  className="bg-muted"
                />
              </div>
            </div>

            {isTimed && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="exc-start-time">Start time</Label>
                  <Input
                    id="exc-start-time"
                    type="time"
                    value={form.start_time}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, start_time: e.target.value }))
                    }
                    className="bg-muted"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="exc-end-time">End time</Label>
                  <Input
                    id="exc-end-time"
                    type="time"
                    value={form.end_time}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, end_time: e.target.value }))
                    }
                    className="bg-muted"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="exc-reason">
                Reason
                <span className="text-muted-foreground text-xs font-normal">
                  optional
                </span>
              </Label>
              <Input
                id="exc-reason"
                value={form.reason}
                onChange={(e) =>
                  setForm((f) => ({ ...f, reason: e.target.value }))
                }
                placeholder="e.g. Public holiday, Staff training"
                className="bg-muted"
              />
            </div>

            {overlapping.length > 0 && (
              <div className="flex gap-2 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium">
                    Overlaps {overlapping.length} existing exception
                    {overlapping.length === 1 ? '' : 's'}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-amber-200/80">
                    {overlapping.slice(0, 3).map((r) => (
                      <li key={r.id} className="truncate">
                        {KIND_META[r.kind].label} ·{' '}
                        {formatDateRange(r.start_date, r.end_date)}
                      </li>
                    ))}
                    {overlapping.length > 3 && (
                      <li>+{overlapping.length - 3} more</li>
                    )}
                  </ul>
                  <p className="mt-1 text-xs text-amber-200/70">
                    Both will still apply — a full-day closure wins over
                    everything else. You can save anyway.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Save changes' : 'Add exception'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete exception?"
        description={
          pendingDelete
            ? `This removes the ${KIND_META[pendingDelete.kind].label.toLowerCase()} on ${formatDateRange(
                pendingDelete.start_date,
                pendingDelete.end_date
              )}. Your weekly schedule applies again. This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function EmptyState({
  canEdit,
  onCreate,
}: {
  canEdit: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="border-border bg-card/50 flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      <div className="bg-muted flex h-14 w-14 items-center justify-center rounded-full">
        <CalendarX2 className="text-muted-foreground h-6 w-6" />
      </div>
      <h2 className="text-foreground mt-4 text-base font-medium">
        No exceptions yet
      </h2>
      <p className="text-muted-foreground mt-1 max-w-md text-sm">
        Your weekly slots run as configured. Add an exception to close for a
        holiday, block part of a day, or open with special hours.
      </p>
      <GatedButton
        canAct={canEdit}
        gateReason="manage closures"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        Add your first exception
      </GatedButton>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Clock,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import type { BookingSlot } from '@/types';
import { useCan } from '@/hooks/use-can';
import { compareValues, useTableSort } from '@/hooks/use-table-sort';
import { DAY_NAMES } from '@/lib/slots/validate';
import { Button } from '@/components/ui/button';
import {
  DataTablePagination,
  SortableHead,
} from '@/components/ui/data-table';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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

type StatusFilter = 'all' | 'active' | 'inactive';

type SortKey = 'day' | 'time' | 'status';

interface FormState {
  day_of_week: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  day_of_week: '1',
  start_time: '19:00',
  end_time: '21:00',
  is_active: true,
};

/** "19:00" or "19:00:00" → "7:00 PM". */
function formatTime(value: string): string {
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return value;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export default function SlotsPage() {
  const canEdit = useCan('edit-settings');
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const { sortKey, sortDir, toggleSort } = useTableSort<SortKey>('day');

  const handleSort = useCallback(
    (key: string) => {
      toggleSort(key as SortKey);
      setPage(0);
    },
    [toggleSort]
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BookingSlot | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<BookingSlot | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/slots');
      if (!res.ok) throw new Error(`Failed to load slots: ${res.status}`);
      const json = (await res.json()) as { slots: BookingSlot[] };
      setSlots(json.slots ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't load slots.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return slots.filter((s) => {
      if (dayFilter !== 'all' && s.day_of_week !== Number(dayFilter))
        return false;
      if (statusFilter === 'active' && !s.is_active) return false;
      if (statusFilter === 'inactive' && s.is_active) return false;
      if (!q) return true;
      const dayName = DAY_NAMES[s.day_of_week]?.toLowerCase() ?? '';
      return (
        dayName.includes(q) ||
        s.start_time.includes(q) ||
        s.end_time.includes(q)
      );
    });
  }, [slots, search, dayFilter, statusFilter]);

  const sorted = useMemo(() => {
    const getValue = (s: BookingSlot) => {
      switch (sortKey) {
        case 'time':
          return s.start_time;
        case 'status':
          return s.is_active;
        default:
          return s.day_of_week;
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
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(slot: BookingSlot) {
    setEditing(slot);
    setForm({
      day_of_week: String(slot.day_of_week),
      start_time: slot.start_time.slice(0, 5),
      end_time: slot.end_time.slice(0, 5),
      is_active: slot.is_active,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (form.end_time <= form.start_time) {
      toast.error('End time must be after start time.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        day_of_week: Number(form.day_of_week),
        start_time: form.start_time,
        end_time: form.end_time,
        is_active: form.is_active,
      };
      const res = await fetch(
        editing ? `/api/slots/${editing.id}` : '/api/slots',
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
      toast.success(editing ? 'Slot updated.' : 'Slot added.');
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save slot.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/slots/${pendingDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed: ${res.status}`);
      }
      setSlots((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      toast.success('Slot deleted.');
      setPendingDelete(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't delete slot.";
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="text-primary h-5 w-5" />
            <h1 className="text-foreground text-2xl font-semibold">
              Slots &amp; Timings
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Configure bookable time windows per weekday. Reservations are booked
            against these.
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="manage slots"
          onClick={openCreate}
        >
          <Plus className="h-4 w-4" />
          Add slot
        </GatedButton>
      </header>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : slots.length === 0 ? (
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
                placeholder="Search by day or time..."
                className="bg-card pl-8"
              />
            </div>
            <Select
              value={dayFilter}
              onValueChange={(v) => {
                setDayFilter(v ?? 'all');
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue>
                  {(v) =>
                    v == null || v === 'all' ? 'All days' : DAY_NAMES[Number(v)]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All days</SelectItem>
                {DAY_NAMES.map((name, idx) => (
                  <SelectItem key={name} value={String(idx)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as StatusFilter);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue>
                  {(v) =>
                    v === 'active'
                      ? 'Active'
                      : v === 'inactive'
                        ? 'Inactive'
                        : 'All statuses'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
              No slots match your search or filters.
            </div>
          ) : (
            <>
              <div className="border-border rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead
                        label="Day"
                        columnKey="day"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHead
                        label="Time"
                        columnKey="time"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHead
                        label="Status"
                        columnKey="status"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((slot) => (
                      <TableRow key={slot.id}>
                        <TableCell className="text-foreground font-medium">
                          {DAY_NAMES[slot.day_of_week]}
                        </TableCell>
                        <TableCell>
                          {formatTime(slot.start_time)} –{' '}
                          {formatTime(slot.end_time)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={slot.is_active ? 'default' : 'outline'}
                            className={
                              slot.is_active
                                ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
                                : 'text-muted-foreground'
                            }
                          >
                            {slot.is_active ? 'Active' : 'Inactive'}
                          </Badge>
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
                                  onClick={() => openEdit(slot)}
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setPendingDelete(slot)}
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
                    ))}
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
            <DialogTitle>{editing ? 'Edit slot' : 'Add slot'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editing
                ? 'Update this bookable time slot.'
                : 'Add a bookable time slot for a weekday.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="slot-day">Day of week</Label>
              <Select
                value={form.day_of_week}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, day_of_week: v ?? f.day_of_week }))
                }
              >
                <SelectTrigger id="slot-day" className="bg-muted w-full">
                  <SelectValue>
                    {(v) => (v == null ? 'Select a day' : DAY_NAMES[Number(v)])}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DAY_NAMES.map((name, idx) => (
                    <SelectItem key={name} value={String(idx)}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="slot-start">Start time</Label>
                <Input
                  id="slot-start"
                  type="time"
                  value={form.start_time}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, start_time: e.target.value }))
                  }
                  className="bg-muted"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slot-end">End time</Label>
                <Input
                  id="slot-end"
                  type="time"
                  value={form.end_time}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, end_time: e.target.value }))
                  }
                  className="bg-muted"
                />
              </div>
            </div>

            <div className="border-border flex items-center justify-between rounded-lg border px-3 py-2.5">
              <Label htmlFor="slot-active" className="cursor-pointer">
                Active
                <span className="text-muted-foreground text-xs font-normal">
                  Open for new reservations
                </span>
              </Label>
              <Switch
                id="slot-active"
                checked={form.is_active}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, is_active: checked }))
                }
              />
            </div>
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
              {editing ? 'Save changes' : 'Add slot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete slot?"
        description={
          pendingDelete
            ? `This removes the ${DAY_NAMES[pendingDelete.day_of_week]} ${formatTime(
                pendingDelete.start_time
              )} slot. This can't be undone.`
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
        <Clock className="text-muted-foreground h-6 w-6" />
      </div>
      <h2 className="text-foreground mt-4 text-base font-medium">
        No slots yet
      </h2>
      <p className="text-muted-foreground mt-1 max-w-md text-sm">
        Define when guests can book — a weekday and a time window.
      </p>
      <GatedButton
        canAct={canEdit}
        gateReason="manage slots"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        Add your first slot
      </GatedButton>
    </div>
  );
}

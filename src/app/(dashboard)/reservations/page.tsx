'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarCheck,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react';

import type { ReservationStatus, ReservationWithRelations } from '@/types';
import { useCan } from '@/hooks/use-can';
import { compareValues, useTableSort } from '@/hooks/use-table-sort';
import { Button } from '@/components/ui/button';
import {
  DataTablePagination,
  SortableHead,
} from '@/components/ui/data-table';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ReservationFormDialog } from '@/components/reservations/reservation-form-dialog';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Scope = 'upcoming' | 'past' | 'all';
type StatusFilter = 'all' | ReservationStatus;
type SortKey = 'guest' | 'date' | 'party' | 'table' | 'status';

const STATUS_META: Record<
  ReservationStatus,
  { label: string; className: string }
> = {
  pending: {
    label: 'Pending',
    className: 'border-amber-600/40 bg-amber-500/10 text-amber-300',
  },
  confirmed: {
    label: 'Confirmed',
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  seated: {
    label: 'Seated',
    className: 'border-sky-600/40 bg-sky-500/10 text-sky-300',
  },
  completed: {
    label: 'Completed',
    className: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'border-border bg-muted text-muted-foreground',
  },
  no_show: {
    label: 'No-show',
    className: 'border-red-600/40 bg-red-500/10 text-red-300',
  },
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return value;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export default function ReservationsPage() {
  const canEdit = useCan('send-messages');
  const [reservations, setReservations] = useState<ReservationWithRelations[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  const [scope, setScope] = useState<Scope>('upcoming');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
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
  const [editing, setEditing] = useState<ReservationWithRelations | null>(null);

  const [pendingDelete, setPendingDelete] =
    useState<ReservationWithRelations | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (s: Scope) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reservations?scope=${s}`);
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const json = (await res.json()) as {
        reservations: ReservationWithRelations[];
      };
      setReservations(json.reservations ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't load reservations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reservations.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (r.guest?.name ?? '').toLowerCase().includes(q) ||
        (r.guest?.phone ?? '').toLowerCase().includes(q) ||
        (r.table?.label ?? '').toLowerCase().includes(q)
      );
    });
  }, [reservations, search, statusFilter]);

  const sorted = useMemo(() => {
    const getValue = (r: ReservationWithRelations) => {
      switch (sortKey) {
        case 'guest':
          return r.guest?.name;
        case 'party':
          return r.party_size;
        case 'table':
          return r.table?.label;
        case 'status':
          return STATUS_META[r.status].label;
        default:
          return `${r.reservation_date} ${r.start_time ?? ''}`;
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
    setDialogOpen(true);
  }

  function openEdit(r: ReservationWithRelations) {
    setEditing(r);
    setDialogOpen(true);
  }

  function handleSaved() {
    // Re-fetch so the row lands in the right scope/order.
    void load(scope);
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/reservations/${pendingDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed: ${res.status}`);
      }
      setReservations((prev) => prev.filter((r) => r.id !== pendingDelete.id));
      toast.success('Reservation deleted.');
      setPendingDelete(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't delete.";
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
            <CalendarCheck className="text-primary h-5 w-5" />
            <h1 className="text-foreground text-2xl font-semibold">
              Reservations
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Book guests in and manage the service. Times are checked against
            your open hours and table capacity.
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="manage reservations"
          onClick={openCreate}
        >
          <Plus className="h-4 w-4" />
          New reservation
        </GatedButton>
      </header>

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
              placeholder="Search by guest, phone, or table..."
              className="bg-card pl-8"
            />
          </div>
          <Select
            value={scope}
            onValueChange={(v) => {
              setScope((v as Scope) ?? 'upcoming');
              setPage(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue>
                {(v) =>
                  v === 'past' ? 'Past' : v === 'all' ? 'All dates' : 'Upcoming'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="past">Past</SelectItem>
              <SelectItem value="all">All dates</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter((v as StatusFilter) ?? 'all');
              setPage(0);
            }}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue>
                {(v) =>
                  v == null || v === 'all'
                    ? 'All statuses'
                    : STATUS_META[v as ReservationStatus].label
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(STATUS_META) as ReservationStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_META[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        ) : reservations.length === 0 ? (
          <EmptyState scope={scope} canEdit={canEdit} onCreate={openCreate} />
        ) : filtered.length === 0 ? (
          <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
            No reservations match your search or filters.
          </div>
        ) : (
          <>
            <div className="border-border rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      label="Guest"
                      columnKey="guest"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHead
                      label="Date"
                      columnKey="date"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <TableHead>Time</TableHead>
                    <SortableHead
                      label="Party"
                      columnKey="party"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHead
                      label="Table"
                      columnKey="table"
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
                  {pageItems.map((r) => {
                    const meta = STATUS_META[r.status];
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          <span className="text-foreground inline-flex items-center gap-1.5">
                            {r.guest?.is_vip && (
                              <Star
                                className="size-3.5 shrink-0 fill-amber-400 text-amber-400"
                                aria-label="VIP"
                              />
                            )}
                            <span className="truncate">
                              {r.guest?.name ?? 'Unknown guest'}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(r.reservation_date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatTime(r.start_time)}
                        </TableCell>
                        <TableCell>{r.party_size}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.table?.label ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={meta.className}>
                            {meta.label}
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
                                <DropdownMenuItem onClick={() => openEdit(r)}>
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setPendingDelete(r)}
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

      <ReservationFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reservation={editing}
        onSaved={handleSaved}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete reservation?"
        description={
          pendingDelete
            ? `This permanently deletes ${pendingDelete.guest?.name ?? 'this guest'}'s booking on ${formatDate(pendingDelete.reservation_date)}. To keep history, set the status to Cancelled instead. This can't be undone.`
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
  scope,
  canEdit,
  onCreate,
}: {
  scope: Scope;
  canEdit: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="border-border bg-card/50 flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      <div className="bg-muted flex h-14 w-14 items-center justify-center rounded-full">
        <CalendarCheck className="text-muted-foreground h-6 w-6" />
      </div>
      <h2 className="text-foreground mt-4 text-base font-medium">
        {scope === 'upcoming'
          ? 'No upcoming reservations'
          : scope === 'past'
            ? 'No past reservations'
            : 'No reservations yet'}
      </h2>
      <p className="text-muted-foreground mt-1 max-w-md text-sm">
        Book a guest in — pick a date and time within your open hours, set the
        party size, and optionally assign a table.
      </p>
      <GatedButton
        canAct={canEdit}
        gateReason="manage reservations"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        New reservation
      </GatedButton>
    </div>
  );
}

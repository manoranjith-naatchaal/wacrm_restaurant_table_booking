'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  UsersRound,
} from 'lucide-react';

import type { GuestWithContact } from '@/types';
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
import { GuestFormDialog } from '@/components/guests/guest-form-dialog';
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

type VipFilter = 'all' | 'vip' | 'regular';
type SortKey = 'name' | 'contact';

export default function GuestsPage() {
  const canEdit = useCan('send-messages');
  const [guests, setGuests] = useState<GuestWithContact[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [vipFilter, setVipFilter] = useState<VipFilter>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const { sortKey, sortDir, toggleSort } = useTableSort<SortKey>('name');

  const handleSort = useCallback(
    (key: string) => {
      toggleSort(key as SortKey);
      setPage(0);
    },
    [toggleSort]
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GuestWithContact | null>(null);

  const [pendingDelete, setPendingDelete] = useState<GuestWithContact | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/guests');
      if (!res.ok) throw new Error(`Failed to load guests: ${res.status}`);
      const json = (await res.json()) as { guests: GuestWithContact[] };
      setGuests(json.guests ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't load guests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return guests.filter((g) => {
      if (vipFilter === 'vip' && !g.is_vip) return false;
      if (vipFilter === 'regular' && g.is_vip) return false;
      if (!q) return true;
      return (
        g.name.toLowerCase().includes(q) ||
        (g.phone ?? '').toLowerCase().includes(q) ||
        (g.email ?? '').toLowerCase().includes(q) ||
        g.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [guests, search, vipFilter]);

  const sorted = useMemo(() => {
    const getValue = (g: GuestWithContact) =>
      sortKey === 'contact'
        ? (g.phone ?? g.contact?.phone ?? g.email)
        : g.name;
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

  function openEdit(guest: GuestWithContact) {
    setEditing(guest);
    setDialogOpen(true);
  }

  function handleSaved(saved: GuestWithContact) {
    setGuests((prev) => {
      const idx = prev.findIndex((g) => g.id === saved.id);
      if (idx === -1) return [...prev, saved];
      const next = [...prev];
      next[idx] = saved;
      return next;
    });
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/guests/${pendingDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed: ${res.status}`);
      }
      setGuests((prev) => prev.filter((g) => g.id !== pendingDelete.id));
      toast.success('Guest deleted.');
      setPendingDelete(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't delete guest.";
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
            <UsersRound className="text-primary h-5 w-5" />
            <h1 className="text-foreground text-2xl font-semibold">Guests</h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Your diners — link their WhatsApp contact, track preferences, and
            see their reservation history.
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="manage guests"
          onClick={openCreate}
        >
          <Plus className="h-4 w-4" />
          Add guest
        </GatedButton>
      </header>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : guests.length === 0 ? (
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
                placeholder="Search by name, phone, email, or tag..."
                className="bg-card pl-8"
              />
            </div>
            <Select
              value={vipFilter}
              onValueChange={(v) => {
                setVipFilter((v as VipFilter) ?? 'all');
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue>
                  {(v) =>
                    v === 'vip'
                      ? 'VIPs only'
                      : v === 'regular'
                        ? 'Regular only'
                        : 'All guests'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All guests</SelectItem>
                <SelectItem value="vip">VIPs only</SelectItem>
                <SelectItem value="regular">Regular only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
              No guests match your search or filters.
            </div>
          ) : (
            <>
              <div className="border-border rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead
                        label="Name"
                        columnKey="name"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHead
                        label="Contact"
                        columnKey="contact"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <TableHead>Tags</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((guest) => (
                      <TableRow key={guest.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/guests/${guest.id}`}
                            className="text-foreground hover:text-primary inline-flex items-center gap-2"
                          >
                            {guest.is_vip && (
                              <Star
                                className="size-3.5 shrink-0 fill-amber-400 text-amber-400"
                                aria-label="VIP"
                              />
                            )}
                            <span className="truncate">{guest.name}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="flex flex-col">
                            <span className="text-foreground/90 inline-flex items-center gap-1.5">
                              {guest.contact && (
                                <MessageSquare
                                  className="size-3 text-emerald-400"
                                  aria-label="Linked WhatsApp contact"
                                />
                              )}
                              {guest.phone || guest.contact?.phone || '—'}
                            </span>
                            {guest.email && (
                              <span className="text-xs">{guest.email}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {guest.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {guest.tags.slice(0, 3).map((t) => (
                                <Badge
                                  key={t}
                                  variant="outline"
                                  className="text-xs"
                                >
                                  {t}
                                </Badge>
                              ))}
                              {guest.tags.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{guest.tags.length - 3}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
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
                                render={<Link href={`/guests/${guest.id}`} />}
                              >
                                <UsersRound className="h-4 w-4" />
                                View profile
                              </DropdownMenuItem>
                              {canEdit && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => openEdit(guest)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => setPendingDelete(guest)}
                                    className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      <GuestFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        guest={editing}
        onSaved={handleSaved}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete guest?"
        description={
          pendingDelete
            ? `This permanently removes ${pendingDelete.name} and their booking profile. This can't be undone.`
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
        <UsersRound className="text-muted-foreground h-6 w-6" />
      </div>
      <h2 className="text-foreground mt-4 text-base font-medium">
        No guests yet
      </h2>
      <p className="text-muted-foreground mt-1 max-w-md text-sm">
        Add diners to track their preferences, dietary needs, and reservation
        history — and link them to their WhatsApp contact.
      </p>
      <GatedButton
        canAct={canEdit}
        gateReason="manage guests"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        Add your first guest
      </GatedButton>
    </div>
  );
}

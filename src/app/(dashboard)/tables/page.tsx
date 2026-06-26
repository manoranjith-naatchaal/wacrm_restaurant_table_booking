'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Armchair,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import type { RestaurantTable } from '@/types';
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
import { Textarea } from '@/components/ui/textarea';
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

type SortKey = 'label' | 'capacity' | 'area' | 'status';

interface FormState {
  label: string;
  capacity: string;
  area: string;
  is_active: boolean;
  notes: string;
}

const EMPTY_FORM: FormState = {
  label: '',
  capacity: '2',
  area: '',
  is_active: true,
  notes: '',
};

export default function TablesPage() {
  const canEdit = useCan('edit-settings');
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters / search / pagination.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const { sortKey, sortDir, toggleSort } = useTableSort<SortKey>('label');

  const handleSort = useCallback(
    (key: string) => {
      toggleSort(key as SortKey);
      setPage(0);
    },
    [toggleSort]
  );

  // Create / edit dialog.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RestaurantTable | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Delete confirmation.
  const [pendingDelete, setPendingDelete] = useState<RestaurantTable | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tables');
      if (!res.ok) throw new Error(`Failed to load tables: ${res.status}`);
      const json = (await res.json()) as { tables: RestaurantTable[] };
      setTables(json.tables ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't load tables.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- derived: filter → search → paginate ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables.filter((t) => {
      if (statusFilter === 'active' && !t.is_active) return false;
      if (statusFilter === 'inactive' && t.is_active) return false;
      if (!q) return true;
      return (
        t.label.toLowerCase().includes(q) ||
        (t.area ?? '').toLowerCase().includes(q)
      );
    });
  }, [tables, search, statusFilter]);

  const sorted = useMemo(() => {
    const getValue = (t: RestaurantTable) => {
      switch (sortKey) {
        case 'capacity':
          return t.capacity;
        case 'area':
          return t.area;
        case 'status':
          return t.is_active;
        default:
          return t.label;
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

  function openEdit(table: RestaurantTable) {
    setEditing(table);
    setForm({
      label: table.label,
      capacity: String(table.capacity),
      area: table.area ?? '',
      is_active: table.is_active,
      notes: table.notes ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    const capacity = Number(form.capacity);
    if (!form.label.trim()) {
      toast.error('Label is required.');
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      toast.error('Capacity must be a whole number of at least 1.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        label: form.label.trim(),
        capacity,
        area: form.area.trim() || null,
        is_active: form.is_active,
        notes: form.notes.trim() || null,
      };
      const res = await fetch(
        editing ? `/api/tables/${editing.id}` : '/api/tables',
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
      toast.success(editing ? 'Table updated.' : 'Table added.');
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save table.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/tables/${pendingDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed: ${res.status}`);
      }
      setTables((prev) => prev.filter((t) => t.id !== pendingDelete.id));
      toast.success('Table deleted.');
      setPendingDelete(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't delete table.";
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
            <Armchair className="text-primary h-5 w-5" />
            <h1 className="text-foreground text-2xl font-semibold">
              Tables &amp; Seating
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage tables, seating capacity, and dining areas. Reservations are
            assigned to these.
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="manage tables"
          onClick={openCreate}
        >
          <Plus className="h-4 w-4" />
          Add table
        </GatedButton>
      </header>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : tables.length === 0 ? (
        <EmptyState canEdit={canEdit} onCreate={openCreate} />
      ) : (
        <div className="space-y-4">
          {/* Search + filter */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search by label or area..."
                className="bg-card pl-8"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as StatusFilter);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
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
              No tables match your search or filters.
            </div>
          ) : (
            <>
              <div className="border-border rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead
                        label="Label"
                        columnKey="label"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHead
                        label="Capacity"
                        columnKey="capacity"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHead
                        label="Area"
                        columnKey="area"
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
                    {pageItems.map((table) => (
                      <TableRow key={table.id}>
                        <TableCell className="text-foreground font-medium">
                          {table.label}
                        </TableCell>
                        <TableCell>
                          {table.capacity}{' '}
                          {table.capacity === 1 ? 'seat' : 'seats'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {table.area || '—'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={table.is_active ? 'default' : 'outline'}
                            className={
                              table.is_active
                                ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
                                : 'text-muted-foreground'
                            }
                          >
                            {table.is_active ? 'Active' : 'Inactive'}
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
                                  onClick={() => openEdit(table)}
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setPendingDelete(table)}
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

              {/* Pagination */}
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
            <DialogTitle>{editing ? 'Edit table' : 'Add table'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editing
                ? "Update this table's details."
                : 'Add a new table to your seating layout.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="table-label">Label</Label>
                <Input
                  id="table-label"
                  value={form.label}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, label: e.target.value }))
                  }
                  placeholder="e.g. T1"
                  className="bg-muted"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="table-capacity">Capacity</Label>
                <Input
                  id="table-capacity"
                  type="number"
                  min={1}
                  value={form.capacity}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, capacity: e.target.value }))
                  }
                  className="bg-muted"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="table-area">Area (optional)</Label>
              <Input
                id="table-area"
                value={form.area}
                onChange={(e) =>
                  setForm((f) => ({ ...f, area: e.target.value }))
                }
                placeholder="e.g. Indoor, Patio, Bar"
                className="bg-muted"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="table-notes">Notes (optional)</Label>
              <Textarea
                id="table-notes"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="Anything worth remembering about this table."
                className="bg-muted"
              />
            </div>

            <div className="border-border flex items-center justify-between rounded-lg border px-3 py-2.5">
              <Label htmlFor="table-active" className="cursor-pointer">
                Active
                <span className="text-muted-foreground text-xs font-normal">
                  Available for new reservations
                </span>
              </Label>
              <Switch
                id="table-active"
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
              {editing ? 'Save changes' : 'Add table'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={`Delete table "${pendingDelete?.label ?? ''}"?`}
        description="This permanently removes the table from your seating layout. This can't be undone."
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
        <Armchair className="text-muted-foreground h-6 w-6" />
      </div>
      <h2 className="text-foreground mt-4 text-base font-medium">
        No tables yet
      </h2>
      <p className="text-muted-foreground mt-1 max-w-md text-sm">
        Add your tables and their seating capacity. Reservations will be
        assigned to them.
      </p>
      <GatedButton
        canAct={canEdit}
        gateReason="manage tables"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        Add your first table
      </GatedButton>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';

import type { MenuItem } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { compareValues, useTableSort } from '@/hooks/use-table-sort';
import { formatMenuPrice } from '@/lib/menu/render';
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

type StatusFilter = 'all' | 'available' | 'unavailable';

type SortKey = 'name' | 'category' | 'price' | 'status';

const ALL_CATEGORIES = '__all__';

interface FormState {
  name: string;
  category: string;
  price: string;
  description: string;
  sort_order: string;
  is_available: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  category: '',
  price: '',
  description: '',
  sort_order: '0',
  is_available: true,
};

export default function MenuPage() {
  const canEdit = useCan('edit-settings');
  const { defaultCurrency } = useAuth();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters / search / pagination.
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);
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

  // Create / edit dialog.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Delete confirmation.
  const [pendingDelete, setPendingDelete] = useState<MenuItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/menu');
      if (!res.ok) throw new Error(`Failed to load menu: ${res.status}`);
      const json = (await res.json()) as { items: MenuItem[] };
      setItems(json.items ?? []);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't load the menu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Distinct categories for the filter dropdown.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      const c = item.category?.trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }, [items]);

  // ---- derived: filter → search → sort → paginate ----
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter === 'available' && !item.is_available) return false;
      if (statusFilter === 'unavailable' && item.is_available) return false;
      if (
        categoryFilter !== ALL_CATEGORIES &&
        (item.category?.trim() ?? '') !== categoryFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        (item.category ?? '').toLowerCase().includes(q) ||
        (item.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [items, search, statusFilter, categoryFilter]);

  const sorted = useMemo(() => {
    const getValue = (item: MenuItem) => {
      switch (sortKey) {
        case 'category':
          return item.category;
        case 'price':
          return item.price ?? null;
        case 'status':
          return item.is_available;
        default:
          return item.name;
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

  function openEdit(item: MenuItem) {
    setEditing(item);
    setForm({
      name: item.name,
      category: item.category ?? '',
      price: item.price != null ? String(item.price) : '',
      description: item.description ?? '',
      sort_order: String(item.sort_order ?? 0),
      is_available: item.is_available,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    const priceRaw = form.price.trim();
    let price: number | null = null;
    if (priceRaw) {
      price = Number(priceRaw);
      if (!Number.isFinite(price) || price < 0) {
        toast.error('Price must be a positive number (or left blank).');
        return;
      }
    }
    const sortOrder = Number(form.sort_order || '0');
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      toast.error('Sort order must be a whole number of 0 or more.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || null,
        price,
        description: form.description.trim() || null,
        sort_order: sortOrder,
        is_available: form.is_available,
      };
      const res = await fetch(
        editing ? `/api/menu/${editing.id}` : '/api/menu',
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
      toast.success(editing ? 'Item updated.' : 'Item added.');
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save the item.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/menu/${pendingDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed: ${res.status}`);
      }
      setItems((prev) => prev.filter((i) => i.id !== pendingDelete.id));
      toast.success('Item deleted.');
      setPendingDelete(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't delete the item.";
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
            <UtensilsCrossed className="text-primary h-5 w-5" />
            <h1 className="text-foreground text-2xl font-semibold">Menu</h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Create and update your menu items. Guests can view this over
            WhatsApp with the &ldquo;Show menu&rdquo; flow block.
          </p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="manage the menu"
          onClick={openCreate}
        >
          <Plus className="h-4 w-4" />
          Add item
        </GatedButton>
      </header>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState canEdit={canEdit} onCreate={openCreate} />
      ) : (
        <div className="space-y-4">
          {/* Search + filters */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-sm">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search by name, category, or description..."
                className="bg-card pl-8"
              />
            </div>
            {categories.length > 0 && (
              <Select
                value={categoryFilter}
                onValueChange={(v) => {
                  setCategoryFilter(v ?? ALL_CATEGORIES);
                  setPage(0);
                }}
              >
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter((v ?? 'all') as StatusFilter);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="unavailable">Unavailable</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
              No items match your search or filters.
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
                        label="Category"
                        columnKey="category"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHead
                        label="Price"
                        columnKey="price"
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
                    {pageItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="max-w-xs">
                          <div className="text-foreground font-medium">
                            {item.name}
                          </div>
                          {item.description && (
                            <div className="text-muted-foreground truncate text-xs">
                              {item.description}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.category || '—'}
                        </TableCell>
                        <TableCell className="text-foreground">
                          {item.price != null
                            ? formatMenuPrice(item.price, defaultCurrency)
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={item.is_available ? 'default' : 'outline'}
                            className={
                              item.is_available
                                ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
                                : 'text-muted-foreground'
                            }
                          >
                            {item.is_available ? 'Available' : 'Unavailable'}
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
                                <DropdownMenuItem onClick={() => openEdit(item)}>
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setPendingDelete(item)}
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
            <DialogTitle>{editing ? 'Edit item' : 'Add item'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editing
                ? "Update this menu item's details."
                : 'Add a new item to your menu.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="menu-name">Name</Label>
              <Input
                id="menu-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="e.g. Margherita Pizza"
                className="bg-muted"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="menu-category">Category (optional)</Label>
                <Input
                  id="menu-category"
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                  placeholder="e.g. Mains, Starters"
                  className="bg-muted"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="menu-price">
                  Price ({defaultCurrency}, optional)
                </Label>
                <Input
                  id="menu-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.price}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, price: e.target.value }))
                  }
                  placeholder="Leave blank for market price"
                  className="bg-muted"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="menu-description">Description (optional)</Label>
              <Textarea
                id="menu-description"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="A short blurb shown under the item."
                className="bg-muted"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="menu-sort">Sort order</Label>
              <Input
                id="menu-sort"
                type="number"
                min={0}
                value={form.sort_order}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sort_order: e.target.value }))
                }
                className="bg-muted"
              />
              <p className="text-muted-foreground text-xs">
                Lower numbers show first. Items share their category&apos;s
                position based on the lowest sort order in it.
              </p>
            </div>

            <div className="border-border flex items-center justify-between rounded-lg border px-3 py-2.5">
              <Label htmlFor="menu-available" className="cursor-pointer">
                Available
                <span className="text-muted-foreground text-xs font-normal">
                  Shown to guests on the menu
                </span>
              </Label>
              <Switch
                id="menu-available"
                checked={form.is_available}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, is_available: checked }))
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
              {editing ? 'Save changes' : 'Add item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={`Delete "${pendingDelete?.name ?? ''}"?`}
        description="This permanently removes the item from your menu. This can't be undone."
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
        <UtensilsCrossed className="text-muted-foreground h-6 w-6" />
      </div>
      <h2 className="text-foreground mt-4 text-base font-medium">
        No menu items yet
      </h2>
      <p className="text-muted-foreground mt-1 max-w-md text-sm">
        Add your dishes with prices and categories. Guests can browse them over
        WhatsApp with the &ldquo;Show menu&rdquo; flow block.
      </p>
      <GatedButton
        canAct={canEdit}
        gateReason="manage the menu"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        Add your first item
      </GatedButton>
    </div>
  );
}

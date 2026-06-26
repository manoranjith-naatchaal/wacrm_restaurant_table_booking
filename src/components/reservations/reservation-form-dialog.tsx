'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  Loader2,
  Search,
  Star,
  User,
} from 'lucide-react';

import type {
  DayAvailabilityResponse,
  ReservationStatus,
  ReservationTableLite,
  ReservationWithRelations,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const STATUS_OPTIONS: { value: ReservationStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'seated', label: 'Seated' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show', label: 'No-show' },
];

interface GuestOption {
  id: string;
  name: string;
  phone: string | null;
  is_vip: boolean;
}

interface ReservationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservation: ReservationWithRelations | null;
  onSaved: (reservation: ReservationWithRelations) => void;
}

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatTime(value: string): string {
  const [hStr, mStr] = value.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return value;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

interface FormState {
  reservation_date: string;
  start_time: string;
  end_time: string;
  party_size: string;
  table_id: string;
  status: ReservationStatus;
  notes: string;
}

const NONE = '__none__';

export function ReservationFormDialog({
  open,
  onOpenChange,
  reservation,
  onSaved,
}: ReservationFormDialogProps) {
  const [form, setForm] = useState<FormState>({
    reservation_date: todayIso(),
    start_time: '19:00',
    end_time: '',
    party_size: '2',
    table_id: NONE,
    status: 'pending',
    notes: '',
  });
  const [guest, setGuest] = useState<GuestOption | null>(null);
  const [saving, setSaving] = useState(false);

  // Reference data.
  const [tables, setTables] = useState<ReservationTableLite[]>([]);
  const [guests, setGuests] = useState<GuestOption[]>([]);
  const [guestPickerOpen, setGuestPickerOpen] = useState(false);
  const [guestQuery, setGuestQuery] = useState('');

  // Availability for the chosen date.
  const [availability, setAvailability] =
    useState<DayAvailabilityResponse | null>(null);
  const [availLoading, setAvailLoading] = useState(false);

  // Hydrate form + reference data on open.
  useEffect(() => {
    if (!open) return;
    if (reservation) {
      setForm({
        reservation_date: reservation.reservation_date,
        start_time: reservation.start_time.slice(0, 5),
        end_time: reservation.end_time ? reservation.end_time.slice(0, 5) : '',
        party_size: String(reservation.party_size),
        table_id: reservation.table_id ?? NONE,
        status: reservation.status,
        notes: reservation.notes ?? '',
      });
      setGuest(reservation.guest);
    } else {
      setForm({
        reservation_date: todayIso(),
        start_time: '19:00',
        end_time: '',
        party_size: '2',
        table_id: NONE,
        status: 'pending',
        notes: '',
      });
      setGuest(null);
    }
    setGuestQuery('');

    void (async () => {
      try {
        const [tRes, gRes] = await Promise.all([
          fetch('/api/tables'),
          fetch('/api/guests'),
        ]);
        if (tRes.ok) {
          const j = (await tRes.json()) as {
            tables: (ReservationTableLite & { is_active: boolean })[];
          };
          setTables((j.tables ?? []).filter((t) => t.is_active));
        }
        if (gRes.ok) {
          const j = (await gRes.json()) as { guests: GuestOption[] };
          setGuests(j.guests ?? []);
        }
      } catch (err) {
        console.error(err);
      }
    })();
  }, [open, reservation]);

  const loadAvailability = useCallback(async (date: string) => {
    setAvailLoading(true);
    try {
      const res = await fetch(`/api/availability?date=${date}`);
      if (res.ok) {
        setAvailability((await res.json()) as DayAvailabilityResponse);
      } else {
        setAvailability(null);
      }
    } catch {
      setAvailability(null);
    } finally {
      setAvailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !form.reservation_date) return;
    void loadAvailability(form.reservation_date);
  }, [open, form.reservation_date, loadAvailability]);

  const filteredGuests = (() => {
    const q = guestQuery.trim().toLowerCase();
    if (!q) return guests.slice(0, 8);
    return guests
      .filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          (g.phone ?? '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  })();

  // Is the chosen start time inside an open window? (client mirror of
  // the server check — server is the source of truth.)
  const timeOutsideHours = (() => {
    if (!availability) return false;
    if (availability.closed) return true;
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const t = toMin(form.start_time);
    return !availability.windows.some(
      (w) => t >= toMin(w.start) && t < toMin(w.end)
    );
  })();

  const activeStatus = form.status !== 'cancelled' && form.status !== 'no_show';

  async function handleSave() {
    if (!guest) {
      toast.error('Pick a guest for this reservation.');
      return;
    }
    const party = Number(form.party_size);
    if (!Number.isInteger(party) || party < 1) {
      toast.error('Party size must be a whole number of at least 1.');
      return;
    }
    if (form.end_time && form.end_time <= form.start_time) {
      toast.error('End time must be after start time.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        guest_id: guest.id,
        reservation_date: form.reservation_date,
        start_time: form.start_time,
        end_time: form.end_time || null,
        party_size: party,
        table_id: form.table_id === NONE ? null : form.table_id,
        status: form.status,
        notes: form.notes.trim() || null,
      };
      const res = await fetch(
        reservation
          ? `/api/reservations/${reservation.id}`
          : '/api/reservations',
        {
          method: reservation ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Save failed: ${res.status}`);
      }
      const json = (await res.json()) as {
        reservation: ReservationWithRelations;
      };
      toast.success(
        reservation ? 'Reservation updated.' : 'Reservation booked.'
      );
      onSaved(json.reservation);
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't save reservation.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover text-popover-foreground max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {reservation ? 'Edit reservation' : 'New reservation'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {reservation
              ? 'Update this booking.'
              : 'Book a guest in. Time is checked against your open hours.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Guest */}
          <div className="space-y-1.5">
            <Label>Guest</Label>
            {guest ? (
              <div className="border-border flex items-center gap-2 rounded-lg border px-3 py-2">
                {guest.is_vip && (
                  <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {guest.name}
                  </p>
                  {guest.phone && (
                    <p className="text-muted-foreground truncate text-xs">
                      {guest.phone}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setGuest(null)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <Popover open={guestPickerOpen} onOpenChange={setGuestPickerOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start"
                    >
                      <Search className="size-4" />
                      Select a guest
                    </Button>
                  }
                />
                <PopoverContent
                  className="w-(--anchor-width) p-0"
                  align="start"
                >
                  <div className="border-border relative border-b">
                    <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                    <Input
                      autoFocus
                      value={guestQuery}
                      onChange={(e) => setGuestQuery(e.target.value)}
                      placeholder="Search guests..."
                      className="border-0 pl-8 focus-visible:ring-0"
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto p-1">
                    {filteredGuests.length === 0 ? (
                      <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                        {guests.length === 0
                          ? 'No guests yet. Add one in Guests first.'
                          : 'No matching guests.'}
                      </p>
                    ) : (
                      filteredGuests.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => {
                            setGuest(g);
                            setGuestPickerOpen(false);
                          }}
                          className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left"
                        >
                          {g.is_vip ? (
                            <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" />
                          ) : (
                            <User className="text-muted-foreground size-4 shrink-0" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="text-foreground block truncate text-sm">
                              {g.name}
                            </span>
                            {g.phone && (
                              <span className="text-muted-foreground block truncate text-xs">
                                {g.phone}
                              </span>
                            )}
                          </span>
                          <Check className="text-muted-foreground/0 size-4" />
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Date + party */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-date">Date</Label>
              <Input
                id="res-date"
                type="date"
                value={form.reservation_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, reservation_date: e.target.value }))
                }
                className="bg-muted"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="res-party">Party size</Label>
              <Input
                id="res-party"
                type="number"
                min={1}
                value={form.party_size}
                onChange={(e) =>
                  setForm((f) => ({ ...f, party_size: e.target.value }))
                }
                className="bg-muted"
              />
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-start">Start time</Label>
              <Input
                id="res-start"
                type="time"
                value={form.start_time}
                onChange={(e) =>
                  setForm((f) => ({ ...f, start_time: e.target.value }))
                }
                className="bg-muted"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="res-end">
                End time
                <span className="text-muted-foreground text-xs font-normal">
                  optional
                </span>
              </Label>
              <Input
                id="res-end"
                type="time"
                value={form.end_time}
                onChange={(e) =>
                  setForm((f) => ({ ...f, end_time: e.target.value }))
                }
                className="bg-muted"
              />
            </div>
          </div>

          {/* Availability hint */}
          <div className="text-sm">
            {availLoading ? (
              <p className="text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                Checking open hours…
              </p>
            ) : availability?.closed ? (
              <p className="flex items-center gap-1.5 text-red-300">
                <AlertTriangle className="size-3.5" />
                Closed on this date.
              </p>
            ) : availability && availability.windows.length > 0 ? (
              <p className="text-muted-foreground">
                Open:{' '}
                {availability.windows
                  .map((w) => `${formatTime(w.start)}–${formatTime(w.end)}`)
                  .join(', ')}
              </p>
            ) : availability ? (
              <p className="text-muted-foreground">
                No bookable hours set for this date.
              </p>
            ) : null}
          </div>

          {/* Table + status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-table">Table</Label>
              <Select
                value={form.table_id}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, table_id: v ?? NONE }))
                }
              >
                <SelectTrigger id="res-table" className="bg-muted w-full">
                  <SelectValue>
                    {(v) => {
                      if (v == null || v === NONE) return 'Unassigned';
                      const t = tables.find((x) => x.id === v);
                      return t ? `${t.label} (${t.capacity})` : 'Unassigned';
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {tables.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label} · seats {t.capacity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="res-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    status: (v as ReservationStatus) ?? f.status,
                  }))
                }
              >
                <SelectTrigger id="res-status" className="bg-muted w-full">
                  <SelectValue>
                    {(v) =>
                      STATUS_OPTIONS.find((s) => s.value === v)?.label ??
                      'Pending'
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {timeOutsideHours && activeStatus && !availLoading && (
            <div className="flex gap-2 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                That start time is outside your open hours for this date. Adjust
                the time, or update Slots &amp; Timings / Closures.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="res-notes">Notes</Label>
            <Textarea
              id="res-notes"
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
              placeholder="Special requests, occasion, seating preference…"
              className="bg-muted min-h-[60px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {reservation ? 'Save changes' : 'Book reservation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CalendarCheck,
  Info,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Star,
  Trash2,
  Utensils,
} from 'lucide-react';

import type {
  GuestReservationSummary,
  GuestStats,
  GuestWithContact,
} from '@/types';
import { cn } from '@/lib/utils';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GuestFormDialog } from '@/components/guests/guest-form-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

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

const STATUS_CLASS: Record<string, string> = {
  completed: 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300',
  confirmed: 'border-primary/40 bg-primary/10 text-primary',
  cancelled: 'border-border bg-muted text-muted-foreground',
  no_show: 'border-red-600/40 bg-red-500/10 text-red-300',
};

export default function GuestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const guestId = params.id;
  const canEdit = useCan('send-messages');

  const [guest, setGuest] = useState<GuestWithContact | null>(null);
  const [reservations, setReservations] = useState<GuestReservationSummary[]>(
    []
  );
  const [stats, setStats] = useState<GuestStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/guests/${guestId}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(`Failed to load guest: ${res.status}`);
      const json = (await res.json()) as {
        guest: GuestWithContact;
        reservations: GuestReservationSummary[];
        stats: GuestStats;
      };
      setGuest(json.guest);
      setReservations(json.reservations ?? []);
      setStats(json.stats);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't load this guest.");
    } finally {
      setLoading(false);
    }
  }, [guestId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/guests/${guestId}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Delete failed: ${res.status}`);
      }
      toast.success('Guest deleted.');
      router.push('/guests');
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't delete guest.";
      toast.error(msg);
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (notFound || !guest) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed px-6 py-16 text-center text-sm">
          This guest doesn&apos;t exist or you don&apos;t have access to it.
        </div>
      </div>
    );
  }

  const phone = guest.phone || guest.contact?.phone || null;

  return (
    <div className="space-y-6">
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {guest.is_vip && (
              <Star
                className="size-5 shrink-0 fill-amber-400 text-amber-400"
                aria-label="VIP"
              />
            )}
            <h1 className="text-foreground truncate text-2xl font-semibold">
              {guest.name}
            </h1>
            {guest.is_vip && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-300"
              >
                VIP
              </Badge>
            )}
          </div>
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" />
                {phone}
              </span>
            )}
            {guest.email && (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-3.5" />
                {guest.email}
              </span>
            )}
            {guest.contact && (
              <span className="inline-flex items-center gap-1.5 text-emerald-400">
                <MessageSquare className="size-3.5" />
                Linked WhatsApp contact
              </span>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(true)}
              className="text-red-400 hover:text-red-300"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        )}
      </header>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total visits" value={stats.completed} />
          <Stat label="Upcoming" value={stats.upcoming} />
          <Stat label="No-shows" value={stats.no_shows} />
          <Stat
            label="Last visit"
            value={stats.last_visit ? formatDate(stats.last_visit) : '—'}
          />
        </div>
      )}

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">
            <CalendarCheck className="size-4" />
            Reservation history
            {reservations.length > 0 && (
              <span className="text-muted-foreground ml-1 text-xs">
                ({reservations.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="details">
            <Info className="size-4" />
            Details
          </TabsTrigger>
        </TabsList>

        {/* Reservation history */}
        <TabsContent value="history" className="mt-4">
          {reservations.length === 0 ? (
            <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed py-12 text-center text-sm">
              No reservation history yet.
              <br />
              <span className="text-xs">
                This guest&apos;s past and upcoming bookings will appear here.
              </span>
            </div>
          ) : (
            <div className="border-border overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reservations.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(r.reservation_date)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatTime(r.start_time) || '—'}
                      </TableCell>
                      <TableCell>{r.party_size}</TableCell>
                      <TableCell>{r.table_label || '—'}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            STATUS_CLASS[r.status] ??
                            'border-border bg-muted text-muted-foreground'
                          }
                        >
                          {r.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Other details */}
        <TabsContent value="details" className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel title="Tags">
              {guest.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {guest.tags.map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
              ) : (
                <Empty>No tags</Empty>
              )}
            </Panel>

            <Panel title="Dietary notes & allergies" icon={Utensils}>
              {guest.dietary_notes ? (
                <p className="text-foreground/90 text-sm whitespace-pre-wrap">
                  {guest.dietary_notes}
                </p>
              ) : (
                <Empty>None recorded</Empty>
              )}
            </Panel>

            <Panel title="Notes" className="sm:col-span-2">
              {guest.notes ? (
                <p className="text-foreground/90 text-sm whitespace-pre-wrap">
                  {guest.notes}
                </p>
              ) : (
                <Empty>No notes</Empty>
              )}
            </Panel>
          </div>
        </TabsContent>
      </Tabs>

      <GuestFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        guest={guest}
        onSaved={(saved) => setGuest(saved)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete guest?"
        description={`This permanently removes ${guest.name} and their booking profile. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/guests"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
    >
      <ArrowLeft className="size-4" />
      Back to guests
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-border bg-card rounded-lg border px-4 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-foreground mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  className,
  children,
}: {
  title: string;
  icon?: typeof CalendarCheck;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn('border-border bg-card rounded-lg border p-4', className)}
    >
      <h2 className="text-foreground mb-3 flex items-center gap-2 text-sm font-medium">
        {Icon && <Icon className="text-muted-foreground size-4" />}
        {title}
      </h2>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

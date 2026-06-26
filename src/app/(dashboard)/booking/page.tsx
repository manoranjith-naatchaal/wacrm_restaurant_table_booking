'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Clock,
  LayoutDashboard,
  Loader2,
  Users,
  UtensilsCrossed,
} from 'lucide-react';

import type { ReservationStatus, ReservationWithRelations } from '@/types';
import { Badge } from '@/components/ui/badge';

interface OverviewData {
  today: string;
  timezone: string;
  kpis: {
    todayBookings: number;
    todayCovers: number;
    pendingConfirmations: number;
    upcoming7: number;
  };
  todaySchedule: ReservationWithRelations[];
  next7Days: { date: string; count: number }[];
}

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

function dayLabels(iso: string): { weekday: string; day: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return {
    weekday: dt.toLocaleDateString('en-US', { weekday: 'short' }),
    day: String(d),
  };
}

function longToday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function BookingOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/booking/overview');
      if (!res.ok) throw new Error(`Failed to load overview: ${res.status}`);
      setData((await res.json()) as OverviewData);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't load the booking overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const maxDay = useMemo(
    () => Math.max(1, ...(data?.next7Days.map((d) => d.count) ?? [1])),
    [data]
  );

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
        Couldn&apos;t load the overview. Please refresh.
      </div>
    );
  }

  const kpis = [
    {
      label: "Today's bookings",
      value: data.kpis.todayBookings,
      icon: CalendarCheck,
      href: '/reservations',
    },
    {
      label: "Today's covers",
      value: data.kpis.todayCovers,
      icon: Users,
      hint: 'guests expected',
    },
    {
      label: 'Pending confirmations',
      value: data.kpis.pendingConfirmations,
      icon: Clock,
      href: '/reservations',
      accent: data.kpis.pendingConfirmations > 0,
    },
    {
      label: 'Upcoming (7 days)',
      value: data.kpis.upcoming7,
      icon: CalendarDays,
      href: '/reservations',
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <LayoutDashboard className="text-primary h-5 w-5" />
          <h1 className="text-foreground text-2xl font-semibold">Overview</h1>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {longToday(data.today)} — your bookings at a glance.
        </p>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          const card = (
            <div
              className={
                'border-border bg-card flex h-full flex-col justify-between rounded-lg border p-4 transition-colors ' +
                (k.href ? 'hover:border-primary/40' : '')
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">
                  {k.label}
                </span>
                <Icon
                  className={
                    'h-4 w-4 ' +
                    (k.accent ? 'text-amber-400' : 'text-muted-foreground')
                  }
                />
              </div>
              <div className="mt-3">
                <span
                  className={
                    'text-3xl font-semibold ' +
                    (k.accent ? 'text-amber-300' : 'text-foreground')
                  }
                >
                  {k.value}
                </span>
                {k.hint && (
                  <span className="text-muted-foreground ml-1.5 text-xs">
                    {k.hint}
                  </span>
                )}
              </div>
            </div>
          );
          return k.href ? (
            <Link key={k.label} href={k.href} className="block">
              {card}
            </Link>
          ) : (
            <div key={k.label}>{card}</div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Today's schedule */}
        <div className="border-border bg-card rounded-lg border lg:col-span-2">
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="text-primary h-4 w-4" />
              <h2 className="text-foreground text-sm font-semibold">
                Today&apos;s schedule
              </h2>
            </div>
            <Link
              href="/reservations"
              className="text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-xs"
            >
              View all
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {data.todaySchedule.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center justify-center px-6 py-12 text-center text-sm">
              <UtensilsCrossed className="mb-2 h-6 w-6 opacity-60" />
              No bookings today.
            </div>
          ) : (
            <ul className="divide-border divide-y">
              {data.todaySchedule.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 px-4 py-3 text-sm"
                >
                  <div className="text-foreground w-20 shrink-0 font-medium tabular-nums">
                    {formatTime(r.start_time)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-foreground truncate font-medium">
                        {r.guest?.name ?? 'Guest'}
                      </span>
                      {r.guest?.is_vip && (
                        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-amber-300 uppercase">
                          VIP
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {r.party_size} {r.party_size === 1 ? 'guest' : 'guests'} ·{' '}
                      {r.table?.label ?? 'No table'}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={STATUS_META[r.status].className}
                  >
                    {STATUS_META[r.status].label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Next 7 days */}
        <div className="border-border bg-card rounded-lg border">
          <div className="border-border flex items-center gap-2 border-b px-4 py-3">
            <CalendarDays className="text-primary h-4 w-4" />
            <h2 className="text-foreground text-sm font-semibold">
              Next 7 days
            </h2>
          </div>
          <ul className="space-y-3 px-4 py-4">
            {data.next7Days.map((d, i) => {
              const { weekday, day } = dayLabels(d.date);
              const pct = Math.round((d.count / maxDay) * 100);
              return (
                <li key={d.date} className="flex items-center gap-3 text-xs">
                  <div className="text-muted-foreground w-12 shrink-0">
                    {i === 0 ? 'Today' : `${weekday} ${day}`}
                  </div>
                  <div className="bg-muted relative h-2.5 flex-1 overflow-hidden rounded-full">
                    <div
                      className="bg-primary absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${d.count === 0 ? 0 : Math.max(pct, 6)}%`,
                      }}
                    />
                  </div>
                  <div className="text-foreground w-5 shrink-0 text-right tabular-nums">
                    {d.count}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

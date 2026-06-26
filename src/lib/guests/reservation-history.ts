import type { SupabaseClient } from '@supabase/supabase-js';

import type { GuestReservationSummary, GuestStats } from '@/types';

export interface GuestHistory {
  reservations: GuestReservationSummary[];
  stats: GuestStats;
}

const ZERO_STATS: GuestStats = {
  total: 0,
  completed: 0,
  upcoming: 0,
  cancelled: 0,
  no_shows: 0,
  last_visit: null,
};

/** Local today as "YYYY-MM-DD" for the upcoming/past split. */
function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface HistoryRow {
  id: string;
  reservation_date: string;
  start_time: string | null;
  party_size: number;
  status: string;
  table: { label: string } | { label: string }[] | null;
}

function tableLabel(table: HistoryRow['table']): string | null {
  if (!table) return null;
  return Array.isArray(table) ? (table[0]?.label ?? null) : table.label;
}

/**
 * A guest's reservation history (newest first) plus derived visit
 * stats. Scoped by account + guest; RLS is the backstop. Used by the
 * guest detail endpoint.
 */
export async function getGuestReservationHistory(
  supabase: SupabaseClient,
  accountId: string,
  guestId: string
): Promise<GuestHistory> {
  const { data, error } = await supabase
    .from('reservations')
    .select(
      'id, reservation_date, start_time, party_size, status, table:restaurant_tables(label)'
    )
    .eq('account_id', accountId)
    .eq('guest_id', guestId)
    .order('reservation_date', { ascending: false })
    .order('start_time', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[getGuestReservationHistory]', error);
    return { reservations: [], stats: { ...ZERO_STATS } };
  }

  const rows = (data ?? []) as HistoryRow[];
  const today = todayIso();

  const stats: GuestStats = { ...ZERO_STATS, total: rows.length };
  for (const r of rows) {
    switch (r.status) {
      case 'completed':
        stats.completed += 1;
        if (!stats.last_visit || r.reservation_date > stats.last_visit) {
          stats.last_visit = r.reservation_date;
        }
        break;
      case 'cancelled':
        stats.cancelled += 1;
        break;
      case 'no_show':
        stats.no_shows += 1;
        break;
      default:
        // pending / confirmed / seated count as upcoming if not past.
        if (r.reservation_date >= today) stats.upcoming += 1;
    }
  }

  const reservations: GuestReservationSummary[] = rows.map((r) => ({
    id: r.id,
    reservation_date: r.reservation_date,
    start_time: r.start_time,
    party_size: r.party_size,
    status: r.status,
    table_label: tableLabel(r.table),
  }));

  return { reservations, stats };
}

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  DEFAULT_BOOKING_TIMEZONE,
  addDaysIso,
  getAccountTimezone,
  getZonedNow,
} from '@/lib/flows/booking';
import type { ReservationWithRelations } from '@/types';

/**
 * GET /api/booking/overview — aggregates for the Booking Management
 * "Overview" dashboard (any member).
 *
 * Returns today's KPIs, today's time-ordered schedule, and a 7-day
 * booking count series. "Today" is resolved in the account's booking
 * timezone so it matches what the restaurant sees, not the server.
 *
 * Cancelled and no-show reservations are excluded from counts/covers
 * (they're not real expected guests); the schedule additionally keeps
 * no-shows out but is otherwise today's live list.
 */

const RELATIONS =
  'guest:guests(id, name, phone, is_vip), table:restaurant_tables(id, label, capacity)';

const COUNTED = (status: string) =>
  status !== 'cancelled' && status !== 'no_show';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    let tz: string;
    try {
      tz = await getAccountTimezone(supabase, accountId);
    } catch {
      tz = DEFAULT_BOOKING_TIMEZONE;
    }
    const today = getZonedNow(tz).dateIso;
    const weekEnd = addDaysIso(today, 6);

    // One windowed read covers today's schedule + the 7-day series.
    const { data, error } = await supabase
      .from('reservations')
      .select(`*, ${RELATIONS}`)
      .eq('account_id', accountId)
      .gte('reservation_date', today)
      .lte('reservation_date', weekEnd)
      .order('reservation_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const rows = (data ?? []) as ReservationWithRelations[];

    // Pending confirmations can sit beyond the 7-day window, so count
    // them separately (head-only — we only need the number).
    const { count: pendingCount, error: pendingErr } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .gte('reservation_date', today);

    if (pendingErr) {
      return NextResponse.json({ error: pendingErr.message }, { status: 500 });
    }

    const todayRows = rows.filter((r) => r.reservation_date === today);
    const todaySchedule = todayRows.filter((r) => r.status !== 'cancelled');
    const todayCounted = todayRows.filter((r) => COUNTED(r.status));

    // 7-day series — one entry per day, today first.
    const next7Days = Array.from({ length: 7 }, (_, i) => {
      const date = addDaysIso(today, i);
      const count = rows.filter(
        (r) => r.reservation_date === date && COUNTED(r.status)
      ).length;
      return { date, count };
    });

    return NextResponse.json({
      today,
      timezone: tz,
      kpis: {
        todayBookings: todayCounted.length,
        todayCovers: todayCounted.reduce((sum, r) => sum + r.party_size, 0),
        pendingConfirmations: pendingCount ?? 0,
        upcoming7: rows.filter((r) => COUNTED(r.status)).length,
      },
      todaySchedule,
      next7Days,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

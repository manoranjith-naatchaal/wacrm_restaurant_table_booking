import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { validateReservationInput } from '@/lib/reservations/validate';
import { checkBooking } from '@/lib/reservations/booking-checks';

/**
 * GET  /api/reservations — list bookings (member). Query params:
 *        ?scope=upcoming|past|all  (default upcoming)
 *        ?date=YYYY-MM-DD          (overrides scope; that day only)
 * POST /api/reservations — create a booking (agent+). Enforces
 *        availability + table fit/conflict on top of shape validation.
 *
 * Guest + table are embedded so the list renders without extra fetches.
 */

const RELATIONS =
  'guest:guests(id, name, phone, is_vip), table:restaurant_tables(id, label, capacity)';

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const scope = searchParams.get('scope') ?? 'upcoming';

    let query = supabase
      .from('reservations')
      .select(`*, ${RELATIONS}`)
      .eq('account_id', accountId);

    if (date) {
      query = query
        .eq('reservation_date', date)
        .order('start_time', { ascending: true });
    } else if (scope === 'past') {
      query = query
        .lt('reservation_date', todayIso())
        .order('reservation_date', { ascending: false })
        .order('start_time', { ascending: false });
    } else if (scope === 'all') {
      query = query
        .order('reservation_date', { ascending: false })
        .order('start_time', { ascending: false });
    } else {
      // upcoming (default)
      query = query
        .gte('reservation_date', todayIso())
        .order('reservation_date', { ascending: true })
        .order('start_time', { ascending: true });
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ reservations: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const raw = await request.json().catch(() => null);
    const parsed = validateReservationInput(raw);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors.join(' ') },
        { status: 400 }
      );
    }
    const v = parsed.value;

    const check = await checkBooking(supabase, accountId, {
      reservation_date: v.reservation_date as string,
      start_time: v.start_time as string,
      end_time: v.end_time ?? null,
      table_id: v.table_id ?? null,
      party_size: v.party_size as number,
      status: v.status ?? 'pending',
    });
    if (!check.ok) {
      return NextResponse.json(
        { error: check.error },
        { status: check.status }
      );
    }

    const { data, error } = await supabase
      .from('reservations')
      .insert({ account_id: accountId, user_id: userId, ...v })
      .select(`*, ${RELATIONS}`)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ reservation: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

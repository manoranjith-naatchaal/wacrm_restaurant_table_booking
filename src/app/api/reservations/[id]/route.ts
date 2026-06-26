import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { validateReservationInput } from '@/lib/reservations/validate';
import { checkBooking } from '@/lib/reservations/booking-checks';
import type { Reservation } from '@/types';

/**
 * PATCH  /api/reservations/[id] — update a booking (agent+). The
 *   merged (existing + patch) state is re-checked for availability and
 *   table fit/conflict, so a status change or table move stays valid.
 * DELETE /api/reservations/[id] — delete a booking (agent+).
 */

const RELATIONS =
  'guest:guests(id, name, phone, is_vip), table:restaurant_tables(id, label, capacity)';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId } = await requireRole('agent');

    const raw = await request.json().catch(() => null);
    const parsed = validateReservationInput(raw, { partial: true });
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors.join(' ') },
        { status: 400 }
      );
    }

    // Load the current row so we can validate the resulting state.
    const { data: existing, error: fetchErr } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const merged = { ...(existing as Reservation), ...parsed.value };
    const check = await checkBooking(
      supabase,
      accountId,
      {
        reservation_date: merged.reservation_date,
        start_time: merged.start_time.slice(0, 5),
        end_time: merged.end_time ? merged.end_time.slice(0, 5) : null,
        table_id: merged.table_id,
        party_size: merged.party_size,
        status: merged.status,
      },
      { excludeId: id }
    );
    if (!check.ok) {
      return NextResponse.json(
        { error: check.error },
        { status: check.status }
      );
    }

    const { data, error } = await supabase
      .from('reservations')
      .update(parsed.value)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(`*, ${RELATIONS}`)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ reservation: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId } = await requireRole('agent');

    const { data, error } = await supabase
      .from('reservations')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

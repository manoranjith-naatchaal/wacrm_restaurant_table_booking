import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { validateGuestInput } from '@/lib/guests/validate';
import { getGuestReservationHistory } from '@/lib/guests/reservation-history';

/**
 * GET    /api/guests/[id] — guest + linked contact + reservation
 *                           history & visit stats (any member).
 * PATCH  /api/guests/[id] — update a guest (agent+).
 * DELETE /api/guests/[id] — delete a guest (agent+).
 *
 * RLS scopes everything to the caller's account → cross-account or
 * missing id resolves to 404.
 */

const CONTACT_EMBED = 'contact:contacts(id, name, phone, avatar_url)';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('guests')
      .select(`*, ${CONTACT_EMBED}`)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { reservations, stats } = await getGuestReservationHistory(
      supabase,
      accountId,
      id
    );

    return NextResponse.json({ guest: data, reservations, stats });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId } = await requireRole('agent');

    const raw = await request.json().catch(() => null);
    const parsed = validateGuestInput(raw, { partial: true });
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors.join(' ') },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('guests')
      .update(parsed.value)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(`*, ${CONTACT_EMBED}`)
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'That contact is already linked to another guest.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ guest: data });
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
      .from('guests')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      // 23503 = foreign_key_violation: the guest still has reservations
      // (reservations.guest_id is ON DELETE RESTRICT). Friendly 409.
      if (error.code === '23503') {
        return NextResponse.json(
          {
            error:
              'This guest has reservations. Cancel or reassign them before deleting.',
          },
          { status: 409 }
        );
      }
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

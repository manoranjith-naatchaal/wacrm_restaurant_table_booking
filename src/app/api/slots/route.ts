import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { validateSlotInput } from '@/lib/slots/validate';

/**
 * GET  /api/slots — list the account's slots (any member).
 * POST /api/slots — create a slot (admin+; availability is config).
 *
 * Ordered by weekday then start time so the UI renders a natural
 * weekly schedule without client-side sorting.
 */

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('booking_slots')
      .select('*')
      .eq('account_id', accountId)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ slots: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const raw = await request.json().catch(() => null);
    const parsed = validateSlotInput(raw);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors.join(' ') },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('booking_slots')
      .insert({
        account_id: accountId,
        user_id: userId,
        ...parsed.value,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation on (account_id, day_of_week, start_time).
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A slot already exists for that day and start time.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ slot: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

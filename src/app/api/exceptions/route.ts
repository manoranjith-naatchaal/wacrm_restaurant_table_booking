import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { validateExceptionInput } from '@/lib/exceptions/validate';

/**
 * GET  /api/exceptions — list the account's overrides (any member).
 * POST /api/exceptions — create one (admin+; availability is config).
 *
 * Ordered by start_date so the UI shows the soonest changes first.
 */

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('booking_exceptions')
      .select('*')
      .eq('account_id', accountId)
      .order('start_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ exceptions: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const raw = await request.json().catch(() => null);
    const parsed = validateExceptionInput(raw);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors.join(' ') },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('booking_exceptions')
      .insert({
        account_id: accountId,
        user_id: userId,
        ...parsed.value,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ exception: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

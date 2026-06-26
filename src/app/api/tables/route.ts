import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { validateTableInput } from '@/lib/tables/validate';

/**
 * GET  /api/tables — list the account's tables (any member).
 * POST /api/tables — create a table (admin+; seating is config).
 *
 * RLS on `restaurant_tables` already enforces both the tenancy and
 * the role tier; the route guards mirror it so an unauthorized
 * caller gets a clean 401/403 instead of an empty result set.
 */

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('restaurant_tables')
      .select('*')
      .eq('account_id', accountId)
      .order('label', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ tables: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const raw = await request.json().catch(() => null);
    const parsed = validateTableInput(raw);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors.join(' ') },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('restaurant_tables')
      .insert({
        account_id: accountId,
        user_id: userId,
        ...parsed.value,
      })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation on (account_id, label).
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A table with that label already exists.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ table: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

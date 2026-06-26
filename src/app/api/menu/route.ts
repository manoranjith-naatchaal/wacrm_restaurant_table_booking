import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { validateMenuItemInput } from '@/lib/menu/validate';

/**
 * GET  /api/menu — list the account's menu items (any member).
 * POST /api/menu — create an item (admin+; the menu is config).
 *
 * RLS on `menu_items` already enforces both the tenancy and the role
 * tier; the route guards mirror it so an unauthorized caller gets a
 * clean 401/403 instead of an empty result set.
 */

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('account_id', accountId)
      .order('category', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const raw = await request.json().catch(() => null);
    const parsed = validateMenuItemInput(raw);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors.join(' ') },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('menu_items')
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
    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

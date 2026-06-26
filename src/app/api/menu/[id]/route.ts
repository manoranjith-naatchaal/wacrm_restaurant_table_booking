import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { validateMenuItemInput } from '@/lib/menu/validate';

/**
 * PATCH  /api/menu/[id] — update a menu item (admin+).
 * DELETE /api/menu/[id] — delete a menu item (admin+).
 *
 * RLS scopes both to the caller's account; a row in another account
 * (or a non-existent id) resolves to zero affected rows → 404.
 */

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId } = await requireRole('admin');

    const raw = await request.json().catch(() => null);
    const parsed = validateMenuItemInput(raw, { partial: true });
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors.join(' ') },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('menu_items')
      .update(parsed.value)
      .eq('id', id)
      .eq('account_id', accountId)
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ item: data });
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
    const { supabase, accountId } = await requireRole('admin');

    const { data, error } = await supabase
      .from('menu_items')
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

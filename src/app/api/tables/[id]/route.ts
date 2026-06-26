import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { validateTableInput } from '@/lib/tables/validate';

/**
 * PATCH  /api/tables/[id] — update a table (admin+).
 * DELETE /api/tables/[id] — delete a table (admin+).
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
    const parsed = validateTableInput(raw, { partial: true });
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors.join(' ') },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('restaurant_tables')
      .update(parsed.value)
      .eq('id', id)
      .eq('account_id', accountId)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A table with that label already exists.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ table: data });
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
      .from('restaurant_tables')
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

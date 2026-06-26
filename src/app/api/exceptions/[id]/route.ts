import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { validateExceptionInput } from '@/lib/exceptions/validate';

/**
 * PATCH  /api/exceptions/[id] — update an override (admin+).
 * DELETE /api/exceptions/[id] — delete an override (admin+).
 *
 * Cross-field validation (kind↔time) means the UI always submits the
 * full intended shape, so PATCH revalidates the whole row.
 * RLS scopes both to the caller's account → cross-account/missing 404.
 */

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, accountId } = await requireRole('admin');

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
    return NextResponse.json({ exception: data });
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
      .from('booking_exceptions')
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

import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { validateGuestInput } from '@/lib/guests/validate';

/**
 * GET  /api/guests — list guests with their linked contact (member).
 * POST /api/guests — create a guest (agent+; operational data).
 *
 * Guests embed a lightweight slice of their linked contact so the
 * list/detail can show the WhatsApp identity without a second fetch.
 */

const CONTACT_EMBED = 'contact:contacts(id, name, phone, avatar_url)';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('guests')
      .select(`*, ${CONTACT_EMBED}`)
      .eq('account_id', accountId)
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ guests: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const raw = await request.json().catch(() => null);
    const parsed = validateGuestInput(raw);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.errors.join(' ') },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('guests')
      .insert({
        account_id: accountId,
        user_id: userId,
        ...parsed.value,
      })
      .select(`*, ${CONTACT_EMBED}`)
      .single();

    if (error) {
      // 23505 = unique_violation on (account_id, contact_id).
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'That contact is already linked to another guest.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ guest: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

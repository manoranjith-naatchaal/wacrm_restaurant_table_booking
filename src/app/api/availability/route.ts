import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { normalizeDate } from '@/lib/exceptions/validate';
import { getAccountAvailability } from '@/lib/reservations/booking-checks';

/**
 * GET /api/availability?date=YYYY-MM-DD — the open booking windows
 * for a date, resolving weekly slots against closures/special hours.
 * Any member can read it (it backs the reservation dialog).
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { searchParams } = new URL(request.url);
    const date = normalizeDate(searchParams.get('date'));
    if (!date) {
      return NextResponse.json(
        { error: 'A valid ?date=YYYY-MM-DD is required.' },
        { status: 400 }
      );
    }

    const availability = await getAccountAvailability(
      supabase,
      accountId,
      date
    );
    return NextResponse.json({ date, ...availability });
  } catch (err) {
    return toErrorResponse(err);
  }
}

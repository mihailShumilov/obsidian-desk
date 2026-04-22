/**
 * GET /api/health — Docker healthcheck endpoint (P5 acceptance).
 * Returns `{ ok: true, ts: <epoch_ms> }` 200. No DB / external calls.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ ok: true, ts: Date.now() });
}

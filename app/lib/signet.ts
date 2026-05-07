/**
 * mempool.space signet helpers.
 *
 * Used by landing-page server components to ground marketing copy in real
 * chain state ("BLOCK 234,861" rather than a static placeholder). Always
 * tolerant of failure — callers fall back to placeholders if `null` comes
 * back. Cached 60s via Next's data cache to stay polite to mempool.space.
 */

export interface SignetTip {
  /** Tip height. */
  height: number;
  /** Coinbase txid of the tip block (always 64-char lowercase hex). */
  txid: string;
}

const BASE = 'https://mempool.space/signet/api';
const HEX_RE = /^[0-9a-f]+$/;

async function fetchText(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

export async function fetchSignetTip(): Promise<SignetTip | null> {
  const [heightStr, hash] = await Promise.all([
    fetchText('/blocks/tip/height'),
    fetchText('/blocks/tip/hash'),
  ]);
  if (heightStr === null || hash === null) return null;

  const height = Number(heightStr);
  if (!Number.isFinite(height) || height <= 0) return null;
  if (!HEX_RE.test(hash)) return null;

  const txid = await fetchText(`/block/${hash}/txid/0`);
  if (txid === null || !HEX_RE.test(txid)) return null;

  return { height, txid };
}

/**
 * Display formatters shared across UI surfaces.
 *
 * Keep this file boring. Single source of truth for address truncation
 * and BTC sats → human-readable rendering.
 */

export function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatBtc(sats: bigint): string {
  if (sats === 0n) return '0';
  const whole = sats / 100_000_000n;
  const frac = sats % 100_000_000n;
  const fracStr = frac.toString().padStart(8, '0').replace(/0+$/, '');
  return fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
}

/**
 * ETA for the next signet block given the latest block's UNIX seconds.
 * Signet's design target is 10-minute blocks, but inter-block gaps are
 * bursty in practice — return "any moment" once the design target has
 * elapsed rather than counting up forever.
 */
export function formatNextBlockEta(
  tipTimestampSeconds: number,
  nowMs: number = Date.now(),
): string {
  const TARGET_BLOCK_INTERVAL_S = 600;
  const elapsedS = Math.floor(nowMs / 1000) - tipTimestampSeconds;
  const remainingS = TARGET_BLOCK_INTERVAL_S - elapsedS;
  if (remainingS <= 0) return 'any moment';
  if (remainingS < 60) return `~${remainingS}s`;
  return `~${Math.ceil(remainingS / 60)}m`;
}

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

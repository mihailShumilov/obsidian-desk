/**
 * Solana slot-time constants for order expiry windows.
 *
 * Solana targets ~400 ms slot times → 9_000 slots/hour. The default
 * order expiry is one trading day. Centralized so a future Solana
 * slot-time change updates every consumer at once.
 */

export const SLOTS_PER_HOUR = 9_000;
export const DEFAULT_ORDER_EXPIRY_SLOTS = SLOTS_PER_HOUR * 24;

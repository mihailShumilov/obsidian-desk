// We deliberately do NOT re-export the `encrypt` or `ika` namespaces from
// the barrel — both modules dynamic-import `@grpc/grpc-js`-pulling code for
// their real-mode flows, and Turbopack's import-graph walker creates a
// client-side chunk for those targets even when the calling code is
// server-only. Result: `Module not found: dns` / `fs` / `net` in the
// client bundle.
//
// Consumers that need them import via the subpath:
//   import * as encrypt from '@obsidian-desk/sdk/encrypt'
//   import * as ika from '@obsidian-desk/sdk/ika'
//
// `btc` stays on the barrel — bitcoinjs-lib is browser-safe.

export * as btc from './btc.ts';
export * from './errors.ts';
export { SLOTS_PER_HOUR, DEFAULT_ORDER_EXPIRY_SLOTS } from './slots.ts';
export { DEFAULT_OBSIDIAN_PROGRAM_ID } from './program-id.ts';
export { assertNotMockOnMainnet, isMainnetEndpoint } from './safety.ts';
export {
  resolveMode,
  tryReal,
  unwrap,
  isTransientError,
  setModeLogger,
} from './mode.ts';
export type {
  Mode,
  ResolvedMode,
  LoggedMode,
  Surface,
  ModeResult,
  ModeLogger,
} from './mode.ts';

// Top-level re-exports for the most-used public types.
export type { Side, EncryptedOrderBlob, EncryptMode } from './encrypt.ts';
export type { Chain, DWallet, Policy, PolicyRule, IkaMode } from './ika.ts';
export type { BtcUnsignedTx, SpendInput, BtcNetworkName } from './btc.ts';

/**
 * Refuse-to-boot guard against the worst-case misconfiguration: running
 * mock-mode FHE / mock-mode Ika against mainnet RPC.
 *
 * Mock mode encodes plaintext into ciphertexts (sdk/src/encrypt.ts) and
 * uses an in-process key store (sdk/src/ika.ts). Pointing that at a real
 * mainnet validator means orderbook intent is recoverable from the chain
 * and signing decisions are made by an unaudited single signer. Both
 * violate the project's non-negotiables (CLAUDE.md).
 *
 * Long term, gaps E5 / I0 close the mock paths; until then this guard
 * trips loudly so a misconfigured deploy fails at boot rather than in
 * production traffic.
 */

const MAINNET_HINTS = ['mainnet', 'mainnet-beta', 'api.mainnet'];

export function isMainnetEndpoint(rpcOrLabel: string | undefined): boolean {
  if (!rpcOrLabel) return false;
  const lower = rpcOrLabel.toLowerCase();
  return MAINNET_HINTS.some((h) => lower.includes(h));
}

export interface SafetyEnv {
  encryptMode?: string;
  ikaMode?: string;
  network?: string;
  rpc?: string;
}

export function assertNotMockOnMainnet(env: SafetyEnv): void {
  const onMainnet = isMainnetEndpoint(env.network) || isMainnetEndpoint(env.rpc);
  // `auto` can fall back to mock at any time — must be treated as risky on
  // mainnet, same as explicit `mock`. Only the strict `real` value clears
  // the guard.
  const isRiskyMode = (m: string | undefined): boolean =>
    m !== 'real';
  if (onMainnet && (isRiskyMode(env.encryptMode) || isRiskyMode(env.ikaMode))) {
    throw new Error(
      [
        'ObsidianDesk safety guard: refusing to run with',
        `OBSIDIAN_ENCRYPT_MODE=${env.encryptMode ?? 'auto(default)'}`,
        `+ OBSIDIAN_IKA_MODE=${env.ikaMode ?? 'auto(default)'}`,
        `against a mainnet endpoint (${env.rpc ?? env.network ?? '?'}).`,
        'Both modes must be "real" on mainnet — "auto" can fall back to mock and expose plaintext.',
      ].join(' '),
    );
  }
}

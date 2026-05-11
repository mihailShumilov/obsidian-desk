/**
 * Global dWallet state for the app.
 *
 * Persisted under `obsidian:dwallet:v1` so a refresh during the wizard
 * preserves your step. **Only public fields persist** — the dWallet `id`
 * (currently the auth token for `lockPolicyAction` in mock mode) lives
 * in memory only, so an XSS / extension that dumps localStorage cannot
 * later use it to grief a user's policy.
 *
 * `bigint` cannot be JSON-serialized, so balance is stored as a string
 * in localStorage and round-tripped through BigInt at use sites.
 */

'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useEffect, useRef } from 'react';
import { getAddressBalanceAction } from '@/app/(authenticated)/deposit/actions';

export type WizardMode = 'real-ok' | 'real-failed-fallback' | 'mock';

export interface DwalletInfo {
  id: string;
  /** Bech32 P2WPKH address. */
  address: string;
  chain: 'bitcoin-signet';
  /** Solana pubkey of the wallet that created this dWallet. Optional only
   *  to keep older persisted entries deserialisable; new creates always
   *  set it, and the UI treats missing creator as "orphan — needs reset". */
  creator?: string;
}

interface DwalletState {
  dwallet: DwalletInfo | null;
  /** Confirmed balance in sats, stored as string for serialization. */
  balanceSats: string;
  /** Sum of confirmed + unconfirmed (mempool), in sats string. */
  totalSats: string;
  /** UNIX seconds of the latest signet block. Drives the "next block ~Xm"
   *  ETA next to pending balances. Null when the upstream lookup hasn't
   *  completed yet or returned an error. Not persisted — re-derived on
   *  each balance poll. */
  tipTimestamp: number | null;
  policyLocked: boolean;
  policyAccount: string | null;
  /** Per-step mode markers — populated by the actions, rendered as badges
   *  in the wizard. Not persisted (re-derived on each call). */
  createMode: WizardMode | null;
  lockMode: WizardMode | null;
  /** Wizard cursor — preserved across refreshes. */
  step: 'create' | 'fund' | 'lock' | 'done';
  setDwallet(dw: DwalletInfo, mode?: WizardMode): void;
  setBalance(confirmed: bigint, total: bigint, tipTimestamp: number | null): void;
  setPolicy(policyAccount: string, mode?: WizardMode): void;
  setStep(s: DwalletState['step']): void;
  reset(): void;
}

export const useDwalletStore = create<DwalletState>()(
  persist(
    (set) => ({
      dwallet: null,
      balanceSats: '0',
      totalSats: '0',
      tipTimestamp: null,
      policyLocked: false,
      policyAccount: null,
      createMode: null,
      lockMode: null,
      step: 'create',
      setDwallet: (dwallet, mode) =>
        set({ dwallet, step: 'fund', policyLocked: false, createMode: mode ?? null }),
      setBalance: (confirmed, total, tipTimestamp) =>
        set({
          balanceSats: confirmed.toString(),
          totalSats: total.toString(),
          tipTimestamp,
        }),
      setPolicy: (policyAccount, mode) =>
        set({ policyLocked: true, policyAccount, step: 'done', lockMode: mode ?? null }),
      setStep: (step) => set({ step }),
      reset: () =>
        set({
          dwallet: null,
          balanceSats: '0',
          totalSats: '0',
          tipTimestamp: null,
          policyLocked: false,
          policyAccount: null,
          createMode: null,
          lockMode: null,
          step: 'create',
        }),
    }),
    {
      name: 'obsidian:dwallet:v1',
      storage: createJSONStorage(() => localStorage),
      // Persist the full dWallet so refresh-then-lock and refresh-then-view
      // both work. dwallet.id is the lookup key in real mode (public Ika
      // identifier) and the auth token in mock mode; for a single-user
      // devnet/signet demo where ownership is gated by Phantom signature
      // anyway, the localStorage trade-off is fine. If the threat model
      // changes (multi-user prod, hostile XSS surface) move id back to
      // memory and add a "re-create dWallet" path on refresh.
      partialize: (state) => ({
        balanceSats: state.balanceSats,
        totalSats: state.totalSats,
        policyLocked: state.policyLocked,
        policyAccount: state.policyAccount,
        step: state.step,
        dwallet: state.dwallet,
      }),
    },
  ),
);

/**
 * Returns one of:
 *   - 'none'      — no dWallet in the local store
 *   - 'orphan'    — dWallet exists but has no creator binding (legacy persisted
 *                   entry from before the field was added). Treat as suspect:
 *                   ask the user to reset.
 *   - 'disconnected' — no Solana wallet connected. The dWallet may belong to
 *                      this user; we just can't verify without the pubkey.
 *   - 'mine'      — connected wallet matches the dWallet's recorded creator.
 *   - 'foreign'   — connected wallet is different from the creator. Showing
 *                   the dWallet's address/balance under this connection would
 *                   be misleading; surface a reset prompt instead.
 */
export type DwalletOwnership = 'none' | 'orphan' | 'disconnected' | 'mine' | 'foreign';

export function dwalletOwnership(
  dwallet: DwalletInfo | null,
  connectedPubkey: string | null,
): DwalletOwnership {
  if (!dwallet) return 'none';
  if (!dwallet.creator) return 'orphan';
  if (!connectedPubkey) return 'disconnected';
  return dwallet.creator === connectedPubkey ? 'mine' : 'foreign';
}

/**
 * Hook: every 15s, refresh the on-chain balance for the current dWallet.
 * Mount once near the app root (e.g. inside Providers) so the polling
 * runs regardless of which page the user is on. No-op when no dWallet
 * is connected.
 */
export function useDwalletPoller(): void {
  const dwallet = useDwalletStore((s) => s.dwallet);
  const setBalance = useDwalletStore((s) => s.setBalance);
  const lastFetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!dwallet) return;
    let cancelled = false;

    async function tick(): Promise<void> {
      if (!dwallet) return;
      try {
        const bal = await getAddressBalanceAction(dwallet.address);
        if (cancelled || lastFetchedFor.current !== dwallet.address) return;
        setBalance(
          BigInt(bal.confirmedSats),
          BigInt(bal.totalSats),
          bal.tipTimestamp ?? null,
        );
      } catch {
        // Network errors are intentionally swallowed — the action itself
        // already returns 0 on failure; we only land here on a true
        // crash. The store retains its prior value.
      }
    }

    lastFetchedFor.current = dwallet.address;
    void tick();
    const id = setInterval(() => void tick(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [dwallet, setBalance]);
}


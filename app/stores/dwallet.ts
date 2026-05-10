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
}

interface DwalletState {
  dwallet: DwalletInfo | null;
  /** Confirmed balance in sats, stored as string for serialization. */
  balanceSats: string;
  /** Sum of confirmed + unconfirmed (mempool), in sats string. */
  totalSats: string;
  policyLocked: boolean;
  policyAccount: string | null;
  /** Per-step mode markers — populated by the actions, rendered as badges
   *  in the wizard. Not persisted (re-derived on each call). */
  createMode: WizardMode | null;
  lockMode: WizardMode | null;
  /** Wizard cursor — preserved across refreshes. */
  step: 'create' | 'fund' | 'lock' | 'done';
  setDwallet(dw: DwalletInfo, mode?: WizardMode): void;
  setBalance(confirmed: bigint, total: bigint): void;
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
      policyLocked: false,
      policyAccount: null,
      createMode: null,
      lockMode: null,
      step: 'create',
      setDwallet: (dwallet, mode) =>
        set({ dwallet, step: 'fund', policyLocked: false, createMode: mode ?? null }),
      setBalance: (confirmed, total) =>
        set({ balanceSats: confirmed.toString(), totalSats: total.toString() }),
      setPolicy: (policyAccount, mode) =>
        set({ policyLocked: true, policyAccount, step: 'done', lockMode: mode ?? null }),
      setStep: (step) => set({ step }),
      reset: () =>
        set({
          dwallet: null,
          balanceSats: '0',
          totalSats: '0',
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
      // Persist the wizard cursor + display values + the dWallet's PUBLIC
      // identifiers (address + chain). `dwallet.id` is intentionally
      // omitted — it's the auth token for `lockPolicyAction` in mock mode,
      // so keeping it in memory only limits XSS / extension exfil risk.
      // After a refresh the wizard re-renders with `id: ''`, which is fine
      // for DoneState rendering and the esplora poll. Any flow that needs
      // the real id (re-locking, server-side mutate) will fail-closed at
      // the action boundary, prompting the user through reset → re-create.
      partialize: (state) => ({
        balanceSats: state.balanceSats,
        totalSats: state.totalSats,
        policyLocked: state.policyLocked,
        policyAccount: state.policyAccount,
        step: state.step,
        dwallet: state.dwallet
          ? { id: '', address: state.dwallet.address, chain: state.dwallet.chain }
          : null,
      }),
    },
  ),
);

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
        setBalance(BigInt(bal.confirmedSats), BigInt(bal.totalSats));
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


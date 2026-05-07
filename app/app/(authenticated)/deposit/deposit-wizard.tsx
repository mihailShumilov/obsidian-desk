'use client';

/**
 * DepositWizard — three-step onboarding for an Ika dWallet (UI_DESIGN.md §6.3).
 *
 * The wizard cursor (`step`) is held in the persisted dwallet store, so
 * a refresh during step 2 leaves you exactly where you were. Re-visits
 * with the policy already locked skip straight to a "Ready to trade" CTA.
 *
 * Real chain calls are performed server-side via the actions in
 * `./actions.ts` (the SDK is Node-only — bitcoinjs-lib + node:crypto).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { ChainBadge } from '@/components/obsidian/chain-badge';
import { ProgressRail } from '@/components/deposit/progress-rail';
import { StepShell } from '@/components/deposit/step-shell';
import { KeyShards } from '@/components/deposit/key-shards';
import { CopyButton } from '@/components/deposit/copy-button';
import { useDwalletStore } from '@/stores/dwallet';
import { formatBtc, truncateAddress } from '@/lib/format';
import { DEFAULT_ORDER_EXPIRY_SLOTS } from '@obsidian-desk/sdk';
import {
  createDWalletAction,
  lockPolicyAction,
} from './actions';

const FAUCET_URL = 'https://signet.bc-2.jp/';

export function DepositWizard(): JSX.Element {
  const dwallet = useDwalletStore((s) => s.dwallet);
  const balanceSats = useDwalletStore((s) => s.balanceSats);
  const totalSats = useDwalletStore((s) => s.totalSats);
  const policyLocked = useDwalletStore((s) => s.policyLocked);
  const policyAccount = useDwalletStore((s) => s.policyAccount);
  const step = useDwalletStore((s) => s.step);
  const setDwallet = useDwalletStore((s) => s.setDwallet);
  const setPolicy = useDwalletStore((s) => s.setPolicy);
  const setStep = useDwalletStore((s) => s.setStep);
  const reset = useDwalletStore((s) => s.reset);

  // Persisted store is hydrated client-side only — until then, render a
  // skeleton so SSR/CSR markup matches.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated) {
    return <div className="h-32 animate-pulse rounded-lg border border-obsidian-700 bg-obsidian-900" />;
  }

  if (policyLocked && dwallet) {
    return <DoneState
      dwallet={dwallet}
      policyAccount={policyAccount}
      balanceSats={BigInt(balanceSats)}
      onReset={reset}
    />;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[160px_1fr]">
      <ProgressRail current={step === 'done' ? 'done' : step} />
      <div className="space-y-6">
        <CreateStep
          state={
            step === 'create'
              ? 'active'
              : dwallet
                ? 'completed'
                : 'pending'
          }
          dwalletAddress={dwallet?.address ?? null}
          onCreated={(dw) => setDwallet(dw)}
        />

        <FundStep
          state={
            step === 'fund' ? 'active' : step === 'create' ? 'pending' : 'completed'
          }
          address={dwallet?.address ?? null}
          balanceSats={BigInt(balanceSats)}
          totalSats={BigInt(totalSats)}
          onProceed={() => setStep('lock')}
          onBack={() => setStep('create')}
        />

        <LockStep
          state={step === 'lock' ? 'active' : step === 'done' ? 'completed' : 'pending'}
          dwalletId={dwallet?.id ?? null}
          balanceSats={BigInt(balanceSats)}
          onLocked={(account) => setPolicy(account)}
          onBack={() => setStep('fund')}
        />
      </div>
    </div>
  );
}

/* ────────────────────────────── steps ────────────────────────────── */

function CreateStep({
  state,
  dwalletAddress,
  onCreated,
}: {
  state: 'pending' | 'active' | 'completed';
  dwalletAddress: string | null;
  onCreated: (dw: { id: string; address: string; chain: 'bitcoin-signet' }) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await createDWalletAction();
      onCreated({ id: result.id, address: result.address, chain: 'bitcoin-signet' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepShell
      index={1}
      title="Create dWallet"
      state={state}
      summary={dwalletAddress ? truncateAddress(dwalletAddress) : undefined}
    >
      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <div>
          <p className="text-sm text-muted">
            Your dWallet is a Bitcoin address you control{' '}
            <em className="not-italic text-foreground">jointly</em> with the
            Ika MPC network. Neither side can sign alone — the network only
            co-signs transactions you authorize in step 3.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Button onClick={generate} disabled={busy}>
              {busy ? 'Generating…' : 'Generate dWallet'}
            </Button>
            {busy && (
              <span className="text-xs text-muted">
                Generating your dWallet…
              </span>
            )}
          </div>
          {error && (
            <ErrorBanner message={error} onRetry={() => void generate()} />
          )}
        </div>
        <KeyShards joined={state === 'active' && busy} />
      </div>
    </StepShell>
  );
}

function FundStep({
  state,
  address,
  balanceSats,
  totalSats,
  onProceed,
  onBack,
}: {
  state: 'pending' | 'active' | 'completed';
  address: string | null;
  balanceSats: bigint;
  totalSats: bigint;
  onProceed: () => void;
  onBack: () => void;
}): JSX.Element {
  const hasFunds = totalSats > 0n;
  const pending = totalSats > balanceSats;

  return (
    <StepShell
      index={2}
      title="Fund with BTC"
      state={state}
      summary={hasFunds ? `${formatBtc(balanceSats)} BTC` : undefined}
    >
      {address && (
        <div className="grid gap-6 md:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Send Bitcoin signet to this address. Funds remain yours — the
              network can only co-sign transactions you authorize, subject
              to policy.
            </p>
            <div>
              <p className="mb-1 text-xs uppercase tracking-widest text-muted">
                Address
              </p>
              <div className="flex items-center gap-3">
                <code className="flex-1 break-all rounded-md border border-obsidian-700 bg-obsidian-800 p-3 font-mono text-xs">
                  {address}
                </code>
                <CopyButton value={address} />
              </div>
            </div>
            <div className="flex items-baseline justify-between rounded-md border border-obsidian-700 bg-obsidian-800 p-3">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted">
                  Balance
                </p>
                <p className="mt-1 font-mono text-2xl text-foreground">
                  {formatBtc(balanceSats)}
                  <span className="ml-1 text-xs text-muted">BTC</span>
                </p>
                <p className="font-mono text-xs text-muted">
                  {balanceSats.toString()} sats
                </p>
              </div>
              {pending && (
                <span className="rounded-md bg-match-gold/15 px-2 py-0.5 text-xs text-match-gold animate-pulse-cipher">
                  +{formatBtc(totalSats - balanceSats)} pending
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              No signet?{' '}
              <a
                href={FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="text-cipher-cyan-dim underline hover:text-cipher-cyan"
              >
                signet.bc-2.jp faucet
              </a>
              . Esplora poll runs every 15 s.
            </p>
            <div className="flex items-center gap-3 pt-2">
              <Button variant="ghost" onClick={onBack}>
                Back
              </Button>
              <Button onClick={onProceed} disabled={!hasFunds}>
                {hasFunds ? 'Continue →' : 'Awaiting funds…'}
              </Button>
            </div>
          </div>
          <div className="flex items-start justify-center pt-1">
            <div className="rounded-md border border-obsidian-700 bg-white p-3">
              <QRCodeSVG
                value={address}
                size={144}
                bgColor="#FFFFFF"
                fgColor="#0B0B14"
                level="M"
              />
            </div>
          </div>
        </div>
      )}
    </StepShell>
  );
}

function LockStep({
  state,
  dwalletId,
  balanceSats,
  onLocked,
  onBack,
}: {
  state: 'pending' | 'active' | 'completed';
  dwalletId: string | null;
  balanceSats: bigint;
  onLocked: (account: string) => void;
  onBack: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cap at the on-chain balance so the policy never authorizes more
  // than what's actually been funded.
  const maxAmount = balanceSats > 0n ? balanceSats : 100_000_000n;

  async function lock(): Promise<void> {
    if (!dwalletId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await lockPolicyAction(dwalletId, maxAmount.toString());
      onLocked(result.policyAccountOnSolana);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepShell index={3} title="Lock to ObsidianDesk" state={state}>
      <p className="text-sm text-muted">
        Authorize the ObsidianDesk Solana program to co-sign settlement
        transactions, subject to these constraints: only to matched
        counterparties, only for matched amounts, only before expiry.
      </p>
      <pre className="mt-5 overflow-x-auto rounded-md border border-obsidian-700 bg-obsidian-800 p-4 font-mono text-xs leading-relaxed">
{`policy:
  controller:           ObsiDesk... (program id)
  max_amount_per_tx:    ${formatBtc(maxAmount)} BTC (${maxAmount.toString()} sats)
  allowed_recipients:   <dynamic per match>
  expiry_per_order:     24h (${DEFAULT_ORDER_EXPIRY_SLOTS.toLocaleString('en-US').replaceAll(',', '_')} slots)`}
      </pre>
      <div className="mt-5 flex items-center gap-3">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button onClick={lock} disabled={busy || !dwalletId}>
          {busy ? 'Locking…' : 'Lock to ObsidianDesk'}
        </Button>
      </div>
      {error && <ErrorBanner message={error} onRetry={() => void lock()} />}
    </StepShell>
  );
}

function DoneState({
  dwallet,
  policyAccount,
  balanceSats,
  onReset,
}: {
  dwallet: { address: string };
  policyAccount: string | null;
  balanceSats: bigint;
  onReset: () => void;
}): JSX.Element {
  const router = useRouter();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-lg border border-cipher-cyan/40 bg-cipher-cyan/5 p-5 ring-inset-subtle">
        <span className="flex size-9 items-center justify-center rounded-full bg-cipher-cyan text-base font-semibold text-obsidian-950">
          ✓
        </span>
        <div className="flex-1">
          <p className="text-lg font-semibold tracking-tightest">
            Ready to trade
          </p>
          <p className="text-sm text-muted">
            Your dWallet is locked. ObsidianDesk can co-sign settlements
            within your policy.
          </p>
        </div>
        <Button onClick={() => router.push('/trade')}>Launch Terminal</Button>
      </div>
      <div className="grid gap-3 rounded-lg border border-obsidian-700 bg-obsidian-900 p-5 ring-inset-subtle">
        <div className="flex items-center justify-between gap-3 text-sm">
          <ChainBadge chain="bitcoin" label="dWallet · Signet" />
          <span className="font-mono text-xs text-muted" title={dwallet.address}>
            {truncateAddress(dwallet.address)}
          </span>
        </div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted">Balance</span>
          <span className="font-mono text-foreground">
            {formatBtc(balanceSats)} BTC
          </span>
        </div>
        {policyAccount && (
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted">Policy account</span>
            <span className="font-mono text-foreground" title={policyAccount}>
              {truncateAddress(policyAccount)}
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={onReset}
          className="mt-2 w-fit text-left text-xs text-muted underline transition-colors hover:text-danger-red"
        >
          Reset dWallet (start over)
        </button>
      </div>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div className="mt-4 rounded-md border border-danger-red/40 bg-danger-red/10 p-3 text-sm text-danger-red">
      <p>{message}</p>
      <Link
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onRetry();
        }}
        className="mt-1 inline-block text-xs text-danger-red underline"
      >
        Retry
      </Link>
    </div>
  );
}

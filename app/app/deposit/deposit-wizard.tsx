'use client';

import { useState } from 'react';
import { createDWalletAction, lockPolicyAction } from './actions';

type Stage = 'create' | 'fund' | 'lock' | 'done';

interface DWalletInfo {
  id: string;
  address: string;
}

export function DepositWizard() {
  const [stage, setStage] = useState<Stage>('create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dwallet, setDwallet] = useState<DWalletInfo | null>(null);
  const [policyAccount, setPolicyAccount] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const result = await createDWalletAction();
      setDwallet({ id: result.id, address: result.address });
      setStage('fund');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    if (!dwallet) return;
    setBusy(true);
    setError(null);
    try {
      // 1 BTC cap for the demo. P8 wires this to the real balance.
      const result = await lockPolicyAction(dwallet.id, '100000000');
      setPolicyAccount(result.policyAccountOnSolana);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <Step n={1} title="Create dWallet" active={stage === 'create'}>
        <p className="text-sm text-muted">
          Generate a Bitcoin signet dWallet co-controlled with the Ika
          network. P4 scaffold: a real keypair is synthesized client-side
          (mock mode); P9 wires real Ika DKG.
        </p>
        {stage === 'create' ? (
          <button
            onClick={handleCreate}
            disabled={busy}
            className="mt-4 rounded-md border border-foreground/20 px-4 py-2 text-sm hover:bg-obsidian-900 disabled:opacity-50"
          >
            {busy ? 'Generating…' : 'Generate dWallet'}
          </button>
        ) : (
          <p className="mt-4 font-mono text-xs text-muted">
            id: {dwallet?.id.slice(0, 16)}…
          </p>
        )}
      </Step>

      <Step
        n={2}
        title="Fund with BTC"
        active={stage === 'fund'}
        muted={stage === 'create'}
      >
        <p className="text-sm text-muted">
          Send signet BTC to the dWallet address. Funds remain yours — the
          network only co-signs settlements you authorize in step 3.
        </p>
        {dwallet && (
          <div className="mt-4 space-y-2">
            <div className="break-all rounded-md border border-foreground/10 bg-obsidian-900 p-3 font-mono text-xs">
              {dwallet.address}
            </div>
            <p className="text-xs text-muted">
              Signet faucet:{' '}
              <a
                href="https://signet.bc-2.jp/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                signet.bc-2.jp
              </a>
            </p>
            {stage === 'fund' && (
              <button
                onClick={() => setStage('lock')}
                className="rounded-md border border-foreground/20 px-4 py-2 text-sm hover:bg-obsidian-900"
              >
                I&apos;ve funded it →
              </button>
            )}
          </div>
        )}
      </Step>

      <Step
        n={3}
        title="Lock to ObsidianDesk"
        active={stage === 'lock'}
        muted={stage !== 'lock' && stage !== 'done'}
      >
        <p className="text-sm text-muted">
          Authorize the ObsidianDesk Solana program to co-sign settlement
          transactions, subject to the policy below.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-foreground/10 bg-obsidian-900 p-3 font-mono text-xs">
{`policy:
  controller:        ObsiDesk... (program id)
  max_amount_sats:   100_000_000  (1 BTC)
  expiry_slots:      216_000      (~24h)
  allowed_recipients: <dynamic per match>`}
        </pre>
        {stage === 'lock' && (
          <button
            onClick={handleLock}
            disabled={busy}
            className="mt-4 rounded-md border border-foreground/20 px-4 py-2 text-sm hover:bg-obsidian-900 disabled:opacity-50"
          >
            {busy ? 'Locking…' : 'Lock to ObsidianDesk'}
          </button>
        )}
        {stage === 'done' && policyAccount && (
          <p className="mt-4 font-mono text-xs text-muted">
            Policy account: {policyAccount}
          </p>
        )}
      </Step>

      {error && (
        <p className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function Step({
  n,
  title,
  active,
  muted,
  children,
}: {
  n: number;
  title: string;
  active: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-lg border p-6 ${
        active
          ? 'border-foreground/30 bg-obsidian-900'
          : 'border-foreground/10 bg-obsidian-950'
      } ${muted ? 'opacity-60' : ''}`}
    >
      <h2 className="text-lg font-semibold">
        <span className="mr-2 text-muted">{n}.</span>
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

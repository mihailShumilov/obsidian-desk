'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChainBadge } from '@/components/obsidian/chain-badge';
import { createDWalletAction, lockPolicyAction } from './actions';

type Stage = 'create' | 'fund' | 'lock' | 'done';

interface DWalletInfo {
  id: string;
  address: string;
}

export function DepositWizard(): JSX.Element {
  const [stage, setStage] = useState<Stage>('create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dwallet, setDwallet] = useState<DWalletInfo | null>(null);
  const [policyAccount, setPolicyAccount] = useState<string | null>(null);

  async function handleCreate(): Promise<void> {
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

  async function handleLock(): Promise<void> {
    if (!dwallet) return;
    setBusy(true);
    setError(null);
    try {
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
    <div className="space-y-6">
      <Step n={1} title="Create dWallet" active={stage === 'create'}>
        <p className="text-sm text-muted">
          Generate a Bitcoin signet dWallet co-controlled with the Ika
          network. Mock mode in this scaffold; real Ika DKG lands in P9.
        </p>
        {stage === 'create' ? (
          <div className="mt-4">
            <Button onClick={handleCreate} disabled={busy}>
              {busy ? 'Generating…' : 'Generate dWallet'}
            </Button>
          </div>
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
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <ChainBadge chain="bitcoin" />
              <span className="text-xs text-muted">Signet</span>
            </div>
            <div className="break-all rounded-md border border-obsidian-700 bg-obsidian-800 p-3 font-mono text-xs">
              {dwallet.address}
            </div>
            <p className="text-xs text-muted">
              Faucet:{' '}
              <a
                href="https://signet.bc-2.jp/"
                target="_blank"
                rel="noreferrer"
                className="text-cipher-cyan-dim underline hover:text-cipher-cyan"
              >
                signet.bc-2.jp
              </a>
            </p>
            {stage === 'fund' && (
              <Button
                variant="secondary"
                onClick={() => setStage('lock')}
              >
                I&apos;ve funded it →
              </Button>
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
        <pre className="mt-4 overflow-x-auto rounded-md border border-obsidian-700 bg-obsidian-800 p-3 font-mono text-xs">
{`policy:
  controller:        ObsiDesk... (program id)
  max_amount_sats:   100_000_000  (1 BTC)
  expiry_slots:      216_000      (~24h)
  allowed_recipients: <dynamic per match>`}
        </pre>
        {stage === 'lock' && (
          <div className="mt-4">
            <Button onClick={handleLock} disabled={busy}>
              {busy ? 'Locking…' : 'Lock to ObsidianDesk'}
            </Button>
          </div>
        )}
        {stage === 'done' && policyAccount && (
          <p className="mt-4 font-mono text-xs text-muted">
            Policy account: {policyAccount}
          </p>
        )}
      </Step>

      {error && (
        <p className="rounded-md border border-danger-red/40 bg-danger-red/10 p-3 text-sm text-danger-red">
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
}): JSX.Element {
  return (
    <Card
      className={`p-6 transition-colors ${
        active ? 'border-cipher-cyan/40' : ''
      } ${muted ? 'opacity-60' : ''}`}
    >
      <h2 className="text-lg font-semibold tracking-tightest">
        <span className="mr-2 text-muted">{n}.</span>
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </Card>
  );
}

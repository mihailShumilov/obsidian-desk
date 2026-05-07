import { DepositWizard } from './deposit-wizard';

export const metadata = {
  title: 'Deposit · ObsidianDesk',
};

export default function DepositPage(): JSX.Element {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tightest">Onboard</h1>
      <p className="mt-2 text-sm text-muted">
        Three steps. The dark pool unlocks once your dWallet is locked to
        ObsidianDesk.
      </p>
      <div className="mt-10">
        <DepositWizard />
      </div>
    </main>
  );
}

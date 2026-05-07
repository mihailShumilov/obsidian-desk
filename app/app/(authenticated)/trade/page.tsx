import { Suspense } from 'react';
import { TradeTerminal } from './trade-terminal';

export const metadata = { title: 'Trade · ObsidianDesk' };

export default function TradePage(): JSX.Element {
  // Suspense boundary required because TradeTerminal calls
  // useSearchParams() (?admin=1 mode). Without it Next 16 errors at build.
  return (
    <Suspense fallback={<div className="h-32" />}>
      <TradeTerminal />
    </Suspense>
  );
}

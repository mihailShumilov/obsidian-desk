import type { Metadata } from 'next';
import { PitchDeck } from '@/components/pitch/pitch-deck';

export const metadata: Metadata = {
  title: 'ObsidianDesk — Pitch deck',
  description:
    'The dark pool where Bitcoin never leaves Bitcoin. Encrypted orderbook on Solana, native BTC settlement via Ika dWallets.',
};

export default function PitchPage(): JSX.Element {
  return <PitchDeck />;
}

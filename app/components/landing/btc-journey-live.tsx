/**
 * Server wrapper for BtcJourney — fetches the current signet tip from
 * mempool.space (cached 60s) and threads it into the client component.
 *
 * Lives in a separate file because BtcJourney is a `'use client'` boundary
 * (framer-motion + Cipher) and cannot itself perform server-side fetches.
 * If the fetch fails, we render with `tip={null}` and the component falls
 * back to demo placeholders.
 */

import { fetchSignetTip } from '@/lib/signet';
import { BtcJourney } from './btc-journey';

export async function BtcJourneyLive(): Promise<JSX.Element> {
  const tip = await fetchSignetTip();
  return <BtcJourney tip={tip} />;
}

import { NotImplementedError } from './errors.js';

export type Chain = 'bitcoin' | 'bitcoin-signet' | 'bitcoin-testnet';

export interface DWallet {
  id: string;
  chain: Chain;
  address: string;
}

export interface PolicyRule {
  kind: string;
  [k: string]: unknown;
}

export interface Policy {
  controller: string;
  maxAmountSats: bigint;
  expirySlots: number;
  rules: PolicyRule[];
}

export interface BtcUnsignedTx {
  psbt: string;
  inputs: ReadonlyArray<{ txid: string; vout: number; valueSats: bigint }>;
  outputs: ReadonlyArray<{ address: string; valueSats: bigint }>;
}

export async function createDWallet(_chain: Chain): Promise<DWallet> {
  throw new NotImplementedError('ika.createDWallet');
}

export async function lockPolicy(
  _dwalletId: string,
  _policy: Policy,
): Promise<{ policyAccountOnSolana: string }> {
  throw new NotImplementedError('ika.lockPolicy');
}

export async function requestSign(
  _dwalletId: string,
  _btcTx: BtcUnsignedTx,
  _solanaProof: { txSignature: string; matchId: bigint },
): Promise<{ signedTxHex: string; broadcastTxid?: string }> {
  throw new NotImplementedError('ika.requestSign');
}

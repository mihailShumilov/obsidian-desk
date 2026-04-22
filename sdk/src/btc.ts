/**
 * Bitcoin transaction builder for ObsidianDesk.
 *
 * Builds P2WPKH spend transactions on signet (default) or testnet via
 * `bitcoinjs-lib`. The signing step lives in `ika.ts` — this module only
 * produces unsigned PSBTs and re-attaches signed inputs.
 *
 * Constraints:
 *  - All amounts are `bigint` satoshis (never floats — see project rule).
 *  - Networks are limited to signet + testnet for the hackathon scope.
 *  - For mock-mode end-to-end tests, the broadcast helper short-circuits.
 */

import * as ecc from 'tiny-secp256k1';
import { ECPairFactory, type ECPairInterface } from 'ecpair';
import { address as btcAddress, networks, payments, Psbt } from 'bitcoinjs-lib';
import type { Network } from 'bitcoinjs-lib';
import { EncryptionError } from './errors.ts';

const ECPair = ECPairFactory(ecc);

export type BtcNetworkName = 'signet' | 'testnet';

export interface BtcUnsignedTx {
  /** Base64-encoded PSBT. */
  psbt: string;
  inputs: ReadonlyArray<{ txid: string; vout: number; valueSats: bigint }>;
  outputs: ReadonlyArray<{ address: string; valueSats: bigint }>;
  network: BtcNetworkName;
}

export interface SpendInput {
  txid: string;
  vout: number;
  valueSats: bigint;
  /** Hex-encoded script pubkey for the input UTXO (witness script for P2WPKH). */
  scriptPubKeyHex: string;
}

const SIGNET: Network = {
  ...networks.testnet,
  bech32: 'tb',
};

export function networkFor(name: BtcNetworkName): Network {
  return name === 'signet' ? SIGNET : networks.testnet;
}

/**
 * Build an unsigned P2WPKH spend tx from `from` to `to` for `amountSats`,
 * paying `feerateSatPerVB` and dropping change back to `from`.
 *
 * The `inputs` parameter MUST be UTXOs owned by `from` (caller is
 * responsible for selection). Returns a base64 PSBT for downstream signing.
 */
export function buildSpendTx(
  from: string,
  to: string,
  amountSats: bigint,
  feerateSatPerVB: number,
  inputs: ReadonlyArray<SpendInput>,
  network: BtcNetworkName = 'signet',
): BtcUnsignedTx {
  if (amountSats <= 0n) {
    throw new EncryptionError('buildSpendTx: amountSats must be > 0');
  }
  if (!Number.isFinite(feerateSatPerVB) || feerateSatPerVB <= 0) {
    throw new EncryptionError('buildSpendTx: feerateSatPerVB must be > 0');
  }
  if (inputs.length === 0) {
    throw new EncryptionError('buildSpendTx: at least one input UTXO required');
  }

  const net = networkFor(network);
  const psbt = new Psbt({ network: net });

  let totalIn = 0n;
  for (const inp of inputs) {
    psbt.addInput({
      hash: inp.txid,
      index: inp.vout,
      witnessUtxo: {
        script: Buffer.from(inp.scriptPubKeyHex, 'hex'),
        value: inp.valueSats,
      },
    });
    totalIn += inp.valueSats;
  }

  // Conservative size estimate for vbyte-based fee:
  //   inputs * 68 vB (P2WPKH witness) + outputs * 31 vB + 11 vB overhead.
  const estVBytes = inputs.length * 68 + 2 * 31 + 11;
  const feeSats = BigInt(Math.ceil(feerateSatPerVB * estVBytes));
  if (totalIn < amountSats + feeSats) {
    throw new EncryptionError(
      'buildSpendTx: input UTXO value insufficient for amount + fee',
    );
  }
  const changeSats = totalIn - amountSats - feeSats;

  psbt.addOutput({ address: to, value: amountSats });
  if (changeSats > 0n) {
    psbt.addOutput({ address: from, value: changeSats });
  }

  return {
    psbt: psbt.toBase64(),
    inputs: inputs.map((i) => ({
      txid: i.txid,
      vout: i.vout,
      valueSats: i.valueSats,
    })),
    outputs:
      changeSats > 0n
        ? [
            { address: to, valueSats: amountSats },
            { address: from, valueSats: changeSats },
          ]
        : [{ address: to, valueSats: amountSats }],
    network,
  };
}

/**
 * Sign every input of `unsigned` with `key` and return the finalized tx hex.
 * Caller must pass a key that controls every input UTXO (we don't do partial
 * sign + relay PSBT here — this is the single-signer mock path).
 */
export function signAndFinalize(unsigned: BtcUnsignedTx, key: ECPairInterface): string {
  const net = networkFor(unsigned.network);
  const psbt = Psbt.fromBase64(unsigned.psbt, { network: net });
  for (let i = 0; i < unsigned.inputs.length; i++) {
    psbt.signInput(i, key);
  }
  psbt.finalizeAllInputs();
  return psbt.extractTransaction().toHex();
}

/**
 * Generate a fresh P2WPKH keypair for `network`. Returns the wallet WIF
 * (caller must store securely) and the bech32 address.
 *
 * Used by `ika.ts` mock mode to synthesize dWallet-like keys locally;
 * **do not use this for production custody** — real dWallets are 2PC-MPC
 * shares, never single private keys.
 */
export function generateP2wpkh(network: BtcNetworkName = 'signet'): {
  wif: string;
  address: string;
  publicKey: Buffer;
} {
  const net = networkFor(network);
  const key = ECPair.makeRandom({ network: net });
  const { address } = payments.p2wpkh({ pubkey: Buffer.from(key.publicKey), network: net });
  if (!address) {
    throw new EncryptionError('generateP2wpkh: bitcoinjs-lib failed to derive an address');
  }
  return {
    wif: key.toWIF(),
    address,
    publicKey: Buffer.from(key.publicKey),
  };
}

export function fromWIF(wif: string, network: BtcNetworkName = 'signet'): ECPairInterface {
  return ECPair.fromWIF(wif, networkFor(network));
}

/**
 * Derive the hex-encoded P2WPKH output script for a bech32 address.
 * Used by mock UTXO providers so the synthesized input has a script that
 * matches the keypair backing `address` — otherwise PSBT signing fails
 * with "non-segwit script".
 */
export function scriptForAddress(address: string, network: BtcNetworkName = 'signet'): string {
  return Buffer.from(btcAddress.toOutputScript(address, networkFor(network))).toString('hex');
}

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
import {
  address as btcAddress,
  crypto as bjsCrypto,
  networks,
  payments,
  Psbt,
  script as bjsScript,
  Transaction,
} from 'bitcoinjs-lib';
import type { Network } from 'bitcoinjs-lib';
import { EncryptionError } from './errors.ts';
import { resolveMode, tryReal, type Mode, type ModeResult } from './mode.ts';

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
 * Derive a P2WPKH address from a 33-byte compressed secp256k1 public key.
 * Used to render the BTC address for an Ika dWallet whose private share lives
 * in the network — we never have a full private key client-side.
 */
export function p2wpkhAddressFromPublicKey(
  publicKey: Uint8Array,
  network: BtcNetworkName = 'signet',
): string {
  const net = networkFor(network);
  const { address } = payments.p2wpkh({ pubkey: Buffer.from(publicKey), network: net });
  if (!address) {
    throw new EncryptionError('p2wpkhAddressFromPublicKey: bitcoinjs-lib failed to derive an address');
  }
  return address;
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

// ────────────────────────────────────────────────────────────────────────────
// Esplora-backed UTXO discovery + signet broadcast
//
// These are the helpers that turn ObsidianDesk from "constructs valid PSBTs"
// into "actually moves Bitcoin on signet". Both routed through `tryReal()`
// so the same env-driven mock/real/auto rules apply uniformly across the
// stack.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Default mempool.space esplora endpoints. Override per-network via env:
 *   OBSIDIAN_ESPLORA_SIGNET_URL  / OBSIDIAN_ESPLORA_TESTNET_URL
 */
const ESPLORA_DEFAULTS: Record<BtcNetworkName, string> = {
  signet: 'https://mempool.space/signet/api',
  testnet: 'https://mempool.space/testnet/api',
};

function esploraUrl(network: BtcNetworkName, env: NodeJS.ProcessEnv = process.env): string {
  const k =
    network === 'signet' ? 'OBSIDIAN_ESPLORA_SIGNET_URL' : 'OBSIDIAN_ESPLORA_TESTNET_URL';
  return env[k] ?? ESPLORA_DEFAULTS[network];
}

interface EsploraUtxo {
  txid: string;
  vout: number;
  status: { confirmed: boolean };
  value: number;
}

/**
 * Fetch confirmed UTXOs for `address` from esplora. Returns SpendInput[]
 * ready to feed into `buildSpendTx`. Unconfirmed UTXOs are ignored — signet
 * confirms in ~10 min so this only matters during the demo's pre-fund step.
 *
 * Mode behaviour:
 *  - `mock`: synthesises ONE 1-BTC UTXO so unit tests don't need network.
 *  - `real`: throws on any network failure.
 *  - `auto`: tries real, falls back to mock UTXO on transient failure.
 *
 * Real-mode failures still throw if the upstream returns an error response
 * (no UTXOs, malformed JSON, etc.) — those are logical, not transient.
 */
export async function getAddressUtxos(
  address: string,
  network: BtcNetworkName = 'signet',
  mode: Mode = resolveMode('btc'),
): Promise<ModeResult<SpendInput[]>> {
  const script = scriptForAddress(address, network);
  return tryReal({
    surface: 'btc',
    op: 'getAddressUtxos',
    mode,
    real: async (signal) => {
      const res = await fetch(`${esploraUrl(network)}/address/${encodeURIComponent(address)}/utxo`, {
        signal,
      });
      if (!res.ok) {
        // 4xx → logical (bad address). 5xx is recognised as transient by mode.ts.
        const err: Error & { status?: number } = new Error(
          `esplora /utxo returned ${res.status}`,
        );
        err.status = res.status;
        throw err;
      }
      const utxos = (await res.json()) as EsploraUtxo[];
      // We need confirmed inputs — unconfirmed UTXOs may not survive a reorg
      // and signet's per-block subsidy is tiny anyway.
      return utxos
        .filter((u) => u.status.confirmed)
        .map((u) => ({
          txid: u.txid,
          vout: u.vout,
          valueSats: BigInt(u.value),
          scriptPubKeyHex: script,
        }));
    },
    mock: async () => [synthesizeUtxo(address, network)],
  });
}

/**
 * Synthesise a single 1-BTC UTXO for `address`. Used by mock-mode tests and
 * by auto-mode fallback when esplora is down. The txid is derived
 * deterministically from the address so concurrent calls don't collide.
 *
 * The synthesised UTXO is NOT broadcastable — the keeper's mock signing
 * path produces a tx that signet would reject (because the input UTXO
 * doesn't exist). That's deliberate; we don't want mock-mode demos to
 * accidentally broadcast garbage to a real network.
 */
export function synthesizeUtxo(address: string, network: BtcNetworkName = 'signet'): SpendInput {
  // 32-byte sha-256 of the address → valid 64-hex txid. bitcoinjs-lib's PSBT
  // input parser only checks length + hex, not chain membership.
  return {
    txid: sha256Hex(address),
    vout: 0,
    valueSats: 100_000_000n, // 1 BTC, more than enough for any demo trade size.
    scriptPubKeyHex: scriptForAddress(address, network),
  };
}

// Sync sha-256 via bitcoinjs-lib's bundled crypto (browser-safe — keeps the
// `btc` barrel free of node:crypto so client bundles don't break).
function sha256Hex(input: string): string {
  return Buffer.from(bjsCrypto.sha256(Buffer.from(input, 'utf8'))).toString('hex');
}

/**
 * Broadcast a finalised tx hex to signet (or testnet). Returns the txid the
 * upstream relay reports back. In mock/auto-fallback mode, returns a
 * locally-derived txid (sha-256 of the hex) and logs that no broadcast
 * happened.
 *
 * After this returns, the caller should pass the resulting txid into the
 * Solana program's `finalize_settlement` so `/positions` can render a
 * mempool.space link that actually resolves.
 */
export async function broadcastTx(
  signedTxHex: string,
  network: BtcNetworkName = 'signet',
  mode: Mode = resolveMode('btc'),
): Promise<ModeResult<string>> {
  if (!/^[0-9a-fA-F]+$/.test(signedTxHex) || signedTxHex.length === 0) {
    throw new EncryptionError('broadcastTx: signedTxHex must be non-empty hex');
  }
  return tryReal({
    surface: 'btc',
    op: 'broadcastTx',
    mode,
    real: async (signal) => {
      const res = await fetch(`${esploraUrl(network)}/tx`, {
        method: 'POST',
        body: signedTxHex,
        headers: { 'content-type': 'text/plain' },
        signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err: Error & { status?: number } = new Error(
          `esplora POST /tx returned ${res.status}: ${body.slice(0, 200)}`,
        );
        err.status = res.status;
        throw err;
      }
      // Esplora returns the txid as plain text on success.
      const txid = (await res.text()).trim();
      if (!/^[0-9a-f]{64}$/.test(txid)) {
        throw new Error(`esplora returned malformed txid: ${txid.slice(0, 80)}`);
      }
      return txid;
    },
    mock: async () => {
      // Local txid derivation — sha-256 of the hex. NOT a real txid; the
      // tx is not on chain. Useful so /positions still has something
      // unique-looking to render in mock-mode dev.
      return sha256Hex(signedTxHex);
    },
  });
}

/**
 * mempool.space transaction URL for use in toasts / UI links. Caller is
 * responsible for not calling this with a synthetic mock txid — the link
 * will 404. The `/positions` page should only render this when the row's
 * `mode === 'real-ok'` for the broadcast.
 */
export function mempoolSpaceTxUrl(txid: string, network: BtcNetworkName = 'signet'): string {
  return `https://mempool.space/${network}/tx/${txid}`;
}

// ────────────────────────────────────────────────────────────────────────────
// External-signer plumbing — closes gap I1's sign-surface.
//
// `signAndFinalize` (above) is the single-key happy path: it has the WIF, so
// it computes the BIP-143 sighash, signs, DER-encodes, attaches, finalises
// in one go. When the signer is *external* (Ika MPC), we need to break that
// apart: extract the sighash so the external signer can sign it, then plug
// the returned (r, s) back into the PSBT as a partial sig and finalise.
//
// The three helpers below cover that flow:
//   1. `bip143SighashForP2WPKH` — extract the sighash for a single P2WPKH input.
//   2. `attachExternalEcdsaSig` — DER-encode the external (r, s), attach
//                                 to the PSBT as a partial sig, return the
//                                 updated base64 PSBT.
//   3. `finalizePsbt`           — finalise + extract signed tx hex.
// ────────────────────────────────────────────────────────────────────────────

const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const SECP256K1_HALF_N = SECP256K1_N >> 1n;
const SIGHASH_ALL = 0x01;

/**
 * Compute the BIP-143 segwit-v0 sighash for input `inputIndex` of `psbtBase64`.
 * Caller guarantees the input is P2WPKH and that `witnessUtxo` is set
 * (the keeper-side `buildSpendTx` always sets it).
 *
 * Returns the 32-byte digest. This is what an external ECDSA signer must
 * sign (the network must NOT apply additional hashing — the sighash is
 * already the final SHA256(SHA256(preimage))).
 */
export function bip143SighashForP2WPKH(
  psbtBase64: string,
  inputIndex: number,
  network: BtcNetworkName = 'signet',
): Buffer {
  const net = networkFor(network);
  const psbt = Psbt.fromBase64(psbtBase64, { network: net });
  if (inputIndex < 0 || inputIndex >= psbt.inputCount) {
    throw new EncryptionError(`bip143SighashForP2WPKH: inputIndex ${inputIndex} out of range`);
  }

  // Cast through `unknown` because PSBT's typed `data.inputs` doesn't expose
  // witnessUtxo in the public surface; we read it as a structural shape.
  const inputs = (psbt as unknown as { data: { inputs: Array<{
    witnessUtxo?: { script: Buffer; value: number | bigint };
  }> } }).data.inputs;
  const witnessUtxo = inputs[inputIndex]?.witnessUtxo;
  if (!witnessUtxo) {
    throw new EncryptionError(
      `bip143SighashForP2WPKH: input ${inputIndex} has no witnessUtxo (P2WPKH only)`,
    );
  }

  // For P2WPKH, scriptCode is the equivalent P2PKH script:
  //   OP_DUP OP_HASH160 <pubkeyHash20> OP_EQUALVERIFY OP_CHECKSIG
  // The witness script `0014<pubkeyHash20>` carries the pubkeyHash starting
  // at byte 2 (after OP_0 + push-20).
  const witnessScript = witnessUtxo.script;
  if (witnessScript.length !== 22 || witnessScript[0] !== 0x00 || witnessScript[1] !== 0x14) {
    throw new EncryptionError(
      `bip143SighashForP2WPKH: input ${inputIndex} script is not v0 P2WPKH (got len=${witnessScript.length})`,
    );
  }
  const pubkeyHash = witnessScript.subarray(2);
  const scriptCode = Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 push20
    pubkeyHash,
    Buffer.from([0x88, 0xac]), // OP_EQUALVERIFY OP_CHECKSIG
  ]);

  // Build the unsigned Transaction shape that BIP-143 hashing operates on.
  // PSBT's internal serialisation already covers this — we just extract the
  // tx and call hashForWitnessV0 with the right scriptCode.
  const tx = (psbt as unknown as { __CACHE: { __TX: Transaction } }).__CACHE.__TX;
  const value = typeof witnessUtxo.value === 'bigint'
    ? witnessUtxo.value
    : BigInt(witnessUtxo.value);
  return Buffer.from(tx.hashForWitnessV0(inputIndex, scriptCode, value, SIGHASH_ALL));
}

/**
 * Normalise an ECDSA `s` value to its low-s canonical form per BIP-62.
 * Bitcoin nodes reject signatures with `s > N/2` since 2015; ensure we
 * always emit the canonical form.
 */
export function normaliseLowS(rs64: Uint8Array): Uint8Array {
  if (rs64.length !== 64) {
    throw new EncryptionError(`normaliseLowS: expected 64 bytes (r||s), got ${rs64.length}`);
  }
  let s = 0n;
  for (let i = 32; i < 64; i++) s = (s << 8n) | BigInt(rs64[i]!);
  if (s <= SECP256K1_HALF_N) return rs64;

  const flipped = SECP256K1_N - s;
  const out = new Uint8Array(64);
  out.set(rs64.subarray(0, 32), 0);
  let v = flipped;
  for (let i = 31; i >= 0; i--) {
    out[32 + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * DER-encode a 64-byte (r || s) ECDSA signature and append the SIGHASH_ALL
 * byte (0x01). Result is what bitcoinjs-lib's `psbt.updateInput` expects
 * in the `partialSig.signature` field.
 *
 * Implementation notes:
 *  - `r` and `s` are big-endian unsigned integers; if the MSB is set we
 *    prepend 0x00 so the DER INTEGER stays positive.
 *  - Strip leading zero bytes from each before re-padding (bitcoin wallets
 *    historically vary on how they emit sigs; canonical form is "minimum
 *    bytes representing the value, with one 0x00 padding if MSB is set").
 */
export function derEncodeEcdsaSig(rs64: Uint8Array, sighashType = SIGHASH_ALL): Buffer {
  if (rs64.length !== 64) {
    throw new EncryptionError(`derEncodeEcdsaSig: expected 64 bytes, got ${rs64.length}`);
  }
  const r = trimAndPad(rs64.subarray(0, 32));
  const s = trimAndPad(rs64.subarray(32, 64));
  const total = 2 + r.length + 2 + s.length;
  const out = Buffer.alloc(2 + total + 1);
  out[0] = 0x30;
  out[1] = total;
  out[2] = 0x02;
  out[3] = r.length;
  out.set(r, 4);
  const sOff = 4 + r.length;
  out[sOff] = 0x02;
  out[sOff + 1] = s.length;
  out.set(s, sOff + 2);
  out[out.length - 1] = sighashType;
  return out;
}

/** Strip leading zero bytes; re-pad with 0x00 if the high bit is set so the
 *  DER INTEGER is unambiguously positive. */
function trimAndPad(b: Uint8Array): Buffer {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const trimmed = b.subarray(i);
  if (trimmed[0]! & 0x80) return Buffer.concat([Buffer.from([0x00]), Buffer.from(trimmed)]);
  return Buffer.from(trimmed);
}

/**
 * Take a 64-byte (r || s) signature produced by an external ECDSA signer
 * (e.g. Ika MPC), normalise to low-s, DER-encode, and attach to `psbtBase64`
 * as a partial sig for input `inputIndex`. Returns the updated PSBT base64.
 *
 * Verifies the signature locally before attaching — if `pubkey` doesn't
 * verify the sighash, throws with a clear error rather than letting the
 * keeper produce a tx that signet would reject silently. This is the gate
 * that catches "the network applied an unexpected hash_scheme".
 */
export function attachExternalEcdsaSig(
  psbtBase64: string,
  inputIndex: number,
  pubkey: Uint8Array,
  rs64: Uint8Array,
  network: BtcNetworkName = 'signet',
): string {
  if (pubkey.length !== 33) {
    throw new EncryptionError(`attachExternalEcdsaSig: pubkey must be 33B compressed, got ${pubkey.length}`);
  }
  const sighash = bip143SighashForP2WPKH(psbtBase64, inputIndex, network);
  const lowS = normaliseLowS(rs64);

  // Verify against the dwallet pubkey BEFORE attaching. tiny-secp256k1's
  // verify() returns false for the wrong sig — that's the signal that the
  // upstream applied a different hash_scheme than we assumed.
  if (!ecc.verify(sighash, pubkey, lowS)) {
    throw new EncryptionError(
      'attachExternalEcdsaSig: signature does not verify against the dwallet pubkey + BIP-143 sighash. ' +
      'Likely cause: Ika network applied a hash_scheme to the message we did not expect, or the pubkey ' +
      'is not the dwallet that signed. Check OBSIDIAN_IKA_GRPC_URL and dwallet.publicKey alignment.',
    );
  }

  const der = derEncodeEcdsaSig(lowS, SIGHASH_ALL);
  const net = networkFor(network);
  const psbt = Psbt.fromBase64(psbtBase64, { network: net });
  psbt.updateInput(inputIndex, {
    partialSig: [{ pubkey: Buffer.from(pubkey), signature: der }],
  });
  return psbt.toBase64();
}

/**
 * Finalise every input of `psbtBase64` and return the broadcast-ready hex.
 * Errors if any input lacks a partial sig.
 */
export function finalizePsbt(psbtBase64: string, network: BtcNetworkName = 'signet'): string {
  const net = networkFor(network);
  const psbt = Psbt.fromBase64(psbtBase64, { network: net });
  psbt.finalizeAllInputs();
  return psbt.extractTransaction().toHex();
}

// Re-export the canonical sighash type so callers don't need to know the magic byte.
export { SIGHASH_ALL };
// `bjsScript` re-exposed for advanced callers; kept internal-ish (most users
// only need the helpers above).
void bjsScript;

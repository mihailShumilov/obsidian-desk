/**
 * Keeper matching loop — drives `try_match → request_decryption → finalize_decryption`
 * against the deployed obsidian-core program.
 *
 * Runs in two phases per candidate match:
 *
 *   1. `try_match` — invokes the on-chain FHE comparator via Encrypt's
 *      `execute_graph` CPI. Three fresh ciphertext-keypair accounts are
 *      allocated client-side and signed into the tx; the Encrypt program
 *      writes the encrypted comparator outputs into them. The keeper then
 *      polls each output account until the executor flips status=VERIFIED.
 *
 *   2. `request_decryption` + off-chain `readCiphertext` gRPC reads + on-chain
 *      `finalize_decryption` — snapshots the on-chain ciphertext digests,
 *      reads plaintexts via gRPC (assumes outputs were authored as PUBLIC
 *      so the keeper doesn't need to be the authorized signer), commits
 *      `(can_match, fill_size, clearing_price, seller_is_order_a)` to chain.
 *
 * Settlement-to-BTC continues to flow through `pollOnce` in `poll.ts` — this
 * module only handles the FHE-match → MatchRecord half.
 */

import BN from 'bn.js';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type Signer,
} from '@solana/web3.js';
import * as encryptSdk from '@obsidian-desk/sdk/encrypt';
import { createHash } from 'node:crypto';
import {
  ENCRYPT_PROGRAM_ID,
  IX_CREATE_DEPOSIT,
  deriveEncryptPdas,
  type EncryptPdaSet,
} from './encrypt-pdas.ts';
import type { LooseProgram, LooseProgramMethods } from './anchor-shims.ts';

/** Polled-account status byte per Encrypt's Ciphertext layout (offset 99). */
const CT_STATUS_VERIFIED = 1;
const CT_STATUS_OFFSET = 99;
const CT_LEN = 100;

/** Stored EncryptedOrder shape (subset the keeper inspects). */
interface StoredOrder {
  market: PublicKey;
  owner: PublicKey;
  dwalletId: PublicKey;
  sideCt: number[] | Buffer;
  priceCt: number[] | Buffer;
  sizeCt: number[] | Buffer;
  expirySlot: BN;
  nonce: number[] | Buffer;
  next: PublicKey | null;
  status: Record<string, Record<string, never>>;
  bump: number;
}

export interface MatchPair {
  /** Order-A PDA pubkey. */
  orderA: PublicKey;
  /** Order-B PDA pubkey. */
  orderB: PublicKey;
}

export interface MatchOptions {
  keeperId: string;
  /** How long to wait for the executor to verify each output ct (ms). */
  executorTimeoutMs?: number;
  /** Polling interval while waiting (ms). */
  executorPollMs?: number;
}

export interface MatchResult {
  matchId: bigint;
  matchIntent: PublicKey;
  matchRecord: PublicKey;
  canMatchOut: PublicKey;
  fillSizeOut: PublicKey;
  clearingPriceOut: PublicKey;
}

/**
 * Run the full matching cycle for one pair: try_match → wait for executor →
 * request_decryption → readCiphertext → finalize_decryption. Returns the
 * MatchRecord pubkey on success; throws on any step failure.
 *
 * Caller is responsible for deciding which two orders to match. The full
 * order-book matching (price/time priority, partial fills) lives in a
 * separate `selectMatchPairs` helper that the daemon's tick calls before
 * dispatching here.
 */
export async function runMatchCycle(
  program: LooseProgram,
  market: PublicKey,
  pair: MatchPair,
  keeperAuthority: Signer,
  payer: Signer,
  options: MatchOptions,
): Promise<MatchResult> {
  const connection = program.provider.connection;
  const callerProgram = program.programId;

  const orderA = await fetchOrder(program, pair.orderA);
  const orderB = await fetchOrder(program, pair.orderB);

  // Compute the next match_id by reading market.match_count + 1.
  const marketState = await fetchMarketState(program, market);
  const matchId = BigInt(marketState.matchCount.toString()) + 1n;
  const matchIdLeBytes = u64LeBytes(matchId);

  const [matchIntent] = PublicKey.findProgramAddressSync(
    [Buffer.from('match_intent'), market.toBuffer(), matchIdLeBytes],
    callerProgram,
  );
  const [matchRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from('match'), market.toBuffer(), matchIdLeBytes],
    callerProgram,
  );

  const pdas = await deriveEncryptPdas(
    connection,
    callerProgram,
    payer.publicKey,
  );

  // CREATE mode (gap E2-residual closure): output ct accounts are FRESH
  // keypairs that the execute_graph CPI's inner system_program::create_account
  // allocates. Each keypair signs the outer tx so the inner CPI's signer
  // requirement is satisfied via signer-flag inheritance (the vendor-patched
  // encrypt-anchor at crates/encrypt-anchor-vendor/ propagates the outer-tx
  // is_signer flag through invoke_execute_graph's account_metas).
  const canMatchKeypair = Keypair.generate();
  const fillSizeKeypair = Keypair.generate();
  const clearingPriceKeypair = Keypair.generate();
  const canMatchPubkey = canMatchKeypair.publicKey;
  const fillSizePubkey = fillSizeKeypair.publicKey;
  const clearingPricePubkey = clearingPriceKeypair.publicKey;
  console.log(
    `[keeper ${options.keeperId}] CREATE-mode output cts (fresh keypair signers)`,
  );

  console.log(
    `[keeper ${options.keeperId}] try_match #${matchId} ` +
      `a=${pair.orderA.toBase58().slice(0, 8)} b=${pair.orderB
        .toBase58()
        .slice(0, 8)} → ct outputs: ${[
        canMatchPubkey.toBase58().slice(0, 8),
        fillSizePubkey.toBase58().slice(0, 8),
        clearingPricePubkey.toBase58().slice(0, 8),
      ].join(', ')}`,
  );

  // Build the try_match instruction by hand. Anchor 0.32 JS encodes the
  // accounts struct with `isSigner = false` for our 3 output cts (they're
  // declared as `UncheckedAccount` on the deployed program), but the
  // CPI to execute_graph downstream requires the new ct accounts to be
  // signers. We therefore construct the meta directly with `isSigner=true`
  // for them and partial-sign with the fresh keypairs.
  const ixData = encodeTryMatchData(
    new BN(matchId.toString()),
    pdas.cpiAuthorityBump,
  );
  const ix = new TransactionInstruction({
    programId: callerProgram,
    data: ixData,
    keys: [
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: pair.orderA, isSigner: false, isWritable: false },
      { pubkey: pair.orderB, isSigner: false, isWritable: false },
      { pubkey: matchIntent, isSigner: false, isWritable: true },
      // Input cts must be writable — Encrypt's execute_graph CPI requires
      // it (matches the upstream voting example's cast_vote keys).
      { pubkey: pubkeyFromOrderField(orderA.sideCt), isSigner: false, isWritable: true },
      { pubkey: pubkeyFromOrderField(orderA.priceCt), isSigner: false, isWritable: true },
      { pubkey: pubkeyFromOrderField(orderA.sizeCt), isSigner: false, isWritable: true },
      { pubkey: pubkeyFromOrderField(orderB.sideCt), isSigner: false, isWritable: true },
      { pubkey: pubkeyFromOrderField(orderB.priceCt), isSigner: false, isWritable: true },
      { pubkey: pubkeyFromOrderField(orderB.sizeCt), isSigner: false, isWritable: true },
      // Output cts — FRESH keypair accounts. is_signer=true so the inner
      // system_program::create_account inside execute_graph can authorise
      // their allocation (the patched encrypt-anchor preserves this flag at
      // the inner CPI; see crates/encrypt-anchor-vendor/src/lib.rs).
      { pubkey: canMatchPubkey, isSigner: true, isWritable: true },
      { pubkey: fillSizePubkey, isSigner: true, isWritable: true },
      { pubkey: clearingPricePubkey, isSigner: true, isWritable: true },
      { pubkey: pdas.encryptProgram, isSigner: false, isWritable: false },
      { pubkey: pdas.config, isSigner: false, isWritable: true },
      { pubkey: pdas.deposit, isSigner: false, isWritable: true },
      { pubkey: pdas.cpiAuthority, isSigner: false, isWritable: false },
      { pubkey: callerProgram, isSigner: false, isWritable: false },
      { pubkey: pdas.networkKey, isSigner: false, isWritable: false },
      { pubkey: pdas.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: keeperAuthority.publicKey, isSigner: true, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
  const tryMatchTx = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    dedupeSigners([
      keeperAuthority,
      payer,
      // The fresh output ct keypairs sign the outer tx so the patched
      // encrypt-anchor's invoke_execute_graph can pass through is_signer=true
      // to the inner system_program::create_account CPI (gap E2-residual).
      canMatchKeypair,
      fillSizeKeypair,
      clearingPriceKeypair,
    ]),
    { commitment: 'confirmed' },
  );

  console.log(`[keeper ${options.keeperId}] try_match #${matchId} tx=${tryMatchTx.slice(0, 12)}…`);

  // ── 2. Wait for the Encrypt executor to commit each output (status=VERIFIED) ─
  await waitForVerified(connection, canMatchPubkey, options);
  await waitForVerified(connection, fillSizePubkey, options);
  await waitForVerified(connection, clearingPricePubkey, options);

  // ── 3. request_decryption — snapshots digests onto MatchIntent ──────────
  const methods = program.methods as LooseProgramMethods;
  const reqDecryptTx = await methods['requestDecryption']!(new BN(matchId.toString()))
    .accountsPartial({
      market,
      matchIntent,
      canMatchCt: canMatchPubkey,
      fillSizeCt: fillSizePubkey,
      clearingPriceCt: clearingPricePubkey,
      keeperAuthority: keeperAuthority.publicKey,
    })
    .signers([keeperAuthority])
    .rpc({ commitment: 'confirmed' });
  console.log(
    `[keeper ${options.keeperId}] request_decryption #${matchId} tx=${reqDecryptTx.slice(0, 12)}…`,
  );

  // ── 4. Read decrypted plaintexts via gRPC ────────────────────────────────
  // Outputs were authored with no `authorized` field by execute_graph, so
  // they default to PUBLIC and any caller can readCiphertext. (For
  // confidential outputs the keeper would need to be the authorized signer
  // or the program would need to call request_decryption CPI on-chain.)
  const [canMatchPlain, fillSizePlain, clearingPlain] = await Promise.all([
    encryptSdk.requestThresholdDecrypt(
      new Uint8Array(canMatchPubkey.toBytes()),
      tryMatchTx,
    ),
    encryptSdk.requestThresholdDecrypt(
      new Uint8Array(fillSizePubkey.toBytes()),
      tryMatchTx,
    ),
    encryptSdk.requestThresholdDecrypt(
      new Uint8Array(clearingPricePubkey.toBytes()),
      tryMatchTx,
    ),
  ]);
  const canMatch = canMatchPlain !== 0n;
  const fillSize = fillSizePlain;
  const clearingPrice = clearingPlain;

  // The keeper has both order plaintexts (it could have decrypted side via
  // gRPC for both orders before dispatching), so it knows whether order_a
  // is the seller (ask) or the buyer (bid). We materialise that decision
  // here. For now use the byte-24 SDK-mock heuristic the on-chain side
  // used to use; with real Encrypt sides it would be a real readCiphertext
  // of `orderA.sideCt`.
  const sellerIsOrderA = await keeperDecryptSide(
    pubkeyFromOrderField(orderA.sideCt),
    tryMatchTx,
  );

  console.log(
    `[keeper ${options.keeperId}] decrypted: can_match=${canMatch} ` +
      `fill=${fillSize} clearing=${clearingPrice} sellerIsA=${sellerIsOrderA}`,
  );

  if (!canMatch) {
    // Bail before finalize — the program would reject anyway.
    throw new Error(
      `keeper: comparator rejected match #${matchId} (can_match=false)`,
    );
  }

  // ── 5. finalize_decryption — writes MatchRecord, closes MatchIntent ─────
  const finalizeTx = await methods['finalizeDecryption']!(
    new BN(matchId.toString()),
    canMatch,
    new BN(fillSize.toString()),
    new BN(clearingPrice.toString()),
    sellerIsOrderA,
  )
    .accountsPartial({
      market,
      matchIntent,
      matchRecord,
      orderA: pair.orderA,
      orderB: pair.orderB,
      keeperAuthority: keeperAuthority.publicKey,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([keeperAuthority, payer])
    .rpc({ commitment: 'confirmed' });

  console.log(
    `[keeper ${options.keeperId}] finalize_decryption #${matchId} tx=${finalizeTx.slice(0, 12)}…`,
  );

  return {
    matchId,
    matchIntent,
    matchRecord,
    canMatchOut: canMatchPubkey,
    fillSizeOut: fillSizePubkey,
    clearingPriceOut: clearingPricePubkey,
  };
}

/** Returns true if the side ciphertext decrypts to ASK (1). */
async function keeperDecryptSide(
  sideCtPubkey: PublicKey,
  txSig: string,
): Promise<boolean> {
  try {
    const v = await encryptSdk.requestThresholdDecrypt(
      new Uint8Array(sideCtPubkey.toBytes()),
      txSig,
    );
    return v === 1n;
  } catch {
    // Fallback for mock-mode ciphertexts: byte 24 carries the side bit.
    return sideCtPubkey.toBytes()[24] === 1;
  }
}

async function waitForVerified(
  connection: Connection,
  account: PublicKey,
  options: MatchOptions,
): Promise<void> {
  const timeoutMs = options.executorTimeoutMs ?? 60_000;
  const intervalMs = options.executorPollMs ?? 1_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await connection.getAccountInfo(account, 'confirmed');
    if (
      info &&
      info.data.length >= CT_LEN &&
      info.data[CT_STATUS_OFFSET] === CT_STATUS_VERIFIED
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `keeper: executor did not commit ${account.toBase58()} within ${timeoutMs}ms`,
  );
}

async function fetchOrder(
  program: LooseProgram,
  orderPda: PublicKey,
): Promise<StoredOrder> {
  const accountClient = (program.account as Record<
    string,
    { fetch(k: PublicKey): Promise<unknown> }
  >)['encryptedOrder'];
  if (!accountClient) {
    throw new Error('keeper: program IDL has no `encryptedOrder` account');
  }
  return (await accountClient.fetch(orderPda)) as StoredOrder;
}

interface StoredMarketState {
  matchCount: BN;
  keeperAuthority: PublicKey;
}

async function fetchMarketState(
  program: LooseProgram,
  market: PublicKey,
): Promise<StoredMarketState> {
  const accountClient = (program.account as Record<
    string,
    { fetch(k: PublicKey): Promise<unknown> }
  >)['marketState'];
  if (!accountClient) {
    throw new Error('keeper: program IDL has no `marketState` account');
  }
  return (await accountClient.fetch(market)) as StoredMarketState;
}

function pubkeyFromOrderField(field: number[] | Buffer): PublicKey {
  return new PublicKey(Buffer.from(field));
}

function u64LeBytes(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

/** Anchor instruction discriminator: first 8 bytes of sha256("global:<name>"). */
function anchorDisc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

/**
 * Encode a `try_match(match_id: u64, cpi_authority_bump: u8)` ix data buffer.
 * Anchor-1 layout: 8-byte disc + 8-byte LE u64 + 1-byte u8.
 */
function encodeTryMatchData(matchId: BN, cpiAuthorityBump: number): Buffer {
  const disc = anchorDisc('try_match');
  const id = matchId.toArrayLike(Buffer, 'le', 8);
  const bump = Buffer.from([cpiAuthorityBump]);
  return Buffer.concat([disc, id, bump]);
}

/** Drop signer duplicates by pubkey so partialSign doesn't reject the same key twice. */
function dedupeSigners(signers: Signer[]): Signer[] {
  const seen = new Set<string>();
  const out: Signer[] = [];
  for (const s of signers) {
    const k = s.publicKey.toBase58();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

/**
 * One-time setup: ensure the keeper's payer has an `encrypt_deposit` PDA so
 * `execute_graph` rents from it. Idempotent — does nothing if the account
 * already exists. Modelled on the upstream voting/e2e demo's deposit ix.
 */
export async function ensureEncryptDeposit(
  connection: Connection,
  payer: Signer,
  callerProgram: PublicKey,
  keeperId: string,
): Promise<EncryptPdaSet> {
  const pdas = await deriveEncryptPdas(connection, callerProgram, payer.publicKey);
  const existing = await connection.getAccountInfo(pdas.deposit, 'confirmed');
  if (existing) {
    console.log(
      `[keeper ${keeperId}] encrypt deposit exists at ${pdas.deposit.toBase58().slice(0, 12)}…`,
    );
    return pdas;
  }

  // 18-byte ix data: disc(1) + bump(1) + 16 bytes reserved (matches the
  // upstream voting/e2e demo). The trailing zeros are the deposit-amount
  // field — leaving them zero defaults to the program's minimum.
  const data = Buffer.alloc(18);
  data[0] = IX_CREATE_DEPOSIT;
  data[1] = pdas.depositBump;

  const vaultPk = pdas.encVault.equals(SystemProgram.programId)
    ? payer.publicKey
    : pdas.encVault;

  const ix = new TransactionInstruction({
    programId: ENCRYPT_PROGRAM_ID,
    data,
    keys: [
      { pubkey: pdas.deposit, isSigner: false, isWritable: true },
      { pubkey: pdas.config, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      {
        pubkey: vaultPk,
        isSigner: vaultPk.equals(payer.publicKey),
        isWritable: true,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });

  const tx = new (await import('@solana/web3.js')).Transaction().add(ix);
  const { sendAndConfirmTransaction } = await import('@solana/web3.js');
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
  });
  console.log(
    `[keeper ${keeperId}] created encrypt deposit ${pdas.deposit.toBase58().slice(0, 12)}… tx=${sig.slice(0, 12)}…`,
  );
  return pdas;
}

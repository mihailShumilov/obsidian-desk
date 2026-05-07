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
  TransactionInstruction,
  type Signer,
} from '@solana/web3.js';
import { encrypt as encryptSdk } from '@obsidian-desk/sdk';
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

  // Fresh keypair accounts for the three FHE comparator outputs. They land
  // on chain as Encrypt Ciphertext accounts when the executor commits.
  const canMatchKp = Keypair.generate();
  const fillSizeKp = Keypair.generate();
  const clearingPriceKp = Keypair.generate();

  console.log(
    `[keeper ${options.keeperId}] try_match #${matchId} ` +
      `a=${pair.orderA.toBase58().slice(0, 8)} b=${pair.orderB
        .toBase58()
        .slice(0, 8)} → ct outputs: ${[
        canMatchKp.publicKey.toBase58().slice(0, 8),
        fillSizeKp.publicKey.toBase58().slice(0, 8),
        clearingPriceKp.publicKey.toBase58().slice(0, 8),
      ].join(', ')}`,
  );

  const methods = program.methods as LooseProgramMethods;

  // ── 1. try_match (CPI to execute_graph) ─────────────────────────────────
  const tryMatchTx = await methods['tryMatch']!(
    new BN(matchId.toString()),
    pdas.cpiAuthorityBump,
  )
    .accountsPartial({
      market,
      orderA: pair.orderA,
      orderB: pair.orderB,
      matchIntent,
      aSideCt: pubkeyFromOrderField(orderA.sideCt),
      aPriceCt: pubkeyFromOrderField(orderA.priceCt),
      aSizeCt: pubkeyFromOrderField(orderA.sizeCt),
      bSideCt: pubkeyFromOrderField(orderB.sideCt),
      bPriceCt: pubkeyFromOrderField(orderB.priceCt),
      bSizeCt: pubkeyFromOrderField(orderB.sizeCt),
      canMatchOut: canMatchKp.publicKey,
      fillSizeOut: fillSizeKp.publicKey,
      clearingPriceOut: clearingPriceKp.publicKey,
      encryptProgram: pdas.encryptProgram,
      encryptConfig: pdas.config,
      encryptDeposit: pdas.deposit,
      encryptCpiAuthority: pdas.cpiAuthority,
      callerProgram,
      encryptNetworkKey: pdas.networkKey,
      encryptEventAuthority: pdas.eventAuthority,
      keeperAuthority: keeperAuthority.publicKey,
      payer: payer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([keeperAuthority, payer, canMatchKp, fillSizeKp, clearingPriceKp])
    .rpc({ commitment: 'confirmed' });

  console.log(`[keeper ${options.keeperId}] try_match #${matchId} tx=${tryMatchTx.slice(0, 12)}…`);

  // ── 2. Wait for the Encrypt executor to commit each output (status=VERIFIED) ─
  await waitForVerified(connection, canMatchKp.publicKey, options);
  await waitForVerified(connection, fillSizeKp.publicKey, options);
  await waitForVerified(connection, clearingPriceKp.publicKey, options);

  // ── 3. request_decryption — snapshots digests onto MatchIntent ──────────
  const reqDecryptTx = await methods['requestDecryption']!(new BN(matchId.toString()))
    .accountsPartial({
      market,
      matchIntent,
      canMatchCt: canMatchKp.publicKey,
      fillSizeCt: fillSizeKp.publicKey,
      clearingPriceCt: clearingPriceKp.publicKey,
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
      new Uint8Array(canMatchKp.publicKey.toBytes()),
      tryMatchTx,
    ),
    encryptSdk.requestThresholdDecrypt(
      new Uint8Array(fillSizeKp.publicKey.toBytes()),
      tryMatchTx,
    ),
    encryptSdk.requestThresholdDecrypt(
      new Uint8Array(clearingPriceKp.publicKey.toBytes()),
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
    canMatchOut: canMatchKp.publicKey,
    fillSizeOut: fillSizeKp.publicKey,
    clearingPriceOut: clearingPriceKp.publicKey,
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

  const data = Buffer.alloc(2);
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

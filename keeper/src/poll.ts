/**
 * Keeper pure-function layer.
 *
 * Exposed to tests (tests/e2e-settlement.ts) so a single poll cycle can run
 * inside the mocha process alongside the program under test. The daemon
 * wrapper in index.ts just calls `pollOnce` on an interval.
 */

import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import BN from 'bn.js';
import { utils } from '@coral-xyz/anchor';
import type { PublicKey } from '@solana/web3.js';
import { btc as btcSdkDefault, type SpendInput } from '@obsidian-desk/sdk';
import type { LooseProgram, LooseProgramMethods } from './anchor-shims.ts';

/**
 * Sign `msg` with a Solana ed25519 keypair (the 64-byte secretKey produced
 * by `Keypair.fromSecretKey`) and return a 128-char lowercase hex string —
 * the format the SDK's `requestSign` regex now requires for the Ika
 * approval_proof field. The first 32 bytes of `secretKey` are the seed;
 * we wrap them in a PKCS#8 envelope and use Node's native ed25519.
 */
function ed25519SignHex(secretKey: Uint8Array, msg: Buffer): string {
  const seed = Buffer.from(secretKey.subarray(0, 32));
  // OID 1.3.101.112 (ed25519) PKCS#8 prefix + 32-byte seed.
  const PKCS8_ED25519_PREFIX = Buffer.from(
    '302e020100300506032b657004220420',
    'hex',
  );
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  return cryptoSign(null, msg, key).toString('hex');
}

/**
 * Byte offset of `settle_status` inside a Borsh-serialized `MatchRecord`:
 *   8 (discriminator) + 32 (market) + 8 (match_id) + 32 (order_a) +
 *   32 (order_b) + 32 (seller_dwallet) + 32 (buyer_dwallet) +
 *   8 (fill_size_decrypted) + 8 (clearing_price_decrypted) = 192.
 *
 * `SettleStatus::Pending` is variant 0 → 1-byte tag = 0x00. A getProgramAccounts
 * memcmp filter on this byte makes the keeper skip historical Settled / Failed
 * records server-side instead of decoding them every tick.
 */
const SETTLE_STATUS_OFFSET = 192;
const SETTLE_STATUS_PENDING_BYTES = utils.bytes.bs58.encode(
  Buffer.from([0]),
);

// SDK namespaces are passed in via PollOptions so callers can inject the
// SAME module instance they used to set up dWallets. Default to the package
// surface for the daemon entrypoint; the e2e test injects the test's copy
// so the in-process mock store is shared.
//
// (ESM resolves modules per resolved path. Importing `@obsidian-desk/sdk`
// from one place and `../sdk/src/ika.ts` from another gives two distinct
// module instances with two distinct mock-store Maps; injection sidesteps
// that without forcing both paths to share a resolution.)

interface IkaNamespace {
  _mockAddressOf(id: string): string | undefined;
  _mockSize(): number;
  requestSign(
    dwalletId: string,
    btcTx: { network: 'signet' | 'testnet'; psbt: string; inputs: unknown; outputs: unknown },
    proof: { txSignature: string; matchId: bigint },
  ): Promise<{ signedTxHex: string; broadcastTxid?: string }>;
}

interface BtcNamespace {
  buildSpendTx(
    from: string,
    to: string,
    amountSats: bigint,
    feerateSatPerVB: number,
    inputs: ReadonlyArray<SpendInput>,
    network?: 'signet' | 'testnet',
  ): {
    psbt: string;
    inputs: unknown;
    outputs: unknown;
    network: 'signet' | 'testnet';
  };
  broadcastTx(
    hex: string,
    network?: 'signet' | 'testnet',
    mode?: 'mock' | 'real' | 'auto',
  ): Promise<{ value: string; mode: 'real-ok' | 'real-failed-fallback' | 'mock'; fallbackReason?: string }>;
}

/**
 * UTXO provider — returns the inputs the keeper will spend from the seller's
 * dWallet. Async to support both real esplora lookups and mocked synthesis.
 * Returning an empty array signals "no spendable UTXOs" — keeper marks the
 * match as failed rather than building a fundless tx.
 */
export type UtxoProvider = (address: string) => Promise<ReadonlyArray<SpendInput>>;

export interface PollOptions {
  /** Arbitrary label — shows up in stdout logs. */
  keeperId: string;
  /** BTC feerate (sat/vB). Used for the settlement tx. */
  feerateSatPerVB: number;
  /** Yields the UTXOs to spend from the seller's dWallet. */
  utxoProvider: UtxoProvider;
  /** BTC network to settle on. Defaults to signet. */
  btcNetwork?: 'signet' | 'testnet';
  /** Broadcast mode passed to btcSdk.broadcastTx. Defaults to `auto`. */
  broadcastMode?: 'mock' | 'real' | 'auto';
  /** Override the Ika SDK namespace — defaults to `@obsidian-desk/sdk/ika`. */
  ikaSdk?: IkaNamespace;
  /** Override the BTC SDK namespace — defaults to `@obsidian-desk/sdk/btc`. */
  btcSdk?: BtcNamespace;
}

export interface PollReport {
  attempted: Array<{ matchRecord: string; matchId: string }>;
  settled: Array<{
    matchRecord: string;
    matchId: string;
    btcSignedHexLen: number;
    btcTxid: string;
    broadcastMode: 'real-ok' | 'real-failed-fallback' | 'mock';
  }>;
  failed: Array<{ matchRecord: string; matchId: string; reason: string }>;
}

interface StoredMatchRecord {
  market: PublicKey;
  matchId: BN;
  orderA: PublicKey;
  orderB: PublicKey;
  sellerDwallet: PublicKey;
  buyerDwallet: PublicKey;
  fillSizeDecrypted: BN;
  clearingPriceDecrypted: BN;
  settleStatus: Record<string, Record<string, never>>;
  btcTxProof: Buffer | number[];
  finalizedAt: BN;
  bump: number;
  createdAt: BN;
}

/** Run one settlement pass. Returns a structured report for the caller to log. */
export async function pollOnce(
  program: LooseProgram,
  options: PollOptions,
): Promise<PollReport> {
  const {
    keeperId,
    feerateSatPerVB,
    utxoProvider,
    btcNetwork = 'signet',
    broadcastMode = 'auto',
  } = options;
  // Lazy-resolve the default sdk namespace so callers in tests can inject
  // their own instance (sharing the in-memory mock store).
  const ikaSdk =
    options.ikaSdk ??
    (((await import('@obsidian-desk/sdk/ika')) as unknown) as IkaNamespace);
  const btcSdk = options.btcSdk ?? (btcSdkDefault as unknown as BtcNamespace);
  const report: PollReport = { attempted: [], settled: [], failed: [] };

  // `program.account.<name>.all()` is dynamic by IDL — escape into untyped land
  // for the cross-workspace call.
  const accountClient = (program.account as Record<
    string,
    {
      all(
        filters?: Array<{ memcmp: { offset: number; bytes: string } }>,
      ): Promise<unknown>;
    }
  >)['matchRecord'];
  if (!accountClient) {
    throw new Error('keeper: program IDL has no `matchRecord` account');
  }
  const records = (await accountClient.all([
    {
      memcmp: {
        offset: SETTLE_STATUS_OFFSET,
        bytes: SETTLE_STATUS_PENDING_BYTES,
      },
    },
  ])) as Array<{
    publicKey: PublicKey;
    account: StoredMatchRecord;
  }>;

  for (const { publicKey, account } of records) {
    // Defense-in-depth: the memcmp filter above has already narrowed the
    // result set, but a future struct-layout change could shift the offset
    // and silently let non-pending records through.
    if (!('pending' in account.settleStatus)) continue;

    const matchIdStr = account.matchId.toString();
    report.attempted.push({ matchRecord: publicKey.toBase58(), matchId: matchIdStr });

    try {
      // Map program-side seller/buyer dwallet Pubkeys to SDK mock-store ids.
      // In the scaffold these ARE the same 32-byte value just serialized
      // differently (Pubkey vs hex). We retrieve the stored address to
      // confirm the dWallet exists in this process.
      const sellerId = account.sellerDwallet.toBuffer().toString('hex');
      const buyerId = account.buyerDwallet.toBuffer().toString('hex');
      const sellerAddress = ikaSdk._mockAddressOf(sellerId);
      const buyerAddress = ikaSdk._mockAddressOf(buyerId);
      if (process.env['KEEPER_DEBUG']) {
        console.log(
          `[keeper ${keeperId}] dbg seller=${sellerId} present=${!!sellerAddress} ` +
            `buyer=${buyerId} present=${!!buyerAddress} mockSize=${ikaSdk._mockSize()}`,
        );
      }
      if (!sellerAddress || !buyerAddress) {
        // Both legs must be in this keeper's mock store — gap I2.
        throw new Error(
          `dWallet not in local mock store (seller=${sellerId.slice(0, 16)}… ` +
            `buyer=${buyerId.slice(0, 16)}…) — see gap I2`,
        );
      }

      const fillSats = BigInt(account.fillSizeDecrypted.toString());
      const utxos = await utxoProvider(sellerAddress);
      if (utxos.length === 0) {
        throw new Error(
          `no spendable UTXOs for seller ${sellerAddress.slice(0, 16)}… ` +
            `— fund the dWallet from a signet faucet before placing orders`,
        );
      }
      const unsigned = btcSdk.buildSpendTx(
        sellerAddress,
        buyerAddress,
        fillSats,
        feerateSatPerVB,
        utxos,
        btcNetwork,
      );

      // Compute the BIP-143 sighash off the unsigned PSBT — this is the
      // exact digest that requestSign signs (real-mode passes it to Ika,
      // mock-mode signs the same digest via bitcoinjs-lib). Recorded
      // on-chain by consume_btc_approval so an auditor can later cross-
      // reference against the broadcast tx's witness.
      const sighash = await sighashFor(unsigned);

      // Find the seller's order so we know which BtcSettleApproval PDA to
      // consume. Whichever of (order_a, order_b) has dwallet_id ==
      // seller_dwallet — the matcher already encoded that mapping into
      // the MatchRecord, we just dereference.
      const sellerOrderPubkey = await findSellerOrder(
        program,
        account.orderA,
        account.orderB,
        account.sellerDwallet,
      );

      // Sign FIRST, then consume the one-shot approval, then broadcast.
      //
      // The earlier ordering (consume → sign → broadcast) had a sharp
      // edge: a transient signing failure would burn the seller's
      // single-use approval without producing a settlement, leaving the
      // seller stuck (the approval PDA is init-once per order, so they
      // can't re-approve until expiry). Sign-first means we only spend
      // the approval when we actually have a broadcast-ready tx.
      //
      // The audit trail still binds correctly: requestSign signs the
      // exact `sighash` we computed above, and that's the digest we
      // record on-chain — independent of whether the signer ran in
      // real or mock mode.
      //
      // approval_proof: the SDK now enforces 128-hex (real ed25519 sig).
      // Sign the BIP-143 sighash with the keeper's own keypair so the
      // proof is non-forgeable + bound to this exact match. Falls back
      // to the legacy 'keeper-mock' literal only when no payer keypair
      // is reachable (in-process tests with synthetic AnchorProvider) —
      // those run in OBSIDIAN_IKA_MODE=mock so the regex never fires.
      const wallet = (program.provider as unknown as { wallet?: { payer?: { secretKey: Uint8Array } } }).wallet;
      const approvalProof = wallet?.payer?.secretKey
        ? ed25519SignHex(wallet.payer.secretKey, Buffer.from(sighash))
        : 'keeper-mock';

      const { signedTxHex } = await ikaSdk.requestSign(sellerId, unsigned, {
        txSignature: approvalProof,
        matchId: BigInt(matchIdStr),
      });

      if (sellerOrderPubkey) {
        const consumed = await tryConsumeBtcApproval(
          program,
          sellerOrderPubkey,
          account.market,
          sighash,
          fillSats,
          keeperId,
        );
        // Three outcomes:
        //  - 'consumed': approval existed, consume succeeded. Strongest.
        //  - 'missing': no approval PDA on-chain. Forward-compat with old
        //               program versions and orders placed before frontend
        //               wired the approve_btc_settlement call. Keeper logs
        //               and falls through to settle — same security as
        //               today's flow (keeper-authority gate still applies).
        //  - 'rejected': approval exists but failed validation (consumed,
        //                expired, amount exceeded). HARD STOP — refuse
        //                to broadcast. This is the load-bearing case.
        if (consumed === 'rejected') {
          // Audit signal: a signed but unbroadcast tx exists in memory.
          // Emit its sha256 (NOT the raw hex — that would re-introduce
          // H4) so an auditor can later detect if this exact tx ever
          // appears on chain via another path. The signed hex is dropped
          // when this scope unwinds.
          const signedTxSha256 = createHash('sha256')
            .update(Buffer.from(signedTxHex, 'hex'))
            .digest('hex');
          console.warn(
            `[keeper ${keeperId}] match ${matchIdStr} consume rejected ` +
              `AFTER signing — signed-tx sha256=${signedTxSha256} ` +
              `(${signedTxHex.length / 2}B); tx will not be broadcast`,
          );
          throw new Error('consume_btc_approval rejected — refusing to broadcast');
        }
      }

      // Broadcast to signet (auto-fallback to local txid derivation if
      // mempool.space is unreachable). The returned txid goes into
      // `btc_tx_proof` so /positions can render mempool.space/<network>/tx/<id>.
      const broadcast = await btcSdk.broadcastTx(signedTxHex, btcNetwork, broadcastMode);
      if (broadcast.fallbackReason) {
        console.warn(
          `[keeper ${keeperId}] broadcast fell back to mock for match ` +
            `${matchIdStr}: ${broadcast.fallbackReason}`,
        );
      }

      // Proof = the 32-byte txid. UI renders mempool.space/<net>/tx/<hex>.
      // In real mode this is the real signet txid; in mock/fallback it's a
      // sha-256 of the signed hex — UI may 404 if it tries to resolve.
      let proofBytes = Buffer.from(broadcast.value, 'hex');

      // Gap I3 — try to attach an SPV merkle-inclusion proof when the
      // broadcast was real and the tx has been confirmed. mempool.space's
      // /merkle-proof endpoint returns null until the next block lands
      // (signet ~10 min); on a fresh broadcast this path will skip and
      // the keeper persists txid-only (spv_verified stays false on-chain).
      if (broadcast.mode === 'real-ok') {
        try {
          const sdk = await import('@obsidian-desk/sdk/btc');
          const spvBlob = await sdk.fetchSpvProof(broadcast.value, btcNetwork);
          if (spvBlob) {
            // On-chain verifier expects little-endian txid + spv blob.
            const txidLE = sdk.txidToLittleEndian(broadcast.value);
            proofBytes = Buffer.concat([txidLE, spvBlob]);
            console.log(
              `[keeper ${keeperId}] match ${matchIdStr} attached SPV proof ` +
                `(${proofBytes.length} bytes total)`,
            );
          }
        } catch (e) {
          console.warn(
            `[keeper ${keeperId}] SPV proof fetch failed for ${broadcast.value.slice(0, 12)}…: ` +
              (e instanceof Error ? e.message : String(e)),
          );
        }
      }
      const methods = program.methods as LooseProgramMethods;
      await methods['finalizeSettlement']!(new BN(matchIdStr), proofBytes)
        .accountsPartial({
          matchRecord: publicKey,
          market: account.market,
          keeperAuthority: program.provider.publicKey!,
        })
        .rpc({ commitment: 'confirmed' });

      report.settled.push({
        matchRecord: publicKey.toBase58(),
        matchId: matchIdStr,
        btcSignedHexLen: signedTxHex.length,
        btcTxid: broadcast.value,
        broadcastMode: broadcast.mode,
      });
      console.log(
        `[keeper ${keeperId}] settled match ${matchIdStr} at ${publicKey
          .toBase58()
          .slice(0, 12)}… btc=${broadcast.value.slice(0, 12)}… ` +
          `(${broadcast.mode}, ${signedTxHex.length} hex chars)`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[keeper ${keeperId}] match ${matchIdStr} failed: ${reason}`);
      try {
        const methods = program.methods as LooseProgramMethods;
        await methods['failSettlement']!(new BN(matchIdStr), 0)
          .accountsPartial({
            matchRecord: publicKey,
            market: account.market,
            keeperAuthority: program.provider.publicKey!,
          })
          .rpc({ commitment: 'confirmed' });
      } catch (inner) {
        console.error(
          `[keeper ${keeperId}] also failed to mark SettleFailed:`,
          inner,
        );
      }
      report.failed.push({
        matchRecord: publicKey.toBase58(),
        matchId: matchIdStr,
        reason,
      });
    }
  }

  return report;
}

// ────────────────────────────────────────────────────────────────────────────
// Gap I4 helpers: find the seller's order, consume its BtcSettleApproval,
// compute the BIP-143 sighash of the unsigned spend tx.
// ────────────────────────────────────────────────────────────────────────────

import { PublicKey as PK } from '@solana/web3.js';

/**
 * Resolve which of the two match-order PDAs belongs to the seller — the
 * one whose `dwallet_id == seller_dwallet`. Returns null if neither matches
 * (gap I4 not yet wired for that order; keeper falls back to no-approval).
 */
async function findSellerOrder(
  program: LooseProgram,
  orderA: PublicKey,
  orderB: PublicKey,
  sellerDwallet: PublicKey,
): Promise<PublicKey | null> {
  const accountClient = (program.account as Record<string, {
    fetch(addr: PublicKey): Promise<{ dwalletId: PublicKey } | undefined>;
  }>)['encryptedOrder'];
  if (!accountClient) return null;
  for (const candidate of [orderA, orderB]) {
    try {
      const ord = await accountClient.fetch(candidate);
      if (ord && ord.dwalletId.equals(sellerDwallet)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Compute the BIP-143 sighash for input 0 of `unsigned`. Returns 32 bytes.
 * Wraps the SDK helper so this module's external surface stays minimal.
 */
async function sighashFor(unsigned: { psbt: string; network: 'signet' | 'testnet' }): Promise<Buffer> {
  const sdk = await import('@obsidian-desk/sdk/btc');
  return sdk.bip143SighashForP2WPKH(unsigned.psbt, 0, unsigned.network);
}

/**
 * Call `consume_btc_approval` on obsidian-core. Distinguishes three outcomes:
 *
 *  - 'consumed' — approval existed and was consumed cleanly.
 *  - 'missing'  — the PDA doesn't exist (account-not-found). This happens
 *                 when (a) the program version on-chain doesn't ship the
 *                 BtcSettleApproval ix yet, or (b) the seller didn't call
 *                 approve_btc_settlement at order time. Forward-compatible
 *                 fall-through; caller continues with today's keeper-authority
 *                 security model.
 *  - 'rejected' — approval exists but validation failed (consumed, expired,
 *                 amount exceeded, or any other on-chain rejection). Caller
 *                 MUST refuse to settle — this is the security gate.
 */
async function tryConsumeBtcApproval(
  program: LooseProgram,
  orderPubkey: PublicKey,
  marketPubkey: PublicKey,
  messageDigest: Buffer,
  outputAmountSats: bigint,
  keeperId: string,
): Promise<'consumed' | 'missing' | 'rejected'> {
  const [approvalPda] = PK.findProgramAddressSync(
    [Buffer.from('btc_approval'), orderPubkey.toBuffer()],
    program.programId,
  );

  // Probe first — distinguish "PDA doesn't exist" from "PDA exists but
  // consume failed". Anchor's getAccountInfo returns null for missing.
  const conn = program.provider.connection;
  const info = await conn.getAccountInfo(approvalPda);
  if (info === null) {
    console.log(
      `[keeper ${keeperId}] no btc_approval PDA at ${approvalPda.toBase58().slice(0, 12)}… ` +
        `(fwd-compat: program version pre-I4 OR seller skipped approve_btc_settlement)`,
    );
    return 'missing';
  }

  try {
    const methods = program.methods as LooseProgramMethods;
    await methods['consumeBtcApproval']!(
      Array.from(messageDigest) as unknown as number[],
      new BN(outputAmountSats.toString()),
    )
      .accountsPartial({
        approval: approvalPda,
        market: marketPubkey,
        keeperAuthority: program.provider.publicKey!,
      })
      .rpc({ commitment: 'confirmed' });
    return 'consumed';
  } catch (err) {
    // Method-not-found from the IDL → forward-compat fall-through. Common
    // when the keeper container is on the new IDL but the on-chain program
    // hasn't been upgraded yet.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('consumeBtcApproval') && msg.includes('not found')) {
      console.log(`[keeper ${keeperId}] consume_btc_approval ix not on-chain yet — fall-through`);
      return 'missing';
    }
    console.error(`[keeper ${keeperId}] consume_btc_approval rejected: ${msg}`);
    return 'rejected';
  }
}

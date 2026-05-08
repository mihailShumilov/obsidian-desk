/**
 * Keeper pure-function layer.
 *
 * Exposed to tests (tests/e2e-settlement.ts) so a single poll cycle can run
 * inside the mocha process alongside the program under test. The daemon
 * wrapper in index.ts just calls `pollOnce` on an interval.
 */

import BN from 'bn.js';
import { utils } from '@coral-xyz/anchor';
import type { PublicKey } from '@solana/web3.js';
import { btc as btcSdkDefault, type SpendInput } from '@obsidian-desk/sdk';
import type { LooseProgram, LooseProgramMethods } from './anchor-shims.ts';

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

      // Gap I4 — consume the seller's on-chain BtcSettleApproval before
      // signing. This is the seller-pre-authorised gate that proves the
      // settlement was permitted, replay-protects against the keeper
      // re-signing a stale match, and bounds the output amount.
      // Find the seller's order: whichever of (order_a, order_b) has
      // dwallet_id == seller_dwallet.
      const sellerOrderPubkey = await findSellerOrder(
        program,
        account.orderA,
        account.orderB,
        account.sellerDwallet,
      );
      if (sellerOrderPubkey) {
        try {
          await consumeBtcApproval(
            program,
            sellerOrderPubkey,
            account.market,
            // Use the BIP-143 sighash of the unsigned tx as the message
            // digest the keeper claims to be presenting. The keeper sdk
            // exposes this; in a worker that can't import bitcoinjs-lib
            // we'd accept a 32-byte zero placeholder.
            await sighashFor(unsigned),
            fillSats,
          );
        } catch (err) {
          // No approval / consumed / expired / amount-exceeded → fail the
          // settle rather than producing a tx the seller didn't authorise.
          // Auto-fallback doesn't apply here — this is a logical gate.
          throw new Error(
            `consume_btc_approval rejected: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const { signedTxHex } = await ikaSdk.requestSign(sellerId, unsigned, {
        txSignature: 'keeper-mock',
        matchId: BigInt(matchIdStr),
      });

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
 * Call `consume_btc_approval` on obsidian-core. Throws on any failure
 * (account missing, already consumed, expired, amount exceeded). Caller
 * marks the match as failed in that case rather than producing an
 * unauthorised settlement tx.
 */
async function consumeBtcApproval(
  program: LooseProgram,
  orderPubkey: PublicKey,
  marketPubkey: PublicKey,
  messageDigest: Buffer,
  outputAmountSats: bigint,
): Promise<void> {
  // PDA: (b"btc_approval", order_pubkey)
  const [approvalPda] = PK.findProgramAddressSync(
    [Buffer.from('btc_approval'), orderPubkey.toBuffer()],
    program.programId,
  );
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
}

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
}

export interface PollOptions {
  /** Arbitrary label — shows up in stdout logs. */
  keeperId: string;
  /** BTC feerate (sat/vB). Used for the settlement tx. */
  feerateSatPerVB: number;
  /** One synthetic UTXO per dWallet (mock mode). Real mode fetches via esplora. */
  mockUtxoProvider: (address: string) => SpendInput;
  /** Override the Ika SDK namespace — defaults to `@obsidian-desk/sdk/ika`. */
  ikaSdk?: IkaNamespace;
  /** Override the BTC SDK namespace — defaults to `@obsidian-desk/sdk/btc`. */
  btcSdk?: BtcNamespace;
}

export interface PollReport {
  attempted: Array<{ matchRecord: string; matchId: string }>;
  settled: Array<{ matchRecord: string; matchId: string; btcSignedHexLen: number }>;
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
  const { keeperId, feerateSatPerVB, mockUtxoProvider } = options;
  // Lazy-resolve the default sdk namespace so callers in tests can inject
  // their own instance (sharing the in-memory mock store).
  const ikaSdk =
    options.ikaSdk ?? ((await import('@obsidian-desk/sdk')).ika as unknown as IkaNamespace);
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
      const utxo = mockUtxoProvider(sellerAddress);
      const unsigned = btcSdk.buildSpendTx(
        sellerAddress,
        buyerAddress,
        fillSats,
        feerateSatPerVB,
        [utxo],
      );

      const { signedTxHex } = await ikaSdk.requestSign(sellerId, unsigned, {
        txSignature: 'keeper-mock',
        matchId: BigInt(matchIdStr),
      });

      // Finalize on Solana. Proof blob = raw signed BTC tx hex bytes; P9
      // will replace this with an SPV proof once the keeper polls signet.
      const proofBytes = Buffer.from(signedTxHex, 'hex');
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
      });
      console.log(
        `[keeper ${keeperId}] settled match ${matchIdStr} at ${publicKey
          .toBase58()
          .slice(0, 12)}… (btc hex ${signedTxHex.length} chars)`,
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

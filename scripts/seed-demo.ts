/**
 * scripts/seed-demo.ts — bootstrap a clean demo on the local validator.
 *
 * What this does (mock mode, no real BTC, no real Ika):
 *   1. Initializes a fresh BTC/USDC market (deterministic mints derived
 *      from the seed so re-running with the same seed converges).
 *   2. Creates two mock dWallets for Alice + Bob and locks both policies
 *      to the program.
 *   3. Submits 8 encrypted orders (4 bids, 4 asks) at staggered prices
 *      around $69,500–$70,500.
 *
 * What this does NOT do:
 *   - Touch real signet (you'd need to fund + lock real Ika dWallets)
 *   - Run the keeper (start that separately: `pnpm -F @obsidian-desk/keeper dev`)
 *   - Trigger matches (the keeper does that, or use /trade?admin=1)
 *
 * Usage:
 *   # 1. Have a local validator running on :18899
 *   solana-test-validator --rpc-port 18899 --bind-address 127.0.0.1 --reset
 *
 *   # 2. Make sure the program is deployed against this validator
 *   anchor build && anchor deploy --provider.cluster http://127.0.0.1:18899
 *
 *   # 3. Run the seed
 *   ANCHOR_PROVIDER_URL=http://127.0.0.1:18899 \
 *     ANCHOR_WALLET=~/.config/solana/id.json \
 *     pnpm exec tsx scripts/seed-demo.ts
 *
 *   # 4. Boot the UI + keeper
 *   pnpm dev
 *   open http://127.0.0.1:13000/trade
 */

import * as anchor from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { encryptOrder } from '../sdk/src/encrypt.ts';
import * as ikaSdk from '../sdk/src/ika.ts';

interface SeedOrder {
  side: 'bid' | 'ask';
  /** USDC, 6-decimal int */
  priceUsdc6: bigint;
  /** BTC, 8-decimal int (sats) */
  sizeSats: bigint;
}

const SEED_ORDERS: SeedOrder[] = [
  // 4 bids stepping down, 4 asks stepping up — leaves a $200 spread at the top
  { side: 'bid', priceUsdc6: 69_900_000_000n, sizeSats: 25_000_000n }, // 0.25 BTC @ $69,900
  { side: 'bid', priceUsdc6: 69_800_000_000n, sizeSats: 50_000_000n },
  { side: 'bid', priceUsdc6: 69_700_000_000n, sizeSats: 12_500_000n },
  { side: 'bid', priceUsdc6: 69_500_000_000n, sizeSats: 100_000_000n }, // 1 BTC @ $69,500
  { side: 'ask', priceUsdc6: 70_100_000_000n, sizeSats: 25_000_000n },
  { side: 'ask', priceUsdc6: 70_200_000_000n, sizeSats: 37_500_000n },
  { side: 'ask', priceUsdc6: 70_400_000_000n, sizeSats: 12_500_000n },
  { side: 'ask', priceUsdc6: 70_800_000_000n, sizeSats: 75_000_000n },
];

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main(): Promise<void> {
  process.env['OBSIDIAN_ENCRYPT_MODE'] = 'mock';
  process.env['OBSIDIAN_IKA_MODE'] = 'mock';

  const rpcUrl =
    process.env['ANCHOR_PROVIDER_URL'] ?? 'http://127.0.0.1:18899';
  const walletPath =
    process.env['ANCHOR_WALLET'] ??
    join(homedir(), '.config', 'solana', 'id.json');

  const connection = new anchor.web3.Connection(rpcUrl, 'confirmed');
  const wallet = new anchor.Wallet(loadKeypair(walletPath));
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  anchor.setProvider(provider);

  // Load IDL from the workspace target/.
  const idlPath = join(process.cwd(), 'target', 'idl', 'obsidian_core.json');
  const idl = JSON.parse(readFileSync(idlPath, 'utf8')) as anchor.Idl;
  const program = new anchor.Program(idl, provider);

  console.log(`[seed-demo] using rpc=${rpcUrl}`);
  console.log(`[seed-demo] wallet=${wallet.publicKey.toBase58()}`);
  console.log(`[seed-demo] program=${program.programId.toBase58()}`);

  // ── 1. Market ───────────────────────────────────────────────────────
  // Deterministic mints derived from a fixed seed so re-running this
  // script converges on the same market PDA.
  const baseMint = pubkeyFromSeed('obsidian-demo-base-btc');
  const quoteMint = pubkeyFromSeed('obsidian-demo-quote-usdc');
  const settleVault = pubkeyFromSeed('obsidian-demo-settle-vault');
  const ikaPolicy = pubkeyFromSeed('obsidian-demo-ika-policy');

  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from('market'), baseMint.toBuffer(), quoteMint.toBuffer()],
    program.programId,
  );
  console.log(`[seed-demo] market=${market.toBase58()}`);

  let marketExisted = false;
  try {
    await (program.account as Record<string, { fetch(k: PublicKey): Promise<unknown> }>)[
      'marketState'
    ]!.fetch(market);
    marketExisted = true;
    console.log('[seed-demo] market already initialized — skipping init');
  } catch {
    /* market doesn't exist yet → initialize */
  }

  if (!marketExisted) {
    const methods = program.methods as Record<
      string,
      (...args: unknown[]) => {
        accountsPartial(a: Record<string, PublicKey>): {
          rpc(opts?: Record<string, unknown>): Promise<string>;
        };
      }
    >;
    const sig = await methods['initializeMarket']!(baseMint, quoteMint)
      .accountsPartial({
        market,
        settleVault,
        ikaPolicy,
        admin: wallet.publicKey,
      })
      .rpc({ commitment: 'confirmed' });
    console.log(`[seed-demo] initializeMarket tx=${sig}`);
  }

  // ── 2. dWallets ─────────────────────────────────────────────────────
  ikaSdk._mockReset();
  const alice = await ikaSdk.createDWallet('bitcoin-signet');
  const bob = await ikaSdk.createDWallet('bitcoin-signet');
  await ikaSdk.lockPolicy(alice.id, {
    controller: program.programId.toBase58(),
    maxAmountSats: 1_000_000_000n,
    expirySlots: 216_000,
    rules: [],
  });
  await ikaSdk.lockPolicy(bob.id, {
    controller: program.programId.toBase58(),
    maxAmountSats: 1_000_000_000n,
    expirySlots: 216_000,
    rules: [],
  });
  console.log(`[seed-demo] alice dwallet=${alice.address}`);
  console.log(`[seed-demo] bob   dwallet=${bob.address}`);

  // Convert hex dWallet ids back to Solana Pubkeys (32 bytes either way).
  const aliceDwPk = new PublicKey(Buffer.from(alice.id, 'hex'));
  const bobDwPk = new PublicKey(Buffer.from(bob.id, 'hex'));

  // ── 3. Encrypted orders ─────────────────────────────────────────────
  const slot = await provider.connection.getSlot();
  const expirySlot = new BN(slot + 1_000_000);

  let submitted = 0;
  let skipped = 0;
  for (const [i, o] of SEED_ORDERS.entries()) {
    const blob = await encryptOrder(o.side, o.priceUsdc6, o.sizeSats);
    const [orderPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), market.toBuffer(), Buffer.from(blob.nonce)],
      program.programId,
    );

    // Alternate orders between Alice and Bob.
    const dwPk = i % 2 === 0 ? aliceDwPk : bobDwPk;

    try {
      const methods = program.methods as Record<
        string,
        (...args: unknown[]) => {
          accountsPartial(a: Record<string, PublicKey>): {
            rpc(opts?: Record<string, unknown>): Promise<string>;
          };
        }
      >;
      await methods['submitOrder']!(
        Buffer.from(blob.side_ct),
        Buffer.from(blob.price_ct),
        Buffer.from(blob.size_ct),
        expirySlot,
        [...blob.nonce],
        dwPk,
      )
        .accountsPartial({
          market,
          order: orderPda,
          owner: wallet.publicKey,
        })
        .rpc({ commitment: 'confirmed' });
      submitted += 1;
      const sizeBtc = (Number(o.sizeSats) / 1e8).toFixed(3);
      const priceUsd = (Number(o.priceUsdc6) / 1e6).toFixed(2);
      console.log(
        `[seed-demo] [${(i + 1).toString().padStart(2, ' ')}/8] ` +
          `${o.side === 'bid' ? 'BID' : 'ASK'} ${sizeBtc} BTC @ $${priceUsd}` +
          ` order=${orderPda.toBase58().slice(0, 12)}…`,
      );
    } catch (err) {
      // Most likely cause: this exact (market, nonce) order PDA already exists
      // from a previous seed run. The nonce is random per blob, so a true
      // collision is astronomically unlikely — but a re-deployed program with
      // a fresh ledger after seeding with the same nonce would clash.
      skipped += 1;
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[seed-demo] [${i + 1}/8] skipped: ${reason.split('\n')[0]}`);
    }
  }

  // ── 4. Summary ──────────────────────────────────────────────────────
  console.log('');
  console.log('───────────────────────────────────────────────────────────');
  console.log('[seed-demo] done');
  console.log(`[seed-demo]   submitted: ${submitted}`);
  console.log(`[seed-demo]   skipped:   ${skipped}`);
  console.log('');
  console.log('next steps:');
  console.log('  1. boot the keeper:      pnpm -F @obsidian-desk/keeper dev');
  console.log('  2. boot the UI:          pnpm -F @obsidian-desk/app dev');
  console.log('  3. open the terminal:    http://127.0.0.1:13000/trade');
  console.log('  4. (admin tools, opt):   http://127.0.0.1:13000/trade?admin=1');
  console.log('───────────────────────────────────────────────────────────');
}

function pubkeyFromSeed(seed: string): PublicKey {
  // Deterministic 32-byte derivation; not a real keypair (we never sign
  // with it, it's just used as a "mint" address for the demo market PDA).
  const buf = Buffer.alloc(32);
  Buffer.from(seed, 'utf8').copy(buf);
  return new PublicKey(buf);
}

main().catch((err) => {
  console.error('[seed-demo] failed:', err);
  process.exit(1);
});

/**
 * Client-side `submit_order` + `approve_btc_settlement` builder.
 *
 * Server-side `prepareEncryptedOrderAction` produces the 32-byte ciphertext
 * refs + a fresh 16-byte nonce. This module derives the order PDA from the
 * nonce, builds both instructions, bundles them into one transaction so
 * the user signs once, and submits via the connected wallet adapter.
 *
 * Bundling is safe because:
 *   - `submit_order` sets `order.owner = ctx.accounts.owner.key()` (the
 *     signer).
 *   - `approve_btc_settlement` requires `order.owner == approver.key()`.
 *   - Same wallet signs both, so the constraint passes within a single
 *     atomic transaction.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  type VersionedTransaction,
} from '@solana/web3.js';
import {
  AnchorProvider,
  Program,
  BN,
  type Idl,
} from '@coral-xyz/anchor';

/**
 * Subset of `@solana/wallet-adapter-react`'s `AnchorWallet` shape that we
 * actually need. Matches Anchor's `Wallet` interface so we can pass it
 * directly to `AnchorProvider`.
 */
export interface AnchorWalletLike {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]>;
}

export interface SubmitOrderOnChainArgs {
  connection: Connection;
  wallet: AnchorWalletLike;
  idl: Idl;
  programId: PublicKey;
  market: PublicKey;
  /** 32-byte ciphertext-account ref. */
  sideCt: Uint8Array;
  priceCt: Uint8Array;
  sizeCt: Uint8Array;
  /** 16-byte order nonce, also seeds the order PDA. */
  nonce: Uint8Array;
  /** Absolute Solana slot. The form supplies relative slots; the caller
   *  resolves to absolute via `connection.getSlot()` before calling. */
  expirySlot: bigint;
  /** dWallet identifier as a 32-byte Solana pubkey. */
  dwalletId: PublicKey;
  /** Cap on the BTC output the keeper may sign for this order. */
  maxAmountSats: bigint;
}

export interface SubmitOrderOnChainResult {
  txSignature: string;
  orderPubkey: string;
  approvalPubkey: string;
}

function hexToBytes(hex: string, expectedLen: number): Uint8Array {
  if (hex.length !== expectedLen * 2) {
    throw new Error(
      `hexToBytes: expected ${expectedLen * 2} hex chars, got ${hex.length}`,
    );
  }
  const out = new Uint8Array(expectedLen);
  for (let i = 0; i < expectedLen; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function hexCtTo32(hex: string): Uint8Array {
  return hexToBytes(hex, 32);
}

export function hexNonceTo16(hex: string): Uint8Array {
  return hexToBytes(hex, 16);
}

/**
 * Build, sign, and submit a `submit_order` + `approve_btc_settlement` tx.
 * Returns the confirmed tx signature plus the derived PDAs so the caller
 * can surface them in the UI.
 */
export async function submitOrderOnChain(
  args: SubmitOrderOnChainArgs,
): Promise<SubmitOrderOnChainResult> {
  const provider = new AnchorProvider(args.connection, args.wallet, {
    commitment: 'confirmed',
  });
  // Anchor's TS types require `Idl`; we have it from the server action.
  const program = new Program(args.idl, provider);

  const [orderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('order'), args.market.toBuffer(), Buffer.from(args.nonce)],
    args.programId,
  );
  const [approvalPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('btc_approval'), orderPda.toBuffer()],
    args.programId,
  );

  // Anchor camel-cases ix names from the IDL's snake_case.
  type LooseMethods = Record<string, (...args: unknown[]) => {
    accountsPartial(accs: Record<string, PublicKey>): {
      instruction(): Promise<import('@solana/web3.js').TransactionInstruction>;
    };
  }>;
  const methods = program.methods as unknown as LooseMethods;

  const submitIx = await methods['submitOrder']!(
    Array.from(args.sideCt),
    Array.from(args.priceCt),
    Array.from(args.sizeCt),
    new BN(args.expirySlot.toString()),
    Array.from(args.nonce),
    args.dwalletId,
  )
    .accountsPartial({
      market: args.market,
      order: orderPda,
      owner: args.wallet.publicKey,
    })
    .instruction();

  const approveIx = await methods['approveBtcSettlement']!(
    new BN(args.maxAmountSats.toString()),
    new BN(args.expirySlot.toString()),
  )
    .accountsPartial({
      order: orderPda,
      approval: approvalPda,
      approver: args.wallet.publicKey,
    })
    .instruction();

  const tx = new Transaction().add(submitIx, approveIx);
  tx.feePayer = args.wallet.publicKey;
  const { blockhash, lastValidBlockHeight } =
    await args.connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;

  const signed = await args.wallet.signTransaction(tx);
  const sig = await args.connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
  });
  await args.connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed',
  );

  return {
    txSignature: sig,
    orderPubkey: orderPda.toBase58(),
    approvalPubkey: approvalPda.toBase58(),
  };
}

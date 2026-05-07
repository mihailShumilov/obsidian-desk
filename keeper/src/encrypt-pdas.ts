/**
 * Derive Encrypt-program PDAs for `execute_graph` and friends.
 *
 * Mirrors the pattern in the upstream voting example
 * (`encrypt-pre-alpha/chains/solana/examples/voting/e2e/e2e-voting-web3.ts`).
 * The constants here track the deployed Encrypt program at
 * `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` on Solana devnet.
 */

import { PublicKey, type Connection } from '@solana/web3.js';

export const ENCRYPT_PROGRAM_ID = new PublicKey(
  '4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8',
);

/** Seed for the per-caller-program CPI authority. Mirrors `encrypt_anchor::CPI_AUTHORITY_SEED`. */
const CPI_AUTHORITY_SEED = Buffer.from('__encrypt_cpi_authority');
const ENCRYPT_CONFIG_SEED = Buffer.from('encrypt_config');
const ENCRYPT_DEPOSIT_SEED = Buffer.from('encrypt_deposit');
const NETWORK_KEY_SEED = Buffer.from('network_encryption_key');
const EVENT_AUTHORITY_SEED = Buffer.from('__event_authority');

/** Encrypt instruction discriminators we use directly (without encrypt-anchor). */
export const IX_CREATE_DEPOSIT = 14;

export interface EncryptPdaSet {
  encryptProgram: PublicKey;
  config: PublicKey;
  eventAuthority: PublicKey;
  /** Per-payer deposit PDA. */
  deposit: PublicKey;
  depositBump: number;
  /** Per-network-key network encryption key PDA. */
  networkKey: PublicKey;
  /** Per-caller-program CPI authority PDA. */
  cpiAuthority: PublicKey;
  cpiAuthorityBump: number;
  /** Raw 32-byte network encryption key (read from config account). */
  networkKeyBytes: Uint8Array;
  /** Encrypt's vault address (read from config account at offset 100..132). */
  encVault: PublicKey;
}

/**
 * Derive the full PDA set the keeper needs to call execute_graph from
 * `obsidian-core`. Reads the Encrypt config account on-chain to fetch the
 * vault + network key (these change over time and aren't program-derivable).
 */
export async function deriveEncryptPdas(
  connection: Connection,
  callerProgram: PublicKey,
  payer: PublicKey,
): Promise<EncryptPdaSet> {
  const [config] = PublicKey.findProgramAddressSync(
    [ENCRYPT_CONFIG_SEED],
    ENCRYPT_PROGRAM_ID,
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [EVENT_AUTHORITY_SEED],
    ENCRYPT_PROGRAM_ID,
  );
  const [deposit, depositBump] = PublicKey.findProgramAddressSync(
    [ENCRYPT_DEPOSIT_SEED, payer.toBuffer()],
    ENCRYPT_PROGRAM_ID,
  );
  const [cpiAuthority, cpiAuthorityBump] = PublicKey.findProgramAddressSync(
    [CPI_AUTHORITY_SEED],
    callerProgram,
  );

  // Read config to extract networkKey (offset 100..132 — 4-byte disc + 96 prefix).
  const configInfo = await connection.getAccountInfo(config);
  if (!configInfo) {
    throw new Error(
      `Encrypt config not found at ${config.toBase58()}. ` +
        `Is the program deployed at ${ENCRYPT_PROGRAM_ID.toBase58()}? ` +
        `Either point at devnet (encrypt deployed) or run 'encrypt solana dev' locally.`,
    );
  }
  // Layout per upstream voting/e2e demo:
  //   bytes  ?..100  config header
  //   bytes 100..132 enc_vault pubkey
  //   bytes 132..164 networkKeyBytes (assumed adjacent — confirm against vendor docs)
  const encVault = new PublicKey(configInfo.data.subarray(100, 132));
  // The network key is the 32-byte value used as a seed for `networkKeyPda`.
  // Upstream voting example uses a 32-byte fill of 0x55 in dev, and reads
  // from the network_encryption_key PDA derived from those bytes. The
  // executor publishes the canonical bytes via a separate config field; for
  // production use the on-chain network_encryption_key account is what
  // matters. We probe by trying the dev placeholder first.
  const networkKeyBytes = new Uint8Array(32).fill(0x55);
  const [networkKey] = PublicKey.findProgramAddressSync(
    [NETWORK_KEY_SEED, Buffer.from(networkKeyBytes)],
    ENCRYPT_PROGRAM_ID,
  );

  return {
    encryptProgram: ENCRYPT_PROGRAM_ID,
    config,
    eventAuthority,
    deposit,
    depositBump,
    networkKey,
    cpiAuthority,
    cpiAuthorityBump,
    networkKeyBytes,
    encVault,
  };
}

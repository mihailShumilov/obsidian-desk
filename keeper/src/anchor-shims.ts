/**
 * Anchor type / IO shims used by both the keeper daemon and the
 * top-level scripts (seed-demo, etc.).
 *
 * `LooseProgramMethods` exists because the IDL-typed `Program<T>` doesn't
 * cross workspace boundaries cleanly — exposing the strongly-typed program
 * from `programs/obsidian-core` to a non-workspace caller pulls in the
 * full `target/types/obsidian_core` declaration. Each call site already
 * casts `program.methods` into this shape; centralizing keeps the cast
 * one-line and lets a future `@coral-xyz/anchor` upgrade fix every site
 * at once.
 */

import { Keypair } from '@solana/web3.js';
import type { PublicKey, Signer } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import type { Idl, Program } from '@coral-xyz/anchor';

interface LooseRpc {
  rpc(opts?: Record<string, unknown>): Promise<string>;
}
interface LooseSigners extends LooseRpc {
  signers(extra: Signer[]): LooseRpc;
}
interface LooseAccounts {
  accountsPartial(a: Record<string, PublicKey>): LooseSigners;
}

export type LooseProgramMethods = Record<
  string,
  (...args: unknown[]) => LooseAccounts
>;

/**
 * Loose `Program<T>` alias used in keeper helpers so we don't have to import
 * the full IDL type from the workspace. The shape is just enough to satisfy
 * `Program<T>`'s generic bound while leaving the rest as escape-hatch.
 */
export type LooseIdl = {
  address: string;
  metadata: { name: string; version: string; spec: string; description?: string };
  instructions: never[];
  accounts: never[];
};
export type LooseProgram = Program<LooseIdl & Idl>;

/** Load a Solana keypair from a JSON-array secret-key file. */
export function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

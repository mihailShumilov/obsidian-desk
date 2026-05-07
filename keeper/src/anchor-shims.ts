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
import type { PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';

export type LooseProgramMethods = Record<
  string,
  (...args: unknown[]) => {
    accountsPartial(a: Record<string, PublicKey>): {
      rpc(opts?: Record<string, unknown>): Promise<string>;
    };
  }
>;

/** Load a Solana keypair from a JSON-array secret-key file. */
export function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

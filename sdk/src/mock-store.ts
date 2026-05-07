/**
 * File-backed mock dWallet store — closes enough of gap I2 to let the
 * Next.js deposit page and the keeper container share dWallets across
 * processes during the hackathon demo.
 *
 * Storage: a single JSON file at `~/.obsidian-mock-keys.json` (overridable
 * via `OBSIDIAN_MOCK_STORE_PATH`). Every write goes via temp-file + rename
 * to stay atomic under concurrent writers. Every read re-loads from disk
 * so a process started later picks up entries written by an earlier one
 * without restarting.
 *
 * **Security note:** in mock mode the file holds raw WIFs (private keys
 * for synthesised signet dWallets). Acceptable for hackathon demo on
 * signet (no real value at risk). NOT acceptable for testnet or any path
 * where these keys could co-sign real value flows. The `assertNotMockOnMainnet`
 * guard in `safety.ts` already trips on mainnet; this store inherits that
 * protection because every caller that touches it must pass through the
 * Ika SDK's mode guard.
 *
 * In real mode the store still tracks dWallet metadata (chain, address,
 * creator-binding, policy, publicKey) so process-isolated callers can
 * agree on which dWallet a given id refers to — but no WIF is written.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface PersistedPolicy {
  controller: string;
  maxAmountSats: bigint;
  expirySlots: number;
  rules: Array<{ kind: string; [k: string]: unknown }>;
}

export interface MockEntry {
  /** Mock-mode only: P2WPKH wallet import format. Real-mode entries omit it. */
  wif?: string;
  chain: 'bitcoin' | 'bitcoin-signet' | 'bitcoin-testnet';
  address: string;
  /** Solana pubkey (base58) of the original creator. Used by `lockPolicy`
   *  to refuse calls from someone else (gap I1 stand-in). */
  creator?: string;
  policy?: PersistedPolicy;
  policyAccountOnSolana?: string;
  /** Real-mode only: secp256k1 compressed dWallet public key from DKG. */
  publicKey?: Uint8Array;
}

// ────────────────────────────────────────────────────────────────────────────
// JSON encoding helpers — bigint and Uint8Array don't round-trip natively.
// Encode them with explicit tag objects so the reviver can spot them
// unambiguously (vs. heuristic string sniffing which would mislabel
// e.g. an address that happens to start with 0x).
// ────────────────────────────────────────────────────────────────────────────

interface TaggedBigInt { __bigint: string }
interface TaggedBytes { __bytes: string }

function isTaggedBigInt(v: unknown): v is TaggedBigInt {
  return typeof v === 'object' && v !== null && '__bigint' in v
    && typeof (v as TaggedBigInt).__bigint === 'string';
}
function isTaggedBytes(v: unknown): v is TaggedBytes {
  return typeof v === 'object' && v !== null && '__bytes' in v
    && typeof (v as TaggedBytes).__bytes === 'string';
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return { __bigint: value.toString() };
  if (value instanceof Uint8Array) {
    return { __bytes: Buffer.from(value).toString('hex') };
  }
  return value;
}
function reviver(_key: string, value: unknown): unknown {
  if (isTaggedBigInt(value)) return BigInt(value.__bigint);
  if (isTaggedBytes(value)) return new Uint8Array(Buffer.from(value.__bytes, 'hex'));
  return value;
}

// ────────────────────────────────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────────────────────────────────

function defaultPath(): string {
  const env = process.env['OBSIDIAN_MOCK_STORE_PATH'];
  if (env && env.length > 0) return env;
  return path.join(os.homedir(), '.obsidian-mock-keys.json');
}

export class MockStore {
  private filePath: string;

  constructor(filePath: string = defaultPath()) {
    this.filePath = filePath;
  }

  /** Path the store reads from / writes to. Useful for tests and logs. */
  path(): string {
    return this.filePath;
  }

  /** Read all entries from disk. Returns an empty Map if the file doesn't exist. */
  private readAll(): Map<string, MockEntry> {
    try {
      const buf = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(buf, reviver) as Record<string, MockEntry>;
      return new Map(Object.entries(parsed));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw err;
    }
  }

  /** Atomic write: serialise to a temp file then rename over the target. */
  private writeAll(entries: Map<string, MockEntry>): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    const obj: Record<string, MockEntry> = Object.fromEntries(entries);
    fs.writeFileSync(tmp, JSON.stringify(obj, replacer, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
  }

  get(id: string): MockEntry | undefined {
    return this.readAll().get(id);
  }

  set(id: string, entry: MockEntry): void {
    const all = this.readAll();
    all.set(id, entry);
    this.writeAll(all);
  }

  delete(id: string): boolean {
    const all = this.readAll();
    const had = all.delete(id);
    if (had) this.writeAll(all);
    return had;
  }

  size(): number {
    return this.readAll().size;
  }

  /** Test-only — wipes the file. Caller is responsible for not invoking
   *  this in any flow that isn't a unit test or `_mockReset` codepath. */
  reset(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

let singleton: MockStore | null = null;

/** Process-singleton accessor — every Ika SDK consumer in this process
 *  shares the same store handle. Tests can override via `setDefaultMockStore`. */
export function defaultMockStore(): MockStore {
  if (!singleton) singleton = new MockStore();
  return singleton;
}

export function setDefaultMockStore(store: MockStore | null): void {
  singleton = store;
}

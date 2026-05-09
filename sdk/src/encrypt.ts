/**
 * Client-side adapter for Encrypt FHE primitives.
 *
 * **Mode selection** — `OBSIDIAN_ENCRYPT_MODE` env var, tri-state via
 * `sdk/src/mode.ts::resolveMode('encrypt')`:
 *   - `mock`   — deterministic byte encoding, round-trip recoverable.
 *                For tests, scaffolding, and CI.
 *   - `real`   — call the deployed Encrypt gRPC service; throw on any
 *                failure (no fallback).
 *   - `auto`   (default) — call real first; fall back to mock on transient
 *                failure (network down, gRPC unreachable). Logical errors
 *                still throw — see mode.ts::isTransientError.
 *
 * **Zero leakage rule:** never log the plaintext order fields. Use
 * `describeCiphertext()` for safe diagnostic output (length + tag only).
 */

import {
  DecryptionError,
  EncryptionError,
  VendorSDKUnavailableError,
} from './errors.ts';
import {
  resolveMode,
  tryReal,
  type Mode,
  type ResolvedMode,
} from './mode.ts';

/**
 * WebCrypto is available in both Node 24 and the browser. Routing through
 * `globalThis.crypto.getRandomValues` instead of `node:crypto` keeps the
 * Next.js client bundle from pulling in the `crypto-browserify` polyfill
 * (~50 KB gzipped) when this module is imported transitively from a
 * client component.
 */
function fillRandom(into: Uint8Array): void {
  globalThis.crypto.getRandomValues(into);
}

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  fillRandom(out);
  return out;
}

/** Devnet endpoint for the Encrypt pre-alpha gRPC service. Override via env. */
const ENCRYPT_DEVNET_GRPC_URL =
  'pre-alpha-dev-1.encrypt.ika-network.net:443';

/** Devnet program id (per docs/vendor/encrypt-pre-alpha.md). Override via env. */
const ENCRYPT_DEVNET_PROGRAM_ID =
  '4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8';

/** Lazy real-mode client. The upstream gRPC client is dynamically imported
 *  so mock-mode consumers (and bundlers targeting browser) never pay for
 *  loading `@grpc/grpc-js`. */
type EncryptClient = {
  createInput(p: {
    chain: number;
    inputs: Array<{ ciphertextBytes: Uint8Array | Buffer; fheType: number }>;
    proof?: Buffer;
    authorized: Buffer;
    networkEncryptionPublicKey: Buffer;
  }): Promise<{ ciphertextIdentifiers: Uint8Array[] }>;
  close(): void;
};

let encryptClientPromise: Promise<EncryptClient> | null = null;
async function getEncryptClient(): Promise<EncryptClient> {
  if (!encryptClientPromise) {
    encryptClientPromise = (async () => {
      const m = (await import(
        '@encrypt.xyz/pre-alpha-solana-client/grpc'
      )) as unknown as {
        createEncryptClient: (url: string) => EncryptClient;
      };
      const url =
        process.env['OBSIDIAN_ENCRYPT_GRPC_URL'] ?? ENCRYPT_DEVNET_GRPC_URL;
      return m.createEncryptClient(url);
    })();
  }
  return encryptClientPromise;
}

/**
 * Encode a u64 as little-endian bytes for the Encrypt service. The vendor
 * client wraps these into the proto's `inputs[].ciphertextBytes` field
 * along with an `fheType` discriminator.
 */
function u64LeBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

/** Solana base58 → 32-byte buffer (lazy-loaded via @solana/web3.js to avoid
 *  the SDK's web bundle footprint when only mock mode is in use). */
async function solanaProgramIdBytes(): Promise<Buffer> {
  const programId =
    process.env['OBSIDIAN_ENCRYPT_PROGRAM_ID'] ?? ENCRYPT_DEVNET_PROGRAM_ID;
  const m = await import('@solana/web3.js');
  return Buffer.from(new m.PublicKey(programId).toBytes());
}

/**
 * Submit one or more plaintext inputs to the Encrypt gRPC service and
 * return the on-chain ciphertext identifiers (32 bytes each — these are
 * the keypair-account pubkeys per docs/vendor/encrypt-pre-alpha.md
 * §Reference: Accounts).
 */
async function encryptViaGrpc(
  inputs: Array<{ value: bigint; fheType: number }>,
): Promise<Uint8Array[]> {
  const client = await getEncryptClient();
  const programIdBytes = await solanaProgramIdBytes();
  // Network encryption key — the pre-alpha decryptor accepts a 32-byte zero
  // placeholder for input commitments. Production reads the live key from
  // the `NetworkEncryptionKey` PDA (account discriminator 7, seeds
  // `["network_encryption_key", key_bytes]`, current key picked via
  // `EncryptConfig.current_epoch` — vendor docs §EncryptConfig + §NetworkEncryptionKey).
  // The active key isn't published as a single fixed PDA; it rotates per
  // epoch and is announced via `register_network_encryption_key` (disc 21).
  // Until the upstream client exposes a `getActiveNetworkEncryptionKey()`
  // helper, the 32-byte zero placeholder is what `createInput` accepts on
  // pre-alpha-dev-1 — the executor re-encrypts inputs under the live key on
  // its side. The placeholder is a pre-alpha quirk, not a security gap.
  const networkKey = Buffer.alloc(32);
  const r = await client.createInput({
    chain: 0, // ProtoChain.SOLANA = 0
    inputs: inputs.map((i) => ({
      ciphertextBytes: u64LeBytes(i.value),
      fheType: i.fheType,
    })),
    authorized: programIdBytes,
    networkEncryptionPublicKey: networkKey,
  });
  return r.ciphertextIdentifiers.map((b) =>
    b instanceof Uint8Array ? b : new Uint8Array(b),
  );
}

// FHE type discriminators per docs/vendor/encrypt-pre-alpha.md §FHE Types.
export const FheType = {
  EBool: 0,
  EUint8: 1,
  EUint16: 2,
  EUint32: 3,
  EUint64: 4,
  EUint128: 5,
} as const;
export type FheType = (typeof FheType)[keyof typeof FheType];

export type Side = 'bid' | 'ask';

export interface EncryptedOrderBlob {
  side_ct: Uint8Array;
  price_ct: Uint8Array;
  size_ct: Uint8Array;
  /** 16-byte cryptographically random nonce; used as PDA seed by `submit_order`. */
  nonce: Uint8Array;
}

/**
 * Tri-state Encrypt mode (`mock` | `real` | `auto`). Was a two-state union
 * before — kept as a type alias for back-compat with code that destructured
 * it. `currentMode()` now returns the tri-state value via `resolveMode`.
 */
export type EncryptMode = Mode;
const U64_MAX = (1n << 64n) - 1n;

/** Width of an Encrypt Ciphertext-account pubkey, used as the wire size for
 *  every ciphertext id (mock or real). 32 bytes per Encrypt's
 *  Reference: Accounts §Ciphertext (disc 6). */
export const CT_ID_LEN = 32;

/** Byte-0 marker for mock-mode ciphertext ids. Helps the debug CLI distinguish
 *  real vs mock cts on-chain without leaking either. */
export const MOCK_TAG = 0xe3;

export function currentMode(): EncryptMode {
  return resolveMode('encrypt');
}

/**
 * Mock ciphertext layout (32 bytes):
 *   [0]      MOCK_TAG (0xE3)
 *   [1]      fhe_type
 *   [2..16]  random salt — fresh per call so identical plaintexts produce
 *            distinct ciphertext ids (mirrors real Encrypt accounts being
 *            keypair-generated)
 *   [16..24] reserved zeros (forward-compat marker)
 *   [24..32] u64 little-endian plaintext (recoverable in mock mode only)
 */
function mockEncrypt(value: bigint, fheType: number): Uint8Array {
  const buf = new Uint8Array(CT_ID_LEN);
  buf[0] = MOCK_TAG;
  buf[1] = fheType;
  fillRandom(buf.subarray(2, 16));
  new DataView(buf.buffer, buf.byteOffset, CT_ID_LEN).setBigUint64(
    24,
    value,
    true,
  );
  return buf;
}

function mockUnpack(ct: Uint8Array): { fheType: number; value: bigint } {
  if (ct.length !== CT_ID_LEN) {
    throw new DecryptionError(
      `mock decrypt: expected ${CT_ID_LEN}-byte ciphertext id, got ${ct.length}`,
    );
  }
  if (ct[0] !== MOCK_TAG) {
    throw new DecryptionError(
      'mock decrypt: ciphertext does not carry the OBSIDIAN_ENCRYPT_MODE=mock tag',
    );
  }
  return {
    fheType: ct[1]!,
    value: new DataView(ct.buffer, ct.byteOffset, CT_ID_LEN).getBigUint64(
      24,
      true,
    ),
  };
}

export async function encryptSide(side: Side): Promise<Uint8Array> {
  const value = side === 'bid' ? 0n : 1n;
  const r = await tryReal<Uint8Array>({
    surface: 'encrypt',
    op: 'encryptSide',
    mode: currentMode(),
    real: async () => {
      const [id] = await encryptViaGrpc([{ value, fheType: FheType.EBool }]);
      return id!;
    },
    mock: async () => mockEncrypt(value, FheType.EBool),
  });
  return r.value;
}

export async function encryptU64(value: bigint): Promise<Uint8Array> {
  if (value < 0n || value > U64_MAX) {
    // Don't include the value in the message — zero leakage rule.
    throw new EncryptionError('encryptU64: value out of u64 range');
  }
  const r = await tryReal<Uint8Array>({
    surface: 'encrypt',
    op: 'encryptU64',
    mode: currentMode(),
    real: async () => {
      const [id] = await encryptViaGrpc([{ value, fheType: FheType.EUint64 }]);
      return id!;
    },
    mock: async () => mockEncrypt(value, FheType.EUint64),
  });
  return r.value;
}

export async function encryptOrder(
  side: Side,
  priceQuote: bigint,
  sizeBase: bigint,
): Promise<EncryptedOrderBlob & { mode: ResolvedMode }> {
  if (priceQuote < 0n || priceQuote > U64_MAX || sizeBase < 0n || sizeBase > U64_MAX) {
    throw new EncryptionError('encryptOrder: price/size out of u64 range');
  }
  const sideValue = side === 'bid' ? 0n : 1n;
  // One tryReal call so real mode batches all three inputs into a single
  // gRPC request (cheaper + atomic proof) and auto-fallback flips both
  // dispatchers together — never a "side via real, price via mock" mix.
  const r = await tryReal<{
    side_ct: Uint8Array;
    price_ct: Uint8Array;
    size_ct: Uint8Array;
  }>({
    surface: 'encrypt',
    op: 'encryptOrder',
    mode: currentMode(),
    real: async () => {
      const [side_ct, price_ct, size_ct] = await encryptViaGrpc([
        { value: sideValue, fheType: FheType.EBool },
        { value: priceQuote, fheType: FheType.EUint64 },
        { value: sizeBase, fheType: FheType.EUint64 },
      ]);
      return { side_ct: side_ct!, price_ct: price_ct!, size_ct: size_ct! };
    },
    mock: async () => ({
      side_ct: mockEncrypt(sideValue, FheType.EBool),
      price_ct: mockEncrypt(priceQuote, FheType.EUint64),
      size_ct: mockEncrypt(sizeBase, FheType.EUint64),
    }),
  });
  const nonce = randomBytes(16);
  return { ...r.value, nonce, mode: r.mode };
}

export async function requestThresholdDecrypt(
  ciphertext: Uint8Array,
  _txSignature: string,
): Promise<bigint> {
  // requestThresholdDecrypt is a sync API the keeper uses in mock paths to
  // recover the plaintext from a deterministic mock ciphertext. Real-mode
  // decryption is async on-chain (request_decryption → finalize_decryption
  // CPI flow); there is no synchronous gRPC equivalent. So we run mock
  // unconditionally — auto and real both surface the same clean error if
  // the caller passed a non-mock ciphertext.
  if (currentMode() === 'real') {
    throw new VendorSDKUnavailableError(
      'encrypt',
      'real requestThresholdDecrypt: decryption is async on-chain in real mode — ' +
        'use the program-side `request_decryption` CPI followed by ' +
        '`read_decrypted_verified` (gap E3 in docs/gaps.md).',
    );
  }
  return mockUnpack(ciphertext).value;
}

/** Plaintext-safe one-line summary for logs / CLIs. Reveals length, mode, and
 *  fhe type only — never the value. */
export function describeCiphertext(ct: Uint8Array): string {
  if (ct.length !== CT_ID_LEN) {
    return `ct(${ct.length}B, unknown-shape)`;
  }
  if (ct[0] === MOCK_TAG) {
    return `ct(${CT_ID_LEN}B, mock, fheType=${ct[1]})`;
  }
  return `ct(${CT_ID_LEN}B, real-or-foreign)`;
}

/**
 * Client-side adapter for Encrypt FHE primitives.
 *
 * **Mode selection** — `OBSIDIAN_ENCRYPT_MODE` env var:
 *   - `mock`   (default) — deterministic byte encoding, round-trip recoverable.
 *                          For tests, scaffolding, and CI. Plaintext is
 *                          recoverable from the ciphertext bytes; never use
 *                          on real value flows.
 *   - `real`             — currently unsupported. The upstream
 *                          `@encrypt.xyz/pre-alpha-solana-client` ships its
 *                          gRPC client as uncompiled `.ts` files in the
 *                          `exports` field, and Node 24 refuses to strip TS
 *                          from `node_modules`
 *                          (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
 *                          See `docs/gaps.md` gap E5 for the closure plan.
 *
 * **Zero leakage rule:** never log the plaintext order fields. Use
 * `describeCiphertext()` for safe diagnostic output (length + tag only).
 */

import {
  DecryptionError,
  EncryptionError,
  VendorSDKUnavailableError,
} from './errors.ts';

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
  // Network encryption key — pre-alpha mock decryptor accepts a placeholder;
  // production fetches the live key from the on-chain Encrypt config account.
  // TODO(real-prod): pull `encryption_key` from the Config account at
  //   `4ebfzW…ND8/seeds=[b"config"]`.
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

export type EncryptMode = 'mock' | 'real';
const MODE_ENV = 'OBSIDIAN_ENCRYPT_MODE';
const U64_MAX = (1n << 64n) - 1n;

/** Width of an Encrypt Ciphertext-account pubkey, used as the wire size for
 *  every ciphertext id (mock or real). 32 bytes per Encrypt's
 *  Reference: Accounts §Ciphertext (disc 6). */
export const CT_ID_LEN = 32;

/** Byte-0 marker for mock-mode ciphertext ids. Helps the debug CLI distinguish
 *  real vs mock cts on-chain without leaking either. */
export const MOCK_TAG = 0xe3;

export function currentMode(): EncryptMode {
  return process.env[MODE_ENV] === 'real' ? 'real' : 'mock';
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
  if (currentMode() === 'real') {
    const [id] = await encryptViaGrpc([{ value, fheType: FheType.EBool }]);
    return id!;
  }
  return mockEncrypt(value, FheType.EBool);
}

export async function encryptU64(value: bigint): Promise<Uint8Array> {
  if (value < 0n || value > U64_MAX) {
    // Don't include the value in the message — zero leakage rule.
    throw new EncryptionError('encryptU64: value out of u64 range');
  }
  if (currentMode() === 'real') {
    const [id] = await encryptViaGrpc([{ value, fheType: FheType.EUint64 }]);
    return id!;
  }
  return mockEncrypt(value, FheType.EUint64);
}

export async function encryptOrder(
  side: Side,
  priceQuote: bigint,
  sizeBase: bigint,
): Promise<EncryptedOrderBlob> {
  if (priceQuote < 0n || priceQuote > U64_MAX || sizeBase < 0n || sizeBase > U64_MAX) {
    throw new EncryptionError('encryptOrder: price/size out of u64 range');
  }
  if (currentMode() === 'real') {
    // Real mode: one batched gRPC call so the upstream proof covers all
    // three encrypted inputs together (cheaper + atomic).
    const sideValue = side === 'bid' ? 0n : 1n;
    const [side_ct, price_ct, size_ct] = await encryptViaGrpc([
      { value: sideValue, fheType: FheType.EBool },
      { value: priceQuote, fheType: FheType.EUint64 },
      { value: sizeBase, fheType: FheType.EUint64 },
    ]);
    const nonce = randomBytes(16);
    return { side_ct: side_ct!, price_ct: price_ct!, size_ct: size_ct!, nonce };
  }
  const [side_ct, price_ct, size_ct] = await Promise.all([
    encryptSide(side),
    encryptU64(priceQuote),
    encryptU64(sizeBase),
  ]);
  const nonce = randomBytes(16);
  return { side_ct, price_ct, size_ct, nonce };
}

export async function requestThresholdDecrypt(
  ciphertext: Uint8Array,
  _txSignature: string,
): Promise<bigint> {
  if (currentMode() === 'real') {
    // Real-mode threshold decryption is async — `request_decryption` on
    // chain emits an event, the off-chain decryptor responds in a later
    // tx, and the program reads the result via `read_decrypted_verified`.
    // The synchronous `requestThresholdDecrypt` from this client doesn't
    // correspond to that flow; callers in real mode should use the
    // on-chain CPI instead. We surface a clean error rather than a mock.
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

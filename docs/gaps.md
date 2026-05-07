# SDK Gaps & Adaptations

Tracks every place where the project deviates from the source-of-truth specs
because of pre-alpha SDK constraints, missing primitives, or simplifications
made deliberately for the hackathon scaffold. Each entry should be removable
once the underlying gap closes.

## Encrypt

### E0. CT_MAX = 3000, not the prompt's 4096
**Where:** `programs/obsidian-core/src/state.rs::CT_MAX`.

**Reality:** Solana's `MAX_PERMITTED_DATA_INCREASE` caps account allocation
inside a CPI at 10 240 bytes. With three inline `Vec<u8>` ciphertext fields
in `EncryptedOrder` (and again in `MatchIntent`), 4096-byte ciphertexts
overflow the cap (3 × 4096 + overhead ≈ 12.5 KB). A 3000-byte cap leaves
~9.2 KB of allocation, well under the limit.

**Why deviate now:** the prompt's 4096 default doesn't account for the
scaffold's choice to inline three ciphertexts in one PDA. The prompt
explicitly licenses overrides ("override from docs/vendor").

**Closure plan (P3):** vanishes when E1 closes — Pubkey references are
32 bytes each, so account size drops to a few hundred bytes total.

### E1. ~~Inline `Vec<u8>` ciphertexts vs. keypair-account references~~ — **CLOSED**
`EncryptedOrder` and `MatchIntent` now store `side_ct: [u8; 32]`, etc. as
Encrypt Ciphertext-account identifiers. Closed by the program rewrite at
2026-05-07 (commit on this branch). The SDK's real-mode `encryptOrder` calls
gRPC `createInput` and returns 3 fresh on-chain ciphertext-account
identifiers; `submit_order` accepts those refs directly. `MatchIntent` also
holds the 3 keeper-supplied output ct refs from `try_match`.

### E2. `enc_xor / enc_gte / enc_min` primitives don't exist — **PARTIALLY CLOSED**
**State (2026-05-07):** the four mock functions in `encrypt_cpi.rs` are gone.
`try_match` now takes the three output ciphertext refs (`can_match_ct`,
`fill_size_ct`, `clearing_price_ct`) as **instruction arguments**, computed
off-chain by the keeper via gRPC `createInput`. The on-chain program never
sees plaintext — it just records the refs and verifies digests at
`request_decryption` time.

**What's left:** moving the FHE comparator from the keeper back on-chain
via `execute_graph` CPI. That's the production trust model — the program
should derive output ciphertexts itself from the input order ciphertexts,
not trust the keeper to pick them. Closure requires:
1. `#[encrypt_fn] match_orders(a_side, a_price, a_size, b_side, b_price, b_size) -> (EBool, EUint64, EUint64)` Rust DSL.
2. The `encrypt-anchor` crate from `dwallet-labs/encrypt-pre-alpha` wired into Cargo.toml.
3. **Blocker**: upstream `encrypt-anchor` requires `anchor-lang = 1` + `edition = 2024` + Rust 1.94, while ObsidianDesk is on `anchor-lang = 0.32.1` + `edition = 2021`. Either upgrade ObsidianDesk to Anchor 1 (multi-day, breaking-change minefield) or vendor + adapt ~5000 LOC of upstream crates for Anchor 0.32.

Until E2 fully closes, the keeper is privileged to compute matches off-chain. The keeper-authority gating on `try_match` (added with this refactor) limits this trust to the same key that gates settlement.

### E3. ~~Threshold decrypt is async, not synchronous~~ — **CLOSED**
The single `request_settlement` instruction has been split into two:

1. `request_decryption(match_id)` — keeper-only. Reads the three output
   Ciphertext accounts produced by `try_match`, parses each one's
   `ciphertext_digest` from the on-chain account data, snapshots the digests
   onto `MatchIntent`, and emits `DecryptionRequested`.
2. `finalize_decryption(match_id, can_match, fill_size, clearing_price, seller_is_order_a)` —
   keeper-only. Verifies the snapshot digests are present (i.e.
   `request_decryption` ran), refuses if `can_match == false`, writes the
   `MatchRecord`, and closes `MatchIntent`.

The keeper performs decryption off-chain via gRPC `readCiphertext` (real
mode shipped with the SDK earlier this session) and submits the verified
plaintexts. Trust model: keeper-authority gating + on-chain digest
verification mean the keeper cannot submit plaintexts that don't bind to
the same on-chain ciphertext accounts that `try_match` matched.

### E5. ~~Upstream TS client `@encrypt.xyz/pre-alpha-solana-client` is unconsumable by Node 24~~ — **CLOSED**
**Where:** `sdk/src/encrypt.ts` real-mode now dispatches to the upstream
gRPC client.

**Original reality (0.1.0):** the published package declared
`exports."./grpc"` as `./src/grpc.ts`. Node 24 refuses to strip TS from
`node_modules/` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).

**Closure (2026-05-07):** Encrypt 0.1.1 ships compiled `dist/grpc.js` +
`.d.ts` but its `exports` field still points at `./src/grpc.ts`, and
the precompiled `dist/grpc.js` uses extension-less imports that Node ESM
rejects. `pnpm patch` is committed at
`patches/@encrypt.xyz__pre-alpha-solana-client@0.1.1.patch` to:

1. Redirect `exports["."]`, `["./grpc"]`, `["./grpc-web"]` to the
   `dist/...` files.
2. Append `.js` to all relative imports inside `dist/` so Node ESM
   resolves them.

`sdk/src/encrypt.ts` real-mode dispatches `encryptU64`, `encryptSide`,
`encryptOrder` to `createEncryptClient(...).createInput(...)` against
`pre-alpha-dev-1.encrypt.ika-network.net:443` and returns the on-chain
32-byte ciphertext identifier per input. `OBSIDIAN_ENCRYPT_GRPC_URL` and
`OBSIDIAN_ENCRYPT_PROGRAM_ID` env vars override defaults. Verified by
`sdk/scripts/devnet-smoke.mjs`.

### E4. ~~Multi-output FHE decrypt vs. one DecryptionRequest per ciphertext~~ — **CLOSED**
`MatchIntent` now stores three independent ciphertext refs + three
independent digest snapshots. `request_decryption` verifies each ct
account's `ciphertext_digest` separately and snapshots all three. The keeper
performs three independent `readCiphertext` gRPC calls (one per ct account)
and submits the three plaintexts to `finalize_decryption`.

## Ika

### I0. ~~Upstream TS client `@ika.xyz/pre-alpha-solana-client` is unconsumable by Node 24~~ — **CLOSED (vendored)**
**Where:** `sdk/src/ika-vendor/`.

**Original reality (0.1.0/0.1.1):** Ika ships ONLY `.ts` sources — even
the main entry `./src/generated/index.ts` is uncompiled. Patching
`exports` doesn't help because there's no compiled output to point at.

**Closure (2026-05-07):** vendored `src/grpc.ts`, `src/bcs-types.ts`,
and `src/generated/grpc/ika_dwallet.ts` (~1100 LOC total) into
`sdk/src/ika-vendor/`. Two project-specific edits applied:

1. `curve: { Curve25519: true }` → `curve: { Secp256k1: true }` and
   `signature_algorithm: { EdDSA: true }` → `{ ECDSASecp256k1: true }`
   so the dWallet matches Bitcoin's signature scheme.
2. Default gRPC URL now `pre-alpha-dev-1.ika.ika-network.net:443`
   (devnet) instead of `127.0.0.1:50051`.

`sdk/src/ika.ts` real-mode dispatches `createDWallet` →
`requestDKG`, deriving a P2WPKH signet address from the returned
secp256k1 public key via `p2wpkhAddressFromPublicKey`. `requestSign`
chains `requestPresign` → `requestSign` against the same client.
`OBSIDIAN_IKA_GRPC_URL` env var overrides the default endpoint. Verified
by `sdk/scripts/devnet-smoke.mjs`.

**Caveats:** vendored code carries the upstream license
(`BSD-3-Clause-Clear`, `Copyright (c) dWallet Labs, Ltd.`); see top-of-file
notices preserved verbatim. Re-sync from upstream when 0.1.2+ ships a
compiled `dist/`.

### I1. No real DKG (distributed key generation) without network access
**Where:** mock `createDWallet` synthesizes a P2WPKH key locally with
`bitcoinjs-lib`.

**Reality:** Real Ika dWallets are 2PC-MPC shares — neither user nor
network can sign alone. DKG is an interactive multi-round MPC ceremony
requiring gRPC contact with the Ika network at
`pre-alpha-dev-1.ika.ika-network.net:443`.

**Why deviate now:** local mock keeps tests offline + deterministic. The
single-key shortcut is semantically equivalent for "the program emits a
signed BTC tx" demos.

**Closure plan (P9+):** real-mode `createDWallet` calls Ika gRPC
`SubmitTransaction(DkgFirstRound)`, polls for the resulting DWallet PDA,
and returns the derived BTC P2WPKH address.

### I2. Mock dWallet store is process-local and in-memory
**Where:** `sdk/src/ika.ts` `mockStore: Map<string, MockEntry>`.

**Reality:** the Ika network is the source of truth for dWallets in
production. The mock substitutes it with a per-process `Map` so tests
that create + sign in one process work, but the deposit page in the
Next.js dev server can't share state with a separately-spawned keeper.

**Why deviate now:** simplifies the e2e test to a single mocha process.
Deposit-page → keeper handoff is not on the P4 acceptance set.

**Closure plan (P8 / P9):** persist mock keys to `~/.obsidian-mock-keys.json`
(file-locked) so multiple processes can read them. Production Ika lookup
is on-chain — no shared file needed.

### I3. `finalize_settlement` accepts any signer (no keeper authority)
**Where:** `programs/obsidian-core/src/lib.rs::FinalizeSettlement`.

**Reality:** the `keeper` account in the Anchor accounts struct is just a
`Signer<'info>` with no on-chain authority check. Anyone with SOL can
call `finalize_settlement` and submit arbitrary `btc_tx_proof` bytes.

**Why deviate now:** a single keeper-keypair check still doesn't enforce
the actual proof's validity — that needs SPV / merkle inclusion verified
on-chain (deferred to P9 per ARCHITECTURE.md §10). Adding a stub authority
check would be performance theater.

**Closure plan (P9):** add a real `KeeperAuthority` PDA stored on
`MarketState`, gate `finalize_settlement` with `has_one = keeper_authority`,
AND verify the BTC proof via SPV against a header oracle. Both must land
together — a keeper check without proof verification is worse than nothing
because it gives a false sense of security.

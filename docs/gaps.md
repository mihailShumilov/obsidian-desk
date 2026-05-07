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

### E1. Inline `Vec<u8>` ciphertexts vs. keypair-account references
**Where:** `programs/obsidian-core/src/state.rs::EncryptedOrder` stores
`side_ct`, `price_ct`, `size_ct` as `Vec<u8>` with `#[max_len(CT_MAX)]`.

**Reality:** Encrypt represents ciphertexts as 100-byte keypair accounts owned
by the Encrypt program (`docs/vendor/encrypt-pre-alpha.md` §Reference: Accounts
— Ciphertext (disc 6)). The pubkey IS the ciphertext identifier; the encrypted
blob lives in a separate account, not inline in our state.

**Why deviate now:** `docs/PROMPTS.md` P2 explicitly asks for inline `Vec<u8>`
fields with `#[max_len(CT_MAX)]`. Following the prompt keeps the P2 acceptance
criteria reachable without reaching forward into P3's CPI work.

**Closure plan (P3):** refactor `EncryptedOrder` to hold `side_ct: Pubkey`,
`price_ct: Pubkey`, `size_ct: Pubkey` referencing real Encrypt Ciphertext
keypair accounts, and add the Encrypt program / config / deposit / network key
/ cpi_authority / event_authority accounts to every Anchor `#[derive(Accounts)]`
struct that does FHE work.

### E2. `enc_xor / enc_gte / enc_min` primitives don't exist
**Where:** `programs/obsidian-core/src/encrypt_cpi.rs`.

**Reality:** all FHE ops go through a single `execute_graph` CPI; the actual
operations (XOR, comparison, min, conditional) are written in the Rust DSL
behind `#[encrypt_fn]` and compiled into a graph at build time
(`docs/vendor/encrypt-pre-alpha.md` §execute_graph, §CPI framework, §FHE
Operations L545).

**Why deviate now:** `docs/ARCHITECTURE.md` §5.2 used these primitive names as
shorthand for what would actually be DSL-compiled graphs. P2 wraps that
shorthand with deterministic mock bodies so the program compiles end-to-end
and the test exercises the full instruction flow.

**Closure plan (P3):** define a single `#[encrypt_fn] match_orders` DSL that
takes the three side / price / size ciphertext pairs and returns
`(can_match: EBool, fill: EUint64, clearing: EUint64)`. Replace the four mock
functions with one CPI invocation of the generated `match_orders_graph`
method on `EncryptContext`.

### E3. Threshold decrypt is async, not synchronous
**Where:** `request_threshold_decrypt` in `encrypt_cpi.rs` returns a struct
synchronously inside the same instruction.

**Reality:** decryption is request → off-chain decryptor responds → read
result in a *later* transaction (`docs/vendor/encrypt-pre-alpha.md` §Decryption
flow L1300). The on-chain pattern is:
1. Tx N: `ctx.request_decryption(req_acct, ct)` → returns digest, store on
   program state.
2. Tx N+M: `read_decrypted_verified::<Uint64>(req_data, &stored_digest)` →
   plaintext value.

**Why deviate now:** keeping the P2 control flow inside one instruction
matches the prompt's spec ("if can_match=1, stores plaintext in MatchRecord")
and avoids needing a two-phase keeper for the test.

**Closure plan (P3 / P9):** split `request_settlement` into two on-chain
instructions:
  - `request_settlement(match_id)` — emits `DecryptionRequested`, stores the
    Encrypt request-account pubkey + digest on `MatchIntent`.
  - `finalize_decryption(match_id)` — after the decryptor responds, reads the
    plaintext and writes the `MatchRecord`. Triggered by the keeper.

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

### E4. Multi-output FHE decrypt vs. one DecryptionRequest per ciphertext
**Where:** `request_threshold_decrypt(can_match_ct, fill_size_ct, clearing_price_ct)`
returns all three plaintexts in one struct.

**Reality:** each `request_decryption` targets a single ciphertext account and
produces a single result value. Three plaintexts ⇒ three request accounts and
three responses to read.

**Closure plan (P3):** loop and store three `(request_pubkey, digest)`
pairs on `MatchIntent`; compose them into the `MatchRecord` in
`finalize_decryption`.

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

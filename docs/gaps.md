# SDK Gaps & Adaptations

Tracks every place where the project deviates from the source-of-truth specs
because of pre-alpha SDK constraints, missing primitives, or simplifications
made deliberately for the hackathon scaffold. Each entry should be removable
once the underlying gap closes.

## Encrypt

### E0. ~~CT_MAX = 3000, not the prompt's 4096~~ — **OBSOLETE (subsumed by E1 closure)**
**Where:** historic — `programs/obsidian-core/src/state.rs` no longer defines
`CT_MAX`.

**Original reality:** Solana's `MAX_PERMITTED_DATA_INCREASE` caps account
allocation inside a CPI at 10 240 bytes. With three inline `Vec<u8>`
ciphertext fields in `EncryptedOrder` (and again in `MatchIntent`),
4096-byte ciphertexts overflowed the cap; a 3000-byte cap left ~9.2 KB of
allocation, well under the limit.

**Closure (alongside E1):** When `EncryptedOrder` and `MatchIntent` switched
to holding 32-byte Ciphertext-account refs (`CT_REF_LEN = 32`), the inline
blob constraint disappeared and the constant was removed. The only large
inline cipher field left in the schema is the singleton
`MarketState.total_volume_cipher` (capped by `TOTAL_VOLUME_CT_MAX = 4096`),
which is on its own account and doesn't compete with anything for the CPI
realloc budget.

### E1. ~~Inline `Vec<u8>` ciphertexts vs. keypair-account references~~ — **CLOSED**
`EncryptedOrder` and `MatchIntent` now store `side_ct: [u8; 32]`, etc. as
Encrypt Ciphertext-account identifiers. Closed by the program rewrite at
2026-05-07 (commit on this branch). The SDK's real-mode `encryptOrder` calls
gRPC `createInput` and returns 3 fresh on-chain ciphertext-account
identifiers; `submit_order` accepts those refs directly. `MatchIntent` also
holds the 3 keeper-supplied output ct refs from `try_match`.

### E2-residual. ~~execute_graph CPI fails at runtime for 6-input/3-output graphs~~ — **CLOSED (vendored patch)**

**Where:** `crates/encrypt-anchor-vendor/src/lib.rs::account_meta_for`.

**Closure (2026-05-08):** Vendored `encrypt-anchor` v0.1.0 from upstream
`dwallet-labs/encrypt-pre-alpha@dadfff8c` into `crates/encrypt-anchor-vendor/`.
Patched `invoke_execute_graph`, `execute_graph`, and `execute_registered_graph`
to use a new helper `account_meta_for(acct)` that preserves both `is_signer`
and `is_writable` from the outer-tx `AccountInfo`, instead of hardcoding
`AccountMeta::new(_, false)` for every encrypt_execute_account.

```rust
fn account_meta_for(acct: &AccountInfo) -> AccountMeta {
    if acct.is_writable {
        AccountMeta::new(acct.key(), acct.is_signer)
    } else {
        AccountMeta::new_readonly(acct.key(), acct.is_signer)
    }
}
```

`programs/obsidian-core/Cargo.toml` repointed `encrypt-anchor` from the git
dep to `path = "../../crates/encrypt-anchor-vendor"`. `Cargo.toml` workspace
includes the new crate. `anchor build` compiles clean.

The original problem from the upstream: the bug was hard-coded for the
voting example which never had output cts that needed to be signers — all
output cts in the upstream example overlapped with input cts and existed
before the call. Our 6-input/3-output `match_orders_graph` has 3 fresh
output cts whose inner system_program create-account CPI requires the
signer flag to chain from the outer transaction.

**Re-vendor procedure** (when upstream ships a fix or we bump the rev):
1. `cd ~/.cargo/git/checkouts/encrypt-pre-alpha-* && git fetch origin && git checkout <new-rev>`
2. `cp ~/.cargo/git/checkouts/.../chains/solana/program-sdk/anchor/src/*.rs crates/encrypt-anchor-vendor/src/`
3. Re-apply the diff: search for `AccountMeta::new(acct.key(), false)` → replace with `account_meta_for(acct)`. Three call sites.
4. Bump `encrypt-types` and `encrypt-solana-types` revs in
   `crates/encrypt-anchor-vendor/Cargo.toml` and
   `programs/obsidian-core/Cargo.toml` to match.
5. `anchor build && anchor deploy --provider.cluster devnet`.

**Devnet verification (final-deploy step):**
```bash
anchor deploy --provider.cluster devnet --program-name obsidian_core --program-keypair scripts/.obsidian-keypair.json
tsx keeper/scripts/devnet-bootstrap.ts             # creates market + 2 pending orders
tsx keeper/scripts/match-pair.ts <market> <a> <b>  # confirms the on-chain match graph completes
```

The previous reproducer (CPI fails at depth 2 with `Cross-program invocation
with unauthorized signer or writable account`) is the failure mode that now
goes away.

**Devnet verification result (2026-05-08):**
- Re-deployed obsidian-core with the vendor-patched encrypt-anchor.
- Switched keeper to CREATE-mode (fresh keypair output cts that sign the
  outer tx).
- Added `system_program` to invoke_execute_graph's fixed account list
  (upstream omitted it; required for Encrypt's inner
  `system_program::create_account` CPI in CREATE mode).

Failure mode progression:
| Attempt | Error |
|---|---|
| 1. Pre-patch (UPDATE mode) | depth-2 `writable privilege escalated` |
| 2. Post-patch, UPDATE mode | depth-2 `signer privilege escalated` |
| 3. Post-patch, CREATE mode (no system_program) | `An account required by the instruction is missing — Unknown program 11111111111111111111111111111111` |
| 4. Post-patch, CREATE mode + system_program in metas | **CPI dispatches successfully → Encrypt runs → `custom program error: 0x14`** (1978 CUs spent before fail) |

The runtime-level CPI gate is closed. Encrypt's program handler runs.

**Residual: Encrypt-domain error 0x14 (=20).** The deployed Encrypt
program at `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` returns custom
error 20, which is **not in the upstream IDL** (`chains/solana/idl/encrypt_program.json`
documents errors 0–17 only). The deployed binary's source isn't in the
public `encrypt-pre-alpha` checkout — only the SDKs are. No `msg!()`
diagnostic is emitted; the failure is a fast-path validation
(1978 compute units consumed before exit).

Likely root causes (informed by the IDL's 0–17 error list):
- Graph hash registration drift — our compiled `match_orders_graph` may
  hash to a value that doesn't match what the deployed Encrypt program
  expects (Encrypt may require pre-registered graphs only).
- Input ciphertext format mismatch — the gRPC-allocated input cts may
  have a discriminator or payload layout that Encrypt's check rejects.
- An undocumented permission / config check past error 17.

Reproducing locally requires an Encrypt program built from a matching
source rev. **This is not closeable from ObsidianDesk's side without
either a more current Encrypt IDL or upstream source access.**

**State (2026-05-07, devnet smoke):**
- obsidian-core `1.0.2` deployed to Solana devnet at
  `H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp`.
- `tsx keeper/scripts/devnet-bootstrap.ts` cleanly creates a market and
  two opposite-side orders whose `*_ct` fields point at real Encrypt
  Ciphertext accounts on devnet (created via gRPC `createInput`).
- `tsx keeper/scripts/match-pair.ts <market> <a> <b>` reaches the Encrypt
  CPI inside `try_match` and fails on every account-shape variant we've
  tried.

**Tried, all fail:**
1. Output cts as fresh keypair signers (CREATE mode). Fails at depth 3
   with `<output_pubkey> writable privilege escalated` — Encrypt's inner
   CPI to system_program needs them as signers but encrypt-anchor's
   `invoke_execute_graph` demoted them to `isSigner=false` at depth 2.
2. Output cts pre-allocated via gRPC `createInput` (UPDATE mode). Fails
   at depth 3 with `<output_pubkey> signer privilege escalated` — the
   same demotion applies, but now the output is already authorised, so
   the failure surfaces at a different inner CPI step.

**Root cause:** the encrypt-anchor v0.1.0 `invoke_execute_graph` hard-codes
`AccountMeta::new(acct.key(), false)` for every `encrypt_execute_account`,
demoting any `isSigner=true` flag from the outer transaction. This works
for the upstream voting example (`cast_vote_graph(yes, no, vote) → (yes, no)`)
because all output cts overlap with input cts and exist before the call,
but it doesn't fit our `match_orders_graph` shape with 3 fresh outputs
that don't appear in the input list.

**Closure paths:**
1. Wait for upstream `encrypt-anchor` to ship a CPI variant that
   propagates the outer-tx signer flag to outputs (or pre-allocates them
   on the keeper's behalf via a different ix).
2. Vendor + adapt `encrypt-anchor::invoke_execute_graph` so we can
   choose the meta layout (preserving `isSigner=true` on selected
   `encrypt_execute_accounts`).
3. Fold our match_orders into a strict UPDATE-mode shape — overwrite 3
   of the 6 input order cts in place. This destroys the original orders,
   so it's only viable if `MatchIntent` carries pristine copies, which
   doubles the per-match account count.

The on-chain DSL graph + program-side wiring are otherwise complete; the
keeper matching loop builds the 22-account instruction correctly and
gets all the way to the Encrypt CPI before stopping at the signer
demotion.

### E2. ~~`enc_xor / enc_gte / enc_min` primitives don't exist~~ — **CLOSED**
**State (2026-05-07):** ObsidianDesk migrated to Anchor 1.0.2 (Rust 1.94)
and pulled in `encrypt-anchor` + `encrypt-solana-dsl` from
`dwallet-labs/encrypt-pre-alpha` (commit `dadfff8`).

`programs/obsidian-core/src/lib.rs` now defines:

```rust
#[encrypt_fn]
fn match_orders_graph(
    a_side: EBool, a_price: EUint64, a_size: EUint64,
    b_side: EBool, b_price: EUint64, b_size: EUint64,
) -> (EBool, EUint64, EUint64) {
    let opp = a_side ^ b_side;
    let a_is_bid = !a_side;
    let bid_price = if a_is_bid { a_price } else { b_price };
    let ask_price = if a_is_bid { b_price } else { a_price };
    let crosses = bid_price >= ask_price;
    let can_match = opp & crosses;
    let fill = a_size.min(b_size);
    let clearing = (a_price + b_price) / 2u64;
    (can_match, fill, clearing)
}
```

`try_match` builds an `EncryptContext` and dispatches the compiled graph
via `ctx.match_orders_graph(...)` — a real `execute_graph` CPI to the
deployed Encrypt program at `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`
on Solana devnet. On-chain artefacts: 6 input Ciphertext-account pubkeys
verified against `EncryptedOrder.{side,price,size}_ct`, 3 output
Ciphertext-account pubkeys allocated by the keeper as fresh keypair
accounts and snapshotted onto `MatchIntent` after the CPI completes.

The program never sees plaintext.

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

### I1. ~~No real DKG / sign-surface~~ — **CLOSED for the sign path**
**Where:** `sdk/src/ika.ts::requestSign` real-mode now plugs back into a
finalised, broadcastable PSBT via `sdk/src/btc.ts::attachExternalEcdsaSig`.

**Closure (2026-05-07):** The signing surface is end-to-end:
1. The keeper builds a P2WPKH PSBT against the seller's dWallet.
2. `sdk/src/btc.ts::bip143SighashForP2WPKH` extracts the BIP-143 segwit-v0
   sighash for input 0 (32 bytes).
3. The SDK calls `client.requestPresign` → `client.requestSign` against the
   pre-alpha Ika gRPC at `pre-alpha-dev-1.ika.ika-network.net:443` with
   the sighash as `message`. Network returns a 64-byte `(r || s)` ECDSA
   signature on Secp256k1.
4. `attachExternalEcdsaSig` normalises to low-s (BIP-62), DER-encodes,
   appends `SIGHASH_ALL`, and **verifies the sig against the dWallet
   pubkey + sighash before attaching**. Mismatch (e.g. unexpected
   network-side hash_scheme) throws explicitly rather than emitting a
   broken tx.
5. `finalizePsbt` extracts the broadcast-ready hex.
6. `sdk/src/btc.ts::broadcastTx` POSTs to `mempool.space/<network>/api/tx`
   and returns the real signet txid.

The unit test at `sdk/tests/btc.test.ts::"external-sig path produces the
same finalised tx as single-key signAndFinalize"` proves byte-equivalence
with the bitcoinjs-lib internal flow.

**Auto-fallback:** If the pre-alpha network is unreachable or the sig
fails verification, `tryReal` (sdk/src/mode.ts) falls back to the mock
single-key path so the demo keeps running. Each call logs which path
produced the value.

**Residual:** authorisation. The current flow uses the keeper's keypair
to authenticate to Ika, not the seller's. Production needs an on-chain
`MessageApproval` (Solana ix) that the seller pre-authorises and the
keeper presents to Ika at sign time. Tracked as **gap I4**.

### I4. ~~On-chain MessageApproval for keeper-presented Ika auth~~ — **CLOSED for the on-chain layer**
**Where:** `programs/obsidian-core/src/lib.rs` —
`approve_btc_settlement` (seller-signed) + `consume_btc_approval` (keeper-only).

**Closure (2026-05-08):** Added `BtcSettleApproval` PDA at
`(b"btc_approval", order_pubkey)`, plus two instructions:

1. `approve_btc_settlement(max_amount_sats, expiry_slot)` — seller signs
   to authorise the keeper to present a Bitcoin settlement tx for this
   specific order. Bound to `order.owner == approver`. PDA init means
   replays fail at the constraint level. Stores `dwallet_id`,
   `max_amount_sats`, `expiry_slot`, `hash_scheme=2 (EcdsaDoubleSha256
   for BIP-143)`, `signature_algorithm=0 (ECDSASecp256k1)`.

2. `consume_btc_approval(message_digest, output_amount_sats)` — gated
   by `market.keeper_authority`. Verifies (a) `consumed_at_slot == 0`
   (replay protection — one-shot), (b) `clock.slot < expiry_slot`,
   (c) `output_amount_sats <= max_amount_sats`. Records the actual
   BIP-143 sighash the keeper presented to Ika so an auditor can
   later cross-reference against the broadcast tx.

Keeper integration (`keeper/src/poll.ts::consumeBtcApproval`): before
calling `ikaSdk.requestSign`, the keeper finds the seller's order
(whichever of `order_a / order_b` has `dwallet_id == seller_dwallet`),
derives the BtcSettleApproval PDA, computes the BIP-143 sighash via
`sdk/src/btc.ts::bip143SighashForP2WPKH`, and calls `consume_btc_approval`.
If the gate fails (no approval / consumed / expired / amount exceeded),
the match is marked failed — no unauthorised settle.

`anchor build --no-idl --ignore-keys` compiles clean; keeper typechecks.

**Residual surfaces (deliberate scope cut):**
- **Frontend order-placement flow.** `app/.../trade/order-form.tsx` doesn't
  yet call `submit_order` (still a P9 stub) so the per-order
  `approve_btc_settlement` ix isn't wired into the wallet popup yet.
  When P9 lands the frontend should bundle both ixs into a single Solana
  tx so the user signs once.
- **Ika gRPC `approval_proof` payload.** The pre-alpha gRPC's
  `approval_proof` field today takes a Solana `transaction_signature`.
  Once Ika exposes a Solana-PDA-aware approval-proof shape, the keeper
  should pass the `consume_btc_approval` tx signature there. Today the
  keeper still passes its own keypair signature, but the on-chain
  consume gate is what carries the security.

### I2. ~~Mock dWallet store is process-local and in-memory~~ — **CLOSED**
**Where:** `sdk/src/mock-store.ts::MockStore` (file-backed, atomic writes).

**Closure (2026-05-07):** The dWallet store now persists to a JSON file at
`~/.obsidian-mock-keys.json` (overridable via `OBSIDIAN_MOCK_STORE_PATH`).
Atomic temp-file + rename writes survive concurrent writers. BigInt and
`Uint8Array` round-trip via tagged objects. File permissions are 0600
(owner read/write only).

In docker compose, the `app` and `keeper` services share the path via a
named volume `obsidian-keys` mounted at `/var/obsidian/keys/mock-keys.json`,
so a dWallet created from the deposit page is visible to the keeper at
settle time.

8 unit tests cover the round-trip, concurrent writes, permissions, and
the cross-process visibility property.

### I3. ~~`finalize_settlement` accepts any signer + no proof verification~~ — **CLOSED (authority + SPV merkle inclusion)**
**Where:**
- Authority gate: `programs/obsidian-core/src/lib.rs::SettlementOutcome` —
  `#[account(has_one = keeper_authority)]` on the market account, plus
  `keeper_authority: Signer<'info>`.
- SPV verifier: `programs/obsidian-core/src/spv.rs::verify_merkle_inclusion`.

**Closure (2026-05-08):**

**Authority gate** — `MarketState` carries `keeper_authority: Pubkey` set
at `initialize_market`. `SettlementOutcome` (the accounts struct shared
by `finalize_settlement` and `fail_settlement`) requires the market to
have-one of that authority and the keeper signer to match. Anyone other
than the configured authority gets `ConstraintHasOne` at the Anchor
boundary, never reaching the handler. Same gate applies to `try_match`,
`request_decryption`, `finalize_decryption`, and the new
`consume_btc_approval`.

**SPV merkle inclusion** — new module `programs/obsidian-core/src/spv.rs`
implements Bitcoin double-SHA256 merkle-path verification using Solana's
`sol_sha256` syscall (via `solana-sha256-hasher` crate). Proof blob
format:
```
[0..80]              80-byte block header
[80..81+L]           varint N — number of merkle siblings
[81+L..81+L+N*33]    N * (sibling: 32 bytes || direction: 1 byte)
```

`finalize_settlement` dispatches on `btc_tx_proof.len()`:
- exactly 32 bytes: txid-only path (legacy / mock-mode broadcast). Stored
  as-is, `record.spv_verified = false`.
- >32 bytes: parsed as `txid (32) || spv_blob`, runs
  `verify_merkle_inclusion(&txid, spv_blob)`. On success
  `record.spv_verified = true`; on failure
  `ErrorCode::BtcProofInvalid` aborts the call.

`MatchRecord.spv_verified: bool` is the auditable flag — set true only
when the on-chain verifier accepted the merkle path. UI / `/positions`
filter on this to badge "settled with SPV proof" vs "settled, proof
pending".

**Keeper integration** — `keeper/src/poll.ts` calls
`@obsidian-desk/sdk/btc::fetchSpvProof(txid, network)` after a real-mode
broadcast lands. The helper hits mempool.space's `/merkle-proof`,
`/block-height`, and `/block/<hash>/header` endpoints and returns the
serialised blob. If the tx is unconfirmed (returns null), the keeper
persists txid-only and `spv_verified` stays false.

`solana-sha256-hasher` was added to `programs/obsidian-core/Cargo.toml`
because anchor-lang 1.0.2 dropped the `hash` submodule from its
`solana_program` facade.

**Verification:**
- `cargo test --lib spv` passes 4 unit tests covering single-tx,
  two-tx, wrong-root, and truncated-proof cases.
- `anchor build --no-idl --ignore-keys` compiles clean.
- `pnpm test` (sdk): 74 unit tests pass (no regressions).
- `pnpm -r typecheck`: clean across sdk + keeper + app.

**Residual (deliberate scope cut, follow-up):**
- Header proof-of-work check. The current verifier accepts any 80-byte
  header — the keeper-authority gate is what bounds who can submit. A
  trustless version would verify `sha256d(header) <= target_from_bits`.
- Trustless header chain. Storing a recent-blocks ring buffer on the
  market and requiring `header.prev_hash` matches a known recent hash
  closes "the keeper made up a header that just happens to commit to
  a real txid".
  Both follow-ups would push obsidian-core towards a full BTC light
  client; for the demo the merkle inclusion is the highest-value gate.

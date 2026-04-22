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

### E5. Upstream TS client `@encrypt.xyz/pre-alpha-solana-client` is unconsumable by Node 24
**Where:** `sdk/src/encrypt.ts` — real-mode entry points throw
`VendorSDKUnavailableError` instead of dispatching to the upstream gRPC
client.

**Reality:** The published package
(`https://www.npmjs.com/package/@encrypt.xyz/pre-alpha-solana-client`,
v0.1.0) declares its `exports."./grpc"` as `./src/grpc.ts` — an
**uncompiled TypeScript file**. The package's `dist/` directory only
contains the Codama-generated on-chain instruction bindings; the gRPC
client (which is what we actually need for `createInput` and
`readCiphertext`) ships only as `.ts`. Node 24's native TS strip refuses
to handle `.ts` files inside `node_modules/`, raising
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. The package
README/install instructions assume a `bun add` consumer; bun can run TS
inside `node_modules` natively.

**Why deviate now:** the prompt's "DO NOT invent missing primitives"
rule applies — we surface a clean `UnsupportedOperation` (via
`VendorSDKUnavailableError`) and document the gap rather than vendoring
the upstream. Mock mode satisfies the entire P3 acceptance set
(round-trip, e2e submit, debug CLI) without the broken real-mode code
path.

**Closure plan:**
1. Preferred: file an issue with `dwallet-labs/encrypt-pre-alpha`
   asking them to ship compiled `dist/grpc/index.{js,d.ts}` and update
   `exports."./grpc"` to point there. Once available, our `encrypt.ts`
   real-mode branches dynamic-import the package and call
   `createInput` + `readCiphertext` directly.
2. Stopgap: vendor `src/grpc.ts` (~189 lines) and the protobuf-generated
   service into `sdk/src/encrypt-grpc/`, depend directly on
   `@grpc/grpc-js` + `@bufbuild/protobuf`. Adds ~200 LOC of vendored
   code; keep behind the same `OBSIDIAN_ENCRYPT_MODE=real` flag.
3. Stopgap: ship a Docker mock gRPC server (P10's `encrypt-mock`) that
   speaks the same protobuf service, so e2e tests have a real network
   target without touching upstream's TS distribution.

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

(Empty — gaps will land when P4 starts.)

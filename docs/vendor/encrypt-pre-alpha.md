# Encrypt — Pre-alpha documentation (vendored)

> Source: docs.encrypt.xyz
> Fetched: 2026-04-22
> Purpose: reference material for AI coding prompts (Claude Code / Cursor).
> This is NOT official documentation — it is an extracted snapshot, accuracy may drift.
>
> **Pre-Alpha Disclaimer (from upstream, applies to every section):** This is an early pre-alpha release for exploring the SDK. **There is no real encryption — all data is completely public and stored as plaintext on-chain.** Do not submit any sensitive or real data. Encryption keys and trust model are not final. All interfaces, APIs, and data formats are subject to change without notice. The Solana program and on-chain data will be wiped periodically and completely deleted at transition to Encrypt Alpha 1. Do not treat any discriminator, account size, fee, or type layout here as stable.

## Table of contents

- [Overview](#overview)
- [Getting started](#getting-started)
- [DSL reference (`#[encrypt_fn]`, types, operations, graph compilation)](#dsl-reference)
- [On-chain primitives](#on-chain-primitives)
- [Instructions / Accounts / Events / Fees reference](#reference)
- [Testing](#testing)
- [Framework integrations (Pinocchio, Anchor, Native, Quasar)](#framework-integrations)
- [Example programs](#example-programs)
- [Raw references](#raw-references)
- [Known limitations](#known-limitations)

## Overview

Encrypt is a REFHE (Really-Fast FHE?) / threshold-FHE runtime for Solana. Solana programs operate on **ciphertexts** — values of type `EUint8`/`EUint64`/`EBool`/... — without ever decrypting on-chain. Programmers write FHE logic in a Rust DSL (`#[encrypt_fn]`) that compiles into a **computation graph** (DAG of FHE operations); on-chain, the `execute_graph` instruction creates output-ciphertext accounts and emits events; off-chain an executor evaluates the real FHE and commits results; when plaintext is needed, a **threshold decryption** request is posted and the decryptor responds. All three Solana program frameworks — Pinocchio, Anchor, native `solana-program` — ship SDK crates (`encrypt-pinocchio`, `encrypt-anchor`, `encrypt-native`) that share the same DSL and `EncryptCpi` trait. A `Quasar` framework is also available and a TypeScript client (for off-chain integration).

Primitives you will use:

- **`#[encrypt_fn]`** — attribute macro that turns a Rust function over `E*` types into a compiled FHE graph.
- **Encrypted scalar types** — `EBool`, `EUint8`, `EUint16`, `EUint32`, `EUint64`, `EUint128`, `EUint256`, `EUint512`, `EUint1024` ... up to `EUint65536`, plus `EAddress` — each with a compile-time `FHE_TYPE_ID`.
- **Encrypted vectors** — `EBitVector*` (`EBitVector2` through `EBitVector65536`) and arithmetic vectors `EVectorU8`, `EVectorU16`, `EVectorU32` up to `EVectorU32768` — SIMD-style arrays for batch ops.
- **Plaintext inputs** — `PBool`, `PUint*` (embedded in instruction data, not ciphertext accounts).
- **Ciphertext account** — the on-chain PDA that stores one encrypted value; tagged with `fhe_type` and owned by the creating program.
- **`execute_graph`** — on-chain instruction that submits a compiled graph + input-ciphertext accounts; creates output-ciphertext accounts and emits a graph-execution event for the off-chain executor.
- **Decryption request** — posts a request event for the threshold decryptor to respond with plaintext.
- **`EncryptCpi` trait** — typed CPI helpers for every Encrypt instruction (create-ciphertext, execute-graph, request-decryption, ...) available from all four framework SDKs.

---

### Introduction

*Source: `docs.encrypt.xyz/introduction`*

#### Encrypt Developer Guide

Encrypt enables smart contracts to **compute on encrypted data** without ever decrypting it on-chain. Your program operates on ciphertexts — the actual values are never visible to validators, indexers, or anyone else.

##### How It Works

  1. **You write FHE logic** using the `#[encrypt_fn]` DSL — it looks like normal Rust
  2. **The macro compiles it** into a computation graph (a DAG of FHE operations)
  3. **On-chain** , `execute_graph` creates output ciphertext accounts and emits events
  4. **Off-chain** , the executor evaluates the graph using real FHE and commits results
  5. **When needed** , you request decryption — the decryptor responds with plaintext

```rust
#[encrypt_fn]
fn transfer(from: EUint64, to: EUint64, amount: EUint64) -> (EUint64, EUint64) {
    let has_funds = from >= amount;
    let new_from = if has_funds { from - amount } else { from };
    let new_to = if has_funds { to + amount } else { to };
    (new_from, new_to)
}
``` 

This compiles into an FHE computation graph that operates on encrypted balances. Nobody on-chain ever sees the actual amounts.

##### What You’ll Learn

  * **Getting Started** : Install dependencies, create your first encrypted program
  * **Tutorial** : Build a complete confidential voting application step by step
  * **DSL Reference** : All supported types, operations, and patterns
  * **On-Chain Integration** : Ciphertext accounts, access control, graph execution, decryption
  * **Framework Guides** : Pinocchio, Anchor, and Native examples
  * **Testing** : Local test framework, CLI tools, mock vs real FHE
  * **Reference** : Complete instruction, account, event, and fee documentation

##### Supported Frameworks

Encrypt works with all three major Solana program frameworks:

Framework| SDK Crate| Best For  
---|---|---  
**Pinocchio**| `encrypt-pinocchio`| Maximum CU efficiency, `#![no_std]` programs  
**Anchor**| `encrypt-anchor`| Rapid development, declarative accounts  
**Native**| `encrypt-native`| `solana-program` users, no framework lock-in  
  
All three use the same `#[encrypt_fn]` DSL and the same `EncryptCpi` trait.

---


### Core concepts

*Source: `docs.encrypt.xyz/getting-started/concepts`*

#### Core Concepts

##### Ciphertext

A **ciphertext** is an encrypted value stored on-chain. It’s a regular Solana keypair account (not a PDA) owned by the Encrypt program. The account pubkey IS the ciphertext identifier.

```text
Ciphertext account (98 bytes):
  ciphertext_digest(32)              — hash of the actual encrypted blob
  authorized(32)                     — who can use this (zero = public)
  network_encryption_public_key(32)  — FHE key it was encrypted under
  fhe_type(1)                        — EBool, EUint64, etc.
  status(1)                          — Pending(0) or Verified(1)
``` 

Ciphertexts are created in three ways:

  * **Authority input** (`create_input_ciphertext`): user submits encrypted data + ZK proof → executor verifies → creates on-chain
  * **Plaintext** (`create_plaintext_ciphertext`): user provides plaintext value → encrypted off-chain by executor
  * **Graph output** (`execute_graph`): computation produces new ciphertexts (status=PENDING until executor commits)

##### Computation Graph

FHE operations are compiled into a **computation graph** — a DAG of operations:

```text
Input(a) ──┐
            ├── Op(Add) ── Output
Input(b) ──┘
``` 

The `#[encrypt_fn]` macro compiles your Rust code into this graph at compile time. The graph is serialized into the `execute_graph` instruction data. The executor evaluates it off-chain using real FHE.

##### Executor & Decryptor

The **executor** and **decryptor** are off-chain services managed by the Encrypt network:

  * **Executor** : listens for `GraphExecuted` events, evaluates computation graphs, commits results on-chain
  * **Decryptor** : listens for `DecryptionRequested` events, performs threshold decryption, writes plaintext results on-chain

In the pre-alpha environment, these are hosted at `pre-alpha-dev-1.encrypt.ika-network.net:443`. You don’t need to run them — just submit encrypted inputs via gRPC and let the network handle the rest.

For **local testing** , `EncryptTestContext` simulates both services in-process via `process_pending()`.

##### Access Control

Every ciphertext has an `authorized` field:

  * `authorized = [0; 32]` → **public** — anyone can compute on it or decrypt it
  * `authorized = <pubkey>` → only that address can use it

Access is managed via:

  * **`transfer_ciphertext`** : change who’s authorized
  * **`copy_ciphertext`** : create a copy with different authorization
  * **`make_public`** : set authorized to zero (irreversible)

##### Digest Verification

When requesting decryption, the `ciphertext_digest` is stored in the DecryptionRequest as a snapshot. At reveal time, verify the digest matches to ensure the ciphertext wasn’t updated between request and response:

```rust
let digest = ctx.request_decryption(request_acct, ciphertext)?;
proposal.pending_digest = digest;  // store for later

// ... later, at reveal time ...
let value = read_decrypted_verified::<Uint64>(req_data, &proposal.pending_digest)?;
```

---


### Installation

*Source: `docs.encrypt.xyz/getting-started/installation`*

#### Installation

##### Prerequisites

  * **Rust** (edition 2024): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
  * **Solana CLI** 3.x+: `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`
  * **Bun** (for TypeScript clients): `curl -fsSL https://bun.sh/install | bash`

##### Add Dependencies

###### For Pinocchio Programs

```toml
[dependencies]
encrypt-types = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-dsl = { package = "encrypt-solana-dsl", git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-pinocchio = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
pinocchio = "0.10"

[dev-dependencies]
encrypt-solana-test = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
``` 

###### For Anchor Programs

```toml
[dependencies]
encrypt-types = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-dsl = { package = "encrypt-solana-dsl", git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-anchor = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
anchor-lang = "0.32"

[dev-dependencies]
encrypt-solana-test = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
``` 

###### For Native Programs

```toml
[dependencies]
encrypt-types = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-dsl = { package = "encrypt-solana-dsl", git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-native = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
solana-program = "4"

[dev-dependencies]
encrypt-solana-test = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
``` 

##### Client SDKs

###### Rust gRPC Client

```toml
[dependencies]
encrypt-solana-client = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
``` 

###### TypeScript gRPC Client

```bash
bun add @encrypt.xyz/pre-alpha-solana-client
``` 

##### Pre-Alpha Environment

The Encrypt program is deployed to **Solana devnet**. An executor is running at:

Resource| Endpoint  
---|---  
**Encrypt gRPC**| `https://pre-alpha-dev-1.encrypt.ika-network.net:443`  
**Solana RPC**| `https://api.devnet.solana.com`  
**Program ID**| `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`  
  
No local executor or validator setup needed — just connect to devnet.

---


### Quick Start

*Source: `docs.encrypt.xyz/getting-started/quick-start`*

#### Quick Start

Build your first encrypted program in 5 minutes.

##### 1\. Write an FHE Function

```rust
use encrypt_dsl::prelude::*;

#[encrypt_fn]
fn add(a: EUint64, b: EUint64) -> EUint64 {
    a + b
}
``` 

The `#[encrypt_fn]` macro generates:

  * `add()` — returns the serialized computation graph bytes
  * `AddCpi` — an extension trait on `EncryptCpi` with method `ctx.add(a, b, output)?`

##### 2\. Use It in Your Program

###### Pinocchio

```rust
use encrypt_pinocchio::EncryptContext;

let ctx = EncryptContext { /* ... */ };
ctx.add(input_a, input_b, output_ct)?;
``` 

###### Anchor

```rust
use encrypt_anchor::EncryptContext;

let ctx = EncryptContext { /* ... */ };
ctx.add(input_a.to_account_info(), input_b.to_account_info(), output.to_account_info())?;
``` 

###### Native

```rust
use encrypt_native::EncryptContext;

let ctx = EncryptContext { /* ... */ };
ctx.add(input_a.clone(), input_b.clone(), output.clone())?;
``` 

##### 3\. Test It

```rust
#[cfg(test)]
mod tests {
    use encrypt_solana_test::EncryptTestContext;
    use encrypt_types::encrypted::Uint64;

    #[test]
    fn test_add() {
        let mut ctx = EncryptTestContext::new_default();
        let user = ctx.new_funded_keypair();

        let a = ctx.create_input::<Uint64>(10, &user.pubkey());
        let b = ctx.create_input::<Uint64>(32, &user.pubkey());

        let graph = super::add();
        let outputs = ctx.execute_and_commit(&graph, &[a, b], 1, &[], &user);

        let result = ctx.decrypt::<Uint64>(&outputs[0], &user);
        assert_eq!(result, 42);
    }
}
``` 

##### 4\. Client SDK (gRPC)

Submit encrypted inputs and read ciphertexts via the gRPC client:

###### Rust

```rust
use encrypt_solana_client::grpc::{EncryptClient, TypedInput};
use encrypt_types::encrypted::{Uint64, Bool};

// Connect to pre-alpha endpoint
let mut client = EncryptClient::connect().await?;

// Create a single encrypted input
let ct = client.create_input::<Uint64>(42u64, &program_id, &network_key).await?;

// Create batch inputs (one proof covers all)
let cts = client.create_inputs(
    &[TypedInput::new::<Uint64>(&10u64), TypedInput::new::<Bool>(&true)],
    &program_id, &network_key,
).await?;

// Read a ciphertext off-chain (signs request with keypair)
let result = client.read_ciphertext(&ct, &reencryption_key, epoch, &keypair).await?;
// result.value = plaintext bytes (mock) or re-encrypted ciphertext (production)
// result.fhe_type, result.digest
``` 

###### TypeScript

```typescript
import { createEncryptClient, encodeReadCiphertextMessage, Chain } from "@encrypt.xyz/pre-alpha-solana-client/grpc";

const client = createEncryptClient();

// Create encrypted input
const { ciphertextIdentifiers } = await client.createInput({
  chain: Chain.SOLANA,
  inputs: [{ ciphertextBytes: ciphertext, fheType: 4 }],
  proof: proofBytes,
  authorized: programId.toBytes(),
  networkEncryptionPublicKey: networkKey,
});

// Read ciphertext off-chain
const msg = encodeReadCiphertextMessage(Chain.SOLANA, ctId, reencryptionKey, epoch);
const result = await client.readCiphertext({ message: msg, signature, signer });
``` 

##### What Happens Under the Hood

  1. Your program calls `execute_graph` → on-chain creates output ciphertext accounts (status=PENDING)
  2. The executor detects the event → evaluates the computation graph → calls `commit_ciphertext` (status=VERIFIED)
  3. When you call `request_decryption` → the decryptor responds with the plaintext result
  4. Your program reads the result from the DecryptionRequest account
  5. Off-chain reads via `read_ciphertext` gRPC — public ciphertexts are open, private ones require signed request

In test mode, `EncryptTestContext` handles all of this automatically via `process_pending()`.

##### Pre-Alpha Environment

Resource| Endpoint  
---|---  
**Encrypt gRPC**| `pre-alpha-dev-1.encrypt.ika-network.net:443` (TLS)  
**Solana Network**|  Devnet (`https://api.devnet.solana.com`)  
**Program ID**| `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8`

---


### DSL Overview

*Source: `docs.encrypt.xyz/dsl/overview`*

#### The Encrypt DSL

The `#[encrypt_fn]` attribute macro lets you write FHE computation as normal Rust. The macro compiles it into a computation graph at compile time.

##### Two Macros

Macro| Crate| Generates  
---|---|---  
`#[encrypt_fn_graph]`| `encrypt-dsl`| Graph bytes function only (`fn name() -> Vec<u8>`)  
`#[encrypt_fn]`| `encrypt-solana-dsl`| Graph bytes + Solana CPI extension trait  
  
Use `#[encrypt_fn]` for Solana programs. Use `#[encrypt_fn_graph]` for chain-agnostic graph generation (testing, analysis).

##### What Gets Generated

```rust
#[encrypt_fn]
fn transfer(from: EUint64, to: EUint64, amount: EUint64) -> (EUint64, EUint64) {
    let has_funds = from >= amount;
    let new_from = if has_funds { from - amount } else { from };
    let new_to = if has_funds { to + amount } else { to };
    (new_from, new_to)
}
``` 

This generates:

  1. **`transfer()`** → `Vec<u8>` — the serialized computation graph
  2. **`TransferCpi`** — an extension trait implemented for all `EncryptCpi` types:

```rust
// Generated (simplified):
trait TransferCpi: EncryptCpi {
    fn transfer(
        &self,
        from: Self::Account<'_>,     // EUint64 input
        to: Self::Account<'_>,       // EUint64 input
        amount: Self::Account<'_>,   // EUint64 input
        __out_0: Self::Account<'_>,  // EUint64 output
        __out_1: Self::Account<'_>,  // EUint64 output
    ) -> Result<(), Self::Error>;
}

impl<T: EncryptCpi> TransferCpi for T {}
``` 

##### Method Syntax

Call the generated function as a method on your `EncryptContext`:

```rust
ctx.transfer(from_ct, to_ct, amount_ct, new_from_ct, new_to_ct)?;
``` 

The trait is automatically in scope (generated in the same module as your `#[encrypt_fn]`).

##### Type Safety

The generated function:

  * Has one parameter per encrypted input (in order)
  * Has one parameter per output (in order)
  * Verifies each input’s `fhe_type` matches the graph at runtime
  * Returns an error if types don’t match

This catches bugs like passing an `EBool` where an `EUint64` is expected.

##### Update Mode

Output accounts can be either:

  * **New accounts** (empty) → `execute_graph` creates a new Ciphertext
  * **Existing accounts** (already has data) → `execute_graph` resets digest/status (reuses the account)

For update mode, pass the same account as both input and output:

```rust
// yes_ct is both input[0] and output[0]
ctx.cast_vote_graph(yes_ct, no_ct, vote_ct, yes_ct, no_ct)?;
```

---


### FHE Types

*Source: `docs.encrypt.xyz/dsl/types`*

#### FHE Types

##### Scalar Types (16)

Type| Byte Width| Rust Equivalent  
---|---|---  
`EBool`| 1| `u8` (0 or 1)  
`EUint8`| 1| `u8`  
`EUint16`| 2| `u16`  
`EUint32`| 4| `u32`  
`EUint64`| 8| `u64`  
`EUint128`| 16| `u128`  
`EUint256`| 32| `[u8; 32]`  
`EAddress`| 32| `[u8; 32]`  
`EUint512`| 64| `[u8; 64]`  
`EUint1024`| 128| `[u8; 128]`  
… up to `EUint65536`| 8192| `[u8; 8192]`  
  
##### Boolean Vectors (16)

`EBitVector2` through `EBitVector65536` — packed boolean arrays.

##### Arithmetic Vectors (13)

`EVectorU8` through `EVectorU32768` — SIMD-style encrypted integer arrays (8,192 bytes each).

##### Plaintext Types

For inputs that don’t need encryption:

Type| Encrypted Equivalent  
---|---  
`PBool`| `EBool`  
`PUint8`| `EUint8`  
`PUint16`| `EUint16`  
`PUint32`| `EUint32`  
`PUint64`| `EUint64`  
…| …  
  
Plaintext inputs are embedded in the instruction data (not ciphertext accounts).

##### Type Safety

Each type has a compile-time `FHE_TYPE_ID`:

  * Operations between incompatible types fail at compile time
  * The on-chain processor verifies `fhe_type` of each input account matches the graph
  * The CPI extension trait verifies `fhe_type` at runtime before CPI

---


### FHE Operations

*Source: `docs.encrypt.xyz/dsl/operations`*

#### Operations

##### Arithmetic

```rust
let sum = a + b;      // Add
let diff = a - b;     // Subtract
let prod = a * b;     // Multiply
let quot = a / b;     // Divide
let rem = a % b;      // Modulo
let neg = -a;         // Negate
``` 

##### Bitwise

```rust
let and = a & b;      // AND
let or = a | b;       // OR
let xor = a ^ b;      // XOR
let not = !a;         // NOT
let shl = a << b;     // Shift left
let shr = a >> b;     // Shift right
``` 

##### Comparison

All comparisons return the **same encrypted type** (0 or 1), not `EBool`:

```rust
let eq = a == b;      // Equal
let ne = a != b;      // Not equal
let lt = a < b;       // Less than
let le = a <= b;      // Less or equal
let gt = a > b;       // Greater than
let ge = a >= b;      // Greater or equal
``` 

##### Method Syntax

Same operations, explicit names:

```rust
let sum = a.add(&b);
let cmp = a.is_greater_or_equal(&b);
let min_val = a.min(&b);
let max_val = a.max(&b);
let rotated = a.rotate_left(&n);
``` 

##### Constants

Bare integer literals are auto-promoted to encrypted constants:

```rust
let incremented = count + 1;       // 1 becomes an encrypted constant
let doubled = value * 2;           // 2 becomes an encrypted constant
``` 

For explicit construction:

```rust
let one = EUint64::from(1u64);
let big = EUint256::from([0xABu8; 32]);
let vec = EVectorU32::from_elements([1u32, 2, 3, 4]);
let ones = EVectorU64::splat(1u128);
let bits = EBitVector16::from(0b1010u128);
``` 

Identical constants are automatically deduplicated in the graph.

---


### DSL Constants

*Source: `docs.encrypt.xyz/dsl/constants`*

#### Constants

Constants are plaintext values embedded directly in the computation graph. The executor applies encryption automatically.

##### Bare Literals

The simplest way — integer literals in expressions auto-promote:

```rust
#[encrypt_fn]
fn increment(count: EUint64) -> EUint64 {
    count + 1  // 1 is auto-promoted to an encrypted EUint64 constant
}
``` 

##### Explicit Construction

For types that need explicit creation:

```rust
// Scalars (up to 128 bits)
let zero = EUint64::from(0u64);
let max = EUint128::from(u128::MAX);

// Big types (byte arrays)
let addr = EUint256::from([0xABu8; 32]);

// Vectors — from elements
let vec = EVectorU32::from_elements([1u32, 2, 3, 4]);

// Vectors — all same value
let ones = EVectorU64::splat(1u128);

// Boolean vectors — from bitmask
let mask = EBitVector16::from(0b1010_1010u128);
``` 

##### Deduplication

Constants with the same `(fhe_type, bytes)` are automatically deduplicated in the graph. Writing `count + 1` twice produces a single constant node, not two.

---


### DSL Conditionals

*Source: `docs.encrypt.xyz/dsl/conditionals`*

#### Conditionals

FHE doesn’t support branching — both paths are always evaluated. The `if`/`else` syntax compiles to a **select** operation.

##### Syntax

```rust
let result = if condition { value_a } else { value_b };
``` 

**Rules:**

  * Both branches must be the **same encrypted type**
  * Condition must be an encrypted comparison result (0 or 1)
  * `else` is **mandatory** — no bare `if`
  * Both branches are always evaluated (FHE requirement)

##### Example

```rust
#[encrypt_fn]
fn conditional_transfer(
    from: EUint64,
    to: EUint64,
    amount: EUint64,
) -> (EUint64, EUint64) {
    let has_funds = from >= amount;
    let new_from = if has_funds { from - amount } else { from };
    let new_to = if has_funds { to + amount } else { to };
    (new_from, new_to)
}
``` 

This compiles to:

  1. `has_funds = IsGreaterOrEqual(from, amount)` → 0 or 1
  2. `from_minus = Subtract(from, amount)`
  3. `to_plus = Add(to, amount)`
  4. `new_from = Select(has_funds, from_minus, from)`
  5. `new_to = Select(has_funds, to_plus, to)`

Both `from - amount` and `from` are computed; `Select` picks one based on the condition.

##### Nested Conditionals

```rust
let tier = if amount >= 1000 {
    3
} else if amount >= 100 {
    2
} else {
    1
};
``` 

Each `if`/`else` becomes a `Select` operation. Nested conditionals produce a chain of `Select` nodes.

---


### DSL Vectors

*Source: `docs.encrypt.xyz/dsl/vectors`*

#### Vectors

Encrypt supports SIMD-style encrypted vectors — fixed-size arrays of encrypted integers where every element-wise operation runs in a single FHE computation. Vectors enable batch processing (e.g., updating 2048 balances in one graph execution).

##### Vector Types

All arithmetic vectors are exactly **8,192 bytes** (65,536 bits). The element count depends on element size:

Type| Element| Elements| FHE Type ID  
---|---|---|---  
`EUint8Vector`| `u8`| 8,192| 32  
`EUint16Vector`| `u16`| 4,096| 33  
`EUint32Vector`| `u32`| 2,048| 34  
`EUint64Vector`| `u64`| 1,024| 35  
`EUint128Vector`| `u128`| 512| 36  
… up to `EUint32768Vector`| 4,096 bytes| 2| 44  
  
Boolean vectors (`EBitVector2` through `EBitVector65536`) store packed boolean arrays.

##### Using Vectors in `#[encrypt_fn]`

Vectors work like scalars in the DSL — all operations are element-wise:

```rust
use encrypt_dsl::prelude::encrypt_fn;
use encrypt_types::encrypted::EUint32Vector;

#[encrypt_fn]
fn add_vectors(a: EUint32Vector, b: EUint32Vector) -> EUint32Vector {
    a + b  // element-wise: result[i] = a[i] + b[i]
}
``` 

###### Scalar Operations

Literals auto-promote to scalar operations that broadcast across all elements:

```rust
#[encrypt_fn]
fn scale_and_shift(v: EUint32Vector) -> EUint32Vector {
    v * 3 + 7  // each element: result[i] = v[i] * 3 + 7
}
``` 

This generates `MultiplyScalar` and `AddScalar` ops — the constant `3` is stored as a single scalar, not replicated 2,048 times.

###### All Arithmetic Operations

Every operation that works on scalars also works element-wise on vectors:

```rust
#[encrypt_fn]
fn all_ops(a: EUint32Vector, b: EUint32Vector) -> EUint32Vector {
    let sum = a + b;
    let diff = a - b;
    let prod = a * b;
    let quot = a / b;
    let rem = a % b;
    let neg = -a;
    let and = a & b;
    let or = a | b;
    let xor = a ^ b;
    let not = !a;
    let min = a.min(&b);
    let max = a.max(&b);
    sum  // return any of these
}
``` 

###### Comparisons

Comparisons return a vector of 0/1 values (same type, not `EBool`):

```rust
#[encrypt_fn]
fn compare(a: EUint32Vector, b: EUint32Vector) -> EUint32Vector {
    a == b  // result[i] = 1 if a[i] == b[i], else 0
}
``` 

All comparison operators work: `==`, `!=`, `<`, `<=`, `>`, `>=`.

###### Conditionals

Use `if cond { a } else { b }` with a scalar `EBool` to select entire vectors:

```rust
use encrypt_types::encrypted::EBool;

#[encrypt_fn]
fn conditional(cond: EBool, a: EUint32Vector, b: EUint32Vector) -> EUint32Vector {
    if cond { a } else { b }  // selects entire vector a or b
}
``` 

For element-wise selection (different condition per element), use `select_scalar`:

```rust
#[encrypt_fn]
fn elementwise_select(
    mask: EUint32Vector,  // 0 or nonzero per element
    a: EUint32Vector,
    b: EUint32Vector,
) -> EUint32Vector {
    mask.select_scalar(&a, &b)  // result[i] = mask[i] != 0 ? a[i] : b[i]
}
``` 

###### Multiple Outputs

A single graph can produce multiple output vectors:

```rust
#[encrypt_fn]
fn sum_and_diff(a: EUint32Vector, b: EUint32Vector) -> (EUint32Vector, EUint32Vector) {
    (a + b, a - b)
}
``` 

##### Vector-Specific Operations

###### Gather

Index-based lookup: `result[i] = source[indices[i]]`

```rust
#[encrypt_fn]
fn permute(data: EUint32Vector, indices: EUint32Vector) -> EUint32Vector {
    data.gather(&indices)
}
``` 

###### Scatter

Inverse of gather: `result[indices[i]] = data[i]`

```rust
#[encrypt_fn]
fn scatter(data: EUint32Vector, indices: EUint32Vector) -> EUint32Vector {
    data.scatter(&indices)
}
``` 

###### Assign

Overwrite elements at specific positions: `result = base; result[indices[i]] = values[i]`

```rust
#[encrypt_fn]
fn update_positions(
    base: EUint32Vector,
    indices: EUint32Vector,
    values: EUint32Vector,
) -> EUint32Vector {
    base.assign(&indices, &values)
}
``` 

###### Copy

Copy entire vector:

```rust
#[encrypt_fn]
fn clone_vec(a: EUint32Vector, src: EUint32Vector) -> EUint32Vector {
    a.copy(&src)  // returns src
}
``` 

###### Get

Extract a single element by index (result at position 0):

```rust
#[encrypt_fn]
fn extract(data: EUint32Vector, index: EUint32Vector) -> EUint32Vector {
    data.get(&index)  // result[0] = data[index[0]], rest = 0
}
``` 

##### Chained Operations

Multiple operations compose naturally in a single graph:

```rust
#[encrypt_fn]
fn dot_product_pair(
    a: EUint32Vector, b: EUint32Vector,
    c: EUint32Vector, d: EUint32Vector,
) -> EUint32Vector {
    a * b + c * d  // (a[i]*b[i]) + (c[i]*d[i])
}

#[encrypt_fn]
fn linear_transform(a: EUint32Vector, b: EUint32Vector) -> EUint32Vector {
    a * 5 + b * 3 + 7
}

#[encrypt_fn]
fn conditional_accumulate(
    cond: EBool,
    acc: EUint32Vector,
    val: EUint32Vector,
) -> EUint32Vector {
    let added = acc + val;
    if cond { added } else { acc }
}
``` 

##### Creating Vectors

Vectors are **8,192 bytes** — too large for Solana instruction data (max ~1,232 bytes). They must be created off-chain via gRPC `CreateInput`:

###### Rust Client

```rust
use encrypt_solana_client::grpc::{EncryptClient, TypedInput};
use encrypt_types::types::FheType;

// Build 8192-byte vector with elements at the start, rest zeros
let mut bytes = vec![0u8; 8192];
bytes[0..4].copy_from_slice(&100u32.to_le_bytes());
bytes[4..8].copy_from_slice(&200u32.to_le_bytes());

let ct_pubkey = client
    .create_inputs(
        &[TypedInput::from_raw(FheType::EVectorU32, bytes)],
        &authorized_pubkey,
        &network_key,
    )
    .await?;
``` 

###### TypeScript Client

```typescript
const bytes = new Uint8Array(8192);
new DataView(bytes.buffer).setUint32(0, 100, true);
new DataView(bytes.buffer).setUint32(4, 200, true);

const [ctPubkey] = await client.createInput({
  fheType: 34, // EVectorU32
  plaintextBytes: bytes,
  authorized: programId,
  networkKey,
});
``` 

##### Testing Vectors

The test harness provides vector-specific helpers:

```rust
use encrypt_solana_test::litesvm::EncryptTestContext;
use encrypt_types::types::FheType;

let mut ctx = EncryptTestContext::new_default();

// Create a vector with specific elements
let mut bytes = vec![0u8; 8192];
bytes[0..4].copy_from_slice(&42u32.to_le_bytes());
bytes[4..8].copy_from_slice(&99u32.to_le_bytes());

let ct = ctx.create_input_bytes(FheType::EVectorU32, &bytes, &program_id);

// After graph execution + commit:
let result = ctx.decrypt_bytes(&ct);
let elem0 = u32::from_le_bytes(result[0..4].try_into().unwrap());
assert_eq!(elem0, 42);
``` 

##### Decryption

Vector decryption responses are automatically chunked — the 8,192-byte plaintext is split across multiple transactions (~12 txs at 700 bytes each). The on-chain `DecryptionRequest` account tracks `bytes_written` / `total_len` and the executor writes chunks until complete. This is transparent to the developer.

##### On-Chain Representation

Vectors use the same 98-byte `Ciphertext` account as scalars:

```text
ciphertext_digest(32) + authorized(32) + network_encryption_public_key(32) + fhe_type(1) + status(1)
``` 

The 32-byte digest commits to the full 8,192-byte value. The actual encrypted data lives off-chain in the executor. The `fhe_type` field (e.g., `34` for `EVectorU32`) tells the executor how to interpret the data.

##### Limitations

  * **No on-chain plaintext creation** : `create_plaintext_ciphertext` can’t handle 8,192 bytes in instruction data. Use gRPC `CreateInput` instead.
  * **No cross-type extraction** : You can’t extract a scalar `EUint32` from an `EUint32Vector` in a single graph (use `get` which returns a vector with the value at position 0).
  * **No reductions** : There are no `sum`, `min_reduce`, or `max_reduce` operations yet that collapse a vector to a scalar. These are on the roadmap.
  * **Index range** : For `EVectorU8`, indices are `u8` values (max 255) but the vector has 8,192 elements — only the first 256 are addressable by gather/scatter/assign.

---


### DSL Graph Compilation

*Source: `docs.encrypt.xyz/dsl/graph-compilation`*

#### Graph Compilation

##### Binary Format

The `#[encrypt_fn]` macro compiles your function into a binary graph at compile time:

```text
[Header 13B] [Nodes N×9B] [Constants section]
``` 

###### Header (13 bytes)

```text
version(1) | num_inputs(2) | num_plaintext_inputs(2) | num_constants(2) | num_ops(2) | num_outputs(2) | constants_len(2)
``` 

Counts are ordered by node kind. `num_nodes` is derived (sum of all counts).

###### Nodes (9 bytes each)

```text
kind(1) | op_type(1) | fhe_type(1) | input_a(2) | input_b(2) | input_c(2)
``` 

Kind| Value| Description  
---|---|---  
Input| 0| Encrypted ciphertext account  
PlaintextInput| 1| Plaintext value in instruction data  
Constant| 2| Literal value in constants section  
Op| 3| FHE operation  
Output| 4| Graph result  
  
Nodes are topologically sorted — every node’s operands appear earlier in the list.

###### Constants Section

Variable-length byte blob. Constant nodes reference it by byte offset (`input_a`). Values stored as little-endian bytes at `fhe_type.byte_width()`.

##### Example

```rust
#[encrypt_fn]
fn add(a: EUint64, b: EUint64) -> EUint64 { a + b }
``` 

Produces 4 nodes:

  * Node 0: Input (EUint64) — `a`
  * Node 1: Input (EUint64) — `b`
  * Node 2: Op (Add, EUint64, inputs: 0, 1)
  * Node 3: Output (EUint64, source: 2)

Header: `version=1, num_inputs=2, num_constants=0, num_ops=1, num_outputs=1, constants_len=0`

##### Registered Graphs

For frequently used graphs, register them on-chain to avoid re-sending graph data:

```rust
ctx.register_graph(graph_pda, bump, &graph_hash, &graph_data)?;
ctx.execute_registered_graph(graph_pda, ix_data, remaining)?;
``` 

Registered graphs enable exact per-op fee calculation (no max-charge gap).

---


### On-chain ciphertexts

*Source: `docs.encrypt.xyz/on-chain/ciphertexts`*

#### Ciphertext Accounts

##### Structure

Ciphertext accounts are **regular keypair accounts** (not PDAs). The Encrypt program is the Solana owner.

Field| Size| Description  
---|---|---  
`ciphertext_digest`| 32| Hash of the encrypted blob (zero until committed)  
`authorized`| 32| Who can use this (zero address = public)  
`network_encryption_public_key`| 32| FHE key it was encrypted under  
`fhe_type`| 1| Type discriminant (EBool=0, EUint64=4, etc.)  
`status`| 1| Pending(0) or Verified(1)  
  
Total: 98 bytes data + 2 bytes prefix (discriminator + version) = **100 bytes**.

##### Account Pubkey = Identifier

The account’s Solana pubkey IS the ciphertext identifier. There is no separate `ciphertext_id` field. This means:

  * Client generates a keypair for each new ciphertext
  * The pubkey is used in events, store lookups, and all references
  * Update mode reuses the same account (same pubkey, new digest)

##### Creating Ciphertexts

###### Authority Input (`create_input_ciphertext`, disc 1)

User encrypts off-chain → submits to executor with ZK proof → executor verifies → calls this instruction. Status = Verified.

###### Plaintext (`create_plaintext_ciphertext`, disc 2)

User provides plaintext value directly. Executor encrypts off-chain and commits digest later. Status = Pending until committed.

```rust
ctx.create_plaintext_typed::<Uint64>(&0u64, ciphertext_account)?;
``` 

###### Graph Output (`execute_graph`, disc 4)

Computation outputs are created automatically by `execute_graph`:

  * **New account** (empty) → creates Ciphertext with status=Pending
  * **Existing account** (has data) → resets digest/status (update mode)

##### Status Lifecycle

```text
Created (by execute_graph) → PENDING → commit_ciphertext → VERIFIED
Created (by create_input)  → VERIFIED (immediately)
Created (by plaintext)     → PENDING → commit_ciphertext → VERIFIED
```

---


### Access control

*Source: `docs.encrypt.xyz/on-chain/access-control`*

#### Access Control

##### The `authorized` Field

Every ciphertext has an `authorized` field (32 bytes):

Value| Meaning  
---|---  
`[0; 32]` (zero)| **Public** — anyone can compute on it and decrypt it  
`<pubkey>`| Only that address can use it (wallet signer or program)  
  
There are no separate guard/permission accounts. The ciphertext IS the access token.

##### Managing Access

###### Transfer Authorization

Move authorization from current party to a new party:

```rust
// Pinocchio
ctx.transfer_ciphertext(ciphertext, new_authorized)?;

// Anchor
ctx.transfer_ciphertext(&ciphertext.to_account_info(), &new_auth.to_account_info())?;
``` 

The current authorized party must sign the transaction.

###### Copy with Different Authorization

Create a copy of the ciphertext authorized to a different party:

```rust
ctx.copy_ciphertext(
    source_ciphertext,
    new_ciphertext,     // empty keypair account
    new_authorized,
    false,              // permanent (rent-exempt)
)?;
``` 

Set `transient: true` for copies that only live within the current transaction (0 lamports, GC’d after tx).

###### Make Public

Set authorized to zero — irreversible, anyone can use it:

```rust
ctx.make_public(ciphertext)?;
``` 

Idempotent — calling on an already-public ciphertext is a no-op.

##### CPI Authorization

When a program calls Encrypt via CPI:

  * **Signer path** : `caller` is a wallet signer → `authorized` checked against signer pubkey
  * **Program path** : `caller` is executable → next account is CPI authority PDA (`__encrypt_cpi_authority`) → `authorized` checked against program address

Detection is automatic via `caller.executable()`.

---


### execute_graph

*Source: `docs.encrypt.xyz/on-chain/execute-graph`*

#### Execute Graph

##### How It Works

`execute_graph` (disc 4) processes a computation graph:

  1. Parses the graph binary from instruction data
  2. Verifies each input ciphertext’s `fhe_type` matches the graph
  3. Verifies each input’s `authorized` matches the caller
  4. Charges fees (per input + constant + plaintext input + output + operation)
  5. Creates or updates output ciphertext accounts (status=PENDING)
  6. Emits `GraphExecutedEvent` for the executor

##### Instruction Data

```text
discriminator(1) | graph_data_len(2) | graph_data(N) | num_inputs(2)
``` 

##### Account Layout

Position| Account| Writable| Signer  
---|---|---|---  
0| config| no| no  
1| deposit| yes| no  
2| caller| no| yes (signer path)  
3| network_encryption_key| no| no  
4| payer| yes| yes  
5| event_authority| no| no  
6| program| no| no  
7..7+N| input ciphertexts| no| no  
7+N..7+N+M| output ciphertexts| yes| no  
  
For CPI path: `cpi_authority` is inserted at position 3, shifting subsequent accounts.

##### Update Mode

Output accounts can be existing ciphertexts:

  * If the output account **already has data** → update mode: resets `ciphertext_digest` and `status` to PENDING
  * If the output account **is empty** → create mode: creates a new Ciphertext

This means the same account can be used as both input and output (e.g., `yes_count` is read, then updated in the same `execute_graph` call).

##### Type Verification

The processor verifies each input ciphertext’s `fhe_type` matches the graph’s Input node `fhe_type`. If they don’t match, the transaction fails with `InvalidArgument`.

##### Using the DSL

Instead of building instruction data manually, use the generated CPI method:

```rust
// Generated by #[encrypt_fn]:
ctx.cast_vote_graph(yes_ct, no_ct, vote_ct, yes_ct, no_ct)?;
//                   ↑inputs↑              ↑outputs↑
```

---


### Decryption flow

*Source: `docs.encrypt.xyz/on-chain/decryption`*

#### Decryption

##### Request → Respond → Read

Decryption is an async on-chain request/response pattern:

###### 1\. Request Decryption

```rust
let digest = ctx.request_decryption(request_acct, ciphertext)?;
// Store `digest` in your program state for later verification
proposal.pending_digest = digest;
``` 

  * Creates a DecryptionRequest keypair account
  * Stores a `ciphertext_digest` snapshot (stale-value protection)
  * Returns the digest — **store it for verification at read time**
  * The decryptor detects the event and responds

###### 2\. Process (Automatic)

The decryptor:

  1. Detects `DecryptionRequestedEvent`
  2. Performs threshold MPC decryption (or mock decryption locally)
  3. Calls `respond_decryption` to write plaintext bytes into the request account

###### 3\. Read Result

```rust
let req_data = request_acct.try_borrow_data()?;
let value = read_decrypted_verified::<Uint64>(&req_data, &proposal.pending_digest)?;
``` 

**Always verify against the stored digest** — if the ciphertext was updated between request and response, the digest won’t match and `read_decrypted_verified` returns an error.

###### 4\. Close Request

After reading the result, reclaim rent:

```rust
ctx.close_decryption_request(request_acct, destination)?;
``` 

##### DecryptionRequest Account

Field| Size| Description  
---|---|---  
`ciphertext`| 32| Ciphertext account pubkey  
`ciphertext_digest`| 32| Digest snapshot at request time  
`requester`| 32| Who requested  
`fhe_type`| 1| Type (determines result byte width)  
`total_len`| 4| Expected result size  
`bytes_written`| 4| Progress (0=pending, ==total_len=complete)  
_result data_|  variable| Plaintext bytes (appended after header)  
  
Total: 2 (prefix) + 105 (header) + byte_width(fhe_type) bytes.

##### Type-Safe Reading

Use the SDK helpers:

```rust
// Pinocchio
use encrypt_pinocchio::accounts::{read_decrypted_verified, ciphertext_digest};

// Read digest from ciphertext account
let ct_data = ciphertext.borrow_unchecked();
let digest = ciphertext_digest(ct_data)?;

// Verify and read result
let value: &u64 = read_decrypted_verified::<Uint64>(req_data, digest)?;
``` 

##### Best Practice: Store-and-Verify

```rust
// At request time:
let digest = ctx.request_decryption(request, ciphertext)?;
state.pending_digest = digest;

// At reveal time:
let value = read_decrypted_verified::<Uint64>(req_data, &state.pending_digest)?;
``` 

This pattern protects against the ciphertext being updated between request and reveal.

---


### CPI framework

*Source: `docs.encrypt.xyz/on-chain/cpi-framework`*

#### CPI Framework

##### EncryptCpi Trait

All three framework SDKs implement the same trait:

```rust
pub trait EncryptCpi {
    type Error;
    type Account<'a>: Clone where Self: 'a;

    fn invoke_execute_graph<'a>(
        &'a self, ix_data: &[u8], accounts: &[Self::Account<'a>],
    ) -> Result<(), Self::Error>;

    fn read_fhe_type<'a>(&'a self, account: Self::Account<'a>) -> Option<u8>;
    fn type_mismatch_error(&self) -> Self::Error;
}
``` 

##### EncryptContext

Each framework provides `EncryptContext`:

```rust
let ctx = EncryptContext {
    encrypt_program,
    config,
    deposit,
    cpi_authority,
    caller_program,
    network_encryption_key,
    payer,
    event_authority,
    system_program,
    cpi_authority_bump,
};
``` 

The struct is identical across frameworks — only the account types differ:

  * **Pinocchio** : `&'a AccountView`
  * **Native** : `&'a AccountInfo<'info>`
  * **Anchor** : `AccountInfo<'info>`

##### Available Methods

Method| Description  
---|---  
`create_plaintext(fhe_type, bytes, ct)`| Create plaintext ciphertext  
`create_plaintext_typed::<T>(value, ct)`| Type-safe plaintext creation  
`execute_graph(ix_data, remaining)`| Execute computation graph  
`execute_registered_graph(graph_pda, ix_data, remaining)`| Execute registered graph  
`register_graph(pda, bump, hash, data)`| Register a reusable graph  
`transfer_ciphertext(ct, new_authorized)`| Transfer authorization  
`copy_ciphertext(source, new_ct, new_auth, transient)`| Copy with different auth  
`make_public(ct)`| Make ciphertext public  
`request_decryption(request, ct)`| Request decryption (returns digest)  
`close_decryption_request(request, destination)`| Close and reclaim rent  
  
##### DSL Extension Traits

`#[encrypt_fn]` generates extension traits that add graph-specific methods:

```rust
// Your DSL function:
#[encrypt_fn]
fn add(a: EUint64, b: EUint64) -> EUint64 { a + b }

// Call as a method on any EncryptContext:
ctx.add(input_a, input_b, output)?;
``` 

The generated method:

  1. Verifies each input account’s `fhe_type` at runtime
  2. Builds the execute_graph instruction data
  3. Assembles remaining accounts (inputs then outputs)
  4. Invokes CPI

---


### Reference: Accounts

*Source: `docs.encrypt.xyz/reference/accounts`*

#### Account Reference

All 7 account types in the Encrypt Solana program. Each account starts with a 2-byte prefix: `discriminator(1) | version(1)`, followed by the account data.

##### Account Discriminators

Discriminator| Account Type  
---|---  
1| EncryptConfig  
2| Authority  
3| DecryptionRequest  
4| EncryptDeposit  
5| RegisteredGraph  
6| Ciphertext  
7| NetworkEncryptionKey  
  
* * *

##### EncryptConfig (disc 1)

Program-wide configuration. PDA seeds: `["encrypt_config"]`.

Offset| Field| Size| Description  
---|---|---|---  
0| discriminator| 1| `1`  
1| version| 1| `1`  
2| current_epoch| 8| Current epoch (LE u64)  
10| enc_per_input| 8| ENC fee per input (LE u64)  
18| enc_per_output| 8| ENC fee per output (LE u64)  
26| max_enc_per_op| 8| Max ENC fee per operation (LE u64)  
34| max_ops_per_graph| 2| Max operations per graph (LE u16)  
36| gas_base| 8| Base SOL gas fee (LE u64)  
44| gas_per_input| 8| SOL gas fee per input (LE u64)  
52| gas_per_output| 8| SOL gas fee per output (LE u64)  
60| gas_per_byte| 8| SOL gas fee per byte (LE u64)  
68| enc_mint| 32| ENC SPL token mint address  
100| enc_vault| 32| ENC vault token account address  
132| bump| 1| PDA bump  
  
**Total: 2 + 131 = 133 bytes**

* * *

##### Authority (disc 2)

Authorized operator (executor/decryptor). PDA seeds: `["authority", pubkey]`.

Offset| Field| Size| Description  
---|---|---|---  
0| discriminator| 1| `2`  
1| version| 1| `1`  
2| pubkey| 32| Authority’s public key  
34| active| 1| Active flag (0 = deactivated)  
35| bump| 1| PDA bump  
  
**Total: 2 + 34 = 36 bytes**

* * *

##### DecryptionRequest (disc 3)

Decryption request with result storage. **Keypair account** (not PDA) – no seed conflicts on multiple requests.

Offset| Field| Size| Description  
---|---|---|---  
0| discriminator| 1| `3`  
1| version| 1| `1`  
2| ciphertext| 32| Ciphertext account pubkey  
34| ciphertext_digest| 32| Digest snapshot at request time  
66| requester| 32| Who requested decryption  
98| fhe_type| 1| FHE type (determines result size)  
99| total_len| 4| Expected result byte count (LE u32)  
103| bytes_written| 4| Bytes written so far (LE u32)  
107|  _result data_|  N| Plaintext bytes (N = byte_width of fhe_type)  
  
**Total: 2 + 105 + byte_width(fhe_type) bytes**

Status is determined by `bytes_written`:

  * `0` = pending (decryptor has not responded)
  * `== total_len` = complete (result is ready)

* * *

##### EncryptDeposit (disc 4)

Fee deposit for a user. PDA seeds: `["encrypt_deposit", owner]`.

Offset| Field| Size| Description  
---|---|---|---  
0| discriminator| 1| `4`  
1| version| 1| `1`  
2| owner| 32| Deposit owner pubkey  
34| enc_balance| 8| ENC token balance (LE u64)  
42| gas_balance| 8| SOL gas balance (LE u64)  
50| pending_enc_withdrawal| 8| Pending ENC withdrawal (LE u64)  
58| pending_gas_withdrawal| 8| Pending SOL withdrawal (LE u64)  
66| withdrawal_epoch| 8| Epoch when withdrawal becomes available (LE u64)  
74| num_txs| 8| Transaction counter (LE u64)  
82| bump| 1| PDA bump  
  
**Total: 2 + 81 = 83 bytes**

* * *

##### RegisteredGraph (disc 5)

A reusable computation graph stored on-chain. PDA seeds: `["registered_graph", graph_hash]`.

Offset| Field| Size| Description  
---|---|---|---  
0| discriminator| 1| `5`  
1| version| 1| `1`  
2| graph_hash| 32| SHA-256 hash of graph data  
34| registrar| 32| Who registered the graph  
66| num_inputs| 2| Number of inputs (LE u16)  
68| num_outputs| 2| Number of outputs (LE u16)  
70| num_ops| 2| Number of operations (LE u16)  
72| finalized| 1| Finalized flag  
73| bump| 1| PDA bump  
74| graph_data_len| 2| Actual graph data length (LE u16)  
76| graph_data| 4096| Graph data (padded to max)  
  
**Total: 2 + 4170 = 4172 bytes**

Maximum graph data: 4096 bytes.

* * *

##### Ciphertext (disc 6)

An encrypted value. **Keypair account** (not PDA) – the account pubkey IS the ciphertext identifier.

Offset| Field| Size| Description  
---|---|---|---  
0| discriminator| 1| `6`  
1| version| 1| `1`  
2| ciphertext_digest| 32| Hash of the encrypted blob (zero until committed)  
34| authorized| 32| Who can use this (`[0; 32]` = public)  
66| network_encryption_public_key| 32| FHE key it was encrypted under  
98| fhe_type| 1| Type discriminant (EBool=0, EUint64=4, etc.)  
99| status| 1| Pending(0) or Verified(1)  
  
**Total: 2 + 98 = 100 bytes**

Status values:

  * `0` = PENDING – waiting for executor to commit
  * `1` = VERIFIED – digest is valid, ciphertext can be used as input

* * *

##### NetworkEncryptionKey (disc 7)

FHE network public key. PDA seeds: `["network_encryption_key", key_bytes]`.

Offset| Field| Size| Description  
---|---|---|---  
0| discriminator| 1| `7`  
1| version| 1| `1`  
2| network_encryption_public_key| 32| FHE network public key bytes  
34| active| 1| Active flag (0 = deactivated)  
35| bump| 1| PDA bump  
  
**Total: 2 + 34 = 36 bytes**

* * *

##### Account Type Summary

Account| Disc| Type| Size (bytes)| PDA Seeds  
---|---|---|---|---  
EncryptConfig| 1| PDA| 133| `["encrypt_config"]`  
Authority| 2| PDA| 36| `["authority", pubkey]`  
DecryptionRequest| 3| Keypair| 107 + N| –  
EncryptDeposit| 4| PDA| 83| `["encrypt_deposit", owner]`  
RegisteredGraph| 5| PDA| 4172| `["registered_graph", graph_hash]`  
Ciphertext| 6| Keypair| 100| –  
NetworkEncryptionKey| 7| PDA| 36| `["network_encryption_key", key_bytes]`

---


### Reference: Instructions

*Source: `docs.encrypt.xyz/reference/instructions`*

#### Instruction Reference

All 22 instructions in the Encrypt Solana program. The first byte of instruction data is the discriminator.

##### Instruction Groups

Group| Disc Range| Instructions  
---|---|---  
Setup| 0| initialize  
Executor| 1–6| create_input_ciphertext, create_plaintext_ciphertext, commit_ciphertext, execute_graph, register_graph, execute_registered_graph  
Ownership| 7–9| transfer_ciphertext, copy_ciphertext, make_public  
Gateway| 10–12| request_decryption, respond_decryption, close_decryption_request  
Fees| 13–18| create_deposit, top_up, withdraw, update_config_fees, reimburse, request_withdraw  
Authority| 19–21| add_authority, remove_authority, register_network_encryption_key  
Event| 228| emit_event  
  
* * *

##### Setup

###### `initialize` (disc 0)

One-time program initialization. Creates the EncryptConfig and initial Authority PDAs.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| config| yes| no| EncryptConfig PDA (must be empty)  
1| authority_pda| yes| no| Authority PDA (must be empty)  
2| initializer| no| yes| Initial authority signer  
3| payer| yes| yes| Rent payer  
4| system_program| no| no| System program  
  
**Data (2 bytes):** `config_bump(1) | authority_bump(1)`

* * *

##### Executor

###### `create_input_ciphertext` (disc 1)

Authority-driven: creates a verified ciphertext from off-chain encrypted data + ZK proof. Status = VERIFIED immediately.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| authority_pda| no| no| Authority PDA  
1| signer| no| yes| Authority signer  
2| config| no| no| EncryptConfig  
3| deposit| yes| no| EncryptDeposit (fee source)  
4| ciphertext| yes| no| New Ciphertext account (must be empty)  
5| creator| no| no| Who gets authorized  
6| network_encryption_key| no| no| NetworkEncryptionKey PDA  
7| payer| yes| yes| Rent payer  
8| system_program| no| no| System program  
9| event_authority| no| no| Event authority PDA  
10| program| no| no| Encrypt program  
  
**Data (33 bytes):** `fhe_type(1) | ciphertext_digest(32)`

* * *

###### `create_plaintext_ciphertext` (disc 2)

User-signed: creates a ciphertext from a plaintext value. The executor encrypts off-chain and commits later. Status = PENDING.

Supports both signer and CPI (program) callers. CPI path inserts `cpi_authority` at position 4.

**Accounts (signer path):**

#| Account| W| S| Description  
---|---|---|---|---  
0| config| no| no| EncryptConfig  
1| deposit| yes| no| EncryptDeposit  
2| ciphertext| yes| no| New Ciphertext account (must be empty)  
3| creator| no| yes| Signer (gets authorized)  
4| network_encryption_key| no| no| NetworkEncryptionKey PDA  
5| payer| yes| yes| Rent payer  
6| system_program| no| no| System program  
7| event_authority| no| no| Event authority PDA  
8| program| no| no| Encrypt program  
  
**Accounts (CPI path):** Same as above but `cpi_authority` is inserted at position 4, shifting positions 4–8 to 5–9.

**Data (1+ bytes):** `fhe_type(1) | [plaintext_bytes(N)]`

* * *

###### `commit_ciphertext` (disc 3)

Authority writes the ciphertext digest after off-chain FHE evaluation. Sets status from PENDING to VERIFIED.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| authority_pda| no| no| Authority PDA  
1| signer| no| yes| Authority signer  
2| ciphertext| yes| no| Ciphertext account  
3| event_authority| no| no| Event authority PDA  
4| program| no| no| Encrypt program  
  
**Data (32 bytes):** `ciphertext_digest(32)`

* * *

###### `execute_graph` (disc 4)

Execute a computation graph. Creates/updates output ciphertext accounts. Emits `GraphExecuted` event.

Supports both signer and CPI callers. CPI path inserts `cpi_authority` at position 3.

**Accounts (signer path):**

#| Account| W| S| Description  
---|---|---|---|---  
0| config| no| no| EncryptConfig  
1| deposit| yes| no| EncryptDeposit  
2| caller| no| yes| Signer  
3| network_encryption_key| no| no| NetworkEncryptionKey PDA  
4| payer| yes| yes| Rent payer  
5| event_authority| no| no| Event authority PDA  
6| program| no| no| Encrypt program  
7..7+N| input ciphertexts| no| no| Input ciphertext accounts  
7+N..7+N+M| output ciphertexts| yes| no| Output ciphertext accounts  
  
**Accounts (CPI path):** `cpi_authority` at position 3, remaining shifted by 1. Fixed accounts = 8 instead of 7.

**Data:** `graph_data_len(2) | graph_data(N) | num_inputs(2)`

* * *

###### `register_graph` (disc 5)

Register a reusable computation graph on-chain. Creates a RegisteredGraph PDA.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| graph_pda| yes| no| RegisteredGraph PDA (must be empty)  
1| registrar| no| yes| Signer  
2| payer| yes| yes| Rent payer  
3| system_program| no| no| System program  
  
**Data (35+ bytes):** `bump(1) | graph_hash(32) | graph_data_len(2) | graph_data(N)`

* * *

###### `execute_registered_graph` (disc 6)

Execute a previously registered graph. Uses the on-chain graph data (no need to re-send).

Supports both signer and CPI callers.

**Accounts (signer path):**

#| Account| W| S| Description  
---|---|---|---|---  
0| config| no| no| EncryptConfig  
1| deposit| yes| no| EncryptDeposit  
2| graph_pda| no| no| RegisteredGraph PDA  
3| caller| no| yes| Signer  
4| network_encryption_key| no| no| NetworkEncryptionKey PDA  
5| payer| yes| yes| Rent payer  
6| event_authority| no| no| Event authority PDA  
7| program| no| no| Encrypt program  
8+| remaining| varies| no| Input + output ciphertexts  
  
**Accounts (CPI path):** `cpi_authority` at position 4, fixed = 9.

**Data (2 bytes):** `num_inputs(2)`

* * *

##### Ownership

###### `transfer_ciphertext` (disc 7)

Transfer authorization to a new party by updating the `authorized` field.

**Accounts (signer path):**

#| Account| W| S| Description  
---|---|---|---|---  
0| ciphertext| yes| no| Ciphertext account  
1| current_authorized| no| yes| Current authorized signer  
2| new_authorized| no| no| New authorized party  
  
**Accounts (CPI path):** `cpi_authority` at position 2, `new_authorized` at position 3.

**Data:** none

* * *

###### `copy_ciphertext` (disc 8)

Create a copy of a ciphertext with a different authorized party.

**Accounts (signer path):**

#| Account| W| S| Description  
---|---|---|---|---  
0| source_ciphertext| no| no| Source Ciphertext  
1| new_ciphertext| yes| no| New Ciphertext account (must be empty)  
2| current_authorized| no| yes| Current authorized signer  
3| new_authorized| no| no| New authorized party  
4| payer| yes| yes| Rent payer  
5| system_program| no| no| System program  
  
**Accounts (CPI path):** `cpi_authority` at position 3, remaining shifted.

**Data (1 byte):** `transient(1)` (0 = permanent/rent-exempt, 1 = transient/0 lamports)

* * *

###### `make_public` (disc 9)

Set `authorized` to zero (public). Irreversible and idempotent.

**Accounts (signer path):**

#| Account| W| S| Description  
---|---|---|---|---  
0| ciphertext| yes| no| Ciphertext account  
1| caller| no| yes| Current authorized signer  
  
**Accounts (CPI path):** `cpi_authority` at position 2.

**Data (32 bytes):** `ciphertext_id(32)`

* * *

##### Gateway

###### `request_decryption` (disc 10)

Request decryption of a ciphertext. Creates a DecryptionRequest account and stores a digest snapshot.

Supports both signer and CPI callers.

**Accounts (signer path):**

#| Account| W| S| Description  
---|---|---|---|---  
0| config| no| no| EncryptConfig  
1| deposit| yes| no| EncryptDeposit  
2| request_acct| yes| no| DecryptionRequest account (must be empty)  
3| caller| no| yes| Signer  
4| ciphertext| no| no| Ciphertext to decrypt  
5| payer| yes| yes| Rent payer  
6| system_program| no| no| System program  
7| event_authority| no| no| Event authority PDA  
8| program| no| no| Encrypt program  
  
**Accounts (CPI path):** `cpi_authority` at position 4, remaining shifted. Fixed = 10.

**Data:** none

* * *

###### `respond_decryption` (disc 11)

Authority writes the decrypted plaintext bytes into the DecryptionRequest account.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| authority_pda| no| no| Authority PDA  
1| request_acct| yes| no| DecryptionRequest account  
2| signer| no| yes| Authority signer  
3| event_authority| no| no| Event authority PDA  
4| program| no| no| Encrypt program  
  
**Data (variable):** plaintext bytes chunk to write

* * *

###### `close_decryption_request` (disc 12)

Close a decryption request and reclaim rent. Only the original requester can close.

**Accounts (signer path):**

#| Account| W| S| Description  
---|---|---|---|---  
0| request| yes| no| DecryptionRequest account  
1| caller| no| yes| Requester signer  
2| destination| yes| no| Rent destination  
  
**Accounts (CPI path):** `cpi_authority` at position 2, `destination` at position 3.

**Data:** none

* * *

##### Fees

###### `create_deposit` (disc 13)

Create an EncryptDeposit PDA for a user. Transfers initial ENC tokens and SOL gas.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| deposit| yes| no| EncryptDeposit PDA (must be empty)  
1| config| no| no| EncryptConfig  
2| user| no| yes| Deposit owner  
3| payer| yes| yes| Rent payer  
4| user_ata| yes| no| User’s ENC token account  
5| vault| yes| no| Program’s ENC vault token account  
6| token_program| no| no| SPL Token program  
7| system_program| no| no| System program  
  
**Data (17 bytes):** `bump(1) | initial_enc_amount(8) | initial_gas_amount(8)`

* * *

###### `top_up` (disc 14)

Add ENC tokens and/or SOL gas to an existing deposit.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| deposit| yes| no| EncryptDeposit PDA  
1| config| no| no| EncryptConfig  
2| user| no| yes| Deposit owner  
3| user_ata| yes| no| User’s ENC token account  
4| vault| yes| no| ENC vault  
5| token_program| no| no| SPL Token program  
6| system_program| no| no| System program  
  
**Data (16 bytes):** `enc_amount(8) | gas_amount(8)`

* * *

###### `withdraw` (disc 15)

Execute a pending withdrawal. Available when `current_epoch >= withdrawal_epoch`.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| deposit| yes| no| EncryptDeposit PDA  
1| config| no| no| EncryptConfig  
2| user| no| yes| Deposit owner  
3| user_ata| yes| no| User’s ENC token account  
4| vault| yes| no| ENC vault  
5| vault_authority| no| no| Vault authority PDA  
6| token_program| no| no| SPL Token program  
  
**Data:** none

* * *

###### `update_config_fees` (disc 16)

Authority updates the fee schedule in EncryptConfig.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| config| yes| no| EncryptConfig PDA  
1| authority_pda| no| no| Authority PDA  
2| signer| no| yes| Authority signer  
  
**Data (58 bytes):** `enc_per_input(8) | enc_per_output(8) | max_enc_per_op(8) | max_ops_per_graph(2) | gas_base(8) | gas_per_input(8) | gas_per_output(8) | gas_per_byte(8)`

* * *

###### `reimburse` (disc 17)

Authority credits back the per-op max-charge overcharge after computing actual costs.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| authority_pda| no| no| Authority PDA  
1| signer| no| yes| Authority signer  
2| deposit| yes| no| EncryptDeposit PDA  
  
**Data (16 bytes):** `enc_amount(8) | gas_amount(8)`

* * *

###### `request_withdraw` (disc 18)

Set pending withdrawal amounts. Actual withdrawal available next epoch.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| deposit| yes| no| EncryptDeposit PDA  
1| config| no| no| EncryptConfig  
2| user| no| yes| Deposit owner  
  
**Data (16 bytes):** `enc_amount(8) | gas_amount(8)`

* * *

##### Authority

###### `add_authority` (disc 19)

Add a new authority. Must be signed by an existing authority.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| new_auth| yes| no| New Authority PDA (must be empty)  
1| existing_auth| no| no| Existing Authority PDA  
2| signer| no| yes| Existing authority signer  
3| payer| yes| yes| Rent payer  
4| system_program| no| no| System program  
  
**Data (33 bytes):** `bump(1) | new_pubkey(32)`

* * *

###### `remove_authority` (disc 20)

Deactivate an authority.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| target_auth| yes| no| Authority PDA to deactivate  
1| signer_auth| no| no| Signer’s Authority PDA  
2| signer| no| yes| Authority signer  
  
**Data:** none

* * *

###### `register_network_encryption_key` (disc 21)

Register a new FHE network encryption public key.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| network_encryption_key_pda| yes| no| NetworkEncryptionKey PDA (must be empty)  
1| authority_pda| no| no| Authority PDA  
2| signer| no| yes| Authority signer  
3| payer| yes| yes| Rent payer  
4| system_program| no| no| System program  
  
**Data (33 bytes):** `bump(1) | network_public_key(32)`

* * *

##### Event

###### `emit_event` (disc 228)

Self-CPI event handler. Called internally by the Encrypt program to emit Anchor-compatible events. Not called by external programs.

**Accounts:**

#| Account| W| S| Description  
---|---|---|---|---  
0| event_authority| no| no| Event authority PDA (must match)  
1| program| no| no| Encrypt program  
  
**Data:** Event payload (prefixed with `EVENT_IX_TAG_LE`)

---


### Reference: Events

*Source: `docs.encrypt.xyz/reference/events`*

#### Event Reference

The Encrypt program emits 5 event types via Anchor-compatible self-CPI. Each event is prefixed with `EVENT_IX_TAG_LE` (8 bytes, `0xe4a545ea51cb9a1d` in LE) followed by a 1-byte event discriminator.

##### Event Discriminators

Discriminator| Event  
---|---  
0| CiphertextCreated  
1| CiphertextCommitted  
2| GraphExecuted  
3| DecryptionRequested  
4| DecryptionResponded  
  
* * *

##### CiphertextCreated (disc 0)

Emitted when a new ciphertext account is created (`create_input_ciphertext` or `create_plaintext_ciphertext`).

Field| Size| Description  
---|---|---  
ciphertext| 32| Ciphertext account pubkey  
ciphertext_digest| 32| Initial digest (zero for plaintext, real for input)  
fhe_type| 1| FHE type discriminant  
  
**Data size: 65 bytes**

Used by the executor to detect new ciphertexts that need processing (plaintext ciphertexts need encryption and commit).

* * *

##### CiphertextCommitted (disc 1)

Emitted when an authority commits a ciphertext digest (`commit_ciphertext`), transitioning status from PENDING to VERIFIED.

Field| Size| Description  
---|---|---  
ciphertext| 32| Ciphertext account pubkey  
ciphertext_digest| 32| The committed digest  
  
**Data size: 64 bytes**

Used by off-chain services to track when ciphertexts become usable as inputs.

* * *

##### GraphExecuted (disc 2)

Emitted when a computation graph is executed (`execute_graph` or `execute_registered_graph`). Output ciphertext accounts are created/updated with status=PENDING.

Field| Size| Description  
---|---|---  
num_outputs| 2| Number of output ciphertexts (LE u16)  
num_inputs| 2| Number of input ciphertexts (LE u16)  
caller_program| 32| Program that invoked execute_graph via CPI  
  
**Data size: 36 bytes**

This is the primary event the executor listens for. Upon detection, the executor:

  1. Reads the graph data from the transaction
  2. Fetches the input ciphertext blobs
  3. Evaluates the computation graph using FHE
  4. Calls `commit_ciphertext` for each output

* * *

##### DecryptionRequested (disc 3)

Emitted when a decryption request is created (`request_decryption`).

Field| Size| Description  
---|---|---  
ciphertext| 32| Ciphertext account pubkey  
requester| 32| Who requested decryption  
  
**Data size: 64 bytes**

The decryptor listens for this event and:

  1. Performs threshold MPC decryption (or mock decryption locally)
  2. Calls `respond_decryption` to write the plaintext result

* * *

##### DecryptionResponded (disc 4)

Emitted when the decryptor writes the plaintext result (`respond_decryption`).

Field| Size| Description  
---|---|---  
ciphertext| 32| Ciphertext account pubkey  
requester| 32| Who requested decryption  
  
**Data size: 64 bytes**

Off-chain clients listen for this event to know when a decryption result is ready to read.

* * *

##### Event Wire Format

Each event is emitted as a self-CPI instruction with the following data layout:

```text
EVENT_IX_TAG_LE(8) | event_discriminator(1) | event_data(N)
``` 

Total on-wire size per event = 9 + data size.

Event| On-Wire Size  
---|---  
CiphertextCreated| 9 + 65 = 74 bytes  
CiphertextCommitted| 9 + 64 = 73 bytes  
GraphExecuted| 9 + 36 = 45 bytes  
DecryptionRequested| 9 + 64 = 73 bytes  
DecryptionResponded| 9 + 64 = 73 bytes  
  
##### Parsing Events

Events are emitted as inner instructions in the transaction. To parse them:

  1. Find inner instructions targeting the Encrypt program with discriminator `228` (EmitEvent)
  2. Skip the first 8 bytes (`EVENT_IX_TAG_LE`)
  3. Read the 1-byte event discriminator
  4. Deserialize the remaining bytes according to the event schema

The `chains/solana/dev` crate provides an event parser for use in tests and off-chain services.

---


### Reference: Fees

*Source: `docs.encrypt.xyz/reference/fees`*

#### Fee Model

Encrypt uses a dual-token fee model: **ENC** (SPL token) for FHE computation costs and **SOL gas** for Solana transaction costs. Fees are charged upfront from the user’s `EncryptDeposit` account and partially reimbursed after actual costs are known.

##### Overview

```text
User creates EncryptDeposit
    ├── ENC balance   (SPL token transfer to vault)
    └── Gas balance   (SOL transfer to deposit PDA)

execute_graph charges:
    ├── ENC: enc_per_input × total_inputs + enc_per_output × outputs + max_enc_per_op × ops
    └── Gas: gas_base + gas_per_input × inputs + gas_per_output × outputs

Authority reimburses (max_charge - actual_cost) after off-chain evaluation
``` 

##### Fee Parameters

Stored in the `EncryptConfig` account, updatable by authorities via `update_config_fees`:

Parameter| Size| Description  
---|---|---  
`enc_per_input`| u64| ENC charged per input (encrypted + plaintext + constant)  
`enc_per_output`| u64| ENC charged per output ciphertext  
`max_enc_per_op`| u64| Maximum ENC charged per FHE operation  
`max_ops_per_graph`| u16| Maximum operations allowed per graph  
`gas_base`| u64| Base SOL gas fee per graph execution  
`gas_per_input`| u64| SOL gas fee per input  
`gas_per_output`| u64| SOL gas fee per output  
`gas_per_byte`| u64| SOL gas fee per byte of graph data  
  
##### ENC Fee Calculation

When `execute_graph` is called, the ENC fee is calculated as:

```text
total_inputs = num_inputs + num_plaintext_inputs + num_constants
enc_fee = enc_per_input * total_inputs
        + enc_per_output * num_outputs
        + max_enc_per_op * num_ops
``` 

The `max_enc_per_op` is a **worst-case** charge. Different FHE operations have vastly different costs (e.g., multiplication is far more expensive than addition). Since the on-chain processor cannot determine actual costs without performing the FHE computation, it charges the maximum. The authority reimburses the difference after off-chain evaluation.

##### Gas Fee Calculation

SOL gas covers the Solana transaction costs:

```text
gas_fee = gas_base
        + gas_per_input * num_inputs
        + gas_per_output * num_outputs
``` 

##### Deposit Lifecycle

###### 1\. Create Deposit

```rust
// Instruction: create_deposit (disc 13)
// Data: bump(1) | initial_enc_amount(8) | initial_gas_amount(8)
``` 

Creates an `EncryptDeposit` PDA for the user. Transfers `initial_enc_amount` ENC tokens from the user’s ATA to the program vault, and `initial_gas_amount` lamports as gas.

###### 2\. Top Up

```rust
// Instruction: top_up (disc 14)
// Data: enc_amount(8) | gas_amount(8)
``` 

Add more ENC and/or SOL to an existing deposit. Either amount can be zero.

###### 3\. Use (Automatic)

Every `execute_graph`, `create_input_ciphertext`, `create_plaintext_ciphertext`, and `request_decryption` call deducts fees from the deposit automatically. The deposit account is passed as a writable account in each of these instructions.

###### 4\. Reimburse

```rust
// Instruction: reimburse (disc 17)
// Data: enc_amount(8) | gas_amount(8)
``` 

After the executor evaluates a computation graph, it knows the actual per-operation costs. The authority calls `reimburse` to credit back the difference between `max_enc_per_op * ops` and the actual cost.

###### 5\. Request Withdraw

```rust
// Instruction: request_withdraw (disc 18)
// Data: enc_amount(8) | gas_amount(8)
``` 

Requests a withdrawal. Sets `pending_enc_withdrawal`, `pending_gas_withdrawal`, and `withdrawal_epoch = current_epoch + 1`. The withdrawal is delayed by one epoch to prevent front-running.

###### 6\. Withdraw

```rust
// Instruction: withdraw (disc 15)
// No data
``` 

Executes the pending withdrawal if `current_epoch >= withdrawal_epoch`. Actual amounts are capped at current balances (charges during the delay may have reduced them).

##### Registered Graph Fee Optimization

When using `execute_registered_graph` instead of `execute_graph`, the authority can compute exact per-operation costs because the graph is known ahead of time. This eliminates the max-charge gap and the need for reimbursement.

```rust
// Register a graph once
ctx.register_graph(graph_pda, bump, &graph_hash, &graph_data)?;

// Execute with exact fees (no max-charge overcharge)
ctx.execute_registered_graph(graph_pda, ix_data, remaining)?;
``` 

##### Fee Example

Given fee parameters:

  * `enc_per_input = 100`
  * `enc_per_output = 50`
  * `max_enc_per_op = 200`
  * `gas_base = 5000`
  * `gas_per_input = 1000`
  * `gas_per_output = 500`

For `cast_vote_graph` (3 inputs, 2 outputs, ~5 ops, 1 constant):

```text
ENC upfront = 100 * (3 + 1) + 50 * 2 + 200 * 5 = 400 + 100 + 1000 = 1500
Gas         = 5000 + 1000 * 3 + 500 * 2 = 5000 + 3000 + 1000 = 9000
``` 

If actual per-op costs total 600 ENC (instead of max 1000), the authority reimburses 400 ENC.

##### EncryptDeposit Account Fields

Field| Size| Description  
---|---|---  
owner| 32| Deposit owner pubkey  
enc_balance| 8| Current ENC balance  
gas_balance| 8| Current SOL gas balance  
pending_enc_withdrawal| 8| Pending ENC withdrawal amount  
pending_gas_withdrawal| 8| Pending SOL gas withdrawal amount  
withdrawal_epoch| 8| Epoch when withdrawal is available  
num_txs| 8| Total transaction count  
bump| 1| PDA bump

---


### Testing framework

*Source: `docs.encrypt.xyz/testing/test-framework`*

#### Test Framework

##### Overview

`encrypt-solana-test` provides three testing modes:

  * **LiteSVM** (`EncryptTestContext`) — fast in-process e2e tests
  * **solana-program-test** (`ProgramTestEncryptContext`) — official Solana runtime e2e tests
  * **Mollusk** — single-instruction unit tests with pre-built account data

```toml
[dev-dependencies]
encrypt-solana-test = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
``` 

##### Architecture

```text
encrypt-dev (chains/solana/dev/) — production-safe, no test deps
  ├── SolanaRuntime                # Production (send_transaction, get_account_data, ...)
  ├── TestRuntime                  # Dev/test (adds airdrop, deploy_program)
  ├── InProcessTestRuntime         # In-process only (adds set_account, advance_slot)
  └── EncryptTxBuilder<R>          # Tx construction for all Encrypt instructions

encrypt-solana-test (chains/solana/test/)
  ├── LiteSvmRuntime               # LiteSVM backend (InProcessTestRuntime)
  ├── ProgramTestRuntime           # solana-program-test backend (InProcessTestRuntime)
  ├── EncryptTestHarness<R>        # Wraps TxBuilder + MockComputeEngine + store + work queue
  ├── EncryptTestContext            # Ergonomic LiteSVM wrapper
  ├── ProgramTestEncryptContext     # Ergonomic solana-program-test wrapper
  └── mollusk helpers               # Account builders, discriminators, setup
``` 

`encrypt-dev` has no test framework dependencies — only the runtime trait hierarchy and `EncryptTxBuilder`. Test runtimes and harness live in `encrypt-solana-test`.

##### EncryptTestContext

```rust
use encrypt_solana_test::litesvm::EncryptTestContext;
use encrypt_types::encrypted::Uint64;

#[test]
fn test_my_program() {
    let mut ctx = EncryptTestContext::new_default();
    let user = ctx.new_funded_keypair();

    let a = ctx.create_input::<Uint64>(10, &user.pubkey());
    let b = ctx.create_input::<Uint64>(32, &user.pubkey());

    let graph = my_add_graph();
    let outputs = ctx.execute_and_commit(&graph, &[a, b], 1, &[], &user);

    let result = ctx.decrypt::<Uint64>(&outputs[0], &user);
    assert_eq!(result, 42);
}
``` 

##### How It Works

  1. **LiteSVM** runs in-process — no external validator needed
  2. A **local authority keypair** signs `commit_ciphertext` and `respond_decryption`
  3. An **in-memory CiphertextStore** tracks all ciphertext digests
  4. `execute_and_commit()` calls `execute_graph` on-chain, then evaluates the graph off-chain using `MockComputeEngine` and commits results
  5. `decrypt()` calls `request_decryption` on-chain, then decrypts and responds

All off-chain processing happens synchronously — no event polling needed.

##### API Reference

Method| Description  
---|---  
`new(elf_path)`| Create context with custom program path  
`new_default()`| Create with default build output path  
`new_funded_keypair()`| Create and fund a new keypair (10 SOL)  
`create_input::<T>(value, authorized)`| Create verified encrypted input (authority-driven)  
`create_plaintext::<T>(value, creator)`| Create plaintext ciphertext (user-signed)  
`execute_and_commit(graph, inputs, n_outputs, existing_outputs, caller)`| Execute + commit in one call  
`decrypt::<T>(ct_pubkey, requester)`| Decrypt and return plaintext value  
`decrypt_from_store(ct_pubkey)`| Read value from mock store (no on-chain request)  
`deploy_program(elf_path)`| Deploy an additional program, returns ID  
`deploy_program_at(id, elf_path)`| Deploy at a specific address  
`cpi_authority_for(caller_program)`| Derive CPI authority PDA for a program  
`send_transaction(ixs, signers)`| Sign and send a transaction  
`get_account_data(pubkey)`| Read raw account data  
`register_ciphertext(pubkey)`| Register CPI-created ciphertext in the store  
`enqueue_graph_execution(graph, inputs, outputs)`| Enqueue CPI-triggered graph for processing  
`process_pending()`| Process all queued graph executions and decryptions  
`program_id()` / `config_pda()` / `deposit_pda()` / etc.| Access Encrypt program PDAs  
  
##### Testing CPI Programs (e2e)

For programs that call the Encrypt program via CPI (like the voting examples):

```rust
use encrypt_solana_test::litesvm::EncryptTestContext;
use encrypt_types::encrypted::{Bool, Uint64};

#[test]
fn test_voting_lifecycle() {
    let mut ctx = EncryptTestContext::new_default();

    // Deploy your program
    let program_id = ctx.deploy_program("path/to/your_program.so");
    let (cpi_authority, cpi_bump) = ctx.cpi_authority_for(&program_id);

    // Create proposal (CPI creates ciphertexts)
    // ... send create_proposal transaction ...

    // Register CPI-created ciphertexts in the harness store
    ctx.register_ciphertext(&yes_ct_pubkey);
    ctx.register_ciphertext(&no_ct_pubkey);

    // Cast vote (CPI to execute_graph)
    // ... send cast_vote transaction ...

    // Enqueue the graph execution for off-chain processing
    ctx.enqueue_graph_execution(&graph_data, &inputs, &outputs);
    ctx.process_pending();

    // Re-register updated ciphertexts
    ctx.register_ciphertext(&yes_ct_pubkey);
    ctx.register_ciphertext(&no_ct_pubkey);

    // Verify results from the mock store
    let yes = ctx.decrypt_from_store(&yes_ct_pubkey);
    assert_eq!(yes, 1);
}
``` 

##### Testing Update Mode

For programs that reuse ciphertext accounts:

```rust
let yes_ct = ctx.create_input::<Uint64>(0, &program_id);
let no_ct = ctx.create_input::<Uint64>(0, &program_id);
let vote = ctx.create_input::<Bool>(1, &program_id);

// Pass yes_ct and no_ct as both inputs and existing outputs (update mode)
let outputs = ctx.execute_and_commit(
    &cast_vote_graph(),
    &[yes_ct, no_ct, vote],
    0,                       // no new outputs
    &[yes_ct, no_ct],        // existing outputs (update mode)
    &caller,
);
``` 

##### Mollusk Mode

For single-instruction unit tests:

```rust
use encrypt_solana_test::mollusk::*;

let (mollusk, program_id) = setup();
let ct_data = build_ciphertext_data(&digest, &authorized, &nk, fhe_type, status);

let result = mollusk.process_instruction(
    &Instruction::new_with_bytes(program_id, &ix_data, accounts),
    &[(key, program_account(&program_id, ct_data))],
);
assert!(result.program_result.is_ok());
``` 

Mollusk is best for testing individual instructions in isolation — signer checks, discriminator validation, authority verification, digest matching, etc.

---


### Testing: Mock vs Real FHE

*Source: `docs.encrypt.xyz/testing/mock-vs-real`*

#### Mock vs Real FHE

##### Mock Mode (Pre-Alpha)

The pre-alpha environment uses **mock FHE** — operations are performed as plaintext arithmetic with keccak256 digests. This means:

  * `add(encrypt(10), encrypt(32))` → `encrypt(42)` — correct result, no actual encryption
  * Graph evaluation is instantaneous (no FHE overhead)
  * Decryption is trivial
  * **No security** — values are not encrypted on-chain

Your program logic, computation graphs, and client code all work identically in mock and real mode. Only the off-chain executor differs.

##### Real REFHE Mode (Coming Soon)

In production, the executor will use the REFHE library:

  * Actual homomorphic encryption on ciphertext blobs
  * Decryption requires threshold MPC (multiple decryptor nodes)
  * Full privacy — values are never visible on-chain

**No code changes required** — the same `#[encrypt_fn]` graphs, CPI calls, and gRPC client calls work in both modes.

---


### Framework: Anchor

*Source: `docs.encrypt.xyz/frameworks/anchor`*

#### Anchor

##### Dependencies

```toml
[dependencies]
encrypt-types = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-dsl = { package = "encrypt-solana-dsl", git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-anchor = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
anchor-lang = "0.32"
``` 

##### Setup EncryptContext

```rust
use encrypt_anchor::EncryptContext;

let ctx = EncryptContext {
    encrypt_program: ctx.accounts.encrypt_program.to_account_info(),
    config: ctx.accounts.config.to_account_info(),
    deposit: ctx.accounts.deposit.to_account_info(),
    cpi_authority: ctx.accounts.cpi_authority.to_account_info(),
    caller_program: ctx.accounts.caller_program.to_account_info(),
    network_encryption_key: ctx.accounts.network_encryption_key.to_account_info(),
    payer: ctx.accounts.payer.to_account_info(),
    event_authority: ctx.accounts.event_authority.to_account_info(),
    system_program: ctx.accounts.system_program.to_account_info(),
    cpi_authority_bump,
};
``` 

##### Execute Graph

```rust
let yes_ct = ctx.accounts.yes_ct.to_account_info();
let no_ct = ctx.accounts.no_ct.to_account_info();
let vote_ct = ctx.accounts.vote_ct.to_account_info();
encrypt_ctx.cast_vote_graph(
    yes_ct.clone(), no_ct.clone(), vote_ct,
    yes_ct, no_ct,
)?;
``` 

Note: Anchor’s `AccountInfo` is `Clone`, so you can pass the same account as both input and output.

##### Request Decryption

```rust
let digest = encrypt_ctx.request_decryption(
    &ctx.accounts.request_acct.to_account_info(),
    &ctx.accounts.ciphertext.to_account_info(),
)?;
``` 

##### Read Decrypted Value

```rust
use encrypt_anchor::accounts::{read_decrypted_verified, ciphertext_digest};

let ct_data = ctx.accounts.ciphertext.try_borrow_data()?;
let digest = ciphertext_digest(&ct_data)?;
let req_data = ctx.accounts.request_acct.try_borrow_data()?;
let value = read_decrypted_verified::<Uint64>(&req_data, digest)?;
``` 

##### Account Structs

Include Encrypt accounts in your Anchor `#[derive(Accounts)]`:

```rust
#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    pub voter: Signer<'info>,
    /// CHECK: Vote ciphertext
    #[account(mut)]
    pub vote_ct: UncheckedAccount<'info>,
    /// CHECK: Yes count ciphertext
    #[account(mut)]
    pub yes_ct: UncheckedAccount<'info>,
    /// CHECK: No count ciphertext
    #[account(mut)]
    pub no_ct: UncheckedAccount<'info>,
    /// CHECK: Encrypt program
    pub encrypt_program: UncheckedAccount<'info>,
    // ... config, deposit, cpi_authority, etc.
}
``` 

##### Full Example

See `chains/solana/examples/confidential-voting-anchor/` for a complete program.

---


### Framework: Pinocchio

*Source: `docs.encrypt.xyz/frameworks/pinocchio`*

#### Pinocchio

##### Dependencies

```toml
[dependencies]
encrypt-types = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-dsl = { package = "encrypt-solana-dsl", git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-pinocchio = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
pinocchio = "0.10"
pinocchio-system = "0.5"
``` 

##### Setup EncryptContext

```rust
use encrypt_pinocchio::EncryptContext;

let ctx = EncryptContext {
    encrypt_program,
    config,
    deposit,
    cpi_authority,
    caller_program,
    network_encryption_key,
    payer,
    event_authority,
    system_program,
    cpi_authority_bump,
};
``` 

##### Create Encrypted Zeros

```rust
use encrypt_types::encrypted::Uint64;

ctx.create_plaintext_typed::<Uint64>(&0u64, ciphertext_acct)?;
``` 

##### Execute Graph

```rust
// Via DSL-generated method (preferred)
ctx.cast_vote_graph(yes_ct, no_ct, vote_ct, yes_ct, no_ct)?;

// Via manual execute_graph
ctx.execute_graph(&ix_data, &[yes_ct, no_ct, vote_ct, yes_ct, no_ct])?;
``` 

##### Request Decryption

```rust
let digest = ctx.request_decryption(request_acct, ciphertext)?;
// Store digest for later verification
``` 

##### Read Decrypted Value

```rust
use encrypt_pinocchio::accounts::{read_decrypted_verified, ciphertext_digest};

let ct_data = unsafe { ciphertext.borrow_unchecked() };
let digest = ciphertext_digest(ct_data)?;
let req_data = unsafe { request_acct.borrow_unchecked() };
let value: &u64 = read_decrypted_verified::<Uint64>(req_data, digest)?;
``` 

##### Full Example

See `chains/solana/examples/voting/pinocchio/` for a complete confidential voting program.

##### Framework Comparison

Consideration| Pinocchio| Native| Anchor| Quasar  
---|---|---|---|---  
**CU efficiency**|  Best| Good| Good| Best  
**Binary size**|  Small| Medium| Largest| Smallest  
**`no_std` support**| Yes| No| No| Yes  
**Account validation**|  Manual| Manual| Declarative| Declarative  
**Zero-copy**|  Manual| No| No| Built-in  
  
All four SDKs implement the same `EncryptCpi` trait with identical CPI authority seeds and instruction discriminators. Consider Quasar for declarative validation with Pinocchio-level performance.

---


### Framework: Native

*Source: `docs.encrypt.xyz/frameworks/native`*

#### Native (solana-program)

##### Dependencies

```toml
[dependencies]
encrypt-types = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-dsl = { package = "encrypt-solana-dsl", git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
encrypt-native = { git = "https://github.com/dwallet-labs/encrypt-pre-alpha" }
solana-program = "4"
``` 

##### Setup EncryptContext

```rust
use encrypt_native::EncryptContext;

let ctx = EncryptContext {
    encrypt_program,
    config,
    deposit,
    cpi_authority,
    caller_program,
    network_encryption_key,
    payer,
    event_authority,
    system_program,
    cpi_authority_bump,
};
``` 

##### Create Encrypted Zeros

```rust
use encrypt_types::encrypted::Uint64;

ctx.create_plaintext_typed::<Uint64>(&0u64, ciphertext_acct)?;
``` 

##### Execute Graph

```rust
ctx.cast_vote_graph(
    yes_ct.clone(), no_ct.clone(), vote_ct.clone(),
    yes_ct.clone(), no_ct.clone(),
)?;
``` 

Note: Native `AccountInfo` is `Clone`, so you can clone for duplicate references.

##### Request Decryption

```rust
let digest = ctx.request_decryption(request_acct, ciphertext)?;
``` 

##### Read Decrypted Value

```rust
use encrypt_native::accounts::{read_decrypted_verified, ciphertext_digest};

let ct_data = ciphertext.try_borrow_data()?;
let digest = ciphertext_digest(&ct_data)?;
let req_data = request_acct.try_borrow_data()?;
let value = read_decrypted_verified::<Uint64>(&req_data, digest)?;
``` 

##### Full Example

See `chains/solana/examples/confidential-voting-native/` for a complete program.

---


### Framework: Quasar

*Source: `docs.encrypt.xyz/frameworks/quasar`*

#### Quasar Framework

The `encrypt-quasar` crate provides a Quasar-native CPI SDK for the Encrypt program. Quasar is a zero-copy Solana program framework with alignment-1 Pod types, declarative account validation, and `invoke_signed_unchecked` CPI.

##### Dependencies

```toml
[dependencies]
encrypt-types = { git = "https://github.com/nicedwalletlabs/encrypt-pre-alpha" }
encrypt-dsl = { package = "encrypt-solana-dsl", git = "https://github.com/nicedwalletlabs/encrypt-pre-alpha" }
encrypt-quasar = { git = "https://github.com/nicedwalletlabs/encrypt-pre-alpha" }
quasar-lang = { git = "https://github.com/blueshift-gg/quasar", branch = "master" }
solana-address = { version = "2.4", features = ["curve25519"] }

[lib]
crate-type = ["cdylib", "lib"]
``` 

##### EncryptContext

```rust
use encrypt_quasar::EncryptContext;

let ctx = EncryptContext {
    encrypt_program: self.encrypt_program.to_account_view(),
    config: self.config.to_account_view(),
    deposit: self.deposit.to_account_view(),
    cpi_authority: self.cpi_authority.to_account_view(),
    caller_program: self.caller_program.to_account_view(),
    network_encryption_key: self.network_encryption_key.to_account_view(),
    payer: self.payer.to_account_view(),
    event_authority: self.event_authority.to_account_view(),
    system_program: self.system_program.to_account_view(),
    cpi_authority_bump,
};
``` 

Convert Quasar owned types (`Signer`, `UncheckedAccount`, `Program<System>`) to `&AccountView` using `.to_account_view()`.

##### Creating Encrypted Zeros

```rust
use encrypt_types::encrypted::Uint64;

ctx.create_plaintext_typed::<Uint64>(
    &0u64,
    self.value_ct.to_account_view(),
)?;
``` 

##### Executing FHE Graphs

Define graphs with `#[encrypt_fn]`:

```rust
use encrypt_dsl::prelude::encrypt_fn;
use encrypt_types::encrypted::EUint64;

#[encrypt_fn]
fn increment_graph(value: EUint64) -> EUint64 {
    value + 1
}
``` 

Execute via CPI (generated `_cpi` function on EncryptContext):

```rust
ctx.increment_graph(
    self.value_ct.to_account_view(),  // input
    self.value_ct.to_account_view(),  // output (same account for in-place)
)?;
``` 

##### Requesting Decryption

```rust
let digest = ctx.request_decryption(
    self.request_acct.to_account_view(),
    self.ciphertext.to_account_view(),
)?;

// Store digest in your program state for later verification
self.my_state.pending_digest = digest;
``` 

##### Reading Decrypted Values

```rust
use encrypt_quasar::accounts;
use encrypt_types::encrypted::Uint64;

let req_data = unsafe { self.request_acct.to_account_view().borrow_unchecked() };
let value: &u64 = accounts::read_decrypted_verified::<Uint64>(
    req_data,
    &self.my_state.pending_digest,
)?;
``` 

##### Quasar Program Patterns

Quasar programs use owned types, explicit discriminators, and `impl` handlers:

```rust
#![no_std]

use encrypt_quasar::EncryptContext;
use quasar_lang::prelude::*;

declare_id!("...");

#[program]
mod my_program {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn create(ctx: Ctx<Create>, /* args */) -> Result<(), ProgramError> {
        ctx.accounts.create(/* args */)
    }
}

#[derive(Accounts)]
pub struct Create {
    #[account(init, payer = payer, seeds = MyState::seeds(state_id), bump)]
    pub state: Account<MyState>,

    // Encrypt program accounts
    pub encrypt_program: UncheckedAccount,
    pub config: UncheckedAccount,
    #[account(mut)]
    pub deposit: UncheckedAccount,
    pub cpi_authority: UncheckedAccount,
    pub caller_program: UncheckedAccount,
    pub network_encryption_key: UncheckedAccount,
    #[account(mut)]
    pub payer: Signer,
    pub event_authority: UncheckedAccount,
    pub system_program: Program<System>,
}
``` 

##### Performance

Quasar produces the smallest binaries and near-lowest CU usage of any declarative framework:

Consideration| Pinocchio| Native| Anchor| Quasar  
---|---|---|---|---  
**CU efficiency**|  Best| Good| Good| Best  
**Binary size**|  Small| Medium| Largest| Smallest  
**`no_std` support**| Yes| No| No| Yes  
**Account validation**|  Manual| Manual| Declarative| Declarative  
**Zero-copy**|  Manual| No| No| Built-in  
  
All four SDKs use the same CPI authority seed (`b"__encrypt_cpi_authority"`), the same instruction discriminators, and the same `EncryptCpi` trait. Programs built with any SDK are fully interoperable.

---


### Example: Counter program

*Source: `docs.encrypt.xyz/examples/counter/02-program`*

#### Confidential Counter: Building the Program

##### 1\. Cargo.toml

```toml
[package]
name = "confidential-counter-anchor"
edition.workspace = true

[dependencies]
encrypt-types = { workspace = true }
encrypt-dsl = { package = "encrypt-solana-dsl", path = "../../../program-sdk/dsl" }
encrypt-anchor = { workspace = true }
anchor-lang = { workspace = true }

[lib]
crate-type = ["cdylib", "lib"]
``` 

Three Encrypt crates:

  * `encrypt-types` – FHE type definitions (`EUint64`, `Uint64`, etc.)
  * `encrypt-dsl` (aliased from `encrypt-solana-dsl`) – the `#[encrypt_fn]` macro that generates FHE graphs + Solana CPI glue
  * `encrypt-anchor` – `EncryptContext` struct and account helpers for Anchor

##### 2\. FHE Graphs

```rust
use encrypt_dsl::prelude::encrypt_fn;
use encrypt_types::encrypted::EUint64;

#[encrypt_fn]
fn increment_graph(value: EUint64) -> EUint64 {
    value + 1
}

#[encrypt_fn]
fn decrement_graph(value: EUint64) -> EUint64 {
    value - 1
}
``` 

The `#[encrypt_fn]` macro does two things at compile time:

  1. **Generates a graph function** (`increment_graph() -> Vec<u8>`) that returns a serialized computation graph in the Encrypt binary format. The graph has one `Input` node (the encrypted value), one `Constant` node (the literal `1`), one `Op` node (add or subtract), and one `Output` node.

  2. **Generates a CPI extension trait** (`IncrementGraphCpi`) with a blanket implementation on `EncryptContext`. This gives you a method like `encrypt_ctx.increment_graph(input_ct, output_ct)` that builds and executes the `execute_graph` CPI to the Encrypt program.

The graph is embedded in the program binary. When the CPI fires, the Encrypt program emits an event that the off-chain executor picks up. The executor deserializes the graph, evaluates each node using real FHE operations, and commits the result ciphertext on-chain.

Key point: the same ciphertext account can be both input and output (in-place update). That’s how `increment` works – the counter value is updated without creating new accounts.

##### 3\. Counter State

```rust
#[account]
#[derive(InitSpace)]
pub struct Counter {
    pub authority: Pubkey,          // who can increment/decrypt
    pub counter_id: [u8; 32],      // unique ID, used as PDA seed
    pub value: [u8; 32],           // pubkey of the ciphertext account
    pub pending_digest: [u8; 32],  // digest from request_decryption
    pub revealed_value: u64,       // plaintext after decryption
    pub bump: u8,                  // PDA bump
}
``` 

  * `value` stores the **pubkey** of a ciphertext account, not the ciphertext itself. Ciphertext accounts are owned by the Encrypt program.
  * `pending_digest` is the store-and-verify pattern: when you request decryption, the Encrypt program returns a digest of the ciphertext at that moment. You store it and later verify the decryption result matches.
  * `revealed_value` holds the plaintext once decrypted. Until then it’s 0.

##### 4\. create_counter

```rust
pub fn create_counter(
    ctx: Context<CreateCounter>,
    counter_id: [u8; 32],
    initial_value_id: [u8; 32],
) -> Result<()> {
    let ctr = &mut ctx.accounts.counter;
    ctr.authority = ctx.accounts.authority.key();
    ctr.counter_id = counter_id;
    ctr.value = initial_value_id;
    ctr.pending_digest = [0u8; 32];
    ctr.revealed_value = 0;
    ctr.bump = ctx.bumps.counter;
    Ok(())
}
``` 

The caller creates an encrypted zero off-chain (via the gRPC `CreateInput` RPC), which produces a ciphertext account on Solana. The caller passes that account’s pubkey as `initial_value_id`. The counter PDA just stores the reference.

Account constraints:

```rust
#[derive(Accounts)]
#[instruction(counter_id: [u8; 32])]
pub struct CreateCounter<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Counter::INIT_SPACE,
        seeds = [b"counter", counter_id.as_ref()],
        bump,
    )]
    pub counter: Account<'info, Counter>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
``` 

The PDA is seeded by `["counter", counter_id]`. The `counter_id` is an arbitrary 32-byte value chosen by the caller (typically a random keypair’s pubkey bytes).

##### 5\. increment / decrement

```rust
pub fn increment(ctx: Context<Increment>, cpi_authority_bump: u8) -> Result<()> {
    let encrypt_ctx = EncryptContext {
        encrypt_program: ctx.accounts.encrypt_program.to_account_info(),
        config: ctx.accounts.config.to_account_info(),
        deposit: ctx.accounts.deposit.to_account_info(),
        cpi_authority: ctx.accounts.cpi_authority.to_account_info(),
        caller_program: ctx.accounts.caller_program.to_account_info(),
        network_encryption_key: ctx.accounts.network_encryption_key.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        event_authority: ctx.accounts.event_authority.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        cpi_authority_bump,
    };

    let value_ct = ctx.accounts.value_ct.to_account_info();
    encrypt_ctx.increment_graph(value_ct.clone(), value_ct)?;

    Ok(())
}
``` 

Step by step:

  1. Build an `EncryptContext` with all the Encrypt program accounts. These are infrastructure accounts (config, deposit, CPI authority PDA, network encryption key, event authority). Every Encrypt CPI needs them.

  2. Call `encrypt_ctx.increment_graph(input, output)`. This method was generated by `#[encrypt_fn]`. It:

     * Serializes the graph bytes
     * Verifies the input ciphertext’s `fhe_type` matches `EUint64`
     * Builds an `execute_graph` CPI instruction
     * Invokes the Encrypt program
  3. The input and output are the **same account** (`value_ct`). This is an in-place update – the executor will overwrite the ciphertext with the computed result.

The `cpi_authority_bump` is the bump for the PDA `["__encrypt_cpi_authority"]` derived from your program ID. The Encrypt program uses this to verify the CPI came from an authorized program.

`decrement` is identical except it calls `encrypt_ctx.decrement_graph(...)`.

The Increment accounts struct shows the full set of accounts needed for any Encrypt CPI:

```rust
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut)]
    pub counter: Account<'info, Counter>,
    /// CHECK: Value ciphertext account
    #[account(mut)]
    pub value_ct: UncheckedAccount<'info>,
    /// CHECK: Encrypt program
    pub encrypt_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt config
    pub config: UncheckedAccount<'info>,
    /// CHECK: Encrypt deposit
    #[account(mut)]
    pub deposit: UncheckedAccount<'info>,
    /// CHECK: CPI authority PDA
    pub cpi_authority: UncheckedAccount<'info>,
    /// CHECK: Caller program
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: Network encryption key
    pub network_encryption_key: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Event authority PDA
    pub event_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
``` 

##### 6\. request_value_decryption

```rust
pub fn request_value_decryption(
    ctx: Context<RequestValueDecryption>,
    cpi_authority_bump: u8,
) -> Result<()> {
    let ctr = &ctx.accounts.counter;
    require!(
        ctr.authority == ctx.accounts.payer.key(),
        CounterError::Unauthorized
    );

    let encrypt_ctx = EncryptContext { /* ... same fields ... */ };

    let digest = encrypt_ctx.request_decryption(
        &ctx.accounts.request_acct.to_account_info(),
        &ctx.accounts.ciphertext.to_account_info(),
    )?;

    let ctr = &mut ctx.accounts.counter;
    ctr.pending_digest = digest;

    Ok(())
}
``` 

`request_decryption` does two things:

  1. Creates a `DecryptionRequest` account (keypair account, passed as a signer)
  2. Returns a `[u8; 32]` digest – a snapshot of the ciphertext’s current state

You **must** store this digest. It prevents stale-value attacks: if someone modifies the ciphertext between your request and the decryptor’s response, the digest won’t match and `reveal_value` will fail.

The decryption request account is a keypair account (not a PDA). The caller generates a fresh keypair and passes it as a signer. This avoids seed conflicts when making multiple decryption requests.

##### 7\. reveal_value

```rust
pub fn reveal_value(ctx: Context<RevealValue>) -> Result<()> {
    let ctr = &mut ctx.accounts.counter;
    require!(
        ctr.authority == ctx.accounts.authority.key(),
        CounterError::Unauthorized
    );

    let expected_digest = &ctr.pending_digest;

    let req_data = ctx.accounts.request_acct.try_borrow_data()?;
    use encrypt_types::encrypted::Uint64;
    let value = encrypt_anchor::accounts::read_decrypted_verified::<Uint64>(
        &req_data,
        expected_digest,
    )
    .map_err(|_| CounterError::DecryptionNotComplete)?;

    ctr.revealed_value = *value;
    Ok(())
}
``` 

`read_decrypted_verified::<Uint64>` does three checks:

  1. The decryption request is complete (decryptor has written the plaintext)
  2. The ciphertext digest in the request matches `expected_digest`
  3. The FHE type matches `Uint64` (the plaintext type corresponding to `EUint64`)

If all checks pass, it returns a reference to the plaintext value. The `Uint64` type parameter is the **plaintext** counterpart of `EUint64`.

The `RevealValue` accounts are minimal – no Encrypt CPI needed:

```rust
#[derive(Accounts)]
pub struct RevealValue<'info> {
    #[account(mut)]
    pub counter: Account<'info, Counter>,
    /// CHECK: Completed decryption request account
    pub request_acct: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
}
``` 

##### Error Codes

```rust
#[error_code]
pub enum CounterError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Decryption not complete")]
    DecryptionNotComplete,
}
```

---


### Example: PC-Token program

*Source: `docs.encrypt.xyz/examples/pc-token/02-program`*

#### PC-Token: Building the Program

##### Account Layouts

###### Mint

Follows P-Token’s COption pattern for optional authorities:

```rust
pub struct Mint {
    pub mint_authority_flag: [u8; 4],   // COption
    pub mint_authority: [u8; 32],
    pub decimals: u8,
    pub is_initialized: u8,
    pub freeze_authority_flag: [u8; 4], // COption
    pub freeze_authority: [u8; 32],
    pub bump: u8,
}
``` 

###### TokenAccount

No plaintext fields. Balance is always encrypted:

```rust
pub struct TokenAccount {
    pub mint: [u8; 32],
    pub owner: [u8; 32],
    pub balance: EUint64,              // encrypted balance
    pub delegate_flag: [u8; 4],        // COption
    pub delegate: [u8; 32],
    pub state: u8,                     // Uninitialized/Initialized/Frozen
    pub allowance: EUint64,            // encrypted delegate allowance
    pub close_authority_flag: [u8; 4], // COption
    pub close_authority: [u8; 32],
    pub bump: u8,
}
``` 

##### FHE Graphs

###### Transfer (conditional)

```rust
#[encrypt_fn]
fn transfer_graph(
    from_balance: EUint64, to_balance: EUint64, amount: EUint64,
) -> (EUint64, EUint64) {
    let sufficient = from_balance >= amount;
    let new_from = if sufficient { from_balance - amount } else { from_balance };
    let new_to = if sufficient { to_balance + amount } else { to_balance };
    (new_from, new_to)
}
``` 

If the sender has insufficient funds, both balances remain unchanged — a privacy-preserving silent no-op. The chain cannot distinguish success from failure.

###### Delegated Transfer (composability)

```rust
#[encrypt_fn]
fn transfer_from_graph(
    from_balance: EUint64, to_balance: EUint64,
    allowance: EUint64, amount: EUint64,
) -> (EUint64, EUint64, EUint64) {
    let sufficient_balance = from_balance >= amount;
    let sufficient_allowance = allowance >= amount;
    let can_transfer = sufficient_balance & sufficient_allowance;
    // if either check fails → no-op
    let new_from = if can_transfer { from_balance - amount } else { from_balance };
    let new_to = if can_transfer { to_balance + amount } else { to_balance };
    let new_allowance = if can_transfer { allowance - amount } else { allowance };
    (new_from, new_to, new_allowance)
}
``` 

Both balance AND allowance are checked atomically in the encrypted domain.

##### Wrap / Unwrap

###### Wrap (SPL → pcToken)

  1. SPL transfer from user to vault (plaintext — the deposit is visible)
  2. `mint_to_graph(balance, amount)` adds to encrypted balance
  3. Amount ciphertext pre-created via gRPC (not `create_plaintext_typed`)

###### Unwrap (pcToken → SPL)

Three-step flow that only reveals the withdrawal amount:

  1. **UnwrapBurn** — `unwrap_burn_graph(balance, amount) → (new_balance, burned)`. `burned` = amount if sufficient, 0 if not. Creates a temporary `WithdrawalReceipt`.
  2. **UnwrapDecrypt** — requests decryption of `burned` ciphertext.
  3. **UnwrapComplete** — verifies `burned == requested_amount`. If yes → SPL transfer from vault. If no → no-op. Closes receipt.

The balance is never decrypted. Only the withdrawal amount appears on the temporary receipt.

---


### Example: Voting program

*Source: `docs.encrypt.xyz/examples/voting/02-program`*

#### Building the Voting Program

Step-by-step guide to the Anchor on-chain program.

##### What you’ll learn

  * How to define an FHE graph with conditional logic (if/else compiles to Select)
  * Proposal state with encrypted counters
  * Update-mode ciphertexts (same account as input and output)
  * VoteRecord PDA for double-vote prevention
  * The decrypt-then-reveal pattern for tallies

##### 1\. The cast_vote graph

```rust
use encrypt_dsl::prelude::encrypt_fn;
use encrypt_types::encrypted::{EBool, EUint64};

#[encrypt_fn]
fn cast_vote_graph(
    yes_count: EUint64,
    no_count: EUint64,
    vote: EBool,
) -> (EUint64, EUint64) {
    let new_yes = if vote { yes_count + 1 } else { yes_count };
    let new_no = if vote { no_count } else { no_count + 1 };
    (new_yes, new_no)
}
``` 

This graph takes three encrypted inputs and produces two encrypted outputs:

  * `yes_count` / `no_count` – current encrypted tallies (EUint64)
  * `vote` – the voter’s encrypted choice (EBool: true = yes, false = no)

The `if vote { ... } else { ... }` syntax compiles to a `Select` operation in the FHE graph. Select is a ternary: `Select(condition, if_true, if_false)`. The executor evaluates this homomorphically – it never learns whether the voter chose yes or no.

The graph returns a tuple `(new_yes, new_no)`. If vote = true, `new_yes = yes_count + 1` and `new_no = no_count` (unchanged). If vote = false, the reverse.

`#[encrypt_fn]` generates a `CastVoteGraphCpi` trait with a `cast_vote_graph()` method on `EncryptContext`. The method takes 3 input accounts and 2 output accounts.

##### 2\. Proposal state

```rust
#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub authority: Pubkey,            // who can close + reveal
    pub proposal_id: [u8; 32],
    pub yes_count: [u8; 32],         // ciphertext account pubkey
    pub no_count: [u8; 32],          // ciphertext account pubkey
    pub is_open: bool,
    pub total_votes: u64,            // plaintext counter (for UI)
    pub revealed_yes: u64,           // written at reveal time
    pub revealed_no: u64,            // written at reveal time
    pub pending_yes_digest: [u8; 32],
    pub pending_no_digest: [u8; 32],
    pub bump: u8,
}
``` 

`yes_count` and `no_count` store ciphertext account pubkeys. These are the encrypted counters that get updated with every vote. `pending_yes_digest` and `pending_no_digest` are set when decryption is requested, used to verify the reveal.

```rust
#[account]
#[derive(InitSpace)]
pub struct VoteRecord {
    pub voter: Pubkey,
    pub bump: u8,
}
``` 

VoteRecord is a PDA derived from `["vote", proposal_id, voter_pubkey]`. If it already exists, Anchor’s `init` constraint fails, preventing double votes.

##### 3\. create_proposal – initialize encrypted zero counters

```rust
pub fn create_proposal(
    ctx: Context<CreateProposal>,
    proposal_id: [u8; 32],
    initial_yes_id: [u8; 32],
    initial_no_id: [u8; 32],
) -> Result<()> {
    let prop = &mut ctx.accounts.proposal;
    prop.authority = ctx.accounts.authority.key();
    prop.proposal_id = proposal_id;
    prop.yes_count = initial_yes_id;
    prop.no_count = initial_no_id;
    prop.is_open = true;
    prop.total_votes = 0;
    prop.bump = ctx.bumps.proposal;
    Ok(())
}
``` 

The `initial_yes_id` and `initial_no_id` are ciphertext accounts pre-created with `create_plaintext_typed::<Uint64>(0)`. They start as encrypted zeros. The frontend creates these keypair accounts and passes their pubkeys.

Account validation:

```rust
#[derive(Accounts)]
#[instruction(proposal_id: [u8; 32])]
pub struct CreateProposal<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [b"proposal", proposal_id.as_ref()],
        bump,
    )]
    pub proposal: Account<'info, Proposal>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
``` 

##### 4\. cast_vote – encrypted vote with update-mode ciphertexts

```rust
pub fn cast_vote(
    ctx: Context<CastVote>,
    cpi_authority_bump: u8,
) -> Result<()> {
    let prop = &ctx.accounts.proposal;
    require!(prop.is_open, VotingError::ProposalClosed);

    let encrypt_ctx = EncryptContext {
        encrypt_program: ctx.accounts.encrypt_program.to_account_info(),
        config: ctx.accounts.config.to_account_info(),
        deposit: ctx.accounts.deposit.to_account_info(),
        cpi_authority: ctx.accounts.cpi_authority.to_account_info(),
        caller_program: ctx.accounts.caller_program.to_account_info(),
        network_encryption_key: ctx.accounts.network_encryption_key.to_account_info(),
        payer: ctx.accounts.payer.to_account_info(),
        event_authority: ctx.accounts.event_authority.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
        cpi_authority_bump,
    };

    let yes_ct = ctx.accounts.yes_ct.to_account_info();
    let no_ct = ctx.accounts.no_ct.to_account_info();
    let vote_ct = ctx.accounts.vote_ct.to_account_info();
    encrypt_ctx.cast_vote_graph(
        yes_ct.clone(), no_ct.clone(), vote_ct,
        yes_ct, no_ct,
    )?;

    let prop = &mut ctx.accounts.proposal;
    prop.total_votes += 1;

    let vr = &mut ctx.accounts.vote_record;
    vr.voter = ctx.accounts.voter.key();
    vr.bump = ctx.bumps.vote_record;

    Ok(())
}
``` 

**Update mode:** Notice that `yes_ct` and `no_ct` appear as both inputs and outputs:

```rust
encrypt_ctx.cast_vote_graph(
    yes_ct.clone(), no_ct.clone(), vote_ct,  // inputs: yes, no, vote
    yes_ct, no_ct,                            // outputs: yes, no
)?;
``` 

The same ciphertext accounts are read (current tally) and written (new tally). The executor reads the current encrypted value, computes the graph, and writes the result back to the same account. This avoids creating new ciphertext accounts for every vote.

**The vote ciphertext** (`vote_ct`) is created before this instruction. The browser encrypts the vote locally via `encryptValue()` and sends the ciphertext directly to the executor via gRPC-Web `createInput`. It’s an encrypted boolean authorized to the voting program.

**Double-vote prevention:** The `vote_record` account uses Anchor’s `init` constraint:

```rust
#[account(
    init,
    payer = payer,
    space = 8 + VoteRecord::INIT_SPACE,
    seeds = [b"vote", proposal.proposal_id.as_ref(), voter.key().as_ref()],
    bump,
)]
pub vote_record: Account<'info, VoteRecord>,
``` 

If the voter has already voted on this proposal, the PDA already exists and `init` fails. Simple and gas-efficient.

##### 5\. close_proposal – lock voting

```rust
pub fn close_proposal(ctx: Context<CloseProposal>) -> Result<()> {
    let prop = &mut ctx.accounts.proposal;
    require!(
        prop.authority == ctx.accounts.authority.key(),
        VotingError::Unauthorized
    );
    require!(prop.is_open, VotingError::ProposalClosed);
    prop.is_open = false;
    Ok(())
}
``` 

Only the authority can close. After closing, no more votes can be cast (the `cast_vote` guard checks `is_open`). Decryption can only be requested after closing.

##### 6\. request_tally_decryption – two separate requests

```rust
pub fn request_tally_decryption(
    ctx: Context<RequestTallyDecryption>,
    is_yes: bool,
    cpi_authority_bump: u8,
) -> Result<()> {
    let prop = &ctx.accounts.proposal;
    require!(!prop.is_open, VotingError::ProposalStillOpen);

    let encrypt_ctx = EncryptContext { /* ... */ };

    let digest = encrypt_ctx.request_decryption(
        &ctx.accounts.request_acct.to_account_info(),
        &ctx.accounts.ciphertext.to_account_info(),
    )?;

    let prop = &mut ctx.accounts.proposal;
    if is_yes {
        prop.pending_yes_digest = digest;
    } else {
        prop.pending_no_digest = digest;
    }
    Ok(())
}
``` 

Each ciphertext (yes_count, no_count) needs its own decryption request. The `is_yes` flag determines which digest to store. You call this instruction twice – once for yes, once for no.

The `request_acct` is a fresh keypair account that the decryptor network will write the plaintext into.

##### 7\. reveal_tally – read decrypted values

```rust
pub fn reveal_tally(ctx: Context<RevealTally>, is_yes: bool) -> Result<()> {
    let prop = &mut ctx.accounts.proposal;
    require!(
        prop.authority == ctx.accounts.authority.key(),
        VotingError::Unauthorized
    );
    require!(!prop.is_open, VotingError::ProposalStillOpen);

    let expected_digest = if is_yes {
        &prop.pending_yes_digest
    } else {
        &prop.pending_no_digest
    };

    let req_data = ctx.accounts.request_acct.try_borrow_data()?;
    use encrypt_types::encrypted::Uint64;
    let value = encrypt_anchor::accounts::read_decrypted_verified::<Uint64>(
        &req_data, expected_digest,
    ).map_err(|_| VotingError::DecryptionNotComplete)?;

    if is_yes {
        prop.revealed_yes = *value;
    } else {
        prop.revealed_no = *value;
    }
    Ok(())
}
``` 

`read_decrypted_verified` checks that the decrypted value’s digest matches what was stored at request time. This prevents reading stale or tampered values. Called twice – once for yes, once for no. Only the authority can reveal.

##### Instruction summary

Disc| Instruction| Who| When  
---|---|---|---  
0| `create_proposal`| Authority| Start – creates encrypted zero counters  
1| `cast_vote`| Any voter| While open – encrypted vote, graph updates counters  
2| `close_proposal`| Authority| After voting ends – locks further votes  
3| `request_tally_decryption`| Anyone| After close – one call per counter (yes/no)  
4| `reveal_tally`| Authority| After decryption – writes plaintext to proposal

---


## Raw references

### URLs successfully fetched (all HTTP 200, `https://docs.encrypt.xyz`, 57 pages — mdBook)
- `introduction.html`
- `getting-started/{installation, quick-start, concepts}.html`
- `tutorial/{overview, create-program, fhe-logic, create-proposal, cast-votes, decrypt-results, testing}.html`
- `dsl/{overview, types, operations, constants, conditionals, vectors, graph-compilation}.html`
- `on-chain/{access-control, ciphertexts, cpi-framework, decryption, execute-graph}.html`
- `reference/{accounts, events, fees, instructions}.html`
- `testing/{mock-vs-real, test-framework}.html`
- `frameworks/{anchor, native, pinocchio, quasar}.html`
- `examples/overview.html`
- `examples/counter/{01-overview, 02-program, 03-testing, 04-react}.html`
- `examples/voting/{01-overview, 02-program, 03-testing, 04-react, 05-e2e}.html`
- `examples/coin-flip/{01-overview, 02-program, 03-betting, 04-testing, 05-react}.html`
- `examples/pc-token/{01-overview, 02-program, 03-testing}.html`
- `examples/pc-swap/{01-overview, 02-program, 03-testing}.html`
- `examples/acl/{01-overview, 02-program, 03-testing}.html`

Not included above (trimmed for size — raw extracted markdown lives in the workspace at `/tmp/docs/encrypt_md/`):
- Step-by-step tutorial pages (most of the tutorial is a redux of quick-start + DSL ref + voting example).
- React front-end snippets for each example (we kept program code, dropped UI code).
- Testing walkthroughs for each individual example (we kept the generic test framework page).

### Known limitations

- **`testing/mock-vs-real.md` is a one-paragraph stub upstream.** Included for completeness.
- **All code-block language tags come from upstream `language-*` CSS classes** (mdBook HTML preserves them faithfully), so `rust`, `typescript`, `bash`, `json`, `toml` fences are accurate.
- **Pre-Alpha Disclaimer was de-duplicated** — it appears once at the top of this file instead of on every page.
- **Headings demoted by three levels** so every vendored page sits under a single `###` section in this file.
- **No real encryption is happening at fetch time** — this is explicitly a pre-alpha; anything about key material, ciphertext commitments, or threshold-decryptor authentication is a placeholder and will change.
- **Task-spec-suggested URLs that returned 404** (the real doc structure is different — this is an mdBook, not Mintlify):
  - `/overview`, `/core-concepts/refhe`, `/core-concepts/threshold-decryption`, `/fhe-types`, `/on-chain-primitives`, `/client-sdk`, `/client-sdk/typescript`, `/solana-integration`, `/examples`, `/confidential-programs`.
  - Equivalent real URLs: `introduction.html`, `getting-started/concepts.html`, `on-chain/decryption.html`, `dsl/types.html`, `on-chain/{ciphertexts,execute-graph,access-control}.html`, `frameworks/quasar.html` (no TypeScript-only SDK page — the TS surface is discussed inside each example's `0?-react.html`), `examples/overview.html`.

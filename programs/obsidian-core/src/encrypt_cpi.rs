//! Encrypt-network CPI adapter — **P2 scaffold**.
//!
//! The real Encrypt API (per docs/vendor/encrypt-pre-alpha.md) has a very
//! different shape than the `enc_xor / enc_gte / enc_min` primitives sketched
//! in docs/ARCHITECTURE.md §5.2:
//!
//!   - Ciphertexts are 100-byte keypair accounts owned by the Encrypt program;
//!     the account pubkey IS the ciphertext identifier (doc §Reference: Accounts).
//!   - All FHE ops go through a single `execute_graph` CPI, with graphs
//!     produced by compiling `#[encrypt_fn]` Rust DSL (doc §execute_graph,
//!     §CPI framework).
//!   - Decryption is async: `request_decryption(request_acct, ciphertext)`
//!     returns a digest; an off-chain decryptor responds later; the program
//!     later reads the result via `read_decrypted_verified`
//!     (doc §Decryption flow).
//!
//! docs/PROMPTS.md P2 explicitly asks for `Vec<u8>` ciphertext fields stored
//! inline in `EncryptedOrder`, plus the named wrappers below. To honor both:
//!
//!   - This module preserves the API SHAPE the prompt describes.
//!   - Bodies are deterministic placeholders so the program and its tests
//!     run end-to-end without the Encrypt program actually being deployed.
//!   - P3 replaces the bodies with real CPI calls and refactors
//!     `EncryptedOrder` to reference Encrypt keypair-account ciphertexts
//!     by Pubkey.
//!
//! See `docs/gaps.md` for the full list of vendor-SDK adaptations.

use crate::state::CT_MAX;

/// Fixed-length placeholder ciphertext. 100 bytes = real Ciphertext account
/// size per Encrypt's Reference: Accounts §Ciphertext (disc 6).
const PLACEHOLDER_CT_LEN: usize = 100;

fn placeholder_ct() -> Vec<u8> {
    vec![0u8; PLACEHOLDER_CT_LEN]
}

fn check_len(ct: &[u8]) -> bool {
    ct.len() <= CT_MAX
}

/// FHE: are the two side ciphertexts opposite (one bid, one ask)?
/// Real impl: `execute_graph` of a 1-bit XOR DSL function.
pub fn enc_opp_sides(a_side_ct: &[u8], b_side_ct: &[u8]) -> Vec<u8> {
    debug_assert!(check_len(a_side_ct) && check_len(b_side_ct));
    placeholder_ct()
}

/// FHE: does `bid_price >= ask_price`?
/// Real impl: `execute_graph` of an EUint64 `>=` DSL function.
pub fn enc_price_crosses(a_price_ct: &[u8], b_price_ct: &[u8]) -> Vec<u8> {
    debug_assert!(check_len(a_price_ct) && check_len(b_price_ct));
    placeholder_ct()
}

/// FHE: `min(a_size, b_size)`.
/// Real impl: `execute_graph` of `.min()` on EUint64 (doc §FHE Operations).
pub fn enc_fill(a_size_ct: &[u8], b_size_ct: &[u8]) -> Vec<u8> {
    debug_assert!(check_len(a_size_ct) && check_len(b_size_ct));
    placeholder_ct()
}

/// Composed `can_match`: `opp_sides AND price_crosses`. Real impl would be
/// produced by a single DSL graph that chains the three comparisons.
pub fn enc_can_match(opp_sides_ct: &[u8], price_crosses_ct: &[u8]) -> Vec<u8> {
    debug_assert!(check_len(opp_sides_ct) && check_len(price_crosses_ct));
    placeholder_ct()
}

/// Mock result of the async `request_decryption` → response → read flow.
/// P3 wires the real pattern (see doc §Decryption flow).
pub struct MockDecryptResponse {
    /// 1 = FHE comparator said the orders match, 0 = rejected.
    pub can_match: u64,
    /// Decrypted fill size in satoshis.
    pub fill_size: u64,
    /// Decrypted clearing price in the market's quote units (USDC × 1e6).
    pub clearing_price: u64,
}

/// P2 mock: always returns a successful decrypt so the test path proceeds.
/// Deterministic values so tests are reproducible.
pub fn request_threshold_decrypt(
    can_match_ct: &[u8],
    fill_size_ct: &[u8],
    clearing_price_ct: &[u8],
) -> MockDecryptResponse {
    debug_assert!(check_len(can_match_ct));
    debug_assert!(check_len(fill_size_ct));
    debug_assert!(check_len(clearing_price_ct));
    MockDecryptResponse {
        can_match: 1,
        // 0.1 BTC in satoshis = 10_000_000 (mock fill size for tests).
        fill_size: 10_000_000,
        // $69,750.00 USDC scaled by 1e6 (mock clearing price for tests).
        clearing_price: 69_750_000_000,
    }
}

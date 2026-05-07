//! Encrypt-network on-chain integration.
//!
//! Closes gaps E3 (async decrypt) and E4 (one DecryptionRequest per ciphertext)
//! from `docs/gaps.md`. Gap E1 (ciphertext-account references) is closed in
//! `state.rs` — the program now stores 32-byte ciphertext identifiers instead
//! of inline `Vec<u8>` blobs.
//!
//! What's NOT yet closed: gap E2 (real `execute_graph` CPI for FHE matching).
//! That requires the upstream `encrypt-anchor` crate, which targets
//! `anchor-lang = 1` + `edition = 2024` while ObsidianDesk is on
//! `anchor-lang = 0.32.1` + `edition = 2021`. The mock match path below
//! produces deterministic output ciphertext identifiers so the rest of the
//! flow works against real on-chain Encrypt accounts produced by the
//! gRPC `createInput` path.

use anchor_lang::prelude::*;

/// Encrypt program id on Solana devnet
/// (per `docs/vendor/encrypt-pre-alpha.md` §Pre-Alpha Environment).
pub const ENCRYPT_PROGRAM_ID: Pubkey =
    pubkey!("4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8");

/// CPI authority PDA seed used by Encrypt's CPI framework.
/// Mirrors `encrypt_anchor::CPI_AUTHORITY_SEED` from
/// `chains/solana/program-sdk/anchor/src/lib.rs`.
pub const CPI_AUTHORITY_SEED: &[u8] = b"__encrypt_cpi_authority";

/// Encrypt program instruction discriminators (per
/// `chains/solana/program-sdk/anchor/src/lib.rs`).
pub const IX_REQUEST_DECRYPTION: u8 = 11;
pub const IX_CLOSE_DECRYPTION_REQUEST: u8 = 13;

// ── Ciphertext-account layout offsets ──
//
// Vendored from `encrypt-pre-alpha`/chains/solana/program-sdk/types/src/accounts.rs
// to avoid pulling the full `encrypt-types` workspace (which targets
// edition 2024 / anchor-lang 1) into this 0.32 program.
//
// Ciphertext account layout (after 2-byte disc+ver prefix):
//   ciphertext_digest(32) authorized(32) network_encryption_public_key(32)
//   fhe_type(1) status(1)
pub const CT_CIPHERTEXT_DIGEST: usize = 2;
pub const CT_FHE_TYPE: usize = 98; // 2 + 32 + 32 + 32
pub const CT_LEN: usize = 100; // 2 + 98

// DecryptionRequest header layout (after 2-byte disc+ver prefix):
//   ciphertext(32) ciphertext_digest(32) requester(32)
//   fhe_type(1) total_len(4) bytes_written(4)
pub const DR_CIPHERTEXT_DIGEST: usize = 34; // 2 + 32
pub const DR_FHE_TYPE: usize = 98;
pub const DR_TOTAL_LEN: usize = 99;
pub const DR_BYTES_WRITTEN: usize = 103;
pub const DR_HEADER_END: usize = 107; // 2 + 105

/// Read `ciphertext_digest` from a Ciphertext account's data buffer.
/// Returns None if the buffer is too short to be a valid ciphertext.
pub fn parse_ciphertext_digest(data: &[u8]) -> Option<[u8; 32]> {
    if data.len() < CT_LEN {
        return None;
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&data[CT_CIPHERTEXT_DIGEST..CT_CIPHERTEXT_DIGEST + 32]);
    Some(out)
}

/// Read the `fhe_type` byte from a Ciphertext account.
pub fn parse_ciphertext_fhe_type(data: &[u8]) -> Option<u8> {
    if data.len() < CT_LEN {
        return None;
    }
    Some(data[CT_FHE_TYPE])
}

/// Returns the decrypted plaintext bytes if the DecryptionRequest is
/// `Complete` AND its stored ciphertext_digest matches `expected_digest`
/// (binding check — closes the digest-replay class of issues).
pub fn read_decrypted_verified(
    request_data: &[u8],
    expected_digest: &[u8; 32],
) -> Option<Vec<u8>> {
    if request_data.len() < DR_HEADER_END {
        return None;
    }
    // Verify the request's stored digest matches what we snapshotted.
    let req_digest = &request_data[DR_CIPHERTEXT_DIGEST..DR_CIPHERTEXT_DIGEST + 32];
    if req_digest != expected_digest {
        return None;
    }
    let total = u32::from_le_bytes(
        request_data[DR_TOTAL_LEN..DR_TOTAL_LEN + 4].try_into().ok()?,
    );
    let written = u32::from_le_bytes(
        request_data[DR_BYTES_WRITTEN..DR_BYTES_WRITTEN + 4].try_into().ok()?,
    );
    if written < total || total == 0 {
        return None;
    }
    let end = DR_HEADER_END + total as usize;
    if request_data.len() < end {
        return None;
    }
    Some(request_data[DR_HEADER_END..end].to_vec())
}

/// FHE type discriminator constants (per Encrypt vendor docs §FHE Types).
pub const FHE_TYPE_EBOOL: u8 = 0;
pub const FHE_TYPE_EUINT64: u8 = 4;

/// Decode a u64 plaintext from a `Complete` DecryptionRequest payload.
/// Encrypt encodes EUint64 as 8 bytes little-endian.
pub fn decode_u64(plaintext: &[u8]) -> Option<u64> {
    if plaintext.len() < 8 {
        return None;
    }
    Some(u64::from_le_bytes(plaintext[..8].try_into().ok()?))
}

/// Decode a bool plaintext from a `Complete` DecryptionRequest payload.
/// Encrypt encodes EBool as a single byte (0 = false, 1 = true).
pub fn decode_bool(plaintext: &[u8]) -> Option<bool> {
    plaintext.first().map(|b| *b != 0)
}

// Match-output ciphertext identifiers are produced off-chain by the keeper
// via gRPC `createInput` (see `keeper/src/match-graph.ts`) and supplied to
// `try_match` as instruction args. Real Encrypt would produce these via
// `execute_graph` CPI from inside the program — that's gap E2.

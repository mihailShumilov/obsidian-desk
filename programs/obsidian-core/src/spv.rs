//! Bitcoin SPV merkle-inclusion verification — gap I3 closure (proof side).
//!
//! `finalize_settlement` accepts an SPV proof blob and verifies that the
//! claimed `btc_txid` is committed to the merkle root of the header. This
//! catches the trivial attack where a keeper submits a fake txid: any txid
//! not actually in the block fails the merkle walk.
//!
//! Proof blob format:
//!     [0..80]              block header (80 bytes)
//!     [80..81+L]           varint N — number of merkle siblings
//!     [81+L..81+L+N*33]    N * (sibling: 32 bytes || direction: 1 byte)
//!
//! `direction` byte: 0 = sibling is on the right (current is the left child),
//!                   1 = sibling is on the left (current is the right child).
//!
//! Bitcoin uses double-SHA256 internally; we implement that via Solana's
//! sha256 syscall (`solana_program::hash::hashv`).
//!
//! What this verifier does:
//!  - parses the proof blob and walks the merkle path
//!  - hashes the 80-byte header to a block_hash for events / audit trails
//!  - confirms `merkle_walk(txid, siblings) == header.merkle_root`
//!
//! What this verifier does NOT do (yet — residual gap I3 follow-up):
//!  - verify the header's proof-of-work meets the target encoded in `bits`
//!  - verify the header chains from a trusted checkpoint stored on-chain
//!
//! Both follow-ups would close "the keeper submitted a header it just made up
//! that happens to commit to a real txid". Today the keeper-authority gate
//! still bounds who can call finalize_settlement at all.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

/// 80-byte Bitcoin block header.
pub const HEADER_LEN: usize = 80;

/// Offset of the merkle root within the block header (bytes 36..68).
pub const HEADER_MERKLE_ROOT_OFFSET: usize = 36;

/// Bitcoin double-SHA256 — Solana's `hashv` is single-SHA256, so we chain.
fn sha256d(data: &[u8]) -> [u8; 32] {
    let first = hashv(&[data]).to_bytes();
    hashv(&[&first]).to_bytes()
}

/// Read a Bitcoin-style varint from `data[start..]`. Returns `(value, bytes_read)`
/// or `None` if the buffer is too short / malformed.
fn read_varint(data: &[u8], start: usize) -> Option<(u64, usize)> {
    if start >= data.len() {
        return None;
    }
    let prefix = data[start];
    match prefix {
        0..=0xfc => Some((prefix as u64, 1)),
        0xfd => {
            if start + 3 > data.len() {
                return None;
            }
            let v = u16::from_le_bytes([data[start + 1], data[start + 2]]) as u64;
            Some((v, 3))
        }
        0xfe => {
            if start + 5 > data.len() {
                return None;
            }
            let v = u32::from_le_bytes([
                data[start + 1], data[start + 2], data[start + 3], data[start + 4],
            ]) as u64;
            Some((v, 5))
        }
        0xff => {
            if start + 9 > data.len() {
                return None;
            }
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(&data[start + 1..start + 9]);
            Some((u64::from_le_bytes(bytes), 9))
        }
    }
}

/// Outcome of a successful SPV verification.
pub struct SpvVerifiedTx {
    /// Double-SHA256 of the 80-byte header. Big-endian byte order is what
    /// Bitcoin explorers display; we keep it little-endian here (the natural
    /// hash-output direction) — callers that want to render or compare
    /// against an explorer hash should reverse.
    pub block_hash: [u8; 32],
    /// Number of merkle steps walked to reach the root. Useful for sanity
    /// checks — Bitcoin block trees are typically 11–13 levels deep.
    pub merkle_depth: u32,
}

/// Verify that `txid` is committed to the merkle root inside the block
/// header at the start of `proof_blob`. `txid` MUST be in little-endian
/// byte order (the format Bitcoin uses internally; reverse from explorer
/// display).
///
/// Returns `Ok(SpvVerifiedTx)` on success; `Err(ProgramError)` on any
/// parse / merkle / size failure. The caller (`finalize_settlement`)
/// converts to its `ErrorCode::BtcProofInvalid` when needed.
pub fn verify_merkle_inclusion(txid: &[u8; 32], proof_blob: &[u8]) -> Result<SpvVerifiedTx> {
    require!(
        proof_blob.len() >= HEADER_LEN + 1,
        crate::errors::ErrorCode::BtcProofInvalid
    );

    let header: &[u8] = &proof_blob[..HEADER_LEN];
    let merkle_root: [u8; 32] = header[HEADER_MERKLE_ROOT_OFFSET..HEADER_MERKLE_ROOT_OFFSET + 32]
        .try_into()
        .map_err(|_| crate::errors::ErrorCode::BtcProofInvalid)?;
    let block_hash = sha256d(header);

    let (n_siblings, varint_len) = read_varint(proof_blob, HEADER_LEN)
        .ok_or(crate::errors::ErrorCode::BtcProofInvalid)?;
    let path_start = HEADER_LEN + varint_len;
    let path_end = path_start
        .checked_add((n_siblings as usize).saturating_mul(33))
        .ok_or(crate::errors::ErrorCode::BtcProofInvalid)?;
    require!(
        proof_blob.len() == path_end,
        crate::errors::ErrorCode::BtcProofInvalid
    );

    let mut current: [u8; 32] = *txid;
    for i in 0..(n_siblings as usize) {
        let off = path_start + i * 33;
        let sibling: [u8; 32] = proof_blob[off..off + 32]
            .try_into()
            .map_err(|_| crate::errors::ErrorCode::BtcProofInvalid)?;
        let direction = proof_blob[off + 32];
        let combined: [u8; 64] = if direction == 0 {
            // sibling on the right
            let mut buf = [0u8; 64];
            buf[..32].copy_from_slice(&current);
            buf[32..].copy_from_slice(&sibling);
            buf
        } else if direction == 1 {
            // sibling on the left
            let mut buf = [0u8; 64];
            buf[..32].copy_from_slice(&sibling);
            buf[32..].copy_from_slice(&current);
            buf
        } else {
            return Err(crate::errors::ErrorCode::BtcProofInvalid.into());
        };
        current = sha256d(&combined);
    }

    require!(
        current == merkle_root,
        crate::errors::ErrorCode::BtcProofInvalid
    );

    Ok(SpvVerifiedTx {
        block_hash,
        merkle_depth: n_siblings as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Single-element merkle tree — txid IS the merkle root, no siblings.
    /// Useful to confirm the verifier accepts the trivial case.
    #[test]
    fn single_tx_block_no_siblings() {
        let txid = [0xaau8; 32];
        let mut header = vec![0u8; HEADER_LEN];
        header[HEADER_MERKLE_ROOT_OFFSET..HEADER_MERKLE_ROOT_OFFSET + 32].copy_from_slice(&txid);
        let mut proof = header.clone();
        proof.push(0); // varint 0 — no siblings

        let r = verify_merkle_inclusion(&txid, &proof).unwrap();
        assert_eq!(r.merkle_depth, 0);
    }

    /// Two-tx block: tx0 and tx1, root = sha256d(tx0 || tx1). Verify with
    /// tx0 as the target and tx1 as the (right-side) sibling.
    #[test]
    fn two_tx_block_left_child() {
        let tx0 = [0x11u8; 32];
        let tx1 = [0x22u8; 32];
        let mut combined = [0u8; 64];
        combined[..32].copy_from_slice(&tx0);
        combined[32..].copy_from_slice(&tx1);
        let root = sha256d(&combined);

        let mut header = vec![0u8; HEADER_LEN];
        header[HEADER_MERKLE_ROOT_OFFSET..HEADER_MERKLE_ROOT_OFFSET + 32].copy_from_slice(&root);
        let mut proof = header.clone();
        proof.push(1); // varint 1
        proof.extend_from_slice(&tx1);
        proof.push(0); // direction: sibling on the right

        let r = verify_merkle_inclusion(&tx0, &proof).unwrap();
        assert_eq!(r.merkle_depth, 1);
    }

    #[test]
    fn rejects_wrong_root() {
        let tx0 = [0x11u8; 32];
        let tx1 = [0x22u8; 32];

        let mut header = vec![0u8; HEADER_LEN];
        // Stuff a non-matching merkle root.
        header[HEADER_MERKLE_ROOT_OFFSET..HEADER_MERKLE_ROOT_OFFSET + 32].copy_from_slice(&[0x99u8; 32]);
        let mut proof = header.clone();
        proof.push(1);
        proof.extend_from_slice(&tx1);
        proof.push(0);

        assert!(verify_merkle_inclusion(&tx0, &proof).is_err());
    }

    #[test]
    fn rejects_truncated_proof() {
        let tx0 = [0x11u8; 32];
        let mut proof = vec![0u8; HEADER_LEN];
        proof.push(2); // claims 2 siblings, but provides 0
        assert!(verify_merkle_inclusion(&tx0, &proof).is_err());
    }
}

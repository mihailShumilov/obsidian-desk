use anchor_lang::prelude::*;

#[event]
pub struct OrderSubmitted {
    pub market: Pubkey,
    pub order: Pubkey,
    pub owner: Pubkey,
    pub nonce: [u8; 16],
    pub expiry_slot: u64,
}

#[event]
pub struct OrderCancelled {
    pub market: Pubkey,
    pub order: Pubkey,
    pub owner: Pubkey,
}

/// Emitted after `try_match` writes a `MatchIntent` with encrypted
/// `can_match / fill_size / clearing_price`. A keeper sees this and calls
/// `request_settlement` to trigger the threshold decrypt.
#[event]
pub struct MatchProposed {
    pub market: Pubkey,
    pub match_intent: Pubkey,
    pub match_id: u64,
    pub order_a: Pubkey,
    pub order_b: Pubkey,
}

/// Emitted after `request_decryption` snapshots the three output ciphertext
/// digests onto MatchIntent. The keeper reads it, calls `readCiphertext`
/// gRPC for each, then submits `finalize_decryption` with the plaintexts.
/// Closes gaps E3 + E4.
#[event]
pub struct DecryptionRequested {
    pub market: Pubkey,
    pub match_intent: Pubkey,
    pub match_id: u64,
    pub can_match_digest: [u8; 32],
    pub fill_size_digest: [u8; 32],
    pub clearing_price_digest: [u8; 32],
}

/// Emitted after decryption confirms a match. The Ika keeper picks this up
/// and initiates the cross-chain dWallet signing flow.
#[event]
pub struct SettleReady {
    pub market: Pubkey,
    pub match_record: Pubkey,
    pub match_id: u64,
    pub fill_size_sats: u64,
    pub clearing_price_quote: u64,
    pub seller_dwallet: Pubkey,
    pub buyer_dwallet: Pubkey,
}

/// Emitted by `finalize_settlement` once the keeper reports a confirmed BTC
/// tx. `btc_tx_proof_len` is the byte length of the proof blob persisted
/// to the MatchRecord (we don't put the bytes themselves on the event to
/// keep log size bounded).
#[event]
pub struct SettleFinalized {
    pub market: Pubkey,
    pub match_record: Pubkey,
    pub match_id: u64,
    pub btc_tx_proof_len: u32,
}

/// Emitted when the keeper reports a settlement failure (timeout, refund
/// path, MPC failure, etc.). The MatchRecord is moved to `SettleFailed`
/// so the keeper can stop re-attempting.
#[event]
pub struct SettleFailedEvent {
    pub market: Pubkey,
    pub match_record: Pubkey,
    pub match_id: u64,
    pub reason_code: u16,
}

/// Emitted when a seller signs a `BtcSettleApproval` PDA — gap I4.
#[event]
pub struct BtcSettlementApproved {
    pub approval: Pubkey,
    pub approver: Pubkey,
    pub order: Pubkey,
    pub dwallet_id: Pubkey,
    pub max_amount_sats: u64,
    pub expiry_slot: u64,
}

/// Emitted when the keeper consumes a `BtcSettleApproval` at settle time.
/// `message_digest` is the BIP-143 sighash the keeper presented to the
/// Ika MPC network — auditable by anyone post-fact.
#[event]
pub struct BtcSettlementConsumed {
    pub approval: Pubkey,
    pub order: Pubkey,
    pub dwallet_id: Pubkey,
    pub message_digest: [u8; 32],
    pub output_amount_sats: u64,
    pub consumed_at_slot: u64,
}

use anchor_lang::prelude::*;

/// Singleton ciphertext slot in `MarketState`. No realloc-cap pressure here
/// because it's the only large field in the struct, so the prompt's 4096 fits.
pub const TOTAL_VOLUME_CT_MAX: usize = 4096;

/// Max size of a Bitcoin tx-proof blob persisted on `MatchRecord`. 1024 B
/// comfortably covers a confirmed signet tx hex + an SPV / merkle inclusion
/// stub for P9. Singleton on the account (no realloc-cap pressure).
pub const BTC_TX_PROOF_MAX: usize = 1024;

/// Orderbook depth ceiling for the hackathon MVP (ARCHITECTURE.md §8).
pub const MAX_ACTIVE_ORDERS: u8 = 16;

/// Length of an Encrypt Ciphertext keypair-account pubkey, used as the
/// on-wire identifier per `docs/vendor/encrypt-pre-alpha.md` §Reference: Accounts.
pub const CT_REF_LEN: usize = 32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum OrderStatus {
    Active,
    Matched,
    Cancelled,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SettleStatus {
    Pending,
    Settled,
    SettleFailed,
    Cancelled,
}

/// Per-market orderbook head + settlement refs (ARCHITECTURE.md §5.1).
#[account]
#[derive(InitSpace)]
pub struct MarketState {
    pub admin: Pubkey,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    /// Head of the `EncryptedOrder` linked list. `None` = book is empty.
    pub orderbook_head: Option<Pubkey>,
    pub settle_vault: Pubkey,
    pub ika_policy: Pubkey,
    /// The only signer permitted to call `finalize_settlement` /
    /// `fail_settlement`. Set at init by the admin; rotation requires
    /// admin to redeploy the market (no in-place setter).
    pub keeper_authority: Pubkey,
    /// Monotonic — incremented once per `try_match`. Also used as match-id source.
    pub match_count: u64,
    /// Best-effort count; incremented on submit, decremented on cancel / match.
    pub active_order_count: u8,
    pub bump: u8,
    /// Encrypted cumulative trading volume. Lives on-chain as an FHE
    /// ciphertext blob; never decrypted.
    #[max_len(TOTAL_VOLUME_CT_MAX)]
    pub total_volume_cipher: Vec<u8>,
}

/// Encrypted limit order. The three ciphertext fields hold **Encrypt
/// Ciphertext keypair-account identifiers** (32-byte pubkeys), not inline
/// blobs. See `docs/vendor/encrypt-pre-alpha.md` §Reference: Accounts and
/// `docs/gaps.md` E1 closure note.
#[account]
#[derive(InitSpace)]
pub struct EncryptedOrder {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub dwallet_id: Pubkey,
    /// Encrypt Ciphertext-account pubkey (FHE EBool: bid=0, ask=1).
    pub side_ct: [u8; CT_REF_LEN],
    /// Encrypt Ciphertext-account pubkey (FHE EUint64: price in quote units).
    pub price_ct: [u8; CT_REF_LEN],
    /// Encrypt Ciphertext-account pubkey (FHE EUint64: size in base units).
    pub size_ct: [u8; CT_REF_LEN],
    pub expiry_slot: u64,
    pub nonce: [u8; 16],
    pub next: Option<Pubkey>,
    pub status: OrderStatus,
    pub bump: u8,
}

/// Intermediate FHE artifact produced by `try_match`. Stores the three
/// ciphertext-account pubkeys for the FHE comparator outputs (can_match,
/// fill_size, clearing_price) plus their digests so the matching outputs
/// can be cryptographically bound to a later async decryption.
#[account]
#[derive(InitSpace)]
pub struct MatchIntent {
    pub market: Pubkey,
    pub match_id: u64,
    pub order_a: Pubkey,
    pub order_b: Pubkey,
    /// Output ciphertext-account pubkeys produced by the FHE comparator.
    pub can_match_ct: [u8; CT_REF_LEN],
    pub fill_size_ct: [u8; CT_REF_LEN],
    pub clearing_price_ct: [u8; CT_REF_LEN],
    /// Digests snapshotted at `request_decryption` time so `finalize_decryption`
    /// can verify the decryption response binds to the same ciphertext that
    /// was matched. Zero until request_decryption fires.
    pub can_match_digest: [u8; 32],
    pub fill_size_digest: [u8; 32],
    pub clearing_price_digest: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
}

/// Post-decrypt settlement record. Decrypted fill size + clearing price are
/// plaintext here because settlement (`finalize_settlement` in P9) needs to
/// pass exact amounts to the Ika dWallet signer.
#[account]
#[derive(InitSpace)]
pub struct MatchRecord {
    pub market: Pubkey,
    pub match_id: u64,
    pub order_a: Pubkey,
    pub order_b: Pubkey,
    pub seller_dwallet: Pubkey,
    pub buyer_dwallet: Pubkey,
    pub fill_size_decrypted: u64,
    pub clearing_price_decrypted: u64,
    pub settle_status: SettleStatus,
    pub created_at: i64,
    pub bump: u8,
    /// Set by `finalize_settlement` once the keeper has broadcast and
    /// confirmed the BTC tx. Empty until then.
    #[max_len(BTC_TX_PROOF_MAX)]
    pub btc_tx_proof: Vec<u8>,
    /// 0 until `finalize_settlement` runs.
    pub finalized_at: i64,
}

use anchor_lang::prelude::*;

/// Per-ciphertext cap for fields that share an account with 2+ other
/// ciphertexts (`EncryptedOrder`, `MatchIntent`).
///
/// Set to 3000 (not the prompt's nominal 4096) so the total account size
/// stays under Solana's 10 240-byte CPI realloc cap (`MAX_PERMITTED_DATA_INCREASE`).
/// 3 × 3000 + per-account overhead ≈ 9.2 KB. Once P3 swaps inline blobs for
/// 32-byte Pubkey references to Encrypt Ciphertext keypair accounts (gap E1
/// in `docs/gaps.md`), this cap becomes irrelevant.
pub const CT_MAX: usize = 3000;

/// Singleton ciphertext slot in `MarketState`. No realloc-cap pressure here
/// because it's the only large field in the struct, so the prompt's 4096 fits.
pub const TOTAL_VOLUME_CT_MAX: usize = 4096;

/// Orderbook depth ceiling for the hackathon MVP (ARCHITECTURE.md §8).
pub const MAX_ACTIVE_ORDERS: u8 = 16;

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

#[account]
#[derive(InitSpace)]
pub struct EncryptedOrder {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub dwallet_id: Pubkey,
    #[max_len(CT_MAX)]
    pub side_ct: Vec<u8>,
    #[max_len(CT_MAX)]
    pub price_ct: Vec<u8>,
    #[max_len(CT_MAX)]
    pub size_ct: Vec<u8>,
    pub expiry_slot: u64,
    pub nonce: [u8; 16],
    pub next: Option<Pubkey>,
    pub status: OrderStatus,
    pub bump: u8,
}

/// Intermediate FHE artifact produced by `try_match`. Holds the ciphertexts
/// for `can_match`, `fill_size`, `clearing_price` until `request_settlement`
/// asks the Encrypt network to threshold-decrypt them.
#[account]
#[derive(InitSpace)]
pub struct MatchIntent {
    pub market: Pubkey,
    pub match_id: u64,
    pub order_a: Pubkey,
    pub order_b: Pubkey,
    #[max_len(CT_MAX)]
    pub can_match_ct: Vec<u8>,
    #[max_len(CT_MAX)]
    pub fill_size_ct: Vec<u8>,
    #[max_len(CT_MAX)]
    pub clearing_price_ct: Vec<u8>,
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
}

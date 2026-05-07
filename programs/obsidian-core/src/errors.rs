use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Order has passed its expiry slot")]
    OrderExpired,
    #[msg("Order is not in Active status")]
    OrderNotActive,
    #[msg("Orderbook is at max capacity (MAX_ACTIVE_ORDERS)")]
    OrderbookFull,
    #[msg("Caller is not authorized for this operation")]
    Unauthorized,
    #[msg("An order cannot be matched against itself")]
    SelfMatch,
    #[msg("Ciphertext exceeds CT_MAX bytes")]
    CiphertextTooLarge,
    #[msg("FHE comparator did not authorize a match")]
    MatchRejected,
    #[msg("Both orders are on the same side (both bids or both asks)")]
    SameSide,
    #[msg("Provided match_id does not match market.match_count + 1")]
    InvalidMatchId,
    #[msg("Match has already been settled")]
    AlreadyMatched,
    #[msg("MatchRecord is not in Pending settle status")]
    SettleNotPending,
    #[msg("BTC tx proof exceeds BTC_TX_PROOF_MAX bytes")]
    BtcProofTooLarge,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}

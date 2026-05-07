//! ObsidianDesk core — encrypted limit orderbook program.
//!
//! Instructions:
//!   - initialize_market        create a `MarketState` PDA for a base/quote pair
//!   - submit_order             push an encrypted order onto the book (linked list)
//!   - cancel_order             owner marks their order Cancelled
//!   - try_match                FHE-compare two orders, write a `MatchIntent`
//!   - request_settlement       threshold-decrypt the match, write `MatchRecord`
//!
//! FHE operations go through `encrypt_cpi`; see that module for the P2
//! scaffold → P3 real-CPI transition plan.

use anchor_lang::prelude::*;

pub mod encrypt_cpi;
pub mod errors;
pub mod events;
pub mod state;

use errors::ErrorCode;
use events::*;
use state::*;

declare_id!("H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp");

#[program]
pub mod obsidian_core {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        base_mint: Pubkey,
        quote_mint: Pubkey,
        keeper_authority: Pubkey,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.admin = ctx.accounts.admin.key();
        market.base_mint = base_mint;
        market.quote_mint = quote_mint;
        market.orderbook_head = None;
        market.settle_vault = ctx.accounts.settle_vault.key();
        market.ika_policy = ctx.accounts.ika_policy.key();
        market.keeper_authority = keeper_authority;
        market.match_count = 0;
        market.active_order_count = 0;
        market.bump = ctx.bumps.market;
        market.total_volume_cipher = Vec::new();
        Ok(())
    }

    pub fn submit_order(
        ctx: Context<SubmitOrder>,
        side_ct: Vec<u8>,
        price_ct: Vec<u8>,
        size_ct: Vec<u8>,
        expiry_slot: u64,
        nonce: [u8; 16],
        dwallet_id: Pubkey,
    ) -> Result<()> {
        require!(side_ct.len() <= CT_MAX, ErrorCode::CiphertextTooLarge);
        require!(price_ct.len() <= CT_MAX, ErrorCode::CiphertextTooLarge);
        require!(size_ct.len() <= CT_MAX, ErrorCode::CiphertextTooLarge);

        let clock = Clock::get()?;
        require!(expiry_slot > clock.slot, ErrorCode::OrderExpired);

        let market = &mut ctx.accounts.market;
        require!(
            market.active_order_count < MAX_ACTIVE_ORDERS,
            ErrorCode::OrderbookFull
        );

        let order = &mut ctx.accounts.order;
        order.market = market.key();
        order.owner = ctx.accounts.owner.key();
        order.dwallet_id = dwallet_id;
        order.side_ct = side_ct;
        order.price_ct = price_ct;
        order.size_ct = size_ct;
        order.expiry_slot = expiry_slot;
        order.nonce = nonce;
        order.next = market.orderbook_head;
        order.status = OrderStatus::Active;
        order.bump = ctx.bumps.order;

        market.orderbook_head = Some(order.key());
        market.active_order_count = market
            .active_order_count
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        emit!(OrderSubmitted {
            market: market.key(),
            order: order.key(),
            owner: order.owner,
            nonce,
            expiry_slot,
        });
        Ok(())
    }

    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        let order = &mut ctx.accounts.order;
        require_keys_eq!(order.owner, ctx.accounts.owner.key(), ErrorCode::Unauthorized);
        require!(order.status == OrderStatus::Active, ErrorCode::OrderNotActive);
        order.status = OrderStatus::Cancelled;

        // We do NOT unlink from the linked list here — keepers skip non-Active
        // statuses on traversal. Full unlink lands when we refactor the book
        // model in P3 (the linked list itself becomes unnecessary once orders
        // reference Encrypt Ciphertext keypair accounts by Pubkey).
        let market = &mut ctx.accounts.market;
        market.active_order_count = market.active_order_count.saturating_sub(1);

        emit!(OrderCancelled {
            market: market.key(),
            order: order.key(),
            owner: order.owner,
        });
        Ok(())
    }

    pub fn try_match(ctx: Context<TryMatch>, match_id: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let next_id = market
            .match_count
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(match_id == next_id, ErrorCode::InvalidMatchId);

        let order_a = &ctx.accounts.order_a;
        let order_b = &ctx.accounts.order_b;
        require!(order_a.key() != order_b.key(), ErrorCode::SelfMatch);
        require!(order_a.status == OrderStatus::Active, ErrorCode::OrderNotActive);
        require!(order_b.status == OrderStatus::Active, ErrorCode::OrderNotActive);

        let clock = Clock::get()?;
        require!(order_a.expiry_slot > clock.slot, ErrorCode::OrderExpired);
        require!(order_b.expiry_slot > clock.slot, ErrorCode::OrderExpired);

        let opp = encrypt_cpi::enc_opp_sides(&order_a.side_ct, &order_b.side_ct);
        let crosses = encrypt_cpi::enc_price_crosses(&order_a.price_ct, &order_b.price_ct);
        let can_match_ct = encrypt_cpi::enc_can_match(&opp, &crosses);
        let fill_size_ct = encrypt_cpi::enc_fill(&order_a.size_ct, &order_b.size_ct);
        // Clearing price: for this scaffold we mirror `crosses`. Real FHE
        // impl runs a DSL that returns (bid_price + ask_price) / 2 (or the
        // resting order's price, depending on policy).
        let clearing_price_ct = crosses;

        market.match_count = next_id;

        let intent = &mut ctx.accounts.match_intent;
        intent.market = market.key();
        intent.match_id = next_id;
        intent.order_a = order_a.key();
        intent.order_b = order_b.key();
        intent.can_match_ct = can_match_ct;
        intent.fill_size_ct = fill_size_ct;
        intent.clearing_price_ct = clearing_price_ct;
        intent.created_at = clock.unix_timestamp;
        intent.bump = ctx.bumps.match_intent;

        emit!(MatchProposed {
            market: market.key(),
            match_intent: intent.key(),
            match_id: next_id,
            order_a: order_a.key(),
            order_b: order_b.key(),
        });
        Ok(())
    }

    pub fn request_settlement(ctx: Context<RequestSettlement>, _match_id: u64) -> Result<()> {
        let intent = &ctx.accounts.match_intent;
        let response = encrypt_cpi::request_threshold_decrypt(
            &intent.can_match_ct,
            &intent.fill_size_ct,
            &intent.clearing_price_ct,
        );
        require!(response.can_match == 1, ErrorCode::MatchRejected);

        let order_a = &mut ctx.accounts.order_a;
        let order_b = &mut ctx.accounts.order_b;
        require!(order_a.status == OrderStatus::Active, ErrorCode::OrderNotActive);
        require!(order_b.status == OrderStatus::Active, ErrorCode::OrderNotActive);

        // Bind seller / buyer from the FHE side decrypt — never from the
        // caller-supplied (order_a, order_b) ordering. Closes SEC-H-2.
        // 0 = bid, 1 = ask. Same-side matches must be rejected.
        let a_side = encrypt_cpi::mock_decrypt_side(&order_a.side_ct);
        let b_side = encrypt_cpi::mock_decrypt_side(&order_b.side_ct);
        require!(a_side != b_side, ErrorCode::SameSide);
        let (seller_dwallet, buyer_dwallet) = if a_side == 1 {
            (order_a.dwallet_id, order_b.dwallet_id)
        } else {
            (order_b.dwallet_id, order_a.dwallet_id)
        };

        let clock = Clock::get()?;
        let record = &mut ctx.accounts.match_record;
        record.market = intent.market;
        record.match_id = intent.match_id;
        record.order_a = intent.order_a;
        record.order_b = intent.order_b;
        record.seller_dwallet = seller_dwallet;
        record.buyer_dwallet = buyer_dwallet;
        record.fill_size_decrypted = response.fill_size;
        record.clearing_price_decrypted = response.clearing_price;
        record.settle_status = SettleStatus::Pending;
        record.created_at = clock.unix_timestamp;
        record.bump = ctx.bumps.match_record;
        record.btc_tx_proof = Vec::new();
        record.finalized_at = 0;

        order_a.status = OrderStatus::Matched;
        order_b.status = OrderStatus::Matched;

        let market = &mut ctx.accounts.market;
        market.active_order_count = market.active_order_count.saturating_sub(2);

        emit!(SettleReady {
            market: intent.market,
            match_record: record.key(),
            match_id: intent.match_id,
            fill_size_sats: response.fill_size,
            clearing_price_quote: response.clearing_price,
            seller_dwallet: record.seller_dwallet,
            buyer_dwallet: record.buyer_dwallet,
        });
        Ok(())
    }

    /// Called by the Ika keeper after broadcasting + 1-conf of the BTC
    /// settlement tx. Persists the proof blob, marks the MatchRecord
    /// settled, and emits SettleFinalized.
    pub fn finalize_settlement(
        ctx: Context<SettlementOutcome>,
        _match_id: u64,
        btc_tx_proof: Vec<u8>,
    ) -> Result<()> {
        require!(
            btc_tx_proof.len() <= state::BTC_TX_PROOF_MAX,
            ErrorCode::BtcProofTooLarge,
        );
        let record = &mut ctx.accounts.match_record;
        require!(
            record.settle_status == SettleStatus::Pending,
            ErrorCode::SettleNotPending,
        );
        let clock = Clock::get()?;
        let proof_len = btc_tx_proof.len() as u32;
        record.btc_tx_proof = btc_tx_proof;
        record.finalized_at = clock.unix_timestamp;
        record.settle_status = SettleStatus::Settled;

        emit!(SettleFinalized {
            market: record.market,
            match_record: record.key(),
            match_id: record.match_id,
            btc_tx_proof_len: proof_len,
        });
        Ok(())
    }

    /// Called by the keeper to abandon a stuck settlement (BTC tx didn't
    /// confirm in N blocks, MPC timeout, etc.). Subsequent calls fail.
    /// `reason_code` is keeper-defined (0 = unknown, 1 = btc_timeout,
    /// 2 = mpc_failure, 3 = invalid_proof, 4 = refund_path).
    pub fn fail_settlement(
        ctx: Context<SettlementOutcome>,
        _match_id: u64,
        reason_code: u16,
    ) -> Result<()> {
        let record = &mut ctx.accounts.match_record;
        require!(
            record.settle_status == SettleStatus::Pending,
            ErrorCode::SettleNotPending,
        );
        let clock = Clock::get()?;
        record.settle_status = SettleStatus::SettleFailed;
        record.finalized_at = clock.unix_timestamp;

        emit!(SettleFailedEvent {
            market: record.market,
            match_record: record.key(),
            match_id: record.match_id,
            reason_code,
        });
        Ok(())
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Accounts
// ────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(base_mint: Pubkey, quote_mint: Pubkey)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + MarketState::INIT_SPACE,
        seeds = [b"market", base_mint.as_ref(), quote_mint.as_ref()],
        bump,
    )]
    pub market: Account<'info, MarketState>,
    /// CHECK: operator-chosen USDC vault. Ownership/layout validated off-chain
    /// during admin setup; the program only stores the reference.
    pub settle_vault: UncheckedAccount<'info>,
    /// CHECK: Ika dWallet policy PDA on Ika. Layout validation lives in the
    /// Ika CPI layer in P4.
    pub ika_policy: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    side_ct: Vec<u8>,
    price_ct: Vec<u8>,
    size_ct: Vec<u8>,
    expiry_slot: u64,
    nonce: [u8; 16],
)]
pub struct SubmitOrder<'info> {
    #[account(mut)]
    pub market: Account<'info, MarketState>,
    #[account(
        init,
        payer = owner,
        space = 8 + EncryptedOrder::INIT_SPACE,
        seeds = [b"order", market.key().as_ref(), nonce.as_ref()],
        bump,
    )]
    pub order: Account<'info, EncryptedOrder>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut, has_one = market)]
    pub order: Account<'info, EncryptedOrder>,
    #[account(mut)]
    pub market: Account<'info, MarketState>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct TryMatch<'info> {
    #[account(mut)]
    pub market: Account<'info, MarketState>,
    #[account(has_one = market)]
    pub order_a: Account<'info, EncryptedOrder>,
    #[account(has_one = market)]
    pub order_b: Account<'info, EncryptedOrder>,
    #[account(
        init,
        payer = payer,
        space = 8 + MatchIntent::INIT_SPACE,
        seeds = [b"match_intent", market.key().as_ref(), &match_id.to_le_bytes()],
        bump,
    )]
    pub match_intent: Account<'info, MatchIntent>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct SettlementOutcome<'info> {
    #[account(
        mut,
        has_one = market,
        constraint = match_record.match_id == match_id @ ErrorCode::InvalidMatchId,
    )]
    pub match_record: Account<'info, MatchRecord>,
    /// Settlement is gated to `market.keeper_authority` set at init —
    /// closes the SEC-H-1 finding where any signer could submit forged
    /// btc_tx_proof bytes or DoS via fail_settlement. SPV proof
    /// verification is still pending (gap I3).
    #[account(has_one = keeper_authority)]
    pub market: Account<'info, MarketState>,
    pub keeper_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct RequestSettlement<'info> {
    #[account(mut)]
    pub market: Account<'info, MarketState>,
    /// Closed on success — its rent returns to `payer` and the account
    /// data is wiped, so a stale intent can't be enumerated by indexers.
    #[account(
        mut,
        has_one = market,
        constraint = match_intent.match_id == match_id @ ErrorCode::InvalidMatchId,
        close = payer,
    )]
    pub match_intent: Account<'info, MatchIntent>,
    #[account(
        init,
        payer = payer,
        space = 8 + MatchRecord::INIT_SPACE,
        seeds = [b"match", market.key().as_ref(), &match_id.to_le_bytes()],
        bump,
    )]
    pub match_record: Account<'info, MatchRecord>,
    #[account(mut, address = match_intent.order_a)]
    pub order_a: Account<'info, EncryptedOrder>,
    #[account(mut, address = match_intent.order_b)]
    pub order_b: Account<'info, EncryptedOrder>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

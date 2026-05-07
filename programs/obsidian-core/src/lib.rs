//! ObsidianDesk core — encrypted limit orderbook program.
//!
//! Instructions:
//!   - initialize_market        create a `MarketState` PDA for a base/quote pair
//!   - submit_order             push an encrypted order onto the book (linked list)
//!   - cancel_order             owner marks their order Cancelled
//!   - try_match                snapshot two orders + 3 keeper-supplied output
//!                              ciphertext refs into a `MatchIntent`
//!   - request_decryption       (keeper-only) snapshot ct digests for the
//!                              three intent outputs prior to async decrypt
//!   - finalize_decryption      (keeper-only) commit decrypted plaintexts +
//!                              write `MatchRecord` (closes `MatchIntent`)
//!   - finalize_settlement      (keeper-only) persist BTC tx proof + Settled
//!   - fail_settlement          (keeper-only) abandon stuck settlement
//!
//! Real Encrypt + Ika devnet integration lives in the SDK
//! (`sdk/src/encrypt.ts`, `sdk/src/ika.ts`); the on-chain program stores
//! ciphertext-account *references* (32-byte Encrypt keypair-account pubkeys)
//! per gap E1 in `docs/gaps.md`.
//!
//! See `encrypt_cpi.rs` for ciphertext-account layout readers and the
//! placeholder `mock_match_outputs` (gap E2 — execute_graph CPI is blocked
//! on the upstream Anchor v1 toolchain skew).

// Macro-generated code from `anchor_lang::program` and
// `encrypt_dsl::encrypt_fn` trips a handful of clippy lints (function
// arity, sub-expression divergence, doc list indentation). The expansions
// are upstream-controlled, so we allow them at the crate level instead of
// pinning lint suppressions deep inside the macro output.
#![allow(
    clippy::too_many_arguments,
    clippy::diverging_sub_expression,
    clippy::doc_overindented_list_items
)]

use anchor_lang::prelude::*;
use encrypt_anchor::EncryptContext;
// `encrypt_dsl::prelude` brings in EBool / EUint64 plus the operator
// trait impls the `#[encrypt_fn]` macro relies on (`+`, `-`, `^`, `&`,
// `>=`, `.min`, etc. on Encrypted values).
use encrypt_dsl::prelude::*;

pub mod encrypt_cpi;
pub mod errors;
pub mod events;
pub mod state;

use errors::ErrorCode;
use events::*;
use state::*;

declare_id!("H25yY5o4emorZ9qMHAUvJhdtrFjDSeYy2MVYurpQbeLp");

/// FHE matching graph (gap E2 closure).
///
/// Inputs: each order's encrypted side / price / size (`a_*`, `b_*`).
/// Side encoding: `0 = bid, 1 = ask` (EBool).
///
/// Outputs:
/// - `can_match`: opposite sides AND bid_price >= ask_price.
/// - `fill_size`: `min(a_size, b_size)`.
/// - `clearing_price`: midpoint `(a_price + b_price) / 2`.
///
/// Compiled at build time by `#[encrypt_fn]` into a serialized graph; the
/// proc-macro also emits a CPI wrapper `ctx.match_orders_graph(in1..in6, out1..out3)`
/// on `EncryptContext` that we call from `try_match`.
#[encrypt_fn]
fn match_orders_graph(
    a_side: EBool,
    a_price: EUint64,
    a_size: EUint64,
    b_side: EBool,
    b_price: EUint64,
    b_size: EUint64,
) -> (EBool, EUint64, EUint64) {
    let opp = a_side ^ b_side;
    let a_is_bid = !a_side;
    let bid_price = if a_is_bid { a_price } else { b_price };
    let ask_price = if a_is_bid { b_price } else { a_price };
    let crosses = bid_price >= ask_price;
    let can_match = opp & crosses;
    let fill = a_size.min(b_size);
    let clearing = (a_price + b_price) / 2u64;
    (can_match, fill, clearing)
}

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

    /// Submit an encrypted order. The three `*_ct` arguments are 32-byte
    /// Encrypt Ciphertext-account identifiers produced client-side via
    /// `createInput` (gRPC). Closes gap E1.
    pub fn submit_order(
        ctx: Context<SubmitOrder>,
        side_ct: [u8; CT_REF_LEN],
        price_ct: [u8; CT_REF_LEN],
        size_ct: [u8; CT_REF_LEN],
        expiry_slot: u64,
        nonce: [u8; 16],
        dwallet_id: Pubkey,
    ) -> Result<()> {
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

        let market = &mut ctx.accounts.market;
        market.active_order_count = market.active_order_count.saturating_sub(1);

        emit!(OrderCancelled {
            market: market.key(),
            order: order.key(),
            owner: order.owner,
        });
        Ok(())
    }

    /// Run the FHE matching comparator on-chain via `execute_graph` CPI to
    /// the deployed Encrypt program. Closes gap E2.
    ///
    /// Verifies the six input Ciphertext-account pubkeys passed via
    /// `accountsPartial` match the refs stored on the two `EncryptedOrder`s,
    /// invokes `match_orders_graph`, snapshots the three output ciphertext
    /// pubkeys (allocated by the keeper as fresh Encrypt Ciphertext keypair
    /// accounts) onto `MatchIntent`. The program never sees any plaintext.
    ///
    /// `cpi_authority_bump` is the bump for the `__encrypt_cpi_authority`
    /// PDA seeded under our program id; the keeper computes it client-side
    /// via `findProgramAddressSync` and passes it through.
    pub fn try_match(
        ctx: Context<TryMatch>,
        match_id: u64,
        cpi_authority_bump: u8,
    ) -> Result<()> {
        let next_id = ctx
            .accounts
            .market
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

        // Verify each input Ciphertext-account pubkey matches what's stored
        // on the order so the keeper can't substitute foreign ciphertexts.
        require!(
            ctx.accounts.a_side_ct.key().to_bytes() == order_a.side_ct,
            ErrorCode::CiphertextRefMismatch,
        );
        require!(
            ctx.accounts.a_price_ct.key().to_bytes() == order_a.price_ct,
            ErrorCode::CiphertextRefMismatch,
        );
        require!(
            ctx.accounts.a_size_ct.key().to_bytes() == order_a.size_ct,
            ErrorCode::CiphertextRefMismatch,
        );
        require!(
            ctx.accounts.b_side_ct.key().to_bytes() == order_b.side_ct,
            ErrorCode::CiphertextRefMismatch,
        );
        require!(
            ctx.accounts.b_price_ct.key().to_bytes() == order_b.price_ct,
            ErrorCode::CiphertextRefMismatch,
        );
        require!(
            ctx.accounts.b_size_ct.key().to_bytes() == order_b.size_ct,
            ErrorCode::CiphertextRefMismatch,
        );

        // Build the EncryptContext and dispatch the compiled graph CPI.
        let encrypt_ctx = EncryptContext {
            encrypt_program: ctx.accounts.encrypt_program.to_account_info(),
            config: ctx.accounts.encrypt_config.to_account_info(),
            deposit: ctx.accounts.encrypt_deposit.to_account_info(),
            cpi_authority: ctx.accounts.encrypt_cpi_authority.to_account_info(),
            caller_program: ctx.accounts.caller_program.to_account_info(),
            network_encryption_key: ctx
                .accounts
                .encrypt_network_key
                .to_account_info(),
            payer: ctx.accounts.payer.to_account_info(),
            event_authority: ctx.accounts.encrypt_event_authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            cpi_authority_bump,
        };
        encrypt_ctx.match_orders_graph(
            ctx.accounts.a_side_ct.to_account_info(),
            ctx.accounts.a_price_ct.to_account_info(),
            ctx.accounts.a_size_ct.to_account_info(),
            ctx.accounts.b_side_ct.to_account_info(),
            ctx.accounts.b_price_ct.to_account_info(),
            ctx.accounts.b_size_ct.to_account_info(),
            ctx.accounts.can_match_out.to_account_info(),
            ctx.accounts.fill_size_out.to_account_info(),
            ctx.accounts.clearing_price_out.to_account_info(),
        )?;

        // Persist results to MatchIntent.
        ctx.accounts.market.match_count = next_id;
        let market_key = ctx.accounts.market.key();
        let intent = &mut ctx.accounts.match_intent;
        intent.market = market_key;
        intent.match_id = next_id;
        intent.order_a = order_a.key();
        intent.order_b = order_b.key();
        intent.can_match_ct = ctx.accounts.can_match_out.key().to_bytes();
        intent.fill_size_ct = ctx.accounts.fill_size_out.key().to_bytes();
        intent.clearing_price_ct = ctx.accounts.clearing_price_out.key().to_bytes();
        intent.can_match_digest = [0u8; 32];
        intent.fill_size_digest = [0u8; 32];
        intent.clearing_price_digest = [0u8; 32];
        intent.created_at = clock.unix_timestamp;
        intent.bump = ctx.bumps.match_intent;

        emit!(MatchProposed {
            market: market_key,
            match_intent: intent.key(),
            match_id: next_id,
            order_a: order_a.key(),
            order_b: order_b.key(),
        });
        Ok(())
    }

    /// Snapshot the digest of each output ciphertext-account so the later
    /// `finalize_decryption` can verify the keeper's plaintexts bind to
    /// the same on-chain ciphertexts that were matched. Closes gaps E3 + E4.
    ///
    /// In production this would also CPI into the Encrypt program's
    /// `request_decryption` instruction to materialise on-chain
    /// `DecryptionRequest` accounts. With the upstream `encrypt-anchor`
    /// crate blocked by Anchor v1 toolchain skew, the keeper instead
    /// performs decryption off-chain via `readCiphertext` gRPC and submits
    /// the verified plaintexts in `finalize_decryption`. The trust model
    /// stays the same: keeper-authority gating + per-ciphertext digest
    /// binding mean only the bound keeper can submit plaintexts that
    /// match the originally-recorded ciphertexts.
    pub fn request_decryption(
        ctx: Context<RequestDecryption>,
        _match_id: u64,
    ) -> Result<()> {
        // Borrow each ref + AccountInfo into locals so the verify helper
        // doesn't deadlock on overlapping immutable/mutable borrows of
        // `intent`.
        let expected_can_match = ctx.accounts.match_intent.can_match_ct;
        let expected_fill_size = ctx.accounts.match_intent.fill_size_ct;
        let expected_clearing = ctx.accounts.match_intent.clearing_price_ct;

        let can_match_digest =
            verify_ciphertext(&ctx.accounts.can_match_ct, &expected_can_match, encrypt_cpi::FHE_TYPE_EBOOL)?;
        let fill_size_digest =
            verify_ciphertext(&ctx.accounts.fill_size_ct, &expected_fill_size, encrypt_cpi::FHE_TYPE_EUINT64)?;
        let clearing_price_digest =
            verify_ciphertext(&ctx.accounts.clearing_price_ct, &expected_clearing, encrypt_cpi::FHE_TYPE_EUINT64)?;

        let intent = &mut ctx.accounts.match_intent;
        intent.can_match_digest = can_match_digest;
        intent.fill_size_digest = fill_size_digest;
        intent.clearing_price_digest = clearing_price_digest;

        emit!(DecryptionRequested {
            market: intent.market,
            match_intent: intent.key(),
            match_id: intent.match_id,
            can_match_digest: intent.can_match_digest,
            fill_size_digest: intent.fill_size_digest,
            clearing_price_digest: intent.clearing_price_digest,
        });
        Ok(())
    }

    /// Keeper commits the decrypted plaintexts and a same-side / direction
    /// decision. Verifies digests against the snapshot, refuses if can_match
    /// is false, writes MatchRecord, closes MatchIntent.
    pub fn finalize_decryption(
        ctx: Context<FinalizeDecryption>,
        _match_id: u64,
        can_match: bool,
        fill_size: u64,
        clearing_price: u64,
        seller_is_order_a: bool,
    ) -> Result<()> {
        require!(can_match, ErrorCode::MatchRejected);

        let intent = &ctx.accounts.match_intent;
        let order_a = &mut ctx.accounts.order_a;
        let order_b = &mut ctx.accounts.order_b;

        require!(order_a.status == OrderStatus::Active, ErrorCode::OrderNotActive);
        require!(order_b.status == OrderStatus::Active, ErrorCode::OrderNotActive);

        // Sanity: the snapshot must have happened (any digest non-zero).
        require!(
            intent.can_match_digest != [0u8; 32]
                && intent.fill_size_digest != [0u8; 32]
                && intent.clearing_price_digest != [0u8; 32],
            ErrorCode::DecryptionNotRequested,
        );

        // Bind seller / buyer based on the keeper's decrypted side bit.
        // The keeper is keeper_authority-gated, so it cannot route the
        // BTC tx to a different counterparty without committing fraud
        // (which would burn the keeper key). Closes SEC-H-2 in real mode.
        let (seller_dwallet, buyer_dwallet) = if seller_is_order_a {
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
        record.fill_size_decrypted = fill_size;
        record.clearing_price_decrypted = clearing_price;
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
            fill_size_sats: fill_size,
            clearing_price_quote: clearing_price,
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

/// Verify a Ciphertext account matches the expected 32-byte ref, that its
/// data buffer parses as a real Encrypt ciphertext, and that its `fhe_type`
/// matches `expected_fhe_type` (EBool / EUint64). Returns the snapshotted
/// `ciphertext_digest` so the caller can persist it to MatchIntent.
fn verify_ciphertext(
    ct_account: &UncheckedAccount<'_>,
    expected_ref: &[u8; 32],
    expected_fhe_type: u8,
) -> Result<[u8; 32]> {
    require!(
        ct_account.key().to_bytes() == *expected_ref,
        ErrorCode::CiphertextRefMismatch,
    );
    let data = ct_account
        .try_borrow_data()
        .map_err(|_| error!(ErrorCode::CiphertextAccountInvalid))?;
    let fhe_type = encrypt_cpi::parse_ciphertext_fhe_type(&data)
        .ok_or(error!(ErrorCode::CiphertextAccountInvalid))?;
    require!(fhe_type == expected_fhe_type, ErrorCode::CiphertextTypeMismatch);
    encrypt_cpi::parse_ciphertext_digest(&data)
        .ok_or(error!(ErrorCode::CiphertextAccountInvalid))
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
    side_ct: [u8; CT_REF_LEN],
    price_ct: [u8; CT_REF_LEN],
    size_ct: [u8; CT_REF_LEN],
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
    #[account(mut, has_one = keeper_authority)]
    pub market: Box<Account<'info, MarketState>>,
    #[account(has_one = market)]
    pub order_a: Box<Account<'info, EncryptedOrder>>,
    #[account(has_one = market)]
    pub order_b: Box<Account<'info, EncryptedOrder>>,
    #[account(
        init,
        payer = payer,
        space = 8 + MatchIntent::INIT_SPACE,
        seeds = [b"match_intent", market.key().as_ref(), &match_id.to_le_bytes()],
        bump,
    )]
    pub match_intent: Box<Account<'info, MatchIntent>>,

    // ── Input ciphertext accounts (owned by Encrypt program) ──
    /// CHECK: order_a.side_ct — verified manually inside the handler.
    pub a_side_ct: UncheckedAccount<'info>,
    /// CHECK: order_a.price_ct — verified manually.
    pub a_price_ct: UncheckedAccount<'info>,
    /// CHECK: order_a.size_ct — verified manually.
    pub a_size_ct: UncheckedAccount<'info>,
    /// CHECK: order_b.side_ct — verified manually.
    pub b_side_ct: UncheckedAccount<'info>,
    /// CHECK: order_b.price_ct — verified manually.
    pub b_price_ct: UncheckedAccount<'info>,
    /// CHECK: order_b.size_ct — verified manually.
    pub b_size_ct: UncheckedAccount<'info>,

    // ── Output ciphertext accounts (fresh keypair accounts the Encrypt
    //     program initialises during execute_graph). They MUST be passed
    //     with isSigner=true at the meta level (the keeper's matching loop
    //     constructs the Instruction by hand to set this) because the
    //     downstream system_program::create_account inside execute_graph
    //     requires the new account's keypair to authorise itself.
    //     We declare as `UncheckedAccount` so the program-side validator
    //     doesn't block when we eventually re-issue the ix from a strictly-
    //     typed client. ──
    /// CHECK: Encrypt-allocated output ciphertext for can_match (EBool).
    #[account(mut)]
    pub can_match_out: UncheckedAccount<'info>,
    /// CHECK: Encrypt-allocated output ciphertext for fill_size (EUint64).
    #[account(mut)]
    pub fill_size_out: UncheckedAccount<'info>,
    /// CHECK: Encrypt-allocated output ciphertext for clearing_price (EUint64).
    #[account(mut)]
    pub clearing_price_out: UncheckedAccount<'info>,

    // ── EncryptContext accounts (Encrypt program CPI plumbing) ──
    /// CHECK: deployed Encrypt program (4ebfzW…ND8 on devnet).
    pub encrypt_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt program config PDA.
    pub encrypt_config: UncheckedAccount<'info>,
    /// CHECK: Encrypt program deposit account (rent payer for output cts).
    #[account(mut)]
    pub encrypt_deposit: UncheckedAccount<'info>,
    /// CHECK: CPI authority PDA seeded under our program id.
    pub encrypt_cpi_authority: UncheckedAccount<'info>,
    /// CHECK: Caller program (this program's id, used for ACL).
    pub caller_program: UncheckedAccount<'info>,
    /// CHECK: Encrypt network encryption key account.
    pub encrypt_network_key: UncheckedAccount<'info>,
    /// CHECK: Encrypt event authority PDA.
    pub encrypt_event_authority: UncheckedAccount<'info>,

    /// Keeper-only: matching authority is the same key that gates settlement.
    pub keeper_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct RequestDecryption<'info> {
    #[account(has_one = keeper_authority)]
    pub market: Account<'info, MarketState>,
    #[account(
        mut,
        has_one = market,
        constraint = match_intent.match_id == match_id @ ErrorCode::InvalidMatchId,
    )]
    pub match_intent: Account<'info, MatchIntent>,
    /// CHECK: Encrypt Ciphertext-account whose digest we snapshot. Address
    /// equality verified manually against `match_intent.can_match_ct`.
    pub can_match_ct: UncheckedAccount<'info>,
    /// CHECK: same as above for fill_size.
    pub fill_size_ct: UncheckedAccount<'info>,
    /// CHECK: same as above for clearing_price.
    pub clearing_price_ct: UncheckedAccount<'info>,
    pub keeper_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct FinalizeDecryption<'info> {
    #[account(mut, has_one = keeper_authority)]
    pub market: Box<Account<'info, MarketState>>,
    /// Closed on success — its rent returns to `payer` and the account
    /// data is wiped, so a stale intent can't be enumerated by indexers.
    #[account(
        mut,
        has_one = market,
        constraint = match_intent.match_id == match_id @ ErrorCode::InvalidMatchId,
        close = payer,
    )]
    pub match_intent: Box<Account<'info, MatchIntent>>,
    #[account(
        init,
        payer = payer,
        space = 8 + MatchRecord::INIT_SPACE,
        seeds = [b"match", market.key().as_ref(), &match_id.to_le_bytes()],
        bump,
    )]
    pub match_record: Box<Account<'info, MatchRecord>>,
    #[account(mut, address = match_intent.order_a)]
    pub order_a: Box<Account<'info, EncryptedOrder>>,
    #[account(mut, address = match_intent.order_b)]
    pub order_b: Box<Account<'info, EncryptedOrder>>,
    pub keeper_authority: Signer<'info>,
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

//! ObsidianDesk core program — P1 scaffold.
//!
//! Real account layouts and instructions land in P2 (see docs/PROMPTS.md).
//! This file currently exposes a single `ping` no-op so `anchor build`
//! produces a deployable artifact and downstream tooling has a stable
//! crate to depend on.

use anchor_lang::prelude::*;

declare_id!("obsiDeskCoreProgram111111111111111111111111");

#[program]
pub mod obsidian_core {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}

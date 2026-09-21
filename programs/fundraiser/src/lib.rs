use anchor_lang::prelude::*;

declare_id!("Gas8wW4Yk4DDfc99pB9A8gSHSZiDpXNaENQkC2wGdwqU");

mod constants;
mod error;
mod instructions;
mod state;
mod events;


pub use constants::*;
use error::*;
use instructions::*;
pub use events::*;

#[program]
pub mod fundraiser {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, amount: u64, duration: u8) -> Result<()> {
        ctx.accounts.initialize(amount, duration, &ctx.bumps)?;
        Ok(())
    }

    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        ctx.accounts.contribute(amount, &ctx.bumps)?;
        Ok(())
    }

    pub fn check_contributions(ctx: Context<CheckContributions>) -> Result<()> {
        ctx.accounts.check_contributions()?;
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        ctx.accounts.refund()?;
        Ok(())
    }
}
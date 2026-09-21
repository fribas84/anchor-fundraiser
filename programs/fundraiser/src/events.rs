use anchor_lang::prelude::*;

#[event]
pub struct CampaignClaimed {
    pub fundraiser: Pubkey,
    pub maker: Pubkey,
    pub contributor_count: u32,
}
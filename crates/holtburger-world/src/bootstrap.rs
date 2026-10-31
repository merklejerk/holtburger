use crate::spell::SpellCatalog;
use holtburger_content::{
    CharacterTitleCatalog, ContractCatalog, MotionSequenceCatalog, SoulEmoteCatalog,
};
use holtburger_dat::file_type::{SecondaryAttributeTable, SkillTable, SpellTable, XpTable};
use std::sync::Arc;

/// Parsed immutable game reference data assembled by content-owning callers.
#[derive(Debug, Clone)]
pub struct WorldBootstrap {
    pub skill_table: Arc<SkillTable>,
    /// Authored formulas for the three maximum vitals.
    pub secondary_attribute_table: Arc<SecondaryAttributeTable>,
    pub spell_table: Arc<SpellTable>,
    pub xp_table: Arc<XpTable>,
    /// Localized static character titles used by shared inspection semantics.
    pub character_titles: Arc<CharacterTitleCatalog>,
    /// Immutable quest contract definitions and parsed progress formats.
    pub contracts: Arc<ContractCatalog>,
    pub motion_sequences: Arc<MotionSequenceCatalog>,
    /// Setup-owned interaction dimensions, available even for bodies without local physics.
    pub setup_dimensions: Arc<holtburger_content::SetupDimensionCatalog>,
    pub soul_emote_catalog: Arc<SoulEmoteCatalog>,
}

impl WorldBootstrap {
    pub fn spell_catalog(&self) -> Arc<SpellCatalog> {
        Arc::new(self.spell_table.as_ref().clone().into())
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn synthetic() -> Self {
        Self {
            skill_table: Arc::new(SkillTable::default()),
            secondary_attribute_table: Arc::new(SecondaryAttributeTable::synthetic()),
            spell_table: Arc::new(SpellTable {
                id: SpellTable::FILE_ID,
                spells: Default::default(),
                spell_sets: Default::default(),
            }),
            xp_table: Arc::new(XpTable::default()),
            character_titles: Arc::new(CharacterTitleCatalog::default()),
            contracts: Arc::new(ContractCatalog::default()),
            motion_sequences: Arc::new(MotionSequenceCatalog::default()),
            setup_dimensions: Arc::new(holtburger_content::SetupDimensionCatalog::default()),
            soul_emote_catalog: Arc::new(SoulEmoteCatalog::default()),
        }
    }
}

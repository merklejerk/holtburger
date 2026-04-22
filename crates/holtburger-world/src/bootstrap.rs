use crate::spell::SpellCatalog;
use holtburger_content::SoulEmoteCatalog;
use holtburger_dat::file_type::{MotionKinematics, SkillTable, SpellTable, XpTable};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct WorldBootstrap {
    pub skill_table: Arc<SkillTable>,
    pub spell_table: Arc<SpellTable>,
    pub xp_table: Arc<XpTable>,
    pub motion_kinematics: Arc<MotionKinematics>,
    pub soul_emote_catalog: Arc<SoulEmoteCatalog>,
}

impl WorldBootstrap {
    pub fn new(
        skill_table: SkillTable,
        spell_table: SpellTable,
        xp_table: XpTable,
        motion_kinematics: MotionKinematics,
        soul_emote_catalog: SoulEmoteCatalog,
    ) -> Self {
        Self {
            skill_table: Arc::new(skill_table),
            spell_table: Arc::new(spell_table),
            xp_table: Arc::new(xp_table),
            motion_kinematics: Arc::new(motion_kinematics),
            soul_emote_catalog: Arc::new(soul_emote_catalog),
        }
    }

    pub fn spell_catalog(&self) -> Arc<SpellCatalog> {
        Arc::new(self.spell_table.as_ref().clone().into())
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn synthetic() -> Self {
        Self::new(
            SkillTable::default(),
            SpellTable {
                id: SpellTable::FILE_ID,
                spells: Default::default(),
                spell_sets: Default::default(),
            },
            XpTable::default(),
            MotionKinematics::default(),
            SoulEmoteCatalog::default(),
        )
    }
}

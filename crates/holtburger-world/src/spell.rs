pub mod formula;
use std::collections::HashMap;

use holtburger_dat::file_type::spell_table::{
    SpellBase as DatSpellBase, SpellExtras as DatSpellExtras, SpellSet as DatSpellSet,
    SpellSetTiers as DatSpellSetTiers, SpellTable as DatSpellTable,
};

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    serde::Serialize,
    serde::Deserialize,
    strum_macros::Display,
    strum_macros::FromRepr,
)]
pub enum MagicSchool {
    #[strum(serialize = "None")]
    None = 0,
    #[strum(serialize = "War Magic")]
    WarMagic = 1,
    #[strum(serialize = "Life Magic")]
    LifeMagic = 2,
    #[strum(serialize = "Item Enchantment")]
    ItemEnchantment = 3,
    #[strum(serialize = "Creature Enchantment")]
    CreatureEnchantment = 4,
    #[strum(serialize = "Void Magic")]
    VoidMagic = 5,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct SpellCatalog {
    pub spells: HashMap<u32, SpellInfo>,
    pub spell_sets: HashMap<u32, SpellSetInfo>,
}

impl SpellCatalog {
    pub fn get(&self, spell_id: u32) -> Option<&SpellInfo> {
        // High bit (0x80000000) is used to mark enchantments in a spell book
        let masked_id = spell_id & 0x7FFFFFFF;
        self.spells.get(&masked_id)
    }

    pub fn resolve_name(&self, spell_id: u32) -> Option<&str> {
        self.get(spell_id).map(|spell| spell.name.as_str())
    }
}

impl From<DatSpellTable> for SpellCatalog {
    fn from(value: DatSpellTable) -> Self {
        Self {
            spells: value
                .spells
                .into_iter()
                .map(|(id, spell)| (id, spell.into()))
                .collect(),
            spell_sets: value
                .spell_sets
                .into_iter()
                .map(|(id, set)| (id, set.into()))
                .collect(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SpellInfo {
    pub name: String,
    pub description: String,
    pub school: MagicSchool,
    pub icon_id: u32,
    pub category: u32,
    pub bitfield: u32,
    pub base_mana: u32,
    pub base_range_constant: f32,
    pub base_range_mod: f32,
    pub power: u32,
    pub spell_economy_mod: f32,
    pub formula_version: u32,
    pub component_loss: f32,
    pub meta_spell_type: u32,
    pub meta_spell_id: u32,
    pub extras: SpellExtrasInfo,
    pub components: [u32; 8],
    pub caster_effect: u32,
    pub target_effect: u32,
    pub fizzle_effect: u32,
    pub recovery_interval: f64,
    pub recovery_amount: f32,
    pub display_order: u32,
    pub non_component_target_type: u32,
    pub mana_mod: u32,
}

/// Recipient source for an ordinary spellbook cast, independent of UI selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpellCastingRoute {
    /// The caster is the recipient, regardless of selection.
    SelfTarget,
    /// The spell is cast without an object recipient.
    Untargeted,
    /// The caller must supply its selected object.
    SelectedTarget,
}

impl SpellInfo {
    /// The shared ordinary-cast decision, also exposed to reference views.
    pub fn casting_route(&self) -> SpellCastingRoute {
        SpellCastingRoute::from_decoded_formula(self.bitfield, &self.components)
    }
}

impl SpellCastingRoute {
    const SELF_TARGETED_FLAG: u32 = 0x8;

    /// Retail acclient.c:387433 checks self before formula targeting (:429344).
    /// Use original decoded slots, never account-customized display formulas.
    /// Authored recipient masks do not determine whether selection is required.
    pub fn from_decoded_formula(flags: u32, components: &[u32; 8]) -> Self {
        if flags & Self::SELF_TARGETED_FLAG != 0 {
            Self::SelfTarget
        } else if formula::casting_target_type(components) == 0 {
            Self::Untargeted
        } else {
            Self::SelectedTarget
        }
    }
}

impl From<DatSpellBase> for SpellInfo {
    fn from(value: DatSpellBase) -> Self {
        Self {
            name: value.name,
            description: value.description,
            school: MagicSchool::from_repr(value.school as usize).unwrap_or(MagicSchool::None),
            icon_id: value.icon_id,
            category: value.category,
            bitfield: value.bitfield,
            base_mana: value.base_mana,
            base_range_constant: value.base_range_constant,
            base_range_mod: value.base_range_mod,
            power: value.power,
            spell_economy_mod: value.spell_economy_mod,
            formula_version: value.formula_version,
            component_loss: value.component_loss,
            meta_spell_type: value.meta_spell_type,
            meta_spell_id: value.meta_spell_id,
            extras: value.extras.into(),
            components: value.components,
            caster_effect: value.caster_effect,
            target_effect: value.target_effect,
            fizzle_effect: value.fizzle_effect,
            recovery_interval: value.recovery_interval,
            recovery_amount: value.recovery_amount,
            display_order: value.display_order,
            non_component_target_type: value.non_component_target_type,
            mana_mod: value.mana_mod,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum SpellExtrasInfo {
    Enchantment {
        duration: f64,
        degrade_modifier: f32,
        degrade_limit: f32,
    },
    PortalSummon {
        portal_lifetime: f64,
    },
    None,
}

impl From<DatSpellExtras> for SpellExtrasInfo {
    fn from(value: DatSpellExtras) -> Self {
        match value {
            DatSpellExtras::Enchantment {
                duration,
                degrade_modifier,
                degrade_limit,
            } => Self::Enchantment {
                duration,
                degrade_modifier,
                degrade_limit,
            },
            DatSpellExtras::PortalSummon { portal_lifetime } => {
                Self::PortalSummon { portal_lifetime }
            }
            DatSpellExtras::None => Self::None,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct SpellSetInfo {
    pub tiers: HashMap<u32, SpellSetTierInfo>,
}

impl From<DatSpellSet> for SpellSetInfo {
    fn from(value: DatSpellSet) -> Self {
        Self {
            tiers: value
                .tiers
                .into_iter()
                .map(|(id, tier)| (id, tier.into()))
                .collect(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SpellSetTierInfo {
    pub spell_count: i32,
    pub spells: Vec<u32>,
}

impl From<DatSpellSetTiers> for SpellSetTierInfo {
    fn from(value: DatSpellSetTiers) -> Self {
        Self {
            spell_count: value.spell_count,
            spells: value.spells,
        }
    }
}

/// Retail examination and ACE spellbook-casting distance limit, in metres.
/// acclient.c:218245, :423598; ACE Player_Magic.cs:481. Item-cast range uses
/// a different skill input and is deliberately outside this spellbook query.
pub fn spellbook_range_metres(
    spell: &SpellInfo,
    skills: &HashMap<crate::stats::SkillType, crate::stats::Skill>,
) -> Option<f32> {
    use crate::stats::SkillType;
    let school_skill = match spell.school {
        MagicSchool::WarMagic => Some(SkillType::WarMagic),
        MagicSchool::LifeMagic => Some(SkillType::LifeMagic),
        MagicSchool::ItemEnchantment => Some(SkillType::ItemEnchantment),
        MagicSchool::CreatureEnchantment => Some(SkillType::CreatureEnchantment),
        MagicSchool::VoidMagic => Some(SkillType::VoidMagic),
        MagicSchool::None => None,
    };
    let level = |kind| {
        skills
            .get(&kind)
            .map(|skill| skill.init.wrapping_add(skill.ranks))
    };
    let level = match school_skill {
        Some(kind) => level(kind)?,
        None => [
            SkillType::WarMagic,
            SkillType::LifeMagic,
            SkillType::ItemEnchantment,
            SkillType::CreatureEnchantment,
            SkillType::VoidMagic,
        ]
        .into_iter()
        .try_fold(0, |maximum, kind| {
            level(kind).map(|value| maximum.max(value))
        })?,
    };
    Some((spell.base_range_constant + spell.base_range_mod * level as f32).min(75.0))
}

#[cfg(test)]
mod inspection_tests {
    use super::*;
    use crate::stats::{Skill, SkillType, TrainingLevel};

    fn skill(kind: SkillType, ranks: u32) -> Skill {
        Skill {
            skill_type: kind,
            ranks,
            init: 10,
            spent_xp: 0,
            next_rank_xp: None,
            base: 200,
            current: 300,
            training: TrainingLevel::Trained,
            trained_cost: 0,
            specialized_cost: 0,
        }
    }

    #[test]
    fn spellbook_range_uses_ranks_and_initial_bonus_not_buffed_or_attribute_skill() {
        let mut spell: SpellInfo = DatSpellBase {
            school: 1,
            base_range_constant: 10.0,
            base_range_mod: 0.5,
            ..DatSpellBase::default()
        }
        .into();
        let skills = HashMap::from([(SkillType::WarMagic, skill(SkillType::WarMagic, 20))]);
        assert_eq!(spellbook_range_metres(&spell, &skills), Some(25.0));
        spell.base_range_mod = 10.0;
        assert_eq!(spellbook_range_metres(&spell, &skills), Some(75.0));
        assert_eq!(spellbook_range_metres(&spell, &HashMap::new()), None);
    }

    #[test]
    fn schoolless_inspection_requires_complete_context_and_selects_highest_magic_level() {
        let spell: SpellInfo = DatSpellBase {
            base_range_mod: 1.0,
            ..DatSpellBase::default()
        }
        .into();
        let mut skills: HashMap<_, _> = [
            SkillType::WarMagic,
            SkillType::LifeMagic,
            SkillType::ItemEnchantment,
            SkillType::CreatureEnchantment,
            SkillType::VoidMagic,
        ]
        .into_iter()
        .map(|kind| (kind, skill(kind, 0)))
        .collect();
        skills.insert(SkillType::VoidMagic, skill(SkillType::VoidMagic, 30));
        assert_eq!(spellbook_range_metres(&spell, &skills), Some(40.0));
        skills.remove(&SkillType::LifeMagic);
        assert_eq!(spellbook_range_metres(&spell, &skills), None);
    }
}

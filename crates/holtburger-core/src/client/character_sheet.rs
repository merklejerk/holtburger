//! Complete, character-scoped progression facts for client presentation.

use holtburger_common::Guid;
use holtburger_common::properties::{PropertyInt64, PropertyString};
use holtburger_world::WorldState;
use holtburger_world::progression::StatTarget;
use holtburger_world::stats::{Attribute, CharacterLevelInfo, Resistances, Skill, Vital};

/// One skill and its authored descriptive content.
#[derive(Debug, Clone, PartialEq)]
pub struct ClientCharacterSkill {
    pub stat: Skill,
    pub description: Option<String>,
    /// End-of-retail visibility from the shared skill identity.
    pub available_in_eor: bool,
}

/// Atomic character facts; absent until this character's description is complete.
#[derive(Debug, Clone, PartialEq)]
pub struct ClientCharacterSheet {
    pub character: Guid,
    /// Server-owned name, absent until the player's identity has been hydrated.
    pub name: Option<String>,
    /// Selected localized title using the shared character inspection rules.
    pub title: Option<String>,
    /// Server-owned luminance storage capacity; absence means capacity is not known.
    pub maximum_luminance: Option<u64>,
    pub level: CharacterLevelInfo,
    pub attributes: Vec<Attribute>,
    pub vitals: Vec<Vital>,
    pub skills: Vec<ClientCharacterSkill>,
    /// Current armor after applicable enchantments and the shared minimum clamp.
    pub armor: i32,
    /// Current damage resistances from world-owned attribute, augmentation, and effect rules.
    pub resistances: Resistances,
    /// Current vitae multiplier; one means no penalty.
    pub vitae: f32,
    /// A send against these target fields awaits an authoritative target change.
    pub guarded_targets: Vec<StatTarget>,
}

impl ClientCharacterSheet {
    pub(super) fn from_world(world: &WorldState, guarded_targets: Vec<StatTarget>) -> Self {
        let mut attributes: Vec<_> = world.player.attributes.values().cloned().collect();
        attributes.sort_by_key(|stat| stat.attr_type);
        let mut vitals: Vec<_> = world.player.vitals.values().cloned().collect();
        vitals.sort_by_key(|stat| stat.vital_type);
        let mut skills: Vec<_> = world
            .player
            .skills
            .values()
            .cloned()
            .map(|stat| {
                let description = world
                    .skill_table
                    .skill_base_hash
                    .get(&(stat.skill_type as u32))
                    .map(|definition| definition.description.clone());
                ClientCharacterSkill {
                    available_in_eor: stat.skill_type.is_eor(),
                    stat,
                    description,
                }
            })
            .collect();
        skills.sort_by_key(|row| row.stat.skill_type);
        Self {
            character: world.player.guid,
            name: world
                .player_string_property(PropertyString::Name)
                .map(str::to_owned),
            title: world.player_entity().and_then(|entity| {
                holtburger_world::inspection::character_title(
                    &entity.properties,
                    &world.character_titles,
                )
            }),
            maximum_luminance: world
                .player_int64_property(PropertyInt64::MaximumLuminance)
                .map(|value| value as u64),
            level: world.get_level_info(),
            attributes,
            vitals,
            skills,
            armor: world.player_armor(),
            resistances: world.player_resistances(),
            vitae: world.player_vitae(),
            guarded_targets,
        }
    }
}

//! Creature and character inspection models, ratings, lineage, title, and PK helpers.

use holtburger_common::properties::{
    ObjectDescriptionFlag, PropertyInt, PropertyString, WorldObjectProperties,
    WorldObjectPropertyAccessors,
};
use holtburger_common::stats::CreatureType;
use holtburger_content::CharacterTitleCatalog;
use holtburger_protocol::messages::object::types::CreatureBuffs;
use strum_macros::Display;

use super::types::{ArmorCoverage, EnchantedValue, HeritageGroup, enchanted_value};
use super::{InspectionContext, InspectionSource};
use crate::state::allegiance::titles::rank_title;

/// Facts consumed only by creature inspection presentations.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureInspection {
    /// Retail-compatible creature or character-style identity derived once for every frontend.
    pub identity: CreatureIdentity,
    /// Effective current and maximum health with appraisal-supplied polarity.
    pub health: EnchantedValue<VitalRange>,
    /// Attributes, stamina, and mana disclosed as one optional profile block.
    pub attributes_and_vitals: Option<CreatureAttributesAndVitals>,
    /// Appraised armor totals for all nine body locations.
    pub armor_coverage: Option<ArmorCoverage>,
    /// Effective creature ratings disclosed by the server.
    pub ratings: Option<CreatureRatings>,
    /// Maximum-health bonus supplied by equipped gear.
    pub max_health_bonus: Option<i32>,
    /// Privacy-controlled affiliation and personal facts for character-style subjects.
    pub character_details: Option<CharacterDetails>,
}

/// Effective combat ratings sent by the server in one appraisal response.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureRatings {
    /// Effective outgoing damage rating.
    pub damage_rating: Option<i32>,
    /// Effective incoming damage resistance rating.
    pub damage_resistance_rating: Option<i32>,
    /// Effective critical-hit frequency rating.
    pub critical_rating: Option<i32>,
    /// Effective critical-hit damage rating.
    pub critical_damage_rating: Option<i32>,
    /// Effective critical-hit frequency resistance rating.
    pub critical_resistance_rating: Option<i32>,
    /// Effective critical-hit damage resistance rating.
    pub critical_damage_resistance_rating: Option<i32>,
    /// Effective PK-only outgoing damage rating.
    pub player_killer_damage_rating: Option<i32>,
    /// Effective PK-only incoming damage resistance rating.
    pub player_killer_damage_resistance_rating: Option<i32>,
    /// Endgame-creature overpower chance in integer percentage points.
    pub overpower_chance_percent: Option<i32>,
    /// Overpower resistance in integer percentage points.
    pub overpower_resistance_percent: Option<i32>,
    /// Effective healing boost rating.
    pub healing_boost_rating: Option<i32>,
    /// Effective nether resistance rating.
    pub nether_resistance_rating: Option<i32>,
    /// Effective damage-over-time resistance rating.
    pub damage_over_time_resistance_rating: Option<i32>,
    /// Effective life-magic drain and harm resistance rating.
    pub life_magic_resistance_rating: Option<i32>,
}

impl CreatureRatings {
    pub(super) fn from_properties(properties: &WorldObjectProperties) -> Self {
        Self {
            damage_rating: properties.get_int_prop(PropertyInt::DamageRating),
            damage_resistance_rating: properties.get_int_prop(PropertyInt::DamageResistRating),
            critical_rating: properties.get_int_prop(PropertyInt::CritRating),
            critical_damage_rating: properties.get_int_prop(PropertyInt::CritDamageRating),
            critical_resistance_rating: properties.get_int_prop(PropertyInt::CritResistRating),
            critical_damage_resistance_rating: properties
                .get_int_prop(PropertyInt::CritDamageResistRating),
            player_killer_damage_rating: properties.get_int_prop(PropertyInt::PkDamageRating),
            player_killer_damage_resistance_rating: properties
                .get_int_prop(PropertyInt::PkDamageResistRating),
            overpower_chance_percent: properties.get_int_prop(PropertyInt::Overpower),
            overpower_resistance_percent: properties.get_int_prop(PropertyInt::OverpowerResist),
            healing_boost_rating: properties.get_int_prop(PropertyInt::HealingBoostRating),
            nether_resistance_rating: properties.get_int_prop(PropertyInt::NetherResistRating),
            damage_over_time_resistance_rating: properties
                .get_int_prop(PropertyInt::DotResistRating),
            life_magic_resistance_rating: properties.get_int_prop(PropertyInt::LifeResistRating),
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.damage_rating.is_none()
            && self.damage_resistance_rating.is_none()
            && self.critical_rating.is_none()
            && self.critical_damage_rating.is_none()
            && self.critical_resistance_rating.is_none()
            && self.critical_damage_resistance_rating.is_none()
            && self.player_killer_damage_rating.is_none()
            && self.player_killer_damage_resistance_rating.is_none()
            && self.overpower_chance_percent.is_none()
            && self.overpower_resistance_percent.is_none()
            && self.healing_boost_rating.is_none()
            && self.nether_resistance_rating.is_none()
            && self.damage_over_time_resistance_rating.is_none()
            && self.life_magic_resistance_rating.is_none()
    }
}

/// Numeric rank and its optional shared title from one inspection response.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterAllegianceRank {
    /// Server-disclosed numeric rank, including values without a known title.
    pub rank: i32,
    /// Retail title when rank, heritage and gender are all supplied and supported.
    pub title: Option<String>,
}

impl CharacterAllegianceRank {
    fn from_properties(properties: &WorldObjectProperties) -> Option<Self> {
        let rank = properties.get_int_prop(PropertyInt::AllegianceRank)?;
        let title = properties
            .get_int_prop(PropertyInt::HeritageGroup)
            .zip(properties.get_int_prop(PropertyInt::Gender))
            .and_then(|(heritage, gender)| {
                rank_title(
                    u8::try_from(heritage).ok()?,
                    u8::try_from(gender).ok()?,
                    u16::try_from(rank).ok()?,
                )
            })
            .map(str::to_owned);
        Some(Self { rank, title })
    }
}

/// Server-disclosed character affiliation and privacy-controlled personal facts.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterDetails {
    /// Inspected character’s own rank and title; unrelated to patron/monarch titles.
    pub allegiance_rank: Option<CharacterAllegianceRank>,
    /// Allegiance name, when the character belongs to one.
    pub allegiance_name: Option<String>,
    /// Server-authored patron title and name.
    pub patron: Option<String>,
    /// Server-authored monarch title and name.
    pub monarch: Option<String>,
    /// Total allegiance followers, disclosed for monarchs.
    pub allegiance_followers: Option<i32>,
    /// Current fellowship name.
    pub fellowship: Option<String>,
    /// Server-authored character creation date.
    pub arrived_in_dereth: Option<String>,
    /// Total character age in seconds.
    pub age_seconds: Option<i32>,
    /// Number of character deaths.
    pub deaths: Option<i32>,
    /// Number of character titles earned.
    pub titles_earned: Option<i32>,
    /// Chess rank.
    pub chess_rank: Option<i32>,
    /// Fishing skill exposed by the legacy FakeFishingSkill property.
    pub fishing_skill: Option<i32>,
    /// Number of enlightenment cycles completed.
    pub enlightenment: Option<i32>,
}

impl CharacterDetails {
    pub(super) fn from_properties(properties: &WorldObjectProperties) -> Self {
        Self {
            allegiance_rank: CharacterAllegianceRank::from_properties(properties),
            allegiance_name: properties
                .get_string_prop(PropertyString::AllegianceName)
                .map(str::to_owned),
            patron: properties
                .get_string_prop(PropertyString::PatronsTitle)
                .map(str::to_owned),
            monarch: properties
                .get_string_prop(PropertyString::MonarchsTitle)
                .map(str::to_owned),
            allegiance_followers: properties.get_int_prop(PropertyInt::AllegianceFollowers),
            fellowship: properties
                .get_string_prop(PropertyString::Fellowship)
                .map(str::to_owned),
            arrived_in_dereth: properties
                .get_string_prop(PropertyString::DateOfBirth)
                .map(str::to_owned),
            age_seconds: properties.get_int_prop(PropertyInt::Age),
            deaths: properties.get_int_prop(PropertyInt::NumDeaths),
            titles_earned: properties.get_int_prop(PropertyInt::NumCharacterTitles),
            chess_rank: properties.get_int_prop(PropertyInt::ChessRank),
            fishing_skill: properties.get_int_prop(PropertyInt::FakeFishingSkill),
            enlightenment: properties.get_int_prop(PropertyInt::Enlightenment),
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.allegiance_rank.is_none()
            && self.allegiance_name.is_none()
            && self.patron.is_none()
            && self.monarch.is_none()
            && self.allegiance_followers.is_none()
            && self.fellowship.is_none()
            && self.arrived_in_dereth.is_none()
            && self.age_seconds.is_none()
            && self.deaths.is_none()
            && self.titles_earned.is_none()
            && self.chess_rank.is_none()
            && self.fishing_skill.is_none()
            && self.enlightenment.is_none()
    }
}

/// Mutually exclusive identity presentations selected by retail's creature examination rules.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum CreatureIdentity {
    /// Ordinary creature presentation with its best available taxonomy label.
    Creature {
        /// Gender plus heritage, or creature type when heritage is absent.
        lineage: Option<String>,
    },
    /// Character-style presentation selected by `Template` or `CharacterTitleId`.
    Character {
        /// Gender plus heritage, or creature type when heritage is absent.
        lineage: Option<String>,
        /// Localized character title, falling back to the server-authored template role.
        role: Option<String>,
        /// Public-flag classification displayed by the retail character inspector.
        player_killer_status: PlayerKillerClassification,
    },
}

impl CreatureIdentity {
    /// Lineage text shared by compact creature headers in every frontend.
    pub fn lineage(&self) -> Option<&str> {
        match self {
            Self::Creature { lineage } | Self::Character { lineage, .. } => lineage.as_deref(),
        }
    }
}

/// Three labels exposed by retail's character inspector, derived from public object flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, Display)]
#[serde(rename_all = "kebab-case")]
pub enum PlayerKillerClassification {
    #[strum(serialize = "Non-Player Killer")]
    NonPlayerKiller,
    #[strum(serialize = "Player Killer Lite")]
    PlayerKillerLite,
    #[strum(serialize = "Player Killer")]
    PlayerKiller,
}

/// Current and maximum vital values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VitalRange {
    /// Current vital value.
    pub current: u32,
    /// Maximum vital value.
    pub max: u32,
}

/// Creature attributes and secondary vitals sent as one optional profile block.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureAttributesAndVitals {
    /// Six effective primary attributes with appraisal-supplied polarity.
    pub attributes: CreatureInspectionAttributes,
    /// Effective current and maximum stamina with appraisal-supplied polarity.
    pub stamina: EnchantedValue<VitalRange>,
    /// Effective current and maximum mana with appraisal-supplied polarity.
    pub mana: EnchantedValue<VitalRange>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureInspectionAttributes {
    pub strength: EnchantedValue<u32>,
    pub endurance: EnchantedValue<u32>,
    pub coordination: EnchantedValue<u32>,
    pub quickness: EnchantedValue<u32>,
    pub focus: EnchantedValue<u32>,
    pub self_attr: EnchantedValue<u32>,
}

/// Localized selected title, with the server-authored character template as fallback.
pub fn character_title(
    object: &impl WorldObjectPropertyAccessors,
    character_titles: &CharacterTitleCatalog,
) -> Option<String> {
    let title_id = object.get_int_prop(PropertyInt::CharacterTitleId);
    title_id
        .and_then(|value| u32::try_from(value).ok())
        .and_then(|value| character_titles.title(value))
        .map(str::to_owned)
        .or_else(|| {
            object
                .get_string_prop(PropertyString::Template)
                .map(str::to_owned)
        })
}

fn creature_identity(
    object: &InspectionSource<'_>,
    character_titles: &CharacterTitleCatalog,
) -> CreatureIdentity {
    let lineage = creature_lineage(object);
    let title_id = object.get_int_prop(PropertyInt::CharacterTitleId);
    let role = character_title(object, character_titles);

    // Retail appraisal presentation selects the character inspector when either property is
    // present. Role text independently follows retail title resolution and then the authored
    // template fallback.
    if role.is_some() || title_id.is_some() {
        CreatureIdentity::Character {
            lineage,
            role,
            player_killer_status: player_killer_classification(object.public_flags),
        }
    } else {
        CreatureIdentity::Creature { lineage }
    }
}

fn creature_lineage(object: &InspectionSource<'_>) -> Option<String> {
    let gender = object
        .get_int_prop(PropertyInt::Gender)
        .and_then(gender_display_name);
    let ancestry = match object.get_int_prop(PropertyInt::HeritageGroup) {
        Some(heritage) if heritage != HeritageGroup::Invalid as i32 => {
            HeritageGroup::from_repr(heritage as usize).map(heritage_display_name)
        }
        _ => object
            .get_int_prop(PropertyInt::CreatureType)
            .and_then(|value| CreatureType::from_repr(value as u32))
            .map(|value| split_semantic_name(&value.to_string())),
    };

    match (gender, ancestry) {
        (Some(gender), Some(ancestry)) => Some(format!("{gender} {ancestry}")),
        (Some(gender), None) => Some(gender.to_owned()),
        (None, Some(ancestry)) => Some(ancestry),
        (None, None) => None,
    }
}

fn gender_display_name(value: i32) -> Option<&'static str> {
    match value {
        1 => Some("Male"),
        2 => Some("Female"),
        _ => None,
    }
}

fn heritage_display_name(value: HeritageGroup) -> String {
    match value {
        HeritageGroup::Gharundim => "Gharu'ndim".to_owned(),
        HeritageGroup::Shadowbound => "Umbraen".to_owned(),
        HeritageGroup::OlthoiAcid => "Olthoi".to_owned(),
        _ => split_semantic_name(&value.to_string()),
    }
}

fn split_semantic_name(value: &str) -> String {
    let mut display = String::with_capacity(value.len());
    let mut previous_was_lowercase_or_digit = false;
    for character in value.chars() {
        if character == '_' || character == '-' {
            display.push(' ');
            previous_was_lowercase_or_digit = false;
            continue;
        }
        if character.is_uppercase() && previous_was_lowercase_or_digit {
            display.push(' ');
        }
        previous_was_lowercase_or_digit = character.is_lowercase() || character.is_ascii_digit();
        display.push(character);
    }
    display
}

pub(super) fn player_killer_classification(
    flags: ObjectDescriptionFlag,
) -> PlayerKillerClassification {
    // CharExamineUI reads the live object's IsPK/IsPKLite bits rather than the raw appraisal
    // property, with PK taking precedence if both are present.
    if flags.contains(ObjectDescriptionFlag::PLAYER_KILLER) {
        PlayerKillerClassification::PlayerKiller
    } else if flags.contains(ObjectDescriptionFlag::PK_LITE_STATUS) {
        PlayerKillerClassification::PlayerKillerLite
    } else {
        PlayerKillerClassification::NonPlayerKiller
    }
}

impl CreatureInspection {
    pub(super) fn from_object(
        object: &InspectionSource<'_>,
        context: InspectionContext<'_>,
    ) -> Self {
        let profile = object
            .creature_profile
            .expect("creature inspection classification requires a creature profile");
        let buffs = profile.buffs.as_ref();
        let identity = creature_identity(object, context.character_titles);
        let supplement = object.supplement;
        let character_details = if matches!(identity, CreatureIdentity::Character { .. }) {
            supplement.and_then(|value| value.character_details.clone())
        } else {
            None
        };
        Self {
            character_details,
            identity,
            health: creature_enchanted_value(
                VitalRange {
                    current: profile.health,
                    max: profile.health_max,
                },
                buffs,
                0x40,
            ),
            attributes_and_vitals: profile.attributes.as_ref().map(|attributes| {
                CreatureAttributesAndVitals {
                    attributes: CreatureInspectionAttributes {
                        strength: creature_enchanted_value(attributes.strength, buffs, 0x1),
                        endurance: creature_enchanted_value(attributes.endurance, buffs, 0x2),
                        coordination: creature_enchanted_value(attributes.coordination, buffs, 0x8),
                        quickness: creature_enchanted_value(attributes.quickness, buffs, 0x4),
                        focus: creature_enchanted_value(attributes.focus, buffs, 0x10),
                        self_attr: creature_enchanted_value(attributes.self_attr, buffs, 0x20),
                    },
                    stamina: creature_enchanted_value(
                        VitalRange {
                            current: attributes.stamina,
                            max: attributes.stamina_max,
                        },
                        buffs,
                        0x80,
                    ),
                    mana: creature_enchanted_value(
                        VitalRange {
                            current: attributes.mana,
                            max: attributes.mana_max,
                        },
                        buffs,
                        0x100,
                    ),
                }
            }),
            armor_coverage: supplement.and_then(|value| value.armor_coverage.clone()),
            ratings: supplement.and_then(|value| value.ratings.clone()),
            max_health_bonus: supplement.and_then(|value| value.max_health_bonus),
        }
    }
}

fn creature_enchanted_value<T: Copy>(
    effective: T,
    buffs: Option<&CreatureBuffs>,
    mask: u16,
) -> EnchantedValue<T> {
    enchanted_value(
        effective,
        None,
        buffs.map(|buffs| buffs.highlights),
        buffs.map(|buffs| buffs.colors),
        mask,
    )
}

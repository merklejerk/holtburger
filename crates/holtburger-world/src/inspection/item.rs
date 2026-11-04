//! Item appraisal facts shared by graphical and terminal inspection.

use super::{
    AttributeType, HeritageGroup, InspectionSource, ObjectInspectionError, UseRequirement,
    VitalType,
};
use holtburger_common::properties::{
    ItemType, MaterialType, PropertyBool, PropertyDataId, PropertyFloat, PropertyInt,
    PropertyString, WorldObjectExt as _, WorldObjectPropertyAccessors,
};
use holtburger_common::stats::SkillType;

/// Training classes that can be required for item activation, ordered by strength.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    serde::Serialize,
    serde::Deserialize,
    strum_macros::Display,
)]
#[serde(rename_all = "kebab-case")]
pub enum ActivationTraining {
    /// Training is sufficient.
    Trained,
    /// Specialization is required.
    Specialized,
}

/// A skill threshold, or a training requirement with an independently optional threshold.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SkillActivationRequirement {
    /// Current skill must reach this value; training is not independently required.
    Minimum {
        /// Minimum current (buffed) skill value.
        minimum: i32,
    },
    /// The skill must be trained or specialized, optionally at a minimum current value.
    Training {
        /// Required training class.
        training: ActivationTraining,
        /// Optional minimum current skill value.
        minimum: Option<i32>,
    },
}

impl SkillActivationRequirement {
    fn merge(&mut self, other: Self) {
        *self = match (&*self, other) {
            (Self::Minimum { minimum: a }, Self::Minimum { minimum: b }) => Self::Minimum {
                minimum: (*a).max(b),
            },
            (Self::Training { training, minimum }, Self::Minimum { minimum: other }) => {
                Self::Training {
                    training: *training,
                    minimum: Some(minimum.map_or(other, |value| value.max(other))),
                }
            }
            (
                Self::Minimum { minimum },
                Self::Training {
                    training,
                    minimum: other,
                },
            ) => Self::Training {
                training,
                minimum: Some(other.map_or(*minimum, |value| value.max(*minimum))),
            },
            (
                Self::Training {
                    training: a,
                    minimum,
                },
                Self::Training {
                    training: b,
                    minimum: other,
                },
            ) => Self::Training {
                training: (*a).max(b),
                minimum: minimum.iter().chain(other.iter()).copied().max(),
            },
        };
    }
}

/// Disclosed equipment-set membership; unknown IDs retain their identity without an invented name.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentSetInfo {
    /// Server-authored set ID.
    pub id: i32,
    /// Known static display name, absent for an unrecognized set.
    pub name: Option<String>,
}

/// Gear contribution kinds, distinct from multiplier and percentage bonuses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GearRatingKind {
    /// Outgoing damage rating.
    Damage,
    /// Incoming damage resistance rating.
    DamageResistance,
    /// Critical-hit frequency rating.
    Critical,
    /// Critical-hit frequency resistance rating.
    CriticalResistance,
    /// Critical-hit damage rating.
    CriticalDamage,
    /// Critical-hit damage resistance rating.
    CriticalDamageResistance,
    /// Healing boost rating.
    HealingBoost,
    /// Nether damage resistance rating.
    NetherResistance,
    /// Life-magic damage resistance rating.
    LifeResistance,
    /// Maximum health bonus in points.
    MaxHealth,
    /// Player-killer outgoing damage rating.
    PlayerKillerDamage,
    /// Player-killer incoming damage resistance rating.
    PlayerKillerDamageResistance,
    /// Overpower rating.
    Overpower,
    /// Overpower resistance rating.
    OverpowerResistance,
}

/// One disclosed gear contribution in the units of its kind.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GearRating {
    /// Meaning and units of the contribution.
    pub kind: GearRatingKind,
    /// Disclosed value; zero is preserved.
    pub value: i32,
}

/// Meaning of a disclosed portal maximum; an unlimited bound differs from missing data.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PortalMaximumLevel {
    /// No upper character-level restriction.
    Unlimited,
    /// Disclosed nonzero upper character-level limit.
    Level {
        /// Maximum accepted level.
        level: i32,
    },
}

/// Server-disclosed remaining lifetime, interpreted at appraisal time.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RemainingLifetime {
    /// The server-calculated remaining duration has elapsed.
    Expired,
    /// Time remaining at appraisal, without a local ticking deadline.
    Remaining {
        /// Remaining whole seconds.
        seconds: u32,
    },
}

/// Independently disclosed portal character-level bounds.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortalLevelLimits {
    /// Minimum character level, when disclosed.
    pub minimum: Option<i32>,
    /// Maximum character level, explicitly unlimited, or undisclosed.
    pub maximum: Option<PortalMaximumLevel>,
}

/// Expiration durations from the latest appraisal, without a client-clock deadline.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemLifetime {
    /// Authored total lifespan in seconds.
    pub lifespan_seconds: Option<i32>,
    /// Remaining lifetime interpreted from the server appraisal.
    pub remaining: Option<RemainingLifetime>,
}

/// Mana-stone behavior disclosed independently from its current stored charge.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManaStoneInfo {
    /// Fraction of source mana recovered when draining an item.
    pub efficiency: Option<f64>,
    /// Probability that the stone is destroyed after use.
    pub destruction_chance: Option<f64>,
}

/// Embedded gems; count and identity are meaningful only as a complete pair.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GemInfo {
    /// Authored embedded-gem count.
    pub count: i32,
    /// Known material name from the shared material enum.
    pub material: MaterialType,
}

/// Server-disclosed attribution for item creation and modification.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemAttribution {
    /// Original craftsman name.
    pub craftsman: Option<String>,
    /// Last tinker name.
    pub tinker: Option<String>,
    /// Imbuer name.
    pub imbuer: Option<String>,
    /// Gear-plating attribution.
    pub plating: Option<String>,
}

impl EquipmentSetInfo {
    pub(super) fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        let id = object.get_int_prop(PropertyInt::EquipmentSetId)?;
        (id != 0).then(|| Self {
            id,
            name: holtburger_content::equipment_sets::equipment_set_name(id).map(str::to_owned),
        })
    }
}

impl GearRating {
    pub(super) fn from_object(object: &InspectionSource<'_>) -> Vec<Self> {
        GEAR_RATING_PROPERTIES
            .iter()
            .filter_map(|(property, kind)| {
                object
                    .get_int_prop(*property)
                    .map(|value| Self { kind: *kind, value })
            })
            .collect()
    }
}

/// Canonical mapping also used to clear obsolete appraisal-owned ratings before a merge.
pub(crate) const GEAR_RATING_PROPERTIES: &[(PropertyInt, GearRatingKind)] = &[
    (PropertyInt::GearDamage, GearRatingKind::Damage),
    (
        PropertyInt::GearDamageResist,
        GearRatingKind::DamageResistance,
    ),
    (PropertyInt::GearCrit, GearRatingKind::Critical),
    (
        PropertyInt::GearCritResist,
        GearRatingKind::CriticalResistance,
    ),
    (PropertyInt::GearCritDamage, GearRatingKind::CriticalDamage),
    (
        PropertyInt::GearCritDamageResist,
        GearRatingKind::CriticalDamageResistance,
    ),
    (PropertyInt::GearHealingBoost, GearRatingKind::HealingBoost),
    (
        PropertyInt::GearNetherResist,
        GearRatingKind::NetherResistance,
    ),
    (PropertyInt::GearLifeResist, GearRatingKind::LifeResistance),
    (PropertyInt::GearMaxHealth, GearRatingKind::MaxHealth),
    (
        PropertyInt::GearPkDamageRating,
        GearRatingKind::PlayerKillerDamage,
    ),
    (
        PropertyInt::GearPkDamageResistRating,
        GearRatingKind::PlayerKillerDamageResistance,
    ),
    (PropertyInt::GearOverpower, GearRatingKind::Overpower),
    (
        PropertyInt::GearOverpowerResist,
        GearRatingKind::OverpowerResistance,
    ),
];

impl PortalLevelLimits {
    pub(super) fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        let minimum = object.get_int_prop(PropertyInt::MinLevel);
        let maximum = object.get_int_prop(PropertyInt::MaxLevel).map(|level| {
            if level == 0 {
                PortalMaximumLevel::Unlimited
            } else {
                PortalMaximumLevel::Level { level }
            }
        });
        (minimum.is_some() || maximum.is_some()).then_some(Self { minimum, maximum })
    }
}

impl ItemLifetime {
    pub(super) fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        let lifespan_seconds = object.get_int_prop(PropertyInt::Lifespan);
        let remaining = object
            .get_int_prop(PropertyInt::RemainingLifespan)
            .map(|seconds| {
                if seconds <= 0 {
                    RemainingLifetime::Expired
                } else {
                    RemainingLifetime::Remaining {
                        seconds: seconds as u32,
                    }
                }
            });
        (lifespan_seconds.is_some() || remaining.is_some()).then_some(Self {
            lifespan_seconds,
            remaining,
        })
    }
}

impl ManaStoneInfo {
    pub(super) fn from_object(
        object: &InspectionSource<'_>,
    ) -> Result<Option<Self>, ObjectInspectionError> {
        if !object
            .item_type()
            .is_some_and(|kind| kind.contains(ItemType::MANA_STONE))
        {
            return Ok(None);
        }
        let efficiency = object.get_float_prop(PropertyFloat::ItemEfficiency);
        let destruction_chance = object.get_float_prop(PropertyFloat::ManaStoneDestroyChance);
        // JSON would turn a non-finite value into null while the terminal still prints it.
        if efficiency.is_some_and(|value| !value.is_finite()) {
            return Err(ObjectInspectionError::NonFiniteManaStoneEfficiency { guid: object.guid });
        }
        if destruction_chance.is_some_and(|value| !value.is_finite()) {
            return Err(ObjectInspectionError::NonFiniteManaStoneDestructionChance {
                guid: object.guid,
            });
        }
        Ok(
            (efficiency.is_some() || destruction_chance.is_some()).then_some(Self {
                efficiency,
                destruction_chance,
            }),
        )
    }
}

impl GemInfo {
    pub(super) fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        let count = object
            .get_int_prop(PropertyInt::GemCount)
            .filter(|count| *count > 0)?;
        let material = object.get_int_prop(PropertyInt::GemType)?;
        let Some(material) = MaterialType::from_repr(material as u32) else {
            log::warn!(
                "object {:?} has unknown gem material {material}",
                object.guid
            );
            return None;
        };
        Some(Self { count, material })
    }
}

impl ItemAttribution {
    pub(super) fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        let craftsman = object
            .get_string_prop(PropertyString::CraftsmanName)
            .map(str::to_owned);
        let tinker = object
            .get_string_prop(PropertyString::TinkerName)
            .map(str::to_owned);
        let imbuer = object
            .get_string_prop(PropertyString::ImbuerName)
            .map(str::to_owned);
        let plating = object
            .get_string_prop(PropertyString::GearPlatingName)
            .map(str::to_owned);
        (craftsman.is_some() || tinker.is_some() || imbuer.is_some() || plating.is_some())
            .then_some(Self {
                craftsman,
                tinker,
                imbuer,
                plating,
            })
    }
}

fn add_skill(
    requirements: &mut Vec<UseRequirement>,
    raw_skill: u32,
    requirement: SkillActivationRequirement,
    object: &InspectionSource<'_>,
) {
    let Some(skill) = SkillType::from_repr(raw_skill) else {
        log::warn!(
            "object {:?} has unknown activation skill {raw_skill}",
            object.guid
        );
        return;
    };
    for existing in requirements.iter_mut() {
        if let UseRequirement::Skill {
            skill: existing_skill,
            requirement: existing_requirement,
        } = existing
            && *existing_skill == skill
        {
            existing_requirement.merge(requirement);
            return;
        }
    }
    requirements.push(UseRequirement::Skill { skill, requirement });
}

pub(super) fn get_use_requirements(object: &InspectionSource<'_>) -> Vec<UseRequirement> {
    let mut requirements = Vec::new();
    for (property, training) in [
        (PropertyInt::UseRequiresSkill, ActivationTraining::Trained),
        (
            PropertyInt::UseRequiresSkillSpec,
            ActivationTraining::Specialized,
        ),
    ] {
        if let Some(skill) = object.get_int_prop(property) {
            add_skill(
                &mut requirements,
                skill as u32,
                SkillActivationRequirement::Training {
                    training,
                    minimum: object.get_int_prop(PropertyInt::UseRequiresSkillLevel),
                },
                object,
            );
        }
    }
    if let Some(skill) = object.get_data_prop(PropertyDataId::ItemSpecializedOnly) {
        add_skill(
            &mut requirements,
            skill.0,
            SkillActivationRequirement::Training {
                training: ActivationTraining::Specialized,
                minimum: object.get_int_prop(PropertyInt::ItemSkillLevelLimit),
            },
            object,
        );
    }
    if let Some((skill, minimum)) = object
        .get_int_prop(PropertyInt::AppraisalItemSkill)
        .zip(object.get_int_prop(PropertyInt::ItemSkillLevelLimit))
    {
        add_skill(
            &mut requirements,
            skill as u32,
            SkillActivationRequirement::Minimum { minimum },
            object,
        );
    }
    if let Some(minimum) = object
        .get_int_prop(PropertyInt::ItemDifficulty)
        .filter(|value| *value > 0)
    {
        add_skill(
            &mut requirements,
            SkillType::ArcaneLore as u32,
            SkillActivationRequirement::Minimum { minimum },
            object,
        );
    }
    if let Some(level) = object.get_int_prop(PropertyInt::UseRequiresLevel) {
        requirements.push(UseRequirement::Level { level });
    }
    if let Some((attribute, minimum)) = object
        .get_int_prop(PropertyInt::ItemAttributeLimit)
        .zip(object.get_int_prop(PropertyInt::ItemAttributeLevelLimit))
    {
        if let Some(attribute) = AttributeType::from_repr(attribute as usize) {
            requirements.push(UseRequirement::Attribute { attribute, minimum });
        } else {
            log::warn!(
                "object {:?} has unknown activation attribute {attribute}",
                object.guid
            );
        }
    }
    if let Some((vital, minimum)) = object
        .get_int_prop(PropertyInt::ItemAttribute2ndLimit)
        .zip(object.get_int_prop(PropertyInt::ItemAttribute2ndLevelLimit))
    {
        if let Some(vital) = VitalType::from_repr(vital as usize) {
            requirements.push(UseRequirement::Vital { vital, minimum });
        } else {
            log::warn!(
                "object {:?} has unknown activation vital {vital}",
                object.guid
            );
        }
    }
    if let Some(heritage) = object
        .get_int_prop(PropertyInt::HeritageGroup)
        .and_then(|value| HeritageGroup::from_repr(value as usize))
        .filter(|heritage| *heritage != HeritageGroup::Invalid)
    {
        requirements.push(UseRequirement::Heritage { heritage });
    }
    if let Some(rank) = object
        .get_int_prop(PropertyInt::ItemAllegianceRankLimit)
        .filter(|rank| *rank > 0)
    {
        requirements.push(UseRequirement::AllegianceRank { rank });
    }
    if object.get_bool_prop_opt(PropertyBool::AppraisalHasAllowedActivator) == Some(true) {
        requirements.push(UseRequirement::Owner {
            name: object
                .get_string_prop(PropertyString::CraftsmanName)
                .map(str::to_owned),
        });
    }
    requirements
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::Entity;
    use crate::inspection::{
        InspectionContext, InspectionSpellRole, ObjectInspection, ObjectInspectionDetails,
    };
    use holtburger_common::properties::WorldObjectPropertyAccessorsMut;
    use holtburger_common::{Guid, position::WorldPosition};
    use holtburger_protocol::messages::object::events::IdentifyObjectResponseEventData;

    fn inspect(entity: &Entity) -> Box<crate::inspection::ItemInspection> {
        let titles = holtburger_content::CharacterTitleCatalog::default();
        let inspection =
            ObjectInspection::from_entity(entity, InspectionContext::new(&titles)).unwrap();
        let ObjectInspectionDetails::Item(item) = inspection.details else {
            panic!("item inspection");
        };
        item
    }

    #[test]
    fn independent_requirement_sources_merge_strongest_constraints() {
        let mut entity = Entity::new(Guid(1), "Essence".into(), WorldPosition::default());
        entity.set_int_prop(PropertyInt::UseRequiresSkill, SkillType::Summoning as i32);
        entity.set_int_prop(PropertyInt::UseRequiresSkillLevel, 400);
        entity.set_int_prop(PropertyInt::AppraisalItemSkill, SkillType::Summoning as i32);
        entity.set_int_prop(PropertyInt::ItemSkillLevelLimit, 570);
        entity.set_did_prop(
            PropertyDataId::ItemSpecializedOnly,
            Guid(SkillType::Summoning as u32),
        );
        entity.set_int_prop(PropertyInt::ItemDifficulty, 250);
        entity.set_int_prop(
            PropertyInt::ItemAttributeLimit,
            AttributeType::SelfAttr as i32,
        );
        entity.set_int_prop(PropertyInt::ItemAttributeLevelLimit, 295);
        entity.set_int_prop(
            PropertyInt::ItemAttribute2ndLimit,
            VitalType::MaxMana as i32,
        );
        entity.set_int_prop(PropertyInt::ItemAttribute2ndLevelLimit, 300);
        let item = inspect(&entity);
        assert_eq!(
            item.use_requirements,
            vec![
                UseRequirement::Skill {
                    skill: SkillType::Summoning,
                    requirement: SkillActivationRequirement::Training {
                        training: ActivationTraining::Specialized,
                        minimum: Some(570),
                    }
                },
                UseRequirement::Skill {
                    skill: SkillType::ArcaneLore,
                    requirement: SkillActivationRequirement::Minimum { minimum: 250 }
                },
                UseRequirement::Attribute {
                    attribute: AttributeType::SelfAttr,
                    minimum: 295
                },
                UseRequirement::Vital {
                    vital: VitalType::MaxMana,
                    minimum: 300
                },
            ]
        );
        assert!(item.wield_requirements.is_empty());
    }

    #[test]
    fn successful_appraisal_replaces_item_facts_and_failed_appraisal_preserves_them() {
        let mut entity = Entity::new(Guid(1), "Weapon".into(), WorldPosition::default());
        let mut response = IdentifyObjectResponseEventData {
            object_guid: entity.guid,
            success: true,
            ..Default::default()
        };
        for (key, value) in [
            (
                PropertyInt::AppraisalItemSkill,
                SkillType::HeavyWeapons as i32,
            ),
            (PropertyInt::ItemSkillLevelLimit, 400),
            (PropertyInt::EquipmentSetId, 13),
            (PropertyInt::GearCrit, 0),
            (PropertyInt::MinLevel, 80),
            (PropertyInt::MaxLevel, 0),
            (PropertyInt::Lifespan, 3600),
            (PropertyInt::RemainingLifespan, -1),
            (PropertyInt::GemCount, 2),
            (PropertyInt::GemType, MaterialType::Ruby as i32),
        ] {
            response.properties.set_int_prop(key, value);
        }
        response
            .properties
            .set_did_prop(PropertyDataId::ProcSpell, Guid(42));
        response
            .properties
            .set_bool_prop(PropertyBool::Dyable, false);
        response
            .properties
            .set_bool_prop(PropertyBool::AppraisalHasAllowedActivator, true);
        response
            .properties
            .set_string_prop(PropertyString::CraftsmanName, "Crafter".into());
        response.spell_book = vec![42, 0x8000_002A];
        assert!(entity.apply_identify_response(&response));
        let before = inspect(&entity);
        assert_eq!(
            before.equipment_set.as_ref().unwrap().name.as_deref(),
            Some("Soldier's")
        );
        assert_eq!(
            before.gear_ratings,
            vec![GearRating {
                kind: GearRatingKind::Critical,
                value: 0
            }]
        );
        assert_eq!(
            before.portal_levels,
            Some(PortalLevelLimits {
                minimum: Some(80),
                maximum: Some(PortalMaximumLevel::Unlimited)
            })
        );
        assert_eq!(
            before.lifetime.as_ref().unwrap().remaining,
            Some(RemainingLifetime::Expired)
        );
        assert_eq!(before.status.dyeable, Some(false));
        assert_eq!(
            before.gems,
            Some(GemInfo {
                count: 2,
                material: MaterialType::Ruby
            })
        );
        assert_eq!(before.spells[0].role, InspectionSpellRole::Triggered);
        assert_eq!(
            before.spells[1].role,
            InspectionSpellRole::ActiveEnchantment
        );
        assert!(before.use_requirements.contains(&UseRequirement::Owner {
            name: Some("Crafter".into())
        }));

        response.success = false;
        response.properties = Default::default();
        response.spell_book.clear();
        assert!(!entity.apply_identify_response(&response));
        assert_eq!(inspect(&entity), before);

        response.success = true;
        assert!(entity.apply_identify_response(&response));
        let after = inspect(&entity);
        assert!(after.use_requirements.is_empty());
        assert!(after.equipment_set.is_none());
        assert!(after.gear_ratings.is_empty());
        assert!(after.portal_levels.is_none());
        assert!(after.lifetime.is_none());
        assert!(after.gems.is_none());
        assert!(after.attribution.is_none());
        assert_eq!(after.status.dyeable, None);
        assert!(after.spells.is_empty());
    }

    #[test]
    fn mana_stone_zero_risks_and_unknown_set_identity_are_preserved() {
        let mut entity = Entity::new(Guid(1), "Stone".into(), WorldPosition::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::MANA_STONE.bits() as i32);
        entity.set_float_prop(PropertyFloat::ItemEfficiency, 0.0);
        entity.set_float_prop(PropertyFloat::ManaStoneDestroyChance, 0.0);
        entity.set_int_prop(PropertyInt::EquipmentSetId, i32::MAX);
        let item = inspect(&entity);
        assert_eq!(
            item.mana_stone,
            Some(ManaStoneInfo {
                efficiency: Some(0.0),
                destruction_chance: Some(0.0)
            })
        );
        assert_eq!(
            item.equipment_set,
            Some(EquipmentSetInfo {
                id: i32::MAX,
                name: None
            })
        );
    }
    #[test]
    fn mana_stone_rejects_non_finite_values_before_frontend_projection() {
        let mut entity = Entity::new(Guid(1), "Stone".into(), WorldPosition::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::MANA_STONE.bits() as i32);
        let titles = holtburger_content::CharacterTitleCatalog::default();
        for (property, expected) in [
            (
                PropertyFloat::ItemEfficiency,
                ObjectInspectionError::NonFiniteManaStoneEfficiency { guid: entity.guid },
            ),
            (
                PropertyFloat::ManaStoneDestroyChance,
                ObjectInspectionError::NonFiniteManaStoneDestructionChance { guid: entity.guid },
            ),
        ] {
            for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
                entity.set_float_prop(property, value);
                assert_eq!(
                    ObjectInspection::from_entity(&entity, InspectionContext::new(&titles)),
                    Err(expected.clone())
                );
            }
            entity.properties.floats.0.remove(&property);
        }
    }
}

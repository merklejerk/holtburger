use super::creature::player_killer_classification;
use super::item_details::{PORTAL_RESTRICTION_FLAGS, item_coverage};
use super::*;
use crate::entity::Entity;
use holtburger_common::Guid;
use holtburger_common::legacy_hash::legacy_string_hash;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{DamageType, ImbuedEffectType, ItemType, PropertyInt64};
use holtburger_common::properties::{
    ObjectDescriptionFlag, PropertyBool, PropertyFloat, PropertyInt, PropertyString,
    WorldObjectPropertyAccessorsMut,
};
use holtburger_common::stats::{CreatureType, SkillType, VitalType};
use holtburger_dat::file_type::{EnumMapper, StringTable, StringTableData};
use holtburger_protocol::messages::object::events::{
    IdentifyObjectResponseEventData, IdentifyResponseFlags,
};
use holtburger_protocol::messages::object::types::{
    ArmorLevels, ArmorProfile, CreatureAttributes, CreatureBuffs, CreatureProfile,
    CreatureProfileFlags, WeaponProfile,
};

fn inspect_entity(entity: &Entity) -> Result<ObjectInspection, ObjectInspectionError> {
    let titles = CharacterTitleCatalog::default();
    ObjectInspection::from_entity(entity, InspectionContext::new(&titles))
}

#[test]
fn augmentation_cost_preserves_appraisal_absence_zero_and_exact_xp() {
    let mut entity = Entity::new(Guid(1), "Augmentation Gem".into(), WorldPosition::default());
    for cost in [None, Some(0), Some(1_000_000_000), Some(i64::MAX), None] {
        let mut response = IdentifyObjectResponseEventData {
            object_guid: entity.guid,
            success: true,
            ..Default::default()
        };
        if let Some(cost) = cost {
            response
                .properties
                .set_int64_prop(PropertyInt64::AugmentationCost, cost);
        }
        assert!(entity.apply_identify_response(&response));
        let inspection = inspect_entity(&entity).unwrap();
        let ObjectInspectionDetails::Item(item) = &inspection.details else {
            panic!("gem must use item inspection");
        };
        assert_eq!(item.augmentation_cost, cost.map(|value| value as u64));
        let rejected = IdentifyObjectResponseEventData {
            object_guid: entity.guid,
            success: false,
            ..Default::default()
        };
        assert!(!entity.apply_identify_response(&rejected));
        assert_eq!(inspect_entity(&entity).unwrap(), inspection);
    }
    entity.set_int64_prop(PropertyInt64::AugmentationCost, -1);
    assert_eq!(
        inspect_entity(&entity),
        Err(ObjectInspectionError::NegativeAugmentationCost {
            guid: entity.guid,
            value: -1,
        })
    );
}

#[test]
fn item_coverage_merges_layers_in_retail_order_without_using_equip_slots() {
    let mut entity = Entity::new(Guid(1), "Apparel".into(), WorldPosition::default());
    entity.set_int_prop(
        PropertyInt::ValidLocations,
        holtburger_common::properties::EquipMask::CHEST_ARMOR.bits() as i32,
    );
    // Wire coverage masks: underwear, outerwear, and their union. Head, hands,
    // and feet are shared between layers; bit zero has no known region.
    for priority in [0x1c07e, 0x1ff00, 0x1ff7f] {
        entity.set_int_prop(PropertyInt::ClothingPriority, priority);
        assert_eq!(
            item_coverage(&InspectionSource::from_entity(&entity)),
            vec![
                ItemCoverageRegion::Head,
                ItemCoverageRegion::Chest,
                ItemCoverageRegion::Abdomen,
                ItemCoverageRegion::UpperArms,
                ItemCoverageRegion::LowerArms,
                ItemCoverageRegion::Hands,
                ItemCoverageRegion::UpperLegs,
                ItemCoverageRegion::LowerLegs,
                ItemCoverageRegion::Feet,
            ]
        );
    }
    entity.set_int_prop(PropertyInt::ClothingPriority, 0x10 | 0x800);
    assert_eq!(
        item_coverage(&InspectionSource::from_entity(&entity)),
        vec![ItemCoverageRegion::Abdomen]
    );
    entity.set_int_prop(
        PropertyInt::ValidLocations,
        holtburger_common::properties::EquipMask::MELEE_WEAPON.bits() as i32,
    );
    assert!(item_coverage(&InspectionSource::from_entity(&entity)).is_empty());
}

#[test]
fn item_coverage_omits_undisclosed_or_unrecognized_regions() {
    let mut entity = Entity::new(Guid(1), "Apparel".into(), WorldPosition::default());
    entity.set_int_prop(
        PropertyInt::ValidLocations,
        holtburger_common::properties::EquipMask::CHEST_ARMOR.bits() as i32,
    );
    assert!(item_coverage(&InspectionSource::from_entity(&entity)).is_empty());
    for priority in [0, 1, i32::MIN] {
        entity.set_int_prop(PropertyInt::ClothingPriority, priority);
        assert!(item_coverage(&InspectionSource::from_entity(&entity)).is_empty());
    }
}

#[test]
fn inspection_preserves_base_changes_to_each_current_vital() {
    use holtburger_common::stats::VitalType;
    let mut entity = Entity::new(Guid(1), "Food".into(), WorldPosition::default());
    for (id, vital) in [
        (2, VitalType::Health),
        (4, VitalType::Stamina),
        (6, VitalType::Mana),
    ] {
        entity.set_int_prop(PropertyInt::BoosterEnum, id);
        for amount in [50, -20, 0, i32::MIN] {
            entity.set_int_prop(PropertyInt::BoostValue, amount);
            let ObjectInspectionDetails::Item(item) = inspect_entity(&entity).unwrap().details
            else {
                panic!("item inspection")
            };
            assert_eq!(
                item.use_effect,
                Some(InspectionUseEffect::VitalChange { vital, amount })
            );
        }
    }
}

#[test]
fn inspection_distinguishes_undisclosed_undefined_and_invalid_boosts() {
    let mut entity = Entity::new(Guid(1), "Food".into(), WorldPosition::default());
    for (vital, amount) in [
        (None, None),
        (Some(2), None),
        (None, Some(50)),
        (Some(0), Some(50)),
    ] {
        entity.properties.ints = Default::default();
        if let Some(vital) = vital {
            entity.set_int_prop(PropertyInt::BoosterEnum, vital);
        }
        if let Some(amount) = amount {
            entity.set_int_prop(PropertyInt::BoostValue, amount);
        }
        let ObjectInspectionDetails::Item(item) = inspect_entity(&entity).unwrap().details else {
            panic!("item inspection")
        };
        assert_eq!(item.use_effect, None);
    }
    for value in [-1, 1, 3, 5, 7] {
        entity.set_int_prop(PropertyInt::BoosterEnum, value);
        entity.set_int_prop(PropertyInt::BoostValue, 50);
        assert_eq!(
            inspect_entity(&entity),
            Err(ObjectInspectionError::InvalidBoosterVital {
                guid: entity.guid,
                value
            })
        );
    }
}

#[test]
fn healing_kit_effects_preserve_each_disclosed_bonus_for_ordinary_and_hooked_kits() {
    for hooked in [false, true] {
        for (skill_bonus, restoration_multiplier) in [
            (Some(50), Some(1.3)),
            (Some(0), None),
            (None, Some(1.0)),
            (None, None),
        ] {
            let mut entity = Entity::new(Guid(1), "Healing Kit".into(), WorldPosition::default());
            entity.set_int_prop(PropertyInt::BoosterEnum, 2);
            if hooked {
                entity.hook_profile = Some(HookProfile {
                    flags: InspectionUseEffect::HOOK_IS_HEALER,
                    valid_locations: holtburger_common::properties::EquipMask::empty(),
                    ammo_type: 0,
                });
            } else {
                entity.flags = ObjectDescriptionFlag::HEALER;
            }
            if let Some(bonus) = skill_bonus {
                entity.set_int_prop(PropertyInt::BoostValue, bonus);
            }
            if let Some(multiplier) = restoration_multiplier {
                entity.set_float_prop(PropertyFloat::HealkitMod, multiplier);
            }
            let ObjectInspectionDetails::Item(item) = inspect_entity(&entity).unwrap().details
            else {
                panic!("item inspection")
            };
            let expected = (skill_bonus.is_some() || restoration_multiplier.is_some()).then_some(
                InspectionUseEffect::HealingKit {
                    skill_bonus,
                    restoration_multiplier,
                },
            );
            assert_eq!(item.use_effect, expected);
        }
    }
}

#[test]
fn healing_kit_inspection_rejects_non_finite_restoration_multipliers() {
    let mut entity = Entity::new(Guid(1), "Healing Kit".into(), WorldPosition::default());
    entity.flags = ObjectDescriptionFlag::HEALER;
    entity.set_int_prop(PropertyInt::BoostValue, 50);
    for multiplier in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        entity.set_float_prop(PropertyFloat::HealkitMod, multiplier);
        assert_eq!(
            inspect_entity(&entity),
            Err(
                ObjectInspectionError::NonFiniteHealingKitRestorationMultiplier {
                    guid: entity.guid
                }
            )
        );
    }
}

#[test]
fn food_spells_are_classified_by_primary_identity_and_preserve_active_provenance() {
    use holtburger_common::properties::PropertyDataId;
    let mut entity = Entity::new(Guid(1), "Potion".into(), WorldPosition::default());
    entity.set_did_prop(PropertyDataId::Spell, Guid(42));
    entity.spell_book = vec![43, 42, 0x8000_002A];
    for (flags, primary_role) in [
        (ObjectDescriptionFlag::FOOD, InspectionSpellRole::OnUse),
        (ObjectDescriptionFlag::empty(), InspectionSpellRole::Item),
    ] {
        entity.flags = flags;
        let ObjectInspectionDetails::Item(item) = inspect_entity(&entity).unwrap().details else {
            panic!("item inspection")
        };
        assert_eq!(
            item.spells,
            vec![
                InspectionSpell {
                    id: 43,
                    role: InspectionSpellRole::Item
                },
                InspectionSpell {
                    id: 42,
                    role: primary_role
                },
                InspectionSpell {
                    id: 42,
                    role: InspectionSpellRole::ActiveEnchantment
                }
            ]
        );
    }
    entity.flags = ObjectDescriptionFlag::FOOD;
    entity.properties.dids = Default::default();
    let ObjectInspectionDetails::Item(item) = inspect_entity(&entity).unwrap().details else {
        panic!("item inspection")
    };
    assert_eq!(item.spells[1].role, InspectionSpellRole::Item);
}

#[test]
fn vendor_inspection_retains_public_food_and_healer_classification() {
    use holtburger_protocol::messages::object::messages::description::PublicWeenieDescription;
    use holtburger_protocol::messages::trade::events::VendorItemEventData;
    let titles = CharacterTitleCatalog::default();
    for (flags, expected_role, expected_effect) in [
        (
            ObjectDescriptionFlag::FOOD,
            InspectionSpellRole::OnUse,
            InspectionUseEffect::VitalChange {
                vital: VitalType::Stamina,
                amount: 50,
            },
        ),
        (
            ObjectDescriptionFlag::HEALER,
            InspectionSpellRole::Item,
            InspectionUseEffect::HealingKit {
                skill_bonus: Some(50),
                restoration_multiplier: Some(1.3),
            },
        ),
    ] {
        let mut vendor = CoreVendorItem::from_protocol(&VendorItemEventData {
            description: PublicWeenieDescription {
                guid: Guid(1),
                name: Some("Vendor Item".into()),
                obj_desc_flags: flags,
                spell: Some(Guid(42)),
                ..Default::default()
            },
            ..Default::default()
        });
        assert_eq!(vendor.public_flags, flags);
        let mut appraisal = IdentifyObjectResponseEventData {
            object_guid: vendor.guid,
            flags: IdentifyResponseFlags::INT_STATS_TABLE
                | IdentifyResponseFlags::FLOAT_STATS_TABLE
                | IdentifyResponseFlags::SPELL_BOOK,
            success: true,
            spell_book: vec![42],
            ..Default::default()
        };
        appraisal
            .properties
            .set_int_prop(PropertyInt::BoosterEnum, 4);
        appraisal
            .properties
            .set_int_prop(PropertyInt::BoostValue, 50);
        appraisal
            .properties
            .set_float_prop(PropertyFloat::HealkitMod, 1.3);
        assert!(vendor.apply_identify_response(&appraisal));
        let ObjectInspectionDetails::Item(item) =
            ObjectInspection::from_vendor_item(&vendor, InspectionContext::new(&titles))
                .unwrap()
                .details
        else {
            panic!("vendor item inspection")
        };
        assert_eq!(item.use_effect, Some(expected_effect));
        assert_eq!(item.spells[0].role, expected_role);
    }
}

#[test]
fn item_progression_is_derived_from_merged_appraisal_and_keeps_ordinary_level_separate() {
    use crate::item_progression::ItemAdvancement;
    use holtburger_common::properties::PropertyInt64;
    let guid = Guid(0x6000_0001);
    let mut entity = Entity::new(guid, "Cloak".into(), WorldPosition::default());
    let mut response = IdentifyObjectResponseEventData {
        object_guid: guid,
        flags: IdentifyResponseFlags::INT_STATS_TABLE | IdentifyResponseFlags::INT64_STATS_TABLE,
        success: true,
        ..Default::default()
    };
    response.properties.set_int_prop(PropertyInt::Level, 80);
    response
        .properties
        .set_int_prop(PropertyInt::ItemMaxLevel, 5);
    response
        .properties
        .set_int_prop(PropertyInt::ItemXpStyle, 2);
    response
        .properties
        .set_int64_prop(PropertyInt64::ItemBaseXp, 100);
    response
        .properties
        .set_int64_prop(PropertyInt64::ItemTotalXp, 350);
    assert!(entity.apply_identify_response(&response));
    let inspection = inspect_entity(&entity).unwrap();
    assert_eq!(inspection.level, Some(80));
    let ObjectInspectionDetails::Item(item) = inspection.details else {
        panic!("item appraisal")
    };
    let progression = item.progression.unwrap();
    assert_eq!(progression.level, 2);
    assert_eq!(
        progression.advancement,
        ItemAdvancement::Advancing {
            level_start_xp: 300,
            next_level_xp: 700
        }
    );
    response
        .properties
        .set_int64_prop(PropertyInt64::ItemTotalXp, 700);
    assert!(entity.apply_identify_response(&response));
    let ObjectInspectionDetails::Item(item) = inspect_entity(&entity).unwrap().details else {
        panic!("item appraisal")
    };
    assert_eq!(item.progression.unwrap().level, 3);
}

#[test]
fn portal_restrictions_follow_each_successful_appraisal() {
    let guid = Guid(0x6000_0001);
    let mut entity = Entity::new(guid, "Portal".into(), WorldPosition::default());
    let all_flags = PORTAL_RESTRICTION_FLAGS
        .iter()
        .fold(0, |mask, (flag, _)| mask | flag);
    let all_restrictions: Vec<_> = PORTAL_RESTRICTION_FLAGS
        .iter()
        .map(|(_, value)| *value)
        .collect();
    let cases = PORTAL_RESTRICTION_FLAGS
        .into_iter()
        .map(|(flag, restriction)| (Some(flag), Some(vec![restriction])))
        .chain([
            (Some(all_flags), Some(all_restrictions.clone())),
            (Some(0), Some(vec![])),
            (Some(all_flags), Some(all_restrictions)),
            (None, None),
        ]);
    for (mask, expected) in cases {
        let mut response = IdentifyObjectResponseEventData {
            object_guid: guid,
            flags: IdentifyResponseFlags::INT_STATS_TABLE,
            success: true,
            ..Default::default()
        };
        if let Some(mask) = mask {
            response
                .properties
                .set_int_prop(PropertyInt::PortalBitmask, mask);
        }
        assert!(entity.apply_identify_response(&response));
        let ObjectInspectionDetails::Item(item) = inspect_entity(&entity).unwrap().details else {
            panic!("portal should use item inspection");
        };
        assert_eq!(item.portal_restrictions, expected, "mask {mask:?}");
    }
}

#[test]
fn portal_destination_survives_appraisal_merge_and_preserves_server_text() {
    let guid = Guid(0x6000_0001);
    for destination in [
        None,
        Some("Holtburg (42.1N, 33.6E)."),
        Some("Hidden Sanctuary"),
    ] {
        let mut entity = Entity::new(guid, "Portal".into(), WorldPosition::default());
        let mut response = IdentifyObjectResponseEventData {
            object_guid: guid,
            flags: IdentifyResponseFlags::STRING_STATS_TABLE,
            success: true,
            ..Default::default()
        };
        if let Some(destination) = destination {
            response.properties.set_string_prop(
                PropertyString::AppraisalPortalDestination,
                destination.to_owned(),
            );
        }
        assert!(entity.apply_identify_response(&response));
        let ObjectInspectionDetails::Item(item) = inspect_entity(&entity).unwrap().details else {
            panic!("portal should use item inspection");
        };
        assert_eq!(item.portal_destination.as_deref(), destination);
    }
}

fn inspect_vendor_item(item: &CoreVendorItem) -> Result<ObjectInspection, ObjectInspectionError> {
    let titles = CharacterTitleCatalog::default();
    ObjectInspection::from_vendor_item(item, InspectionContext::new(&titles))
}

fn inspect_entity_with_title(
    entity: &Entity,
    title_id: u32,
    token: &str,
    display: &str,
) -> Result<ObjectInspection, ObjectInspectionError> {
    let mapper = EnumMapper {
        id: EnumMapper::FILE_ID,
        base_enum_map: 0,
        numbering: 0,
        entries: [(title_id, token.to_owned())].into_iter().collect(),
    };
    let strings = StringTable {
        id: StringTable::FILE_ID,
        language: 1,
        unknown: 0,
        entries: vec![StringTableData {
            id: legacy_string_hash(token.as_bytes()),
            variable_names: Vec::new(),
            variables: Vec::new(),
            strings: vec![display.to_owned()],
            comments: Vec::new(),
            unknown: 0,
        }],
    };
    let titles = CharacterTitleCatalog::from_assets(&mapper, &strings).unwrap();
    ObjectInspection::from_entity(entity, InspectionContext::new(&titles))
}

#[test]
fn lockpicking_uses_current_appraisal_and_current_lock_state() {
    let guid = Guid(0x6000_0001);
    let mut entity = Entity::new(guid, "Door".into(), WorldPosition::default());
    let mut response = IdentifyObjectResponseEventData {
        object_guid: guid,
        success: true,
        ..Default::default()
    };
    let read = |entity: &Entity| {
        let ObjectInspectionDetails::Item(item) = inspect_entity(entity).unwrap().details else {
            panic!("door should use item inspection");
        };
        item.lockpicking
    };
    assert_eq!(read(&entity), None);
    response
        .properties
        .set_bool_prop(PropertyBool::Locked, true);
    for (difficulty, success_percent) in [
        (Some(250), Some(73)),
        (Some(0), Some(0)),
        (Some(250), None),
        (None, Some(100)),
    ] {
        response.properties.ints.0.clear();
        if let Some(value) = difficulty {
            response
                .properties
                .set_int_prop(PropertyInt::ResistLockpick, value);
        }
        if let Some(value) = success_percent {
            response
                .properties
                .set_int_prop(PropertyInt::AppraisalLockpickSuccessPercent, value);
        }
        assert!(entity.apply_identify_response(&response));
        assert_eq!(
            read(&entity),
            Some(LockpickingInfo {
                difficulty,
                success_percent
            })
        );
    }

    // Live unlocks hide retained appraisal facts before another appraisal arrives.
    entity.set_bool_prop(PropertyBool::Locked, false);
    assert_eq!(read(&entity), None);
    response
        .properties
        .set_bool_prop(PropertyBool::Locked, false);
    assert!(entity.apply_identify_response(&response));
    assert_eq!(read(&entity), None);

    // An absent Locked property must not classify a skill bonus using retained lock state.
    entity.set_bool_prop(PropertyBool::Locked, true);
    response.properties.bools.0.clear();
    response
        .properties
        .set_int_prop(PropertyInt::ResistLockpick, 25);
    assert!(entity.apply_identify_response(&response));
    assert_eq!(read(&entity), None);

    // Omitted facts in a later successful appraisal replace the old disclosure.
    response
        .properties
        .set_bool_prop(PropertyBool::Locked, true);
    assert!(entity.apply_identify_response(&response));
    assert!(read(&entity).is_some());
    response.properties.ints.0.clear();
    assert!(entity.apply_identify_response(&response));
    assert_eq!(read(&entity), None);
}

#[test]
fn from_entity_captures_open_status_property() {
    let mut entity = Entity::new(
        Guid(0x60000001),
        "Door".to_string(),
        WorldPosition::default(),
    );
    entity.set_bool_prop(PropertyBool::Open, true);
    entity.set_bool_prop(PropertyBool::Locked, false);

    let inspection = inspect_entity(&entity).unwrap();
    let ObjectInspectionDetails::Item(item) = inspection.details else {
        panic!("door should use item inspection");
    };

    assert_eq!(item.status.is_open, Some(true));
    assert_eq!(item.status.is_locked, Some(false));
}

#[test]
fn ordinary_creature_identity_uses_creature_type_lineage() {
    let mut entity = Entity::new(
        Guid(0x60000003),
        "Test Creature".to_string(),
        WorldPosition::default(),
    );
    entity.set_int_prop(PropertyInt::CreatureType, CreatureType::Olthoi as i32);
    entity.creature_profile = Some(CreatureProfile {
        flags: CreatureProfileFlags::empty(),
        health: 100,
        health_max: 100,
        attributes: None,
        buffs: None,
    });

    let inspection = inspect_entity(&entity).unwrap();
    let ObjectInspectionDetails::Creature(creature) = inspection.details else {
        panic!("profile-backed object should use creature inspection");
    };

    assert_eq!(
        creature.identity,
        CreatureIdentity::Creature {
            lineage: Some("Olthoi".to_owned()),
        }
    );
    assert_eq!(creature.attributes_and_vitals, None);
}

#[test]
fn template_selects_character_identity_with_retail_fallbacks() {
    let mut entity = Entity::new(
        Guid(0x6000000B),
        "Drawohan the Gem Seller".to_string(),
        WorldPosition::default(),
    );
    entity.set_string_prop(PropertyString::Template, "Gem Seller".to_owned());
    entity.set_int_prop(PropertyInt::CharacterTitleId, 999);
    entity.set_int_prop(PropertyInt::CreatureType, CreatureType::Lugian as i32);
    entity.flags = ObjectDescriptionFlag::VENDOR;
    entity.creature_profile = Some(CreatureProfile {
        flags: CreatureProfileFlags::empty(),
        health: 100,
        health_max: 100,
        attributes: None,
        buffs: None,
    });

    let inspection = inspect_entity(&entity).unwrap();
    let ObjectInspectionDetails::Creature(creature) = inspection.details else {
        panic!("profile-backed object should use creature inspection");
    };

    assert_eq!(
        creature.identity,
        CreatureIdentity::Character {
            lineage: Some("Lugian".to_owned()),
            role: Some("Gem Seller".to_owned()),
            player_killer_status: PlayerKillerClassification::NonPlayerKiller,
        }
    );
}

#[test]
fn character_identity_prefers_localized_title_and_shared_character_facts() {
    let mut entity = Entity::new(
        Guid(0x6000000C),
        "Character".to_string(),
        WorldPosition::default(),
    );
    entity.set_int_prop(PropertyInt::CharacterTitleId, 42);
    entity.set_string_prop(PropertyString::Template, "Template Fallback".to_owned());
    entity.set_int_prop(PropertyInt::Gender, 2);
    entity.set_int_prop(PropertyInt::HeritageGroup, HeritageGroup::Gharundim as i32);
    entity.flags = ObjectDescriptionFlag::PLAYER_KILLER | ObjectDescriptionFlag::PK_LITE_STATUS;
    entity.creature_profile = Some(CreatureProfile {
        flags: CreatureProfileFlags::empty(),
        health: 100,
        health_max: 100,
        attributes: None,
        buffs: None,
    });

    let inspection =
        inspect_entity_with_title(&entity, 42, "DefenderOfDereth", "Defender of Dereth").unwrap();
    let ObjectInspectionDetails::Creature(creature) = inspection.details else {
        panic!("profile-backed object should use creature inspection");
    };

    assert_eq!(
        creature.identity,
        CreatureIdentity::Character {
            lineage: Some("Female Gharu'ndim".to_owned()),
            role: Some("Defender of Dereth".to_owned()),
            player_killer_status: PlayerKillerClassification::PlayerKiller,
        }
    );
}

#[test]
fn pk_lite_public_flag_selects_the_lite_character_label() {
    assert_eq!(
        player_killer_classification(ObjectDescriptionFlag::PK_LITE_STATUS),
        PlayerKillerClassification::PlayerKillerLite
    );
}

#[test]
fn creature_enchantment_masks_classify_attributes_and_vitals_without_base_values() {
    let mut entity = Entity::new(
        Guid(0x60000008),
        "Enhanced Creature".to_string(),
        WorldPosition::default(),
    );
    entity.creature_profile = Some(CreatureProfile {
        flags: CreatureProfileFlags::SHOW_ATTRIBUTES | CreatureProfileFlags::HAS_BUFFS_DEBUFFS,
        health: 90,
        health_max: 120,
        attributes: Some(CreatureAttributes {
            strength: 300,
            endurance: 250,
            quickness: 200,
            coordination: 210,
            focus: 175,
            self_attr: 160,
            stamina: 80,
            mana: 70,
            stamina_max: 100,
            mana_max: 90,
        }),
        buffs: Some(CreatureBuffs {
            highlights: 0x1 | 0x2 | 0x40 | 0x80,
            colors: 0x1 | 0x80,
        }),
    });

    let inspection = inspect_entity(&entity).unwrap();
    let ObjectInspectionDetails::Creature(creature) = inspection.details else {
        panic!("profile-backed object should use creature inspection");
    };
    assert_eq!(creature.health.unbuffed, None);
    assert_eq!(
        creature.health.enchantment,
        Some(EnchantmentPolarity::Harmful)
    );
    let profile = creature
        .attributes_and_vitals
        .expect("attributes and secondary vitals");
    assert_eq!(
        profile.attributes.strength.enchantment,
        Some(EnchantmentPolarity::Beneficial)
    );
    assert_eq!(
        profile.attributes.endurance.enchantment,
        Some(EnchantmentPolarity::Harmful)
    );
    assert_eq!(profile.attributes.coordination.enchantment, None);
    assert_eq!(profile.attributes.strength.unbuffed, None);
    assert_eq!(
        profile.stamina.enchantment,
        Some(EnchantmentPolarity::Beneficial)
    );
    assert_eq!(profile.mana.enchantment, None);
}

#[test]
fn creature_without_profile_uses_item_shape() {
    let mut entity = Entity::new(
        Guid(0x70000001),
        "Object-like NPC".to_string(),
        WorldPosition::default(),
    );
    entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);

    let inspection = inspect_entity(&entity).unwrap();

    assert!(matches!(
        inspection.details,
        ObjectInspectionDetails::Item(_)
    ));
}

#[test]
fn player_requires_creature_profile() {
    let entity = Entity::new(
        Guid(0x50000001),
        "Player".to_string(),
        WorldPosition::default(),
    );

    assert_eq!(
        inspect_entity(&entity),
        Err(ObjectInspectionError::MissingPlayerCreatureProfile { guid: entity.guid })
    );
}

#[test]
fn item_spell_marker_is_decoded_without_losing_provenance() {
    let mut entity = Entity::new(
        Guid(0x60000004),
        "Magic Item".to_string(),
        WorldPosition::default(),
    );
    entity.spell_book = vec![42, 0x8000_002B];

    let inspection = inspect_entity(&entity).unwrap();
    let ObjectInspectionDetails::Item(item) = inspection.details else {
        panic!("item should use item inspection");
    };

    assert_eq!(
        item.spells,
        vec![
            InspectionSpell {
                id: 42,
                role: InspectionSpellRole::Item,
            },
            InspectionSpell {
                id: 43,
                role: InspectionSpellRole::ActiveEnchantment,
            },
        ]
    );
}

#[test]
fn item_enchantment_masks_classify_effective_values_and_preserve_proven_base() {
    let mut entity = Entity::new(
        Guid(0x60000006),
        "Enchanted Sword".to_string(),
        WorldPosition::default(),
    );
    entity.set_int_prop(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
    entity.set_int_prop(PropertyInt::Damage, 50);
    entity.set_float_prop(PropertyFloat::DamageVariance, 0.5);
    entity.set_int_prop(PropertyInt::DamageType, DamageType::SLASH.bits() as i32);
    entity.set_int_prop(PropertyInt::WeaponTime, 40);
    entity.set_float_prop(PropertyFloat::ArmorModVsSlash, 1.0);
    entity.weapon_profile = Some(WeaponProfile {
        damage_type: DamageType::SLASH.bits(),
        weapon_time: 32,
        weapon_skill: 0,
        damage: 60,
        damage_variance: 0.5,
        damage_mod: 1.0,
        weapon_length: 1.0,
        max_velocity: 1.0,
        weapon_offense: 1.0,
        max_velocity_estimated: 0,
    });
    entity.armor_profile = Some(ArmorProfile {
        slashing: 1.2,
        piercing: 1.0,
        bludgeoning: 1.0,
        cold: 1.0,
        fire: 1.0,
        acid: 1.0,
        nether: 1.0,
        lightning: 1.0,
    });
    entity.weapon_highlight = Some(0x8 | 0x4);
    entity.weapon_color = Some(0x8 | 0x4);
    entity.armor_highlight = Some(0x2);
    entity.armor_color = Some(0x2);

    let inspection = inspect_entity(&entity).unwrap();
    let ObjectInspectionDetails::Item(item) = inspection.details else {
        panic!("weapon should use item inspection");
    };
    let weapon = item.weapon.expect("weapon details");
    assert_eq!(
        weapon.damage.effective,
        DamageRangeInfo {
            min: 30.0,
            max: 60.0
        }
    );
    assert_eq!(
        weapon.damage.unbuffed,
        Some(DamageRangeInfo {
            min: 25.0,
            max: 50.0
        })
    );
    assert_eq!(
        weapon.damage.enchantment,
        Some(EnchantmentPolarity::Beneficial)
    );
    assert_eq!(weapon.speed.and_then(|value| value.unbuffed), Some(40));
    let slashing = item.protections.expect("protections").slashing;
    assert_eq!(slashing.effective, 1.2);
    assert_eq!(slashing.unbuffed, Some(1.0));
    assert_eq!(slashing.enchantment, Some(EnchantmentPolarity::Beneficial));
}

#[test]
fn item_enchantment_masks_do_not_fabricate_missing_base_values() {
    let mut entity = Entity::new(
        Guid(0x60000007),
        "Appraisal-only Sword".to_string(),
        WorldPosition::default(),
    );
    entity.set_int_prop(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
    entity.weapon_profile = Some(WeaponProfile {
        damage_type: DamageType::ACID.bits(),
        weapon_time: 23,
        weapon_skill: 0,
        damage: 71,
        damage_variance: 0.56,
        damage_mod: 1.0,
        weapon_length: 1.0,
        max_velocity: 1.0,
        weapon_offense: 1.2,
        max_velocity_estimated: 0,
    });
    entity.armor_profile = Some(ArmorProfile {
        slashing: 1.2,
        piercing: 1.0,
        bludgeoning: 1.0,
        cold: 1.0,
        fire: 1.0,
        acid: 1.0,
        nether: 1.0,
        lightning: 1.0,
    });
    entity.weapon_highlight = Some(0x1 | 0x4 | 0x8);
    entity.weapon_color = Some(0);
    entity.armor_highlight = Some(0x2);
    entity.armor_color = Some(0);

    let inspection = inspect_entity(&entity).unwrap();
    let ObjectInspectionDetails::Item(item) = inspection.details else {
        panic!("weapon should use item inspection");
    };
    let weapon = item.weapon.expect("weapon details");
    assert_eq!(weapon.damage.unbuffed, None);
    assert_eq!(
        weapon.damage.enchantment,
        Some(EnchantmentPolarity::Harmful)
    );
    let speed = weapon.speed.expect("weapon speed");
    assert_eq!(speed.unbuffed, None);
    assert_eq!(speed.enchantment, Some(EnchantmentPolarity::Harmful));
    let attack = item
        .bonuses
        .iter()
        .find(|bonus| bonus.kind == BonusKind::Attack)
        .expect("attack bonus");
    assert_eq!(attack.value.unbuffed, None);
    assert_eq!(attack.value.enchantment, Some(EnchantmentPolarity::Harmful));
    let slashing = item.protections.expect("protections").slashing;
    assert_eq!(slashing.unbuffed, None);
    assert_eq!(slashing.enchantment, Some(EnchantmentPolarity::Harmful));
}

#[test]
fn use_requirements_preserve_training_thresholds_and_independent_skills() {
    let mut entity = Entity::new(
        Guid(0x60000009),
        "Essence".to_string(),
        WorldPosition::default(),
    );
    let requirements = |entity: &Entity| {
        let inspection = inspect_entity(entity).unwrap();
        let ObjectInspectionDetails::Item(item) = inspection.details else {
            panic!("essence should use item inspection");
        };
        item.use_requirements
    };
    assert!(requirements(&entity).is_empty());
    // A threshold alone cannot identify the skill it belongs to.
    entity.set_int_prop(PropertyInt::UseRequiresSkillLevel, 570);
    assert!(requirements(&entity).is_empty());
    entity.set_int_prop(PropertyInt::UseRequiresSkill, SkillType::Summoning as i32);
    entity.set_int_prop(PropertyInt::UseRequiresLevel, 180);
    assert_eq!(
        requirements(&entity),
        vec![
            UseRequirement::Skill {
                skill: SkillType::Summoning,
                requirement: SkillActivationRequirement::Training {
                    training: ActivationTraining::Trained,
                    minimum: Some(570)
                },
            },
            UseRequirement::Level { level: 180 },
        ]
    );
    entity.set_int_prop(
        PropertyInt::UseRequiresSkillSpec,
        SkillType::Summoning as i32,
    );
    assert_eq!(
        requirements(&entity),
        vec![
            UseRequirement::Skill {
                skill: SkillType::Summoning,
                requirement: SkillActivationRequirement::Training {
                    training: ActivationTraining::Specialized,
                    minimum: Some(570)
                },
            },
            UseRequirement::Level { level: 180 },
        ]
    );
    entity
        .properties
        .ints
        .0
        .remove(&PropertyInt::UseRequiresSkillLevel);
    entity.set_int_prop(PropertyInt::UseRequiresSkill, SkillType::LifeMagic as i32);
    assert_eq!(
        requirements(&entity),
        vec![
            UseRequirement::Skill {
                skill: SkillType::LifeMagic,
                requirement: SkillActivationRequirement::Training {
                    training: ActivationTraining::Trained,
                    minimum: None
                },
            },
            UseRequirement::Skill {
                skill: SkillType::Summoning,
                requirement: SkillActivationRequirement::Training {
                    training: ActivationTraining::Specialized,
                    minimum: None
                },
            },
            UseRequirement::Level { level: 180 },
        ]
    );
}

#[test]
fn wield_requirements_preserve_missing_fields_and_ace_value_slots() {
    let mut entity = Entity::new(
        Guid(0x60000009),
        "Requirement Test".to_string(),
        WorldPosition::default(),
    );
    entity.set_int_prop(
        PropertyInt::WieldRequirements,
        WieldRequirementType::Skill as i32,
    );
    entity.set_int_prop(
        PropertyInt::WieldRequirements2,
        WieldRequirementType::CreatureType as i32,
    );
    entity.set_int_prop(PropertyInt::WieldDifficulty2, CreatureType::Olthoi as i32);

    let inspection = inspect_entity(&entity).unwrap();
    let ObjectInspectionDetails::Item(item) = inspection.details else {
        panic!("ordinary object should use item inspection");
    };

    assert_eq!(
        item.wield_requirements,
        vec![WieldRequirement::CreatureType {
            creature_type: CreatureType::Olthoi,
        }]
    );
}

#[test]
fn special_effects_follow_ace_property_ownership_without_duplicate_imbues() {
    let mut entity = Entity::new(
        Guid(0x6000000A),
        "Effect Test".to_string(),
        WorldPosition::default(),
    );
    entity.set_float_prop(PropertyFloat::IgnoreArmor, 1.0);
    entity.set_float_prop(PropertyFloat::ResistanceModifier, 1.0);
    entity.set_int_prop(
        PropertyInt::ResistanceModifierType,
        DamageType::FIRE.bits() as i32,
    );
    entity.set_int_prop(
        PropertyInt::ImbuedEffect,
        ImbuedEffectType::AlwaysCritical.bits() as i32,
    );

    let inspection = inspect_entity(&entity).unwrap();
    let ObjectInspectionDetails::Item(item) = inspection.details else {
        panic!("ordinary object should use item inspection");
    };

    assert_eq!(
        item.effects,
        vec![Effect::ArmorCleaving, Effect::FireCleaving]
    );
    assert!(
        item.imbued_effects
            .contains(ImbuedEffectType::AlwaysCritical)
    );
}

#[test]
fn entity_and_vendor_item_share_the_same_populator() {
    let mut entity = Entity::new(
        Guid(0x60000005),
        "Shared Item".to_string(),
        WorldPosition::default(),
    );
    entity.set_int_prop(PropertyInt::Value, 125);
    let mut vendor = CoreVendorItem {
        guid: entity.guid,
        wcid: 1,
        properties: entity.properties.clone(),
        ..Default::default()
    };
    vendor.spell_book = entity.spell_book.clone();

    assert_eq!(
        inspect_entity(&entity).unwrap(),
        inspect_vendor_item(&vendor).unwrap()
    );
}

#[test]
fn appraisal_supplement_decodes_armor_and_preserves_signed_zero_and_absence() {
    let mut properties = WorldObjectProperties::default();
    properties.set_int_prop(PropertyInt::DamageRating, -3);
    properties.set_int_prop(PropertyInt::DamageResistRating, 0);
    properties.set_int_prop(PropertyInt::NumDeaths, 0);
    let supplement = InspectionSupplement::from_response(
        &properties,
        Some(&ArmorLevels {
            head: 9_999,
            chest: 10_311,
            abdomen: 484,
            upper_arm: 181,
            lower_arm: 182,
            hand: 277,
            upper_leg: 484,
            lower_leg: 485,
            foot: 490,
        }),
    );

    let armor = supplement.armor_coverage.expect("armor coverage");
    assert_eq!(
        armor,
        ArmorCoverage {
            head: ArmorCoverageValue {
                level: 0,
                enchantable: false,
            },
            chest: ArmorCoverageValue {
                level: 312,
                enchantable: false,
            },
            abdomen: ArmorCoverageValue {
                level: 484,
                enchantable: true,
            },
            upper_arm: ArmorCoverageValue {
                level: 181,
                enchantable: true,
            },
            lower_arm: ArmorCoverageValue {
                level: 182,
                enchantable: true,
            },
            hand: ArmorCoverageValue {
                level: 277,
                enchantable: true,
            },
            upper_leg: ArmorCoverageValue {
                level: 484,
                enchantable: true,
            },
            lower_leg: ArmorCoverageValue {
                level: 485,
                enchantable: true,
            },
            foot: ArmorCoverageValue {
                level: 490,
                enchantable: true,
            },
        }
    );
    let ratings = supplement.ratings.expect("ratings");
    assert_eq!(ratings.damage_rating, Some(-3));
    assert_eq!(ratings.damage_resistance_rating, Some(0));
    assert_eq!(ratings.critical_damage_rating, None);
    assert_eq!(
        supplement
            .character_details
            .expect("character details")
            .deaths,
        Some(0)
    );
}

#[test]
fn inspection_allegiance_rank_resolves_only_disclosed_supported_title_inputs() {
    let mut properties = WorldObjectProperties::default();
    properties.set_int_prop(PropertyInt::AllegianceRank, 3);
    let details = InspectionSupplement::from_response(&properties, None)
        .character_details
        .expect("rank alone retains affiliation details");
    assert_eq!(
        details.allegiance_rank,
        Some(CharacterAllegianceRank {
            rank: 3,
            title: None
        })
    );
    properties.set_int_prop(PropertyInt::HeritageGroup, 1);
    properties.set_int_prop(PropertyInt::Gender, 2);
    let details = InspectionSupplement::from_response(&properties, None)
        .character_details
        .unwrap();
    assert_eq!(
        details.allegiance_rank,
        Some(CharacterAllegianceRank {
            rank: 3,
            title: Some("Baroness".into())
        })
    );
    for (property, value) in [
        (PropertyInt::HeritageGroup, 257),
        (PropertyInt::HeritageGroup, -1),
        (PropertyInt::Gender, 258),
        (PropertyInt::Gender, 0),
        (PropertyInt::AllegianceRank, -1),
        (PropertyInt::AllegianceRank, 65_537),
    ] {
        let mut unsupported = properties.clone();
        unsupported.set_int_prop(property, value);
        let rank = InspectionSupplement::from_response(&unsupported, None)
            .character_details
            .unwrap()
            .allegiance_rank
            .unwrap();
        assert_eq!(
            rank.rank,
            unsupported
                .get_int_prop(PropertyInt::AllegianceRank)
                .unwrap()
        );
        assert!(
            rank.title.is_none(),
            "unsupported {property:?} must not resolve a title"
        );
    }
    let mut missing_rank = WorldObjectProperties::default();
    missing_rank.set_int_prop(PropertyInt::HeritageGroup, 1);
    missing_rank.set_int_prop(PropertyInt::Gender, 2);
    assert!(
        InspectionSupplement::from_response(&missing_rank, None)
            .character_details
            .is_none()
    );
}

#[test]
fn equipment_unenchantable_preserves_absence_and_threshold_boundary() {
    let mut properties = WorldObjectProperties::default();
    assert_eq!(
        InspectionSupplement::from_response(&properties, None).equipment_unenchantable,
        None
    );
    for (value, expected) in [(9_998, false), (9_999, true), (10_000, true)] {
        properties.set_int_prop(PropertyInt::ResistMagic, value);
        assert_eq!(
            InspectionSupplement::from_response(&properties, None).equipment_unenchantable,
            Some(expected)
        );
    }

    let mut bonus_only = WorldObjectProperties::default();
    bonus_only.set_int_prop(PropertyInt::GearMaxHealth, 25);
    let supplement = InspectionSupplement::from_response(&bonus_only, None);
    assert_eq!(supplement.max_health_bonus, Some(25));
    assert!(supplement.ratings.is_none());
}

#[test]
fn successful_refresh_replaces_supplement_while_rejection_preserves_it() {
    let guid = Guid(0x6000_000B);
    let mut entity = Entity::new(guid, "Refresh Test".to_owned(), WorldPosition::default());
    let mut first = IdentifyObjectResponseEventData {
        object_guid: guid,
        flags: IdentifyResponseFlags::INT_STATS_TABLE,
        success: true,
        ..Default::default()
    };
    first
        .properties
        .set_int_prop(PropertyInt::ResistMagic, 9_999);
    first.properties.set_int_prop(PropertyInt::DamageRating, 5);
    first.properties.set_string_prop(
        PropertyString::DateOfBirth,
        "1 Frostfell, 1 P.Y.".to_owned(),
    );
    first.armor_levels = Some(ArmorLevels {
        head: 100,
        chest: 200,
        abdomen: 300,
        upper_arm: 400,
        lower_arm: 500,
        hand: 600,
        upper_leg: 700,
        lower_leg: 800,
        foot: 900,
    });
    assert!(entity.apply_identify_response(&first));
    let ObjectInspectionDetails::Item(item) = inspect_entity(&entity).unwrap().details else {
        panic!("ordinary object should use item inspection");
    };
    assert_eq!(item.status.unenchantable, Some(true));

    let rejected = IdentifyObjectResponseEventData {
        object_guid: guid,
        success: false,
        ..Default::default()
    };
    assert!(!entity.apply_identify_response(&rejected));
    assert_eq!(
        entity
            .inspection_supplement
            .as_ref()
            .and_then(|value| value.ratings.as_ref())
            .and_then(|value| value.damage_rating),
        Some(5)
    );
    assert_eq!(
        entity
            .inspection_supplement
            .as_ref()
            .and_then(|value| value.armor_coverage.as_ref())
            .map(|value| value.foot.level),
        Some(900)
    );

    let mut changed = IdentifyObjectResponseEventData {
        object_guid: guid,
        success: true,
        armor_levels: Some(ArmorLevels {
            head: 101,
            chest: 201,
            abdomen: 301,
            upper_arm: 401,
            lower_arm: 501,
            hand: 601,
            upper_leg: 701,
            lower_leg: 801,
            foot: 901,
        }),
        ..Default::default()
    };
    changed
        .properties
        .set_int_prop(PropertyInt::DamageRating, -2);
    changed
        .properties
        .set_string_prop(PropertyString::Fellowship, "Changed Fellowship".to_owned());
    assert!(entity.apply_identify_response(&changed));
    let changed_supplement = entity
        .inspection_supplement
        .as_ref()
        .expect("changed successful supplement");
    assert_eq!(changed_supplement.equipment_unenchantable, None);
    assert_eq!(
        changed_supplement
            .ratings
            .as_ref()
            .and_then(|value| value.damage_rating),
        Some(-2)
    );
    assert_eq!(
        changed_supplement
            .armor_coverage
            .as_ref()
            .map(|value| value.foot.level),
        Some(901)
    );
    assert_eq!(
        changed_supplement
            .character_details
            .as_ref()
            .and_then(|value| value.fellowship.as_deref()),
        Some("Changed Fellowship")
    );

    let empty_success = IdentifyObjectResponseEventData {
        object_guid: guid,
        success: true,
        ..Default::default()
    };
    assert!(entity.apply_identify_response(&empty_success));
    let ObjectInspectionDetails::Item(item) = inspect_entity(&entity).unwrap().details else {
        panic!("ordinary object should use item inspection");
    };
    assert_eq!(item.status.unenchantable, None);
    assert_eq!(entity.get_int_prop(PropertyInt::DamageRating), Some(-2));
    let supplement = entity
        .inspection_supplement
        .as_ref()
        .expect("successful empty supplement");
    assert!(supplement.armor_coverage.is_none());
    assert!(supplement.ratings.is_none());
    assert!(supplement.character_details.is_none());
}

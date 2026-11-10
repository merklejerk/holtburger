use crate::inspection::{GEAR_RATING_PROPERTIES, InspectionSupplement};
use holtburger_common::properties::{
    PropertyBool, PropertyDataId, PropertyFloat, PropertyInt, PropertyInt64, PropertyString,
    WorldObjectProperties,
};
use holtburger_protocol::messages::object::events::{
    IdentifyObjectResponseEventData, IdentifyResponseFlags,
};
use holtburger_protocol::messages::object::types::{
    ArmorLevels, ArmorProfile, CreatureProfile, HookProfile, WeaponProfile,
};

pub(crate) struct IdentifyTarget<'a> {
    pub properties: &'a mut WorldObjectProperties,
    pub armor_profile: &'a mut Option<ArmorProfile>,
    pub creature_profile: &'a mut Option<CreatureProfile>,
    pub weapon_profile: &'a mut Option<WeaponProfile>,
    pub hook_profile: &'a mut Option<HookProfile>,
    pub armor_levels: &'a mut Option<ArmorLevels>,
    pub inspection_supplement: &'a mut Option<InspectionSupplement>,
    pub spell_book: &'a mut Vec<u32>,
    pub armor_highlight: &'a mut Option<u16>,
    pub armor_color: &'a mut Option<u16>,
    pub weapon_highlight: &'a mut Option<u16>,
    pub weapon_color: &'a mut Option<u16>,
    pub resist_highlight: &'a mut Option<u16>,
    pub resist_color: &'a mut Option<u16>,
}

pub(crate) fn apply_identify_response(
    target: IdentifyTarget<'_>,
    data: &IdentifyObjectResponseEventData,
) -> bool {
    let IdentifyTarget {
        properties,
        armor_profile,
        creature_profile,
        weapon_profile,
        hook_profile,
        armor_levels,
        inspection_supplement,
        spell_book,
        armor_highlight,
        armor_color,
        weapon_highlight,
        weapon_color,
        resist_highlight,
        resist_color,
    } = target;

    if !data.success {
        return false;
    }

    *inspection_supplement = Some(InspectionSupplement::from_response(
        &data.properties,
        data.armor_levels.as_ref(),
    ));

    let flags = data.flags;

    clear_item_appraisal_properties(properties);
    properties.merge(data.properties.clone());
    // ACE assesses both fields (PropertyInt.cs); absent contributors mean one only
    // after this successful appraisal. Never inherit an older raw total/count pair.
    if data
        .properties
        .ints
        .get(&PropertyInt::ItemWorkmanship)
        .is_some()
    {
        let count = data
            .properties
            .ints
            .get(&PropertyInt::NumItemsInMaterial)
            .copied()
            .unwrap_or(1);
        properties
            .ints
            .insert(PropertyInt::NumItemsInMaterial, count);
    } else {
        properties.ints.0.remove(&PropertyInt::ItemWorkmanship);
        properties.ints.0.remove(&PropertyInt::NumItemsInMaterial);
    }

    // ACE AppraiseInfo.BuildProperties includes all authored assessment bools.
    // A successful full appraisal establishes absent UnlimitedUse as false (ACE's
    // WorldObject_Properties.cs default); before appraisal its absence is unknown.
    properties.bools.insert(
        PropertyBool::UnlimitedUse,
        data.properties
            .bools
            .get(&PropertyBool::UnlimitedUse)
            .copied()
            .unwrap_or(false),
    );

    if flags.contains(IdentifyResponseFlags::ARMOR_PROFILE) {
        *armor_profile = data.armor_profile.clone();
    }
    if flags.contains(IdentifyResponseFlags::CREATURE_PROFILE) {
        *creature_profile = data.creature_profile.clone();
    }
    if flags.contains(IdentifyResponseFlags::WEAPON_PROFILE) {
        *weapon_profile = data.weapon_profile.clone();
    }
    if flags.contains(IdentifyResponseFlags::HOOK_PROFILE) {
        *hook_profile = data.hook_profile.clone();
    }
    if flags.contains(IdentifyResponseFlags::ARMOR_LEVELS) {
        *armor_levels = data.armor_levels.clone();
    }
    // A successful appraisal with no spell-book block discloses an empty book.
    *spell_book = data.spell_book.clone();

    if flags.contains(IdentifyResponseFlags::ARMOR_ENCHANTMENT_BITFIELD) {
        *armor_highlight = data.armor_highlight;
        *armor_color = data.armor_color;
    }
    if flags.contains(IdentifyResponseFlags::WEAPON_ENCHANTMENT_BITFIELD) {
        *weapon_highlight = data.weapon_highlight;
        *weapon_color = data.weapon_color;
    }
    if flags.contains(IdentifyResponseFlags::RESIST_ENCHANTMENT_BITFIELD) {
        *resist_highlight = data.resist_highlight;
        *resist_color = data.resist_color;
    }

    true
}

/// A successful full appraisal replaces these item facts; absence must not inherit an
/// older requirement, cost, proc, rating, or description contributor. Live property updates
/// still use the same canonical tables after this replacement.
fn clear_item_appraisal_properties(properties: &mut WorldObjectProperties) {
    properties.int64s.0.remove(&PropertyInt64::AugmentationCost);
    for key in [
        PropertyInt::WieldRequirements,
        PropertyInt::WieldSkillType,
        PropertyInt::WieldDifficulty,
        PropertyInt::WieldRequirements2,
        PropertyInt::WieldSkillType2,
        PropertyInt::WieldDifficulty2,
        PropertyInt::WieldRequirements3,
        PropertyInt::WieldSkillType3,
        PropertyInt::WieldDifficulty3,
        PropertyInt::WieldRequirements4,
        PropertyInt::WieldSkillType4,
        PropertyInt::WieldDifficulty4,
        PropertyInt::ItemDifficulty,
        PropertyInt::ItemAllegianceRankLimit,
        PropertyInt::ItemSkillLevelLimit,
        PropertyInt::AppraisalItemSkill,
        PropertyInt::ItemAttributeLimit,
        PropertyInt::ItemAttributeLevelLimit,
        PropertyInt::ItemAttribute2ndLimit,
        PropertyInt::ItemAttribute2ndLevelLimit,
        PropertyInt::UseRequiresSkill,
        PropertyInt::UseRequiresSkillLevel,
        PropertyInt::UseRequiresSkillSpec,
        PropertyInt::UseRequiresLevel,
        PropertyInt::HeritageGroup,
        PropertyInt::HeritageSpecificArmor,
        PropertyInt::EquipmentSetId,
        PropertyInt::MinLevel,
        PropertyInt::MaxLevel,
        PropertyInt::Lifespan,
        PropertyInt::RemainingLifespan,
        PropertyInt::GemCount,
        PropertyInt::GemType,
    ]
    .iter()
    .chain(GEAR_RATING_PROPERTIES.iter().map(|(key, _)| key))
    {
        properties.ints.0.remove(key);
    }
    for key in [
        PropertyBool::AppraisalHasAllowedWielder,
        PropertyBool::AppraisalHasAllowedActivator,
        PropertyBool::Dyable,
    ] {
        properties.bools.0.remove(&key);
    }
    for key in [
        PropertyDataId::ItemSpecializedOnly,
        PropertyDataId::ProcSpell,
    ] {
        properties.dids.0.remove(&key);
    }
    for key in [
        PropertyFloat::ItemEfficiency,
        PropertyFloat::ManaStoneDestroyChance,
    ] {
        properties.floats.0.remove(&key);
    }
    for key in [
        PropertyString::CraftsmanName,
        PropertyString::TinkerName,
        PropertyString::ImbuerName,
        PropertyString::GearPlatingName,
    ] {
        properties.strings.0.remove(&key);
    }
}

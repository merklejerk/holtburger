use holtburger_common::properties::WorldObjectProperties;
use holtburger_protocol::messages::object::events::IdentifyObjectResponseEventData;
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

    properties.merge(data.properties.clone());

    if data.armor_profile.is_some() {
        *armor_profile = data.armor_profile.clone();
    }
    if data.creature_profile.is_some() {
        *creature_profile = data.creature_profile.clone();
    }
    if data.weapon_profile.is_some() {
        *weapon_profile = data.weapon_profile.clone();
    }
    if data.hook_profile.is_some() {
        *hook_profile = data.hook_profile.clone();
    }
    if data.armor_levels.is_some() {
        *armor_levels = data.armor_levels.clone();
    }
    if !data.spell_book.is_empty() {
        *spell_book = data.spell_book.clone();
    }

    *armor_highlight = data.armor_highlight;
    *armor_color = data.armor_color;
    *weapon_highlight = data.weapon_highlight;
    *weapon_color = data.weapon_color;
    *resist_highlight = data.resist_highlight;
    *resist_color = data.resist_color;

    true
}

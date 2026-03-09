use holtburger_common::properties::{
    AttackType, ImbuedEffectType, ItemType, PropertyBool, PropertyFloat, PropertyInt,
    PropertyString, WeaponType, WorldObjectExt as _, WorldObjectPropertyAccessors,
};
use holtburger_common::stats::CreatureType;
use strum_macros::Display;
use crate::entity::Entity;
use crate::damage::compute_damage_range;
use crate::crafting::salvage::get_material_name;
use crate::magic::calculate_mana_time_left;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Assessment {
    pub name: String,
    pub description: Option<String>,
    pub value: u32,
    pub burden: Option<u32>,
    pub material: Option<MaterialInfo>,
    pub tinkering: Option<TinkeringInfo>,
    pub spellcraft: Option<i32>,
    pub mana: Option<ManaInfo>,
    pub status_flags: Vec<StatusFlag>,
    pub stack: Option<StackInfo>,
    pub uses: Option<UsesInfo>,
    pub armor: Option<i32>,
    pub weapon: Option<WeaponInfo>,
    pub creature: Option<CreatureInfo>,
    pub protections: Option<Protections>,
    pub imbued_effects: Vec<String>,
    pub effects: Vec<Effect>,
    pub use_info: Option<String>,
    pub spells: Vec<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Display)]
#[serde(tag = "type", content = "data")]
pub enum Effect {
    #[strum(serialize = "Armor Rending")]
    ArmorRending,
    #[strum(serialize = "Armor Cleaving")]
    ArmorCleaving,
    #[strum(serialize = "Slash Cleaving")]
    SlashCleaving,
    #[strum(serialize = "Pierce Cleaving")]
    PierceCleaving,
    #[strum(serialize = "Bludgeon Cleaving")]
    BludgeonCleaving,
    #[strum(serialize = "Acid Cleaving")]
    AcidCleaving,
    #[strum(serialize = "Cold Cleaving")]
    ColdCleaving,
    #[strum(serialize = "Electric Cleaving")]
    ElectricCleaving,
    #[strum(serialize = "Fire Cleaving")]
    FireCleaving,
    #[strum(serialize = "Nether Cleaving")]
    NetherCleaving,
    #[strum(serialize = "Magic Absorption")]
    MagicAbsorption,
    #[strum(serialize = "Biting Strike")]
    BitingStrike(f64),
    #[strum(serialize = "Crushing Blow")]
    CrushingBlow(f64),
    Slayer {
        creature_type: CreatureType,
        bonus: f64,
    },
    Multistrike,
    Cleaving(i32),
    #[strum(serialize = "Always Critical")]
    AlwaysCritical,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MaterialInfo {
    pub name: String,
    pub workmanship: i32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TinkeringInfo {
    pub count: i32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ManaInfo {
    pub current: i32,
    pub max: i32,
    pub seconds_left: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub enum StatusFlag {
    Retained,
    Bonded,
    Attuned,
    Sticky,
    Locked,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StackInfo {
    pub current: u32,
    pub max: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UsesInfo {
    pub current: u32,
    pub max: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WeaponInfo {
    pub damage_min: f64,
    pub damage_max: f64,
    pub damage_types: Vec<String>,
    pub speed: f32,
    pub weapon_type: Option<WeaponType>,
    pub wield_skill_type: Option<u32>, // SkillType enum from stats.rs might be better but u32 is safe for now
    pub difficulty: i32,
    pub attack_bonus: Option<f64>,
    pub defense_bonus: Option<f64>,
    pub missile_defense_bonus: Option<f64>,
    pub magic_defense_bonus: Option<f64>,
    pub mana_conversion_mod: Option<f64>,
    pub crit_rate: Option<f64>,
    pub elemental_damage_mod: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CreatureInfo {
    pub health: u32,
    pub health_max: u32,
    pub stamina: u32,
    pub stamina_max: u32,
    pub mana: u32,
    pub mana_max: u32,
    pub attributes: Option<Attributes>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Attributes {
    pub strength: u32,
    pub endurance: u32,
    pub coordination: u32,
    pub quickness: u32,
    pub focus: u32,
    pub self_attr: u32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Protections {
    pub slashing: f32,
    pub piercing: f32,
    pub bludgeoning: f32,
    pub fire: f32,
    pub cold: f32,
    pub acid: f32,
    pub lightning: f32,
    pub nether: f32,
}

impl Assessment {
    pub fn from_entity(entity: &Entity) -> Self {
        Assessment {
            name: entity.name().to_string(),
            description: entity
                .get_string_prop(PropertyString::LongDesc)
                .or_else(|| entity.get_string_prop(PropertyString::ShortDesc))
                .map(|s| s.to_string()),
            value: entity.item_value() as u32,
            burden: entity.burden(),
            material: MaterialInfo::from_entity(entity),
            tinkering: TinkeringInfo::from_entity(entity),
            spellcraft: entity.get_int_prop(PropertyInt::ItemSpellcraft),
            mana: ManaInfo::from_entity(entity),
            status_flags: StatusFlag::from_entity(entity),
            stack: StackInfo::from_entity(entity),
            uses: UsesInfo::from_entity(entity),
            armor: entity.get_int_prop(PropertyInt::ArmorLevel),
            weapon: WeaponInfo::from_entity(entity),
            creature: CreatureInfo::from_entity(entity),
            protections: Protections::from_entity(entity),
            imbued_effects: get_imbued_effects(entity),
            effects: Effect::from_entity(entity),
            use_info: entity
                .get_string_prop(PropertyString::Use)
                .map(|s| s.to_string()),
            spells: entity.spell_book.clone(),
        }
    }
}

impl MaterialInfo {
    fn from_entity(entity: &Entity) -> Option<Self> {
        let mat_type = entity.get_int_prop(PropertyInt::MaterialType)?;
        let workmanship = entity.get_int_prop(PropertyInt::ItemWorkmanship)?;

        Some(MaterialInfo {
            name: get_material_name(mat_type as u32).to_string(),
            workmanship,
        })
    }
}

impl TinkeringInfo {
    fn from_entity(entity: &Entity) -> Option<Self> {
        entity
            .get_int_prop(PropertyInt::NumTimesTinkered)
            .filter(|&t| t > 0)
            .map(|count| TinkeringInfo { count })
    }
}

impl ManaInfo {
    fn from_entity(entity: &Entity) -> Option<Self> {
        let max = entity.get_int_prop(PropertyInt::ItemMaxMana)?;
        let current = entity.get_int_prop(PropertyInt::ItemCurMana).unwrap_or(0);
        let seconds_left = entity
            .get_float_prop(PropertyFloat::ManaRate)
            .and_then(|rate| calculate_mana_time_left(current, rate));

        Some(ManaInfo {
            current,
            max,
            seconds_left,
        })
    }
}

impl StatusFlag {
    fn from_entity(entity: &Entity) -> Vec<Self> {
        let mut flags = Vec::new();
        if entity.get_bool_prop(PropertyBool::Retained) {
            flags.push(StatusFlag::Retained);
        }
        if entity.get_int_prop(PropertyInt::Bonded).unwrap_or(0) != 0 {
            flags.push(StatusFlag::Bonded);
        }
        match entity.get_int_prop(PropertyInt::Attuned).unwrap_or(0) {
            1 => flags.push(StatusFlag::Attuned),
            2 => flags.push(StatusFlag::Sticky),
            _ => {}
        }
        if entity.is_locked() {
            flags.push(StatusFlag::Locked);
        }
        flags
    }
}

impl StackInfo {
    fn from_entity(entity: &Entity) -> Option<Self> {
        entity
            .max_stack_size()
            .filter(|&max| max > 1)
            .map(|max| StackInfo {
                current: entity.stack_size(),
                max,
            })
    }
}

impl UsesInfo {
    fn from_entity(entity: &Entity) -> Option<Self> {
        entity.max_structure().map(|max| UsesInfo {
            current: entity.structure().unwrap_or(0),
            max,
        })
    }
}

impl WeaponInfo {
    fn from_entity(entity: &Entity) -> Option<Self> {
        if !entity.item_type().is_some_and(|it| {
            it.intersects(ItemType::MELEE_WEAPON | ItemType::CASTER | ItemType::MISSILE_WEAPON)
        }) {
            return None;
        }

        let range = compute_damage_range(entity)?;

        // Use attack offense from profile as fallback for the bonus
        let attack_bonus = get_normalized_multiplier(entity, PropertyFloat::WeaponOffense).or_else(|| {
            entity
                .weapon_profile
                .as_ref()
                .map(|p| p.weapon_offense - 1.0)
                .filter(|&v| v.abs() > f64::EPSILON)
        });

        Some(WeaponInfo {
            damage_min: range.min,
            damage_max: range.max,
            damage_types: range
                .damage_type
                .iter_display_names()
                .map(|s| s.to_string())
                .collect(),
            speed: entity
                .weapon_profile
                .as_ref()
                .map(|p| p.weapon_time as f32)
                .unwrap_or(0.0),
            weapon_type: entity
                .get_int_prop(PropertyInt::WeaponType)
                .and_then(|w| WeaponType::from_repr(w as u32)),
            wield_skill_type: entity.get_int_prop(PropertyInt::WieldSkillType).map(|s| s as u32),
            difficulty: entity.get_int_prop(PropertyInt::WieldDifficulty).unwrap_or(0),
            attack_bonus,
            defense_bonus: get_normalized_multiplier(entity, PropertyFloat::WeaponDefense),
            missile_defense_bonus: get_normalized_multiplier(entity, PropertyFloat::WeaponMissileDefense),
            magic_defense_bonus: get_normalized_multiplier(entity, PropertyFloat::WeaponMagicDefense),
            mana_conversion_mod: get_nonzero_modifier(entity, PropertyFloat::ManaConversionMod),
            crit_rate: get_nonzero_modifier(entity, PropertyFloat::CriticalFrequency),
            elemental_damage_mod: get_normalized_multiplier(entity, PropertyFloat::ElementalDamageMod),
        })
    }
}

/// Extracts a multiplier-based property (baseline 1.0) and returns it normalized to 0.0.
fn get_normalized_multiplier(entity: &Entity, prop: PropertyFloat) -> Option<f64> {
    entity
        .get_float_prop(prop)
        .map(|v| v - 1.0)
        .filter(|&v| v.abs() > f64::EPSILON)
}

/// Extracts a modifier-based property (baseline 0.0) and returns it if it is non-zero.
fn get_nonzero_modifier(entity: &Entity, prop: PropertyFloat) -> Option<f64> {
    entity.get_float_prop(prop).filter(|&v| v != 0.0)
}

impl CreatureInfo {
    fn from_entity(entity: &Entity) -> Option<Self> {
        let cp = entity.creature_profile.as_ref()?;
        Some(CreatureInfo {
            health: cp.health,
            health_max: cp.health_max,
            stamina: cp.attributes.as_ref().map(|a| a.stamina).unwrap_or(0),
            stamina_max: cp.attributes.as_ref().map(|a| a.stamina_max).unwrap_or(0),
            mana: cp.attributes.as_ref().map(|a| a.mana).unwrap_or(0),
            mana_max: cp.attributes.as_ref().map(|a| a.mana_max).unwrap_or(0),
            attributes: cp.attributes.as_ref().map(|a| Attributes {
                strength: a.strength,
                endurance: a.endurance,
                coordination: a.coordination,
                quickness: a.quickness,
                focus: a.focus,
                self_attr: a.self_attr,
            }),
        })
    }
}

impl Protections {
    fn from_entity(entity: &Entity) -> Option<Self> {
        let ap = entity.armor_profile.as_ref()?;
        Some(Protections {
            slashing: ap.slashing,
            piercing: ap.piercing,
            bludgeoning: ap.bludgeoning,
            fire: ap.fire,
            cold: ap.cold,
            acid: ap.acid,
            lightning: ap.lightning,
            nether: ap.nether,
        })
    }
}

impl Effect {
    fn from_entity(entity: &Entity) -> Vec<Self> {
        let mut effects = Vec::new();

        // Float Detectors (Present if nonzero)
        if entity.get_float_prop(PropertyFloat::IgnoreArmor).is_some() {
            // Distinguish between Rending and Cleaving base on property values or context
            // In ACE, Rending is usually 1.0/0.0 on the prop, Cleaving might be different
            // But for now we'll just check existence as requested.
            effects.push(Effect::ArmorRending);
        }

        if let Some(res_mod) = entity.get_float_prop(PropertyFloat::ResistanceModifier) {
            if res_mod != 0.0 {
                // ResistanceModifier is used for Cleaving.
                // We'd need DamageType logic to know WHICH cleaving, but the prompt
                // asks for them as separate variants. We'll use the weapon's damage type.
                if let Some(range) = compute_damage_range(entity) {
                    let dt = range.damage_type;
                    if dt.contains(holtburger_common::properties::DamageType::SLASH) {
                        effects.push(Effect::SlashCleaving);
                    }
                    if dt.contains(holtburger_common::properties::DamageType::PIERCE) {
                        effects.push(Effect::PierceCleaving);
                    }
                    if dt.contains(holtburger_common::properties::DamageType::BLUDGEON) {
                        effects.push(Effect::BludgeonCleaving);
                    }
                    if dt.contains(holtburger_common::properties::DamageType::ACID) {
                        effects.push(Effect::AcidCleaving);
                    }
                    if dt.contains(holtburger_common::properties::DamageType::COLD) {
                        effects.push(Effect::ColdCleaving);
                    }
                    if dt.contains(holtburger_common::properties::DamageType::ELECTRIC) {
                        effects.push(Effect::ElectricCleaving);
                    }
                    if dt.contains(holtburger_common::properties::DamageType::FIRE) {
                        effects.push(Effect::FireCleaving);
                    }
                    if dt.contains(holtburger_common::properties::DamageType::NETHER) {
                        effects.push(Effect::NetherCleaving);
                    }
                }
            }
        }

        if entity.get_float_prop(PropertyFloat::AbsorbMagicDamage).is_some() {
            effects.push(Effect::MagicAbsorption);
        }

        // Float Properties (Strength attached)
        if let Some(freq) = entity.get_float_prop(PropertyFloat::CriticalFrequency) {
            if freq > 0.0 {
                effects.push(Effect::BitingStrike(freq));
            }
        }
        if let Some(mult) = entity.get_float_prop(PropertyFloat::CriticalMultiplier) {
            if mult > 0.0 {
                effects.push(Effect::CrushingBlow(mult));
            }
        }
        if let Some(bonus) = entity.get_float_prop(PropertyFloat::SlayerDamageBonus) {
            if bonus > 0.0 {
                if let Some(creature_type) = entity
                    .get_int_prop(PropertyInt::SlayerCreatureType)
                    .and_then(|t| CreatureType::from_repr(t as u32))
                {
                    effects.push(Effect::Slayer {
                        creature_type,
                        bonus,
                    });
                }
            }
        }

        // Int Properties
        if let Some(at) = entity
            .get_int_prop(PropertyInt::AttackType)
            .map(|bits| AttackType::from_bits_truncate(bits as u32))
        {
            if at.intersects(AttackType::DoubleStrike | AttackType::TripleStrike) {
                effects.push(Effect::Multistrike);
            }
        }

        if let Some(cleave_targets) = entity.get_int_prop(PropertyInt::Cleaving) {
            if cleave_targets > 0 {
                effects.push(Effect::Cleaving(cleave_targets));
            }
        }

        // Bitflags in ImbuedEffect (formerly thought as PropertyBool)
        let bits = [
            PropertyInt::ImbuedEffect,
            PropertyInt::ImbuedEffect2,
            PropertyInt::ImbuedEffect3,
            PropertyInt::ImbuedEffect4,
            PropertyInt::ImbuedEffect5,
        ]
        .into_iter()
        .filter_map(|p| entity.get_int_prop(p))
        .fold(0u32, |acc, val| acc | (val as u32));

        let imbued = ImbuedEffectType::from_bits_truncate(bits);
        if imbued.contains(ImbuedEffectType::AlwaysCritical) {
            effects.push(Effect::AlwaysCritical);
        }

        effects
    }
}

fn get_imbued_effects(entity: &Entity) -> Vec<String> {
    let bits = [
        PropertyInt::ImbuedEffect,
        PropertyInt::ImbuedEffect2,
        PropertyInt::ImbuedEffect3,
        PropertyInt::ImbuedEffect4,
        PropertyInt::ImbuedEffect5,
    ]
    .into_iter()
    .filter_map(|p| entity.get_int_prop(p))
    .fold(0u32, |acc, val| acc | (val as u32));

    ImbuedEffectType::from_bits_truncate(bits)
        .iter_display_names()
        .map(|s| s.to_string())
        .collect()
}

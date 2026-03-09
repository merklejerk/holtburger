use crate::damage::compute_damage_range;
use crate::entity::Entity;
use crate::magic::calculate_mana_time_left;
use holtburger_common::properties::{
    AttackType, DamageType, ImbuedEffectType, ItemType, MaterialType, PropertyBool, PropertyFloat,
    PropertyInt, PropertyString, WeaponType, WorldObjectExt as _, WorldObjectPropertyAccessors,
};
use holtburger_common::stats::{CreatureType, SkillType};
use strum_macros::{Display, FromRepr};

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
    pub bonded: Option<BondedStatus>,
    pub attuned: Option<AttunedStatus>,
    pub is_retained: bool,
    pub is_locked: bool,
    pub is_sellable: bool,
    pub stack: Option<StackInfo>,
    pub uses: Option<UsesInfo>,
    pub armor: Option<i32>,
    pub weapon: Option<WeaponInfo>,
    pub creature: Option<CreatureInfo>,
    pub protections: Option<Protections>,
    pub bonuses: Vec<Bonus>,
    pub wield_requirements: Vec<WieldRequirement>,
    pub inscriptions: Option<InscriptionInfo>,
    pub imbued_effects: Vec<String>,
    pub effects: Vec<Effect>,
    pub use_info: Option<String>,
    pub spells: Vec<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Bonus {
    pub name: String,
    pub value: f64,
    pub is_multiplier: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum WieldRequirement {
    Skill {
        skill: SkillType,
        difficulty: i32,
    },
    RawSkill {
        skill: SkillType,
        difficulty: i32,
    },
    Attribute {
        attribute: AttributeType,
        difficulty: i32,
    },
    RawAttribute {
        attribute: AttributeType,
        difficulty: i32,
    },
    Vital {
        vital: VitalType,
        difficulty: i32,
    },
    RawVital {
        vital: VitalType,
        difficulty: i32,
    },
    Level {
        level: i32,
    },
    Training {
        skill: SkillType,
        level: TrainingLevel,
    },
    IntStat {
        property: PropertyInt,
        value: i32,
    },
    BoolStat {
        property: PropertyBool,
        value: bool,
    },
    CreatureType {
        creature_type: CreatureType,
    },
    Heritage {
        heritage: HeritageGroup,
    },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InscriptionInfo {
    pub text: String,
    pub scribe: Option<String>,
}

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, Display, PartialEq, Eq, FromRepr,
)]
pub enum WieldRequirementType {
    Invalid = 0,
    Skill = 1,
    RawSkill = 2,
    Attrib = 3,
    RawAttrib = 4,
    SecondaryAttrib = 5,
    RawSecondaryAttrib = 6,
    Level = 7,
    Training = 8,
    IntStat = 9,
    BoolStat = 10,
    CreatureType = 11,
    HeritageType = 12,
}

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, Display, PartialEq, Eq, FromRepr,
)]
pub enum AttributeType {
    Undef = 0,
    Strength = 1,
    Endurance = 2,
    Quickness = 3,
    Coordination = 4,
    Focus = 5,
    SelfAttr = 6,
}

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, Display, PartialEq, Eq, FromRepr,
)]
pub enum VitalType {
    Undef = 0,
    MaxHealth = 1,
    Health = 2,
    MaxStamina = 3,
    Stamina = 4,
    MaxMana = 5,
    Mana = 6,
}

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, Display, PartialEq, Eq, FromRepr,
)]
pub enum TrainingLevel {
    Inactive = 0,
    Untrained = 1,
    Trained = 2,
    Specialized = 3,
}

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, Display, PartialEq, Eq, FromRepr,
)]
pub enum HeritageGroup {
    Invalid = 0,
    Aluvian = 1,
    Gharundim = 2,
    Sho = 3,
    Viamontian = 4,
    Shadowbound = 5,
    Gearknight = 6,
    Tumerok = 7,
    Lugian = 8,
    Empyrean = 9,
    Penumbraen = 10,
    Undead = 11,
    Olthoi = 12,
    OlthoiAcid = 13,
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
    pub material_type: MaterialType,
    pub workmanship: f32,
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

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, Display)]
pub enum BondedStatus {
    #[strum(serialize = "Destroy")]
    Destroy = -2,
    #[strum(serialize = "Slippery")]
    Slippery = -1,
    #[strum(serialize = "Normal")]
    Normal = 0,
    #[strum(serialize = "Bonded")]
    Bonded = 1,
    // Unused by ACE
    // #[strum(serialize = "Sticky")]
    // Sticky = 2,
}

impl BondedStatus {
    fn from_entity(entity: &Entity) -> Option<Self> {
        let val = entity.get_int_prop(PropertyInt::Bonded)?;
        match val {
            -2 => Some(BondedStatus::Destroy),
            -1 => Some(BondedStatus::Slippery),
            0 => Some(BondedStatus::Normal),
            1 => Some(BondedStatus::Bonded),
            // Unused by ACE
            // 2 => Some(BondedStatus::Sticky),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, Display)]
pub enum AttunedStatus {
    #[strum(serialize = "Normal")]
    Normal = 0,
    #[strum(serialize = "Attuned")]
    Attuned = 1,
    #[strum(serialize = "Sticky")]
    Sticky = 2,
}

impl AttunedStatus {
    fn from_entity(entity: &Entity) -> Option<Self> {
        let val = entity.get_int_prop(PropertyInt::Attuned)?;
        match val {
            0 => Some(AttunedStatus::Normal),
            1 => Some(AttunedStatus::Attuned),
            2 => Some(AttunedStatus::Sticky),
            _ => None,
        }
    }
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
    pub damage_type: DamageType,
    pub speed: f32,
    pub weapon_type: Option<WeaponType>,
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
            value: entity.item_value(),
            burden: entity.burden(),
            material: MaterialInfo::from_entity(entity),
            tinkering: TinkeringInfo::from_entity(entity),
            spellcraft: entity.get_int_prop(PropertyInt::ItemSpellcraft),
            mana: ManaInfo::from_entity(entity),
            bonded: BondedStatus::from_entity(entity),
            attuned: AttunedStatus::from_entity(entity),
            is_retained: entity.get_bool_prop(PropertyBool::Retained),
            is_locked: entity.is_locked(),
            is_sellable: entity.is_sellable(),
            stack: StackInfo::from_entity(entity),
            uses: UsesInfo::from_entity(entity),
            armor: entity.get_int_prop(PropertyInt::ArmorLevel),
            weapon: WeaponInfo::from_entity(entity),
            creature: CreatureInfo::from_entity(entity),
            protections: Protections::from_entity(entity),
            bonuses: get_bonuses(entity),
            wield_requirements: get_wield_requirements(entity),
            inscriptions: InscriptionInfo::from_entity(entity),
            imbued_effects: get_imbued_effects(entity),
            effects: Effect::from_entity(entity),
            use_info: entity
                .get_string_prop(PropertyString::Use)
                .map(|s| s.to_string()),
            spells: entity.spell_book.clone(),
        }
    }
}

fn get_wield_requirements(entity: &Entity) -> Vec<WieldRequirement> {
    let mut reqs = Vec::new();

    // Regular Wield Requirements
    let configs = [
        (
            PropertyInt::WieldRequirements,
            PropertyInt::WieldSkillType,
            PropertyInt::WieldDifficulty,
        ),
        (
            PropertyInt::WieldRequirements2,
            PropertyInt::WieldSkillType2,
            PropertyInt::WieldDifficulty2,
        ),
        (
            PropertyInt::WieldRequirements3,
            PropertyInt::WieldSkillType3,
            PropertyInt::WieldDifficulty3,
        ),
        (
            PropertyInt::WieldRequirements4,
            PropertyInt::WieldSkillType4,
            PropertyInt::WieldDifficulty4,
        ),
    ];

    for (req_prop, skill_prop, diff_prop) in configs {
        let req_type_id = entity.get_int_prop(req_prop).unwrap_or(0);
        let requirement_type =
            if let Some(rt) = WieldRequirementType::from_repr(req_type_id as usize) {
                rt
            } else if entity.get_int_prop(skill_prop).is_some() {
                // Default to Skill if skill_prop exists but req_prop doesn't
                WieldRequirementType::Skill
            } else {
                WieldRequirementType::Invalid
            };

        if requirement_type != WieldRequirementType::Invalid {
            let skill_id = entity.get_int_prop(skill_prop).unwrap_or(0) as u32;
            let difficulty = entity.get_int_prop(diff_prop).unwrap_or(0);

            let req = match requirement_type {
                WieldRequirementType::Skill => SkillType::from_repr(skill_id)
                    .map(|skill| WieldRequirement::Skill { skill, difficulty }),
                WieldRequirementType::RawSkill => SkillType::from_repr(skill_id)
                    .map(|skill| WieldRequirement::RawSkill { skill, difficulty }),
                WieldRequirementType::Attrib => {
                    AttributeType::from_repr(skill_id as usize).map(|attribute| {
                        WieldRequirement::Attribute {
                            attribute,
                            difficulty,
                        }
                    })
                }
                WieldRequirementType::RawAttrib => {
                    AttributeType::from_repr(skill_id as usize).map(|attribute| {
                        WieldRequirement::RawAttribute {
                            attribute,
                            difficulty,
                        }
                    })
                }
                WieldRequirementType::SecondaryAttrib => VitalType::from_repr(skill_id as usize)
                    .map(|vital| WieldRequirement::Vital { vital, difficulty }),
                WieldRequirementType::RawSecondaryAttrib => VitalType::from_repr(skill_id as usize)
                    .map(|vital| WieldRequirement::RawVital { vital, difficulty }),
                WieldRequirementType::Level => Some(WieldRequirement::Level { level: difficulty }),
                WieldRequirementType::Training => {
                    SkillType::from_repr(skill_id).and_then(|skill| {
                        TrainingLevel::from_repr(difficulty as usize)
                            .map(|level| WieldRequirement::Training { skill, level })
                    })
                }
                WieldRequirementType::IntStat => {
                    PropertyInt::from_repr(skill_id).map(|property| WieldRequirement::IntStat {
                        property,
                        value: difficulty,
                    })
                }
                WieldRequirementType::BoolStat => {
                    PropertyBool::from_repr(skill_id).map(|property| WieldRequirement::BoolStat {
                        property,
                        value: difficulty != 0,
                    })
                }
                WieldRequirementType::CreatureType => CreatureType::from_repr(skill_id)
                    .map(|creature_type| WieldRequirement::CreatureType { creature_type }),
                WieldRequirementType::HeritageType => HeritageGroup::from_repr(skill_id as usize)
                    .map(|heritage| WieldRequirement::Heritage { heritage }),
                _ => None,
            };

            if let Some(r) = req {
                reqs.push(r);
            }
        }
    }

    // Arcane Lore requirement from ItemDifficulty
    if let Some(difficulty) = entity.get_int_prop(PropertyInt::ItemDifficulty)
        && difficulty > 0
    {
        reqs.push(WieldRequirement::Skill {
            skill: SkillType::ArcaneLore,
            difficulty,
        });
    }

    reqs
}

fn get_bonuses(entity: &Entity) -> Vec<Bonus> {
    let mut bonuses = Vec::new();

    let mult_props = [
        ("Attack Bonus", PropertyFloat::WeaponOffense),
        ("Defense Bonus", PropertyFloat::WeaponDefense),
        ("Missile Defense Bonus", PropertyFloat::WeaponMissileDefense),
        ("Magic Defense Bonus", PropertyFloat::WeaponMagicDefense),
        ("Elemental Damage", PropertyFloat::ElementalDamageMod),
    ];

    for (name, prop) in mult_props {
        if let Some(val) = get_normalized_multiplier(entity, prop) {
            bonuses.push(Bonus {
                name: name.to_string(),
                value: val,
                is_multiplier: true,
            });
        }
    }

    // Fallback for weapon offense from profile
    if !bonuses.iter().any(|b| b.name == "Attack Bonus")
        && let Some(p) = entity.weapon_profile.as_ref()
    {
        let val = p.weapon_offense - 1.0;
        if val.abs() > f64::EPSILON {
            bonuses.push(Bonus {
                name: "Attack Bonus".to_string(),
                value: val,
                is_multiplier: true,
            });
        }
    }

    let mod_props = [
        ("Mana Conv", PropertyFloat::ManaConversionMod),
        ("Crit Rate", PropertyFloat::CriticalFrequency),
    ];

    for (name, prop) in mod_props {
        if let Some(val) = get_nonzero_modifier(entity, prop) {
            bonuses.push(Bonus {
                name: name.to_string(),
                value: val,
                is_multiplier: false,
            });
        }
    }

    bonuses
}

impl InscriptionInfo {
    fn from_entity(entity: &Entity) -> Option<Self> {
        let text = entity.get_string_prop(PropertyString::Inscription)?;
        let scribe = entity
            .get_string_prop(PropertyString::ScribeName)
            .map(|s| s.to_string());

        Some(InscriptionInfo {
            text: text.to_string(),
            scribe,
        })
    }
}

impl MaterialInfo {
    fn from_entity(entity: &Entity) -> Option<Self> {
        let mat_type = entity.get_int_prop(PropertyInt::MaterialType)?;
        let workmanship = entity.effective_workmanship()? as f32;

        Some(MaterialInfo {
            material_type: MaterialType::from_repr(mat_type as u32)?,
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

        Some(WeaponInfo {
            damage_min: range.min,
            damage_max: range.max,
            damage_type: range.damage_type,
            speed: entity
                .weapon_profile
                .as_ref()
                .map(|p| p.weapon_time as f32)
                .unwrap_or(0.0),
            weapon_type: entity
                .get_int_prop(PropertyInt::WeaponType)
                .and_then(|w| WeaponType::from_repr(w as u32)),
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

        if let Some(res_mod) = entity.get_float_prop(PropertyFloat::ResistanceModifier)
            && res_mod != 0.0
        {
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

        if entity
            .get_float_prop(PropertyFloat::AbsorbMagicDamage)
            .is_some()
        {
            effects.push(Effect::MagicAbsorption);
        }

        // Float Properties (Strength attached)
        if let Some(freq) = entity.get_float_prop(PropertyFloat::CriticalFrequency)
            && freq > 0.0
        {
            effects.push(Effect::BitingStrike(freq));
        }
        if let Some(mult) = entity.get_float_prop(PropertyFloat::CriticalMultiplier)
            && mult > 0.0
        {
            effects.push(Effect::CrushingBlow(mult));
        }
        if let Some(bonus) = entity.get_float_prop(PropertyFloat::SlayerDamageBonus)
            && bonus > 0.0
            && let Some(creature_type) = entity
                .get_int_prop(PropertyInt::SlayerCreatureType)
                .and_then(|t| CreatureType::from_repr(t as u32))
        {
            effects.push(Effect::Slayer {
                creature_type,
                bonus,
            });
        }

        // Int Properties
        if let Some(at) = entity
            .get_int_prop(PropertyInt::AttackType)
            .map(|bits| AttackType::from_bits_truncate(bits as u32))
            && at.intersects(AttackType::DoubleStrike | AttackType::TripleStrike)
        {
            effects.push(Effect::Multistrike);
        }

        if let Some(cleave_targets) = entity.get_int_prop(PropertyInt::Cleaving)
            && cleave_targets > 0
        {
            effects.push(Effect::Cleaving(cleave_targets));
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

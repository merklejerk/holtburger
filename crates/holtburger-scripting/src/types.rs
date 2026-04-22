use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    DamageType, EquipMask, PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId,
    PropertyInt, PropertyInt64, PropertyString,
};
use holtburger_common::stats::{AttributeType, SkillType, TrainingLevel, VitalType};
use holtburger_core::{ActiveCharacterConfirmation, BusyOperationKind};
use holtburger_protocol::messages::combat::{
    AttackConditions, AttackHeight, CombatMode, DamageLocation,
};
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use holtburger_protocol::messages::object::types::{
    ArmorProfile, CreatureAttributes, CreatureBuffs, CreatureProfile, CreatureProfileFlags,
    WeaponProfile,
};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::ScriptJsonValue;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptSource {
    pub name: String,
    pub source: String,
}

impl ScriptSource {
    pub fn new(name: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            source: source.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptPostRequest {
    pub url: String,
    #[serde(default)]
    pub body_json: Option<ScriptJsonValue>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptPostResponse {
    pub ok: bool,
    pub status: u16,
    pub body_json: Option<ScriptJsonValue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptPostErrorCode {
    InvalidRequest,
    PolicyDenied,
    Timeout,
    Transport,
    ResponseTooLarge,
    InvalidJsonResponse,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptPostError {
    pub code: ScriptPostErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptFetchAllowedHost {
    pub host: String,
    pub port: u16,
}

fn normalize_script_fetch_host(host: &str) -> String {
    let trimmed = host.trim();
    let normalized = trimmed
        .strip_prefix('[')
        .and_then(|trimmed| trimmed.strip_suffix(']'))
        .unwrap_or(trimmed);
    normalized.to_ascii_lowercase()
}

impl ScriptFetchAllowedHost {
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: normalize_script_fetch_host(&host.into()),
            port,
        }
    }

    pub fn matches(&self, host: &str, port: u16) -> bool {
        self.host == normalize_script_fetch_host(host) && self.port == port
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptFetchPolicy {
    pub allowed_hosts: Vec<ScriptFetchAllowedHost>,
    pub timeout_ms: u64,
    pub max_response_bytes: usize,
}

impl ScriptFetchPolicy {
    pub const DEFAULT_TIMEOUT_MS: u64 = 5_000;
    pub const DEFAULT_MAX_RESPONSE_BYTES: usize = 256 * 1024;

    pub fn effective_timeout_ms(&self, requested_timeout_ms: Option<u64>) -> u64 {
        match requested_timeout_ms {
            Some(requested_timeout_ms) if requested_timeout_ms > 0 => {
                requested_timeout_ms.min(self.timeout_ms)
            }
            _ => self.timeout_ms,
        }
    }

    pub fn allows(&self, host: &str, port: u16) -> bool {
        self.allowed_hosts
            .iter()
            .any(|allowed_host| allowed_host.matches(host, port))
    }
}

impl Default for ScriptFetchPolicy {
    fn default() -> Self {
        Self {
            allowed_hosts: Vec::new(),
            timeout_ms: Self::DEFAULT_TIMEOUT_MS,
            max_response_bytes: Self::DEFAULT_MAX_RESPONSE_BYTES,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScriptHostConfig {
    pub fetch_policy: ScriptFetchPolicy,
}

/// Script-facing snapshot of client-visible state.
///
/// Implementations should project semantic frontend state and avoid leaking
/// widget-local concerns such as focus or scroll position.
/// `debug_log` is the one intentional side effect for script-side diagnostics.
pub trait ScriptClientView {
    fn self_entity(&self) -> Option<ScriptSelfView>;
    fn character_sheet(&self) -> Option<ScriptCharacterSheetView> {
        None
    }
    fn target_entity(&self) -> Option<ScriptEntityView>;
    fn entity(&self, guid: Guid) -> Option<ScriptEntityView>;
    fn entity_bool_prop(&self, guid: Guid, prop: PropertyBool) -> Option<bool>;
    fn entity_int_prop(&self, guid: Guid, prop: PropertyInt) -> Option<i32>;
    fn entity_int64_prop(&self, guid: Guid, prop: PropertyInt64) -> Option<i64>;
    fn entity_float_prop(&self, guid: Guid, prop: PropertyFloat) -> Option<f64>;
    fn entity_string_prop(&self, guid: Guid, prop: PropertyString) -> Option<String>;
    fn entity_data_prop(&self, guid: Guid, prop: PropertyDataId) -> Option<Guid>;
    fn entity_instance_prop(&self, guid: Guid, prop: PropertyInstanceId) -> Option<Guid>;
    fn load_config(&self) -> Option<ScriptJsonValue> {
        None
    }
    fn load_data(&self) -> Option<ScriptJsonValue> {
        None
    }
    fn load_data_bin(&self) -> Option<Vec<u8>> {
        None
    }
    fn write_config(&self, _contents: String) -> bool {
        false
    }
    fn debug_log(&self, message: String) {
        log::info!("{}", message);
    }
    fn nearby_entities(
        &self,
        max_distance: Option<f32>,
        classifications: Option<Vec<ScriptEntityKind>>,
    ) -> Vec<ScriptEntityView>;
    fn inventory(&self) -> Vec<ScriptContainerView>;
    fn current_open_container(&self) -> Option<Guid>;
    fn equipment(&self) -> Vec<ScriptEquipmentSlotView>;
    fn combat_info(&self) -> ScriptCombatInfo;
    fn current_interaction(&self) -> Option<ScriptClientInteraction>;
    fn enchantments(&self) -> Vec<ScriptEnchantmentView>;
    fn spellbook(&self) -> Vec<u32>;
    fn in_spellbook(&self, spell_id: u32) -> bool;
    fn distance(&self, from: ScriptPositionRef, to: ScriptPositionRef) -> f32;
    fn heading_to(&self, from: ScriptPositionRef, to: ScriptPositionRef) -> f32;
    fn entity_exists(&self, guid: Guid) -> bool;
    fn current_trade_info(&self) -> Option<ScriptTradeInfo>;
    fn party(&self) -> Option<ScriptPartyView>;
    fn server_time(&self) -> Option<f64>;
    fn pending_confirmation(&self) -> Option<ScriptConfirmation>;
    fn busy_operation(&self) -> ScriptBusyOperation;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptSelfView {
    pub guid: Guid,
    pub name: String,
    pub position: ScriptWorldPosition,
    pub health: u32,
    pub health_max: u32,
    pub stamina: u32,
    pub stamina_max: u32,
    pub mana: u32,
    pub mana_max: u32,
    pub encumbrance: f32,
    pub capacity: f32,
    pub busy_operation: ScriptBusyOperation,
    pub heading: f32,
    pub combat_mode: CombatMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptCharacterSheetView {
    pub attributes: Vec<ScriptCharacterAttributeView>,
    pub vitals: Vec<ScriptCharacterVitalView>,
    pub skills: Vec<ScriptCharacterSkillView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptCharacterAttributeView {
    pub attribute_type: AttributeType,
    pub base: u32,
    pub effective: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptCharacterVitalView {
    pub vital_type: VitalType,
    pub base: u32,
    pub effective: u32,
    pub current: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptCharacterSkillView {
    pub skill_type: SkillType,
    pub base: u32,
    pub effective: u32,
    pub training: TrainingLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ScriptPositionRef {
    Position(ScriptWorldPosition),
    Guid(Guid),
}

impl From<ScriptWorldPosition> for ScriptPositionRef {
    fn from(position: ScriptWorldPosition) -> Self {
        Self::Position(position)
    }
}

impl From<WorldPosition> for ScriptPositionRef {
    fn from(position: WorldPosition) -> Self {
        Self::Position(position.into())
    }
}

impl From<Guid> for ScriptPositionRef {
    fn from(guid: Guid) -> Self {
        Self::Guid(guid)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptWorldPosition {
    pub landblock_id: Guid,
    pub coords: holtburger_common::Vector3,
    pub rotation: holtburger_common::Quaternion,
}

impl From<WorldPosition> for ScriptWorldPosition {
    fn from(position: WorldPosition) -> Self {
        Self {
            landblock_id: position.landblock_id,
            coords: position.coords,
            rotation: position.rotation,
        }
    }
}

impl From<ScriptWorldPosition> for WorldPosition {
    fn from(position: ScriptWorldPosition) -> Self {
        Self {
            landblock_id: position.landblock_id,
            coords: position.coords,
            rotation: position.rotation,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptCombatInfo {
    pub combat_mode: CombatMode,
    pub is_engaged: bool,
    pub target: Option<Guid>,
    pub power: f32,
    pub height: AttackHeight,
    pub last_attack_time: Option<f64>,
}

impl Default for ScriptCombatInfo {
    fn default() -> Self {
        Self {
            combat_mode: CombatMode::NonCombat,
            is_engaged: false,
            target: None,
            power: 0.0,
            height: AttackHeight::Medium,
            last_attack_time: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEnchantmentView {
    pub spell_id: u32,
    pub end_time: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptClientInteraction {
    TargetEntity { guid: Guid },
    Approach { guid: Guid },
    Follow { guid: Guid },
    Attack { guid: Guid },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptBusyOperation {
    #[default]
    None,
    Use,
    UseWithTarget,
    Salvage,
    SpellCast,
    Buy,
    Sell,
}

impl ScriptBusyOperation {
    pub const fn from_kind(kind: BusyOperationKind) -> Self {
        match kind {
            BusyOperationKind::Use => Self::Use,
            BusyOperationKind::UseWithTarget => Self::UseWithTarget,
            BusyOperationKind::Salvage => Self::Salvage,
            BusyOperationKind::SpellCast => Self::SpellCast,
            BusyOperationKind::Buy => Self::Buy,
            BusyOperationKind::Sell => Self::Sell,
        }
    }
}

impl From<BusyOperationKind> for ScriptBusyOperation {
    fn from(kind: BusyOperationKind) -> Self {
        Self::from_kind(kind)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEntityView {
    pub guid: Guid,
    pub name: Option<String>,
    pub kind: ScriptEntityKind,
    pub weenie_id: Option<u32>,
    pub position: ScriptWorldPosition,
    pub profile: Option<ScriptEntityProfile>,
    pub container: Guid,
    pub wielder: Guid,
    pub distance_to_self: f32,
    pub motion_command: ScriptMotionCommand,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ScriptEntityProfile {
    Armor(ArmorProfile),
    Creature(CreatureProfile),
    Weapon(WeaponProfile),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptArmorProfileSerde {
    slashing: f32,
    piercing: f32,
    bludgeoning: f32,
    cold: f32,
    fire: f32,
    acid: f32,
    nether: f32,
    lightning: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptCreatureAttributesSerde {
    strength: u32,
    endurance: u32,
    quickness: u32,
    coordination: u32,
    focus: u32,
    self_attr: u32,
    stamina: u32,
    mana: u32,
    stamina_max: u32,
    mana_max: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptCreatureBuffsSerde {
    highlights: u16,
    colors: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptCreatureProfileSerde {
    flags: CreatureProfileFlags,
    health: u32,
    health_max: u32,
    attributes: Option<ScriptCreatureAttributesSerde>,
    buffs: Option<ScriptCreatureBuffsSerde>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptWeaponProfileSerde {
    damage_type: u32,
    weapon_time: u32,
    weapon_skill: u32,
    damage: u32,
    damage_variance: f64,
    damage_mod: f64,
    weapon_length: f64,
    max_velocity: f64,
    weapon_offense: f64,
    max_velocity_estimated: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
enum ScriptEntityProfileSerde {
    Armor(ScriptArmorProfileSerde),
    Creature(ScriptCreatureProfileSerde),
    Weapon(ScriptWeaponProfileSerde),
}

impl Serialize for ScriptEntityProfile {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        ScriptEntityProfileSerde::from(self).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ScriptEntityProfile {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        ScriptEntityProfileSerde::deserialize(deserializer).map(Into::into)
    }
}

impl From<&ScriptEntityProfile> for ScriptEntityProfileSerde {
    fn from(profile: &ScriptEntityProfile) -> Self {
        match profile {
            ScriptEntityProfile::Armor(data) => Self::Armor(data.into()),
            ScriptEntityProfile::Creature(data) => Self::Creature(data.into()),
            ScriptEntityProfile::Weapon(data) => Self::Weapon(data.into()),
        }
    }
}

impl From<ScriptEntityProfileSerde> for ScriptEntityProfile {
    fn from(profile: ScriptEntityProfileSerde) -> Self {
        match profile {
            ScriptEntityProfileSerde::Armor(data) => Self::Armor(data.into()),
            ScriptEntityProfileSerde::Creature(data) => Self::Creature(data.into()),
            ScriptEntityProfileSerde::Weapon(data) => Self::Weapon(data.into()),
        }
    }
}

impl From<&ArmorProfile> for ScriptArmorProfileSerde {
    fn from(profile: &ArmorProfile) -> Self {
        Self {
            slashing: profile.slashing,
            piercing: profile.piercing,
            bludgeoning: profile.bludgeoning,
            cold: profile.cold,
            fire: profile.fire,
            acid: profile.acid,
            nether: profile.nether,
            lightning: profile.lightning,
        }
    }
}

impl From<ScriptArmorProfileSerde> for ArmorProfile {
    fn from(profile: ScriptArmorProfileSerde) -> Self {
        Self {
            slashing: profile.slashing,
            piercing: profile.piercing,
            bludgeoning: profile.bludgeoning,
            cold: profile.cold,
            fire: profile.fire,
            acid: profile.acid,
            nether: profile.nether,
            lightning: profile.lightning,
        }
    }
}

impl From<&CreatureAttributes> for ScriptCreatureAttributesSerde {
    fn from(attributes: &CreatureAttributes) -> Self {
        Self {
            strength: attributes.strength,
            endurance: attributes.endurance,
            quickness: attributes.quickness,
            coordination: attributes.coordination,
            focus: attributes.focus,
            self_attr: attributes.self_attr,
            stamina: attributes.stamina,
            mana: attributes.mana,
            stamina_max: attributes.stamina_max,
            mana_max: attributes.mana_max,
        }
    }
}

impl From<ScriptCreatureAttributesSerde> for CreatureAttributes {
    fn from(attributes: ScriptCreatureAttributesSerde) -> Self {
        Self {
            strength: attributes.strength,
            endurance: attributes.endurance,
            quickness: attributes.quickness,
            coordination: attributes.coordination,
            focus: attributes.focus,
            self_attr: attributes.self_attr,
            stamina: attributes.stamina,
            mana: attributes.mana,
            stamina_max: attributes.stamina_max,
            mana_max: attributes.mana_max,
        }
    }
}

impl From<&CreatureBuffs> for ScriptCreatureBuffsSerde {
    fn from(buffs: &CreatureBuffs) -> Self {
        Self {
            highlights: buffs.highlights,
            colors: buffs.colors,
        }
    }
}

impl From<ScriptCreatureBuffsSerde> for CreatureBuffs {
    fn from(buffs: ScriptCreatureBuffsSerde) -> Self {
        Self {
            highlights: buffs.highlights,
            colors: buffs.colors,
        }
    }
}

impl From<&CreatureProfile> for ScriptCreatureProfileSerde {
    fn from(profile: &CreatureProfile) -> Self {
        Self {
            flags: profile.flags,
            health: profile.health,
            health_max: profile.health_max,
            attributes: profile.attributes.as_ref().map(Into::into),
            buffs: profile.buffs.as_ref().map(Into::into),
        }
    }
}

impl From<ScriptCreatureProfileSerde> for CreatureProfile {
    fn from(profile: ScriptCreatureProfileSerde) -> Self {
        Self {
            flags: profile.flags,
            health: profile.health,
            health_max: profile.health_max,
            attributes: profile.attributes.map(Into::into),
            buffs: profile.buffs.map(Into::into),
        }
    }
}

impl From<&WeaponProfile> for ScriptWeaponProfileSerde {
    fn from(profile: &WeaponProfile) -> Self {
        Self {
            damage_type: profile.damage_type,
            weapon_time: profile.weapon_time,
            weapon_skill: profile.weapon_skill,
            damage: profile.damage,
            damage_variance: profile.damage_variance,
            damage_mod: profile.damage_mod,
            weapon_length: profile.weapon_length,
            max_velocity: profile.max_velocity,
            weapon_offense: profile.weapon_offense,
            max_velocity_estimated: profile.max_velocity_estimated,
        }
    }
}

impl From<ScriptWeaponProfileSerde> for WeaponProfile {
    fn from(profile: ScriptWeaponProfileSerde) -> Self {
        Self {
            damage_type: profile.damage_type,
            weapon_time: profile.weapon_time,
            weapon_skill: profile.weapon_skill,
            damage: profile.damage,
            damage_variance: profile.damage_variance,
            damage_mod: profile.damage_mod,
            weapon_length: profile.weapon_length,
            max_velocity: profile.max_velocity,
            weapon_offense: profile.weapon_offense,
            max_velocity_estimated: profile.max_velocity_estimated,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "data")]
pub enum ScriptMotionCommand {
    #[default]
    None,
    Stop,
    WalkForward,
    WalkBackwards,
    RunForward,
    TurnRight,
    TurnLeft,
    SidestepRight,
    SidestepLeft,
    Dead,
    Other(u16),
}

impl ScriptMotionCommand {
    pub fn from_command(command: InterpretedMotionCommand) -> Self {
        match command {
            InterpretedMotionCommand::STOP => Self::Stop,
            InterpretedMotionCommand::WALK_FORWARD => Self::WalkForward,
            InterpretedMotionCommand::WALK_BACKWARDS => Self::WalkBackwards,
            InterpretedMotionCommand::RUN_FORWARD => Self::RunForward,
            InterpretedMotionCommand::TURN_RIGHT => Self::TurnRight,
            InterpretedMotionCommand::TURN_LEFT => Self::TurnLeft,
            InterpretedMotionCommand::SIDESTEP_RIGHT => Self::SidestepRight,
            InterpretedMotionCommand::SIDESTEP_LEFT => Self::SidestepLeft,
            InterpretedMotionCommand::DEAD => Self::Dead,
            other => Self::Other(other.raw()),
        }
    }
}

impl From<InterpretedMotionCommand> for ScriptMotionCommand {
    fn from(command: InterpretedMotionCommand) -> Self {
        Self::from_command(command)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptEntityKind {
    Player,
    Npc,
    Vendor,
    Monster,
    Weapon,
    Apparel,
    Container,
    Item,
    Consumable,
    Money,
    Key,
    Writable,
    HealingKit,
    ManaStone,
    Door,
    Portal,
    LifeStone,
    Chest,
    Wand,
    Tool,
    StaticObject,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptContainerView {
    pub container_guid: Guid,
    pub slots: u32,
    pub items: Vec<Guid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptEquipmentSlotKind {
    HeadWear,
    ChestWear,
    AbdomenWear,
    UpperArmWear,
    LowerArmWear,
    HandWear,
    UpperLegWear,
    LowerLegWear,
    FootWear,
    ChestArmor,
    AbdomenArmor,
    UpperArmArmor,
    LowerArmArmor,
    UpperLegArmor,
    LowerLegArmor,
    NeckWear,
    LeftWrist,
    RightWrist,
    LeftFinger,
    RightFinger,
    MeleeWeapon,
    Shield,
    MissileWeapon,
    MissileAmmo,
    Caster,
    TwoHanded,
    TrinketOne,
    Cloak,
    SigilOne,
    SigilTwo,
    SigilThree,
}

impl ScriptEquipmentSlotKind {
    pub const ALL: [Self; 31] = [
        Self::HeadWear,
        Self::ChestWear,
        Self::AbdomenWear,
        Self::UpperArmWear,
        Self::LowerArmWear,
        Self::HandWear,
        Self::UpperLegWear,
        Self::LowerLegWear,
        Self::FootWear,
        Self::ChestArmor,
        Self::AbdomenArmor,
        Self::UpperArmArmor,
        Self::LowerArmArmor,
        Self::UpperLegArmor,
        Self::LowerLegArmor,
        Self::NeckWear,
        Self::LeftWrist,
        Self::RightWrist,
        Self::LeftFinger,
        Self::RightFinger,
        Self::MeleeWeapon,
        Self::Shield,
        Self::MissileWeapon,
        Self::MissileAmmo,
        Self::Caster,
        Self::TwoHanded,
        Self::TrinketOne,
        Self::Cloak,
        Self::SigilOne,
        Self::SigilTwo,
        Self::SigilThree,
    ];

    pub const fn equip_mask(self) -> EquipMask {
        match self {
            Self::HeadWear => EquipMask::HEAD_WEAR,
            Self::ChestWear => EquipMask::CHEST_WEAR,
            Self::AbdomenWear => EquipMask::ABDOMEN_WEAR,
            Self::UpperArmWear => EquipMask::UPPER_ARM_WEAR,
            Self::LowerArmWear => EquipMask::LOWER_ARM_WEAR,
            Self::HandWear => EquipMask::HAND_WEAR,
            Self::UpperLegWear => EquipMask::UPPER_LEG_WEAR,
            Self::LowerLegWear => EquipMask::LOWER_LEG_WEAR,
            Self::FootWear => EquipMask::FOOT_WEAR,
            Self::ChestArmor => EquipMask::CHEST_ARMOR,
            Self::AbdomenArmor => EquipMask::ABDOMEN_ARMOR,
            Self::UpperArmArmor => EquipMask::UPPER_ARM_ARMOR,
            Self::LowerArmArmor => EquipMask::LOWER_ARM_ARMOR,
            Self::UpperLegArmor => EquipMask::UPPER_LEG_ARMOR,
            Self::LowerLegArmor => EquipMask::LOWER_LEG_ARMOR,
            Self::NeckWear => EquipMask::NECK_WEAR,
            Self::LeftWrist => EquipMask::WRIST_WEAR_LEFT,
            Self::RightWrist => EquipMask::WRIST_WEAR_RIGHT,
            Self::LeftFinger => EquipMask::FINGER_WEAR_LEFT,
            Self::RightFinger => EquipMask::FINGER_WEAR_RIGHT,
            Self::MeleeWeapon => EquipMask::MELEE_WEAPON,
            Self::Shield => EquipMask::SHIELD,
            Self::MissileWeapon => EquipMask::MISSILE_WEAPON,
            Self::MissileAmmo => EquipMask::MISSILE_AMMO,
            Self::Caster => EquipMask::CASTER,
            Self::TwoHanded => EquipMask::TWO_HANDED,
            Self::TrinketOne => EquipMask::TRINKET_ONE,
            Self::Cloak => EquipMask::CLOAK,
            Self::SigilOne => EquipMask::SIGIL_ONE,
            Self::SigilTwo => EquipMask::SIGIL_TWO,
            Self::SigilThree => EquipMask::SIGIL_THREE,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptEquipmentSlotView {
    pub slot: ScriptEquipmentSlotKind,
    pub equip_mask: EquipMask,
    pub item_guid: Option<Guid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptTradeInfo {
    pub partner_guid: Guid,
    pub partner_name: Option<String>,
    pub our_items: Vec<Guid>,
    pub their_items: Vec<Guid>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptPartyView {
    pub leader_guid: Guid,
    pub members: Vec<ScriptPartyMemberView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptPartyMemberView {
    pub guid: Guid,
    pub name: Option<String>,
    pub health_percent: Option<f32>,
    pub stamina_percent: Option<f32>,
    pub mana_percent: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ScriptEvent {
    ChatMessage(ScriptChatEvent),
    CombatFeedback(ScriptCombatFeedback),
    Lifecycle(ScriptLifecycleEvent),
    Workflow(ScriptWorkflowEvent),
    Command {
        msg: String,
    },
    WeenieError {
        error: holtburger_protocol::errors::WeenieError,
    },
    SelfVitalsChanged,
    EntityAppeared {
        guid: Guid,
    },
    EntityDisappeared {
        guid: Guid,
    },
    EntityUpdated {
        guid: Guid,
    },
    TeleportStarted {
        sequence: u16,
    },
    PlayerKilled {
        death_message: String,
        victim_id: Guid,
        killer_id: Guid,
    },
    InventoryChanged {
        added: Vec<Guid>,
        removed: Vec<Guid>,
    },
    SpellbookChanged,
    PartyChanged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptChatEvent {
    pub channel: ScriptChatChannelKind,
    pub sender: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ScriptCombatFeedback {
    #[serde(rename_all = "camelCase")]
    AttackDone {
        error: holtburger_protocol::errors::WeenieError,
    },
    AttackCommenced,
    #[serde(rename_all = "camelCase")]
    AttackerNotification {
        defender_name: String,
        damage_type: DamageType,
        health_percent: f64,
        damage: u32,
        critical_hit: bool,
        attack_conditions: AttackConditions,
    },
    #[serde(rename_all = "camelCase")]
    DefenderNotification {
        attacker_name: String,
        damage_type: DamageType,
        health_percent: f64,
        damage: u32,
        damage_location: DamageLocation,
        critical_hit: bool,
        attack_conditions: AttackConditions,
    },
    #[serde(rename_all = "camelCase")]
    EvasionAttackerNotification {
        defender_name: String,
    },
    #[serde(rename_all = "camelCase")]
    EvasionDefenderNotification {
        attacker_name: String,
    },
    #[serde(rename_all = "camelCase")]
    VictimNotification {
        death_message: String,
    },
    #[serde(rename_all = "camelCase")]
    KillerNotification {
        death_message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptChatChannelKind {
    Say,
    Tell,
    Emote,
    SoulEmote,
    Fellowship,
    Allegiance,
    Vassals,
    Patron,
    Monarch,
    CoVassals,
    General,
    Trade,
    Lfg,
    Roleplay,
    Society,
    Olthoi,
    System,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ScriptLifecycleEvent {
    Started {
        args: String,
    },
    Stopped,
    #[serde(rename_all = "camelCase")]
    Tick {
        elapsed_seconds: f64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ScriptWorkflowEvent {
    ConfirmationOpened { confirmation: ScriptConfirmation },
    ConfirmationClosed,
    BusyOperationChanged { busy: ScriptBusyOperation },
    TargetEntityChanged { guid: Option<Guid> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ScriptConfirmation {
    Character(ActiveCharacterConfirmation),
    Local(ScriptLocalConfirmation),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptLocalConfirmation {
    pub kind: ScriptLocalConfirmationKind,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum ScriptLocalConfirmationKind {
    Unswear,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptIntent {
    Print {
        style: ScriptMessageStyle,
        message: String,
    },
    Say {
        message: String,
    },
    Tell {
        target: String,
        message: String,
    },
    Use {
        guid: Guid,
    },
    Emote {
        message: String,
    },
    SoulEmote {
        token: String,
    },
    OpenTrade {
        guid: Guid,
    },
    AddToTrade {
        item: Guid,
    },
    AcceptTrade,
    DeclineTrade,
    ResetTrade,
    ExitTrade,
    OpenContainer {
        guid: Guid,
    },
    CloseContainer {
        guid: Guid,
    },
    SnapHeading {
        heading: f32,
    },
    Scoot {
        distance_m: f32,
    },
    Combine {
        source: Guid,
        dest: Guid,
    },
    MoveItem {
        item: Guid,
        container: Guid,
    },
    StackItems {
        source: Guid,
        destination: Guid,
        amount: u32,
    },
    SplitItem {
        item: Guid,
        container: Guid,
        amount: u32,
    },
    Salvage {
        tool: Guid,
        items: Vec<Guid>,
    },
    Assess {
        target: Guid,
    },
    Drop {
        item: Guid,
    },
    Pickup {
        item: Guid,
        container: Option<Guid>,
    },
    Equip {
        guid: Guid,
        slot: ScriptEquipmentSlotKind,
    },
    Unequip {
        guid: Guid,
    },
    CastSpell {
        spell_id: u32,
        target: Option<Guid>,
    },
    RespondToConfirmation {
        accepted: bool,
    },
    SetCombatMode {
        on: bool,
    },
    Client(ScriptClientIntent),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScriptClientIntent {
    TargetEntity { guid: Guid },
    Approach { guid: Guid },
    Follow { guid: Guid },
    Attack { guid: Guid },
    CancelInteraction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptMessageStyle {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    System,
    Chat,
    Combat,
    Tell,
    Emote,
    Party,
    Guild,
    Trade,
    Help,
    Society,
    Magic,
}

#[cfg(test)]
mod tests {
    use super::ScriptEntityProfile;
    use crate::ScriptCombatFeedback;
    use deno_core::serde_json::{Value, from_value, json, to_value};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::DamageType;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_protocol::messages::combat::AttackConditions;
    use holtburger_protocol::messages::object::types::{
        ArmorProfile, CreatureAttributes, CreatureBuffs, CreatureProfile, CreatureProfileFlags,
        WeaponProfile,
    };

    fn assert_roundtrip(profile: ScriptEntityProfile, expected: Value) {
        let actual = to_value(&profile).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(from_value::<ScriptEntityProfile>(actual).unwrap(), profile);
    }

    #[test]
    fn script_entity_profile_serializes_nested_profiles_as_camel_case() {
        assert_roundtrip(
            ScriptEntityProfile::Armor(ArmorProfile {
                slashing: 1.0,
                piercing: 2.0,
                bludgeoning: 3.0,
                cold: 4.0,
                fire: 5.0,
                acid: 6.0,
                nether: 7.0,
                lightning: 8.0,
            }),
            json!({
                "kind": "armor",
                "data": {
                    "slashing": 1.0,
                    "piercing": 2.0,
                    "bludgeoning": 3.0,
                    "cold": 4.0,
                    "fire": 5.0,
                    "acid": 6.0,
                    "nether": 7.0,
                    "lightning": 8.0,
                }
            }),
        );

        assert_roundtrip(
            ScriptEntityProfile::Creature(CreatureProfile {
                flags: CreatureProfileFlags::SHOW_ATTRIBUTES
                    | CreatureProfileFlags::HAS_BUFFS_DEBUFFS,
                health: 10,
                health_max: 20,
                attributes: Some(CreatureAttributes {
                    strength: 1,
                    endurance: 2,
                    quickness: 3,
                    coordination: 4,
                    focus: 5,
                    self_attr: 6,
                    stamina: 7,
                    mana: 8,
                    stamina_max: 9,
                    mana_max: 10,
                }),
                buffs: Some(CreatureBuffs {
                    highlights: 11,
                    colors: 12,
                }),
            }),
            json!({
                "kind": "creature",
                "data": {
                    "flags": "HAS_BUFFS_DEBUFFS | SHOW_ATTRIBUTES",
                    "health": 10,
                    "healthMax": 20,
                    "attributes": {
                        "strength": 1,
                        "endurance": 2,
                        "quickness": 3,
                        "coordination": 4,
                        "focus": 5,
                        "selfAttr": 6,
                        "stamina": 7,
                        "mana": 8,
                        "staminaMax": 9,
                        "manaMax": 10,
                    },
                    "buffs": {
                        "highlights": 11,
                        "colors": 12,
                    }
                }
            }),
        );

        assert_roundtrip(
            ScriptEntityProfile::Weapon(WeaponProfile {
                damage_type: 13,
                weapon_time: 14,
                weapon_skill: 15,
                damage: 16,
                damage_variance: 0.5,
                damage_mod: 1.25,
                weapon_length: 2.5,
                max_velocity: 3.5,
                weapon_offense: 4.5,
                max_velocity_estimated: 17,
            }),
            json!({
                "kind": "weapon",
                "data": {
                    "damageType": 13,
                    "weaponTime": 14,
                    "weaponSkill": 15,
                    "damage": 16,
                    "damageVariance": 0.5,
                    "damageMod": 1.25,
                    "weaponLength": 2.5,
                    "maxVelocity": 3.5,
                    "weaponOffense": 4.5,
                    "maxVelocityEstimated": 17,
                }
            }),
        );
    }

    #[test]
    fn script_world_position_serializes_landblock_id_as_camel_case() {
        let position = super::ScriptWorldPosition::from(WorldPosition {
            landblock_id: holtburger_common::Guid(0x0100_0001),
            coords: Vector3::new(1.0, 2.0, 3.0),
            rotation: Quaternion::identity(),
        });

        let actual = to_value(position).unwrap();
        assert_eq!(
            actual,
            json!({
                "landblockId": 16777217,
                "coords": { "x": 1.0, "y": 2.0, "z": 3.0 },
                "rotation": { "w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0 },
            })
        );
        assert_eq!(
            from_value::<super::ScriptWorldPosition>(actual).unwrap(),
            position
        );
    }

    #[test]
    fn script_combat_feedback_serializes_fields_as_camel_case() {
        let feedback = ScriptCombatFeedback::AttackerNotification {
            defender_name: "Defender".to_owned(),
            damage_type: DamageType::FIRE,
            health_percent: 42.5,
            damage: 17,
            critical_hit: true,
            attack_conditions: AttackConditions::RECKLESSNESS,
        };

        let actual = to_value(&feedback).unwrap();
        assert_eq!(
            actual,
            json!({
                "kind": "attacker_notification",
                "data": {
                    "defenderName": "Defender",
                    "damageType": "FIRE",
                    "healthPercent": 42.5,
                    "damage": 17,
                    "criticalHit": true,
                    "attackConditions": "RECKLESSNESS",
                }
            })
        );
        assert_eq!(
            from_value::<ScriptCombatFeedback>(actual).unwrap(),
            feedback
        );
    }

    #[test]
    fn script_fetch_allowed_host_normalizes_ipv6_brackets() {
        let allowed_host = super::ScriptFetchAllowedHost::new("[::1]", 443);

        assert_eq!(allowed_host.host, "::1");
        assert!(allowed_host.matches("::1", 443));
        assert!(allowed_host.matches("[::1]", 443));
    }
}

use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    EquipMask, PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt,
    PropertyInt64, PropertyString,
};
use holtburger_common::stats::{AttributeType, SkillType, TrainingLevel, VitalType};
use holtburger_core::{ActiveCharacterConfirmation, BusyOperationKind};
use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use holtburger_protocol::messages::object::types::{ArmorProfile, CreatureProfile, WeaponProfile};
use serde::{Deserialize, Serialize};

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
    fn active_spells(&self) -> Vec<ScriptSpellEffectView>;
    fn server_time(&self) -> Option<f64>;
    fn pending_confirmation(&self) -> Option<ScriptConfirmation>;
    fn busy_operation(&self) -> ScriptBusyOperation;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptSelfView {
    pub guid: Guid,
    pub name: String,
    pub position: WorldPosition,
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
    Position(WorldPosition),
    Guid(Guid),
}

impl From<WorldPosition> for ScriptPositionRef {
    fn from(position: WorldPosition) -> Self {
        Self::Position(position)
    }
}

impl From<Guid> for ScriptPositionRef {
    fn from(guid: Guid) -> Self {
        Self::Guid(guid)
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
    pub position: WorldPosition,
    pub profile: Option<ScriptEntityProfile>,
    pub container: Guid,
    pub wielder: Guid,
    pub distance_to_self: f32,
    pub motion_command: ScriptMotionCommand,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptEntityProfile {
    Armor(ArmorProfile),
    Creature(CreatureProfile),
    Weapon(WeaponProfile),
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
#[serde(rename_all = "camelCase")]
pub struct ScriptSpellEffectView {
    pub spell_id: u32,
    pub name: Option<String>,
    pub remaining_seconds: Option<f64>,
    pub target_guid: Option<Guid>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptEvent {
    ChatMessage(ScriptChatEvent),
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptChatChannelKind {
    Say,
    Tell,
    Emote,
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
#[serde(tag = "kind", content = "data")]
pub enum ScriptLifecycleEvent {
    Started,
    Stopped,
    Tick { elapsed_seconds: f64 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptWorkflowEvent {
    ConfirmationOpened { confirmation: ScriptConfirmation },
    ConfirmationClosed,
    BusyOperationChanged { busy: ScriptBusyOperation },
    TargetEntityChanged { guid: Option<Guid> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
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
pub enum ScriptLocalConfirmationKind {
    Unswear,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptIntent {
    Log {
        level: ScriptLogLevel,
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
    Client(ScriptClientIntent),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptClientIntent {
    TargetEntity { guid: Guid },
    Approach { guid: Guid },
    Follow { guid: Guid },
    Attack { guid: Guid },
    CancelInteraction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScriptLogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

use crate::stats;
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    HasProperties, HasPropertiesMut, PropertyFloat, PropertyInt, PropertyInt64, PropertyString,
    PropertyUpdate, WorldObjectProperties, WorldObjectPropertyAccessors,
};
use holtburger_protocol::messages::EquipMask;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::magic::Enchantment;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct SkillBase {
    pub ranks: u32,
    pub init: u32,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct VitalBase {
    pub ranks: u32,
    pub start: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct LastSentStats {
    pub attributes: Vec<stats::Attribute>,
    pub vitals: Vec<stats::Vital>,
    pub skills: Vec<stats::Skill>,
    pub resistances: stats::Resistances,
    pub armor: i32,
    pub vitae: f32,
}

/// Session-local player model and derived player-facing state.
///
/// `PlayerState` owns player-specific data such as attributes, vitals, spells, inventory, and
/// protocol sequence tracking. It is intentionally **not** the protocol router anymore; feature
/// handlers under `crate::handlers` orchestrate message flows and call into focused mutation
/// methods on `PlayerState` and `WorldState`.
///
/// NOTE: physical player location/velocity is mirrored in `WorldState.entities`. Mutations that
/// affect the mirrored physical state should go through `WorldState` helper methods so the entity
/// graph and spatial index stay in sync.
#[derive(Debug, Clone)]
pub struct PlayerState {
    /// Unique identifier for the player's character.
    pub guid: Guid,
    /// Computed attribute values (Strength, Endurance, etc.) including buffs.
    pub attributes: HashMap<stats::AttributeType, stats::Attribute>,
    /// Computed vital values (Health, Stamina, Mana) including current/max/buffed states.
    pub vitals: HashMap<stats::VitalType, stats::Vital>,
    /// Stores the raw ranks and start for vitals so they can be recalculated during stat updates.
    pub vital_bases: HashMap<stats::VitalType, VitalBase>,
    /// Computed skill values (Melee Defense, War Magic, etc.) including training level and buffs.
    pub skills: HashMap<stats::SkillType, stats::Skill>,
    /// Stores the raw ranks and init for skills so they can be recalculated during stat updates.
    pub skill_bases: HashMap<stats::SkillType, SkillBase>,
    /// Current position in the world (Landcell + local coordinates).
    pub position: WorldPosition,
    /// Sequence for object instantiation/removal.
    pub instance_sequence: u16,
    /// Sequence for server-controlled movement/actions.
    pub server_control_sequence: u16,
    /// Sequence for teleportation events to ignore stale position updates.
    pub teleport_sequence: u16,
    /// Sequence for server-forced repositions (e.g. rubberbanding or physics corrections).
    pub force_position_sequence: u16,
    /// Sequence for client-initiated position updates.
    pub position_sequence: u16,
    /// Monotonically increasing sequence for autonomous movement steps.
    pub movement_sequence: u16,
    /// List of all active enchantments (buffs/debuffs) currently affecting the player.
    pub enchantments: Vec<Enchantment>,
    /// Master list of known spells (Knowledge). Maps SpellID -> Power/Modifier level.
    pub spells: BTreeMap<u32, f32>,
    /// Content of the 8 spellbook hotbars (Organization). Each inner vec corresponds to a UI hotbar.
    pub hotbar_spells: Vec<Vec<u32>>,
    /// All server-sent properties for the player.
    pub properties: WorldObjectProperties,

    /// Whether collision detection is disabled for movement.
    pub noclip: bool,

    /// Flat set of all item GUIDs currently owned by the player (in pack or containers).
    pub inventory: HashSet<Guid>,
    /// Items currently equipped, mapped by their primary slot mask.
    pub equipment: HashMap<Guid, EquipMask>,

    /// Dirty tracking for events to minimize redundant UI updates.
    pub(crate) last_sent_stats: Option<LastSentStats>,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            guid: Guid::NULL,
            attributes: HashMap::new(),
            vitals: HashMap::new(),
            vital_bases: HashMap::new(),
            skills: HashMap::new(),
            skill_bases: HashMap::new(),
            position: WorldPosition::default(),
            instance_sequence: 0,
            server_control_sequence: 0,
            teleport_sequence: 0,
            force_position_sequence: 0,
            position_sequence: 0,
            movement_sequence: 0,
            enchantments: Vec::new(),
            spells: BTreeMap::new(),
            hotbar_spells: vec![Vec::new(); 8],
            properties: WorldObjectProperties::default(),
            noclip: false,
            inventory: HashSet::new(),
            equipment: HashMap::new(),
            last_sent_stats: None,
        }
    }

    pub fn level(&self) -> u32 {
        self.get_int_prop_default(PropertyInt::Level) as u32
    }

    pub fn total_experience(&self) -> u64 {
        self.get_int64_prop(PropertyInt64::TotalExperience)
            .unwrap_or(0) as u64
    }

    pub fn available_experience(&self) -> u64 {
        self.get_int64_prop(PropertyInt64::AvailableExperience)
            .unwrap_or(0) as u64
    }

    pub fn unspent_skill_points(&self) -> u32 {
        self.get_int_prop_default(PropertyInt::AvailableSkillCredits) as u32
    }

    pub fn available_luminance(&self) -> u64 {
        self.get_int64_prop(PropertyInt64::AvailableLuminance)
            .unwrap_or(0) as u64
    }

    pub fn combat_mode(&self) -> CombatMode {
        let val = self.get_int_prop_default(PropertyInt::CombatMode);
        CombatMode::from_repr(val as u32).unwrap_or(CombatMode::NonCombat)
    }

    pub fn name(&self) -> &str {
        self.get_string_prop(PropertyString::Name)
            .unwrap_or("Unknown")
    }

    pub fn armor(&self) -> i32 {
        let base_armor = self.get_int_prop_default(PropertyInt::ArmorLevel);
        i32::max(
            -400,
            crate::magic::get_enchanted_armor(base_armor, &self.enchantments),
        )
    }

    pub fn vitae(&self) -> f32 {
        crate::magic::get_total_vitae(&self.enchantments)
    }

    pub fn resistances(&self) -> stats::Resistances {
        let get_r = |prop: PropertyFloat| {
            let base = self.get_float_prop(prop).unwrap_or(1.0);
            crate::magic::get_enchanted_resistance(base as f32, &self.enchantments, prop as u32)
        };
        stats::Resistances {
            slash: get_r(PropertyFloat::ResistSlash),
            pierce: get_r(PropertyFloat::ResistPierce),
            bludgeon: get_r(PropertyFloat::ResistBludgeon),
            fire: get_r(PropertyFloat::ResistFire),
            cold: get_r(PropertyFloat::ResistCold),
            acid: get_r(PropertyFloat::ResistAcid),
            electric: get_r(PropertyFloat::ResistElectric),
            nether: get_r(PropertyFloat::ResistNether),
        }
    }
}

impl HasProperties for PlayerState {
    fn properties(&self) -> &WorldObjectProperties {
        &self.properties
    }
}

impl HasPropertiesMut for PlayerState {
    fn properties_mut(&mut self) -> &mut WorldObjectProperties {
        &mut self.properties
    }
}

impl PlayerState {
    pub fn get_int_prop_default(&self, prop: PropertyInt) -> i32 {
        self.get_int_prop(prop).unwrap_or(0)
    }

    pub fn set_property(&mut self, update: PropertyUpdate) {
        self.properties.apply(update);
    }

    /// Adds an item to the player's inventory tracking.
    pub fn add_to_inventory(&mut self, item: Guid) {
        self.inventory.insert(item);
    }

    /// Removes an item from the player's inventory tracking and equipment.
    pub fn remove_from_inventory(&mut self, item: Guid) {
        self.inventory.remove(&item);
        self.equipment.remove(&item);
    }

    /// Marks an item as equipped.
    pub fn wield_item(&mut self, item: Guid, slot: EquipMask) {
        self.inventory.insert(item);
        self.equipment.insert(item, slot);
    }

    /// Marks an item as unequipped.
    pub fn unwield_item(&mut self, item: Guid) {
        self.equipment.remove(&item);
    }

    pub fn get_attributes(&self) -> Vec<stats::Attribute> {
        let mut attr_objs: Vec<_> = self.attributes.values().cloned().collect();
        attr_objs.sort_by_key(|a| a.attr_type as u32);
        attr_objs
    }

    pub fn get_vitals(&self) -> Vec<stats::Vital> {
        let mut vitals: Vec<_> = self.vitals.values().cloned().collect();
        vitals.sort_by_key(|v| v.vital_type as u32);
        vitals
    }

    pub fn get_skills(&self) -> Vec<stats::Skill> {
        let mut skills: Vec<_> = self.skills.values().cloned().collect();
        skills.sort_by_key(|s| s.skill_type as u32);
        skills
    }
}

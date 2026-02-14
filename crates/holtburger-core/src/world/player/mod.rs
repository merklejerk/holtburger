use std::collections::{BTreeMap, HashMap, HashSet};

use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_protocol::messages::EquipMask;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::magic::Enchantment;

use super::stats;

pub mod magic;
pub mod messages;
pub mod movement;
pub mod stats_calc;
pub mod types;

pub(crate) use types::LastSentStats;
pub use types::{SkillBase, VitalBase};

/// The localized state of the current player.
///
/// NOTE: This data is mirrored in the `WorldState.entities` map.
/// Authorities should update player state via `WorldState` mutation methods
/// to maintain the mirror invariant.
#[derive(Debug, Clone)]
pub struct PlayerState {
    /// Unique identifier for the player's character.
    pub guid: Guid,
    /// The character's display name.
    pub name: String,
    /// Current character level.
    pub level: u32,
    /// Total experience points earned over the character's lifetime.
    pub total_experience: u64,
    /// Experience points currently available for spending on attributes/skills/vitals.
    pub available_experience: u64,
    /// Current pool of unspent skill points.
    pub unspent_skill_points: u32,
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
    /// Elemental and physical damage resistances computed from properties and enchantments.
    pub resistances: stats::Resistances,
    /// Total armor level (AL) computed from equipped items and buffs.
    pub armor: i32,
    /// Current "Vitae" penalty/bonus multiplier (0.0 to 1.0+).
    pub vitae: f32,
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
    /// Sparse mapping of integer properties (from `PropertyInt`).
    pub int_properties: BTreeMap<u32, i32>,
    /// Sparse mapping of 64-bit integer properties (from `PropertyInt64`).
    pub int64_properties: BTreeMap<u32, i64>,
    /// Sparse mapping of boolean properties (from `PropertyBool`).
    pub bool_properties: BTreeMap<u32, bool>,
    /// Sparse mapping of floating point properties (from `PropertyFloat`).
    pub float_properties: BTreeMap<u32, f64>,
    /// Sparse mapping of string properties (from `PropertyString`).
    pub string_properties: BTreeMap<u32, String>,
    /// Sparse mapping of Data ID properties (from `PropertyDataId`).
    pub did_properties: BTreeMap<u32, Guid>,
    /// Sparse mapping of Instance ID properties (from `PropertyInstanceId`).
    pub iid_properties: BTreeMap<u32, Guid>,
    /// Current stance (Peace, Melee, Missile, Magic).
    pub combat_mode: CombatMode,

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
            name: "Unknown".to_string(),
            level: 0,
            total_experience: 0,
            available_experience: 0,
            unspent_skill_points: 0,
            attributes: HashMap::new(),
            vitals: HashMap::new(),
            vital_bases: HashMap::new(),
            skills: HashMap::new(),
            skill_bases: HashMap::new(),
            resistances: stats::Resistances::default(),
            armor: 0,
            vitae: 1.0,
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
            int_properties: BTreeMap::new(),
            int64_properties: BTreeMap::new(),
            bool_properties: BTreeMap::new(),
            float_properties: BTreeMap::new(),
            string_properties: BTreeMap::new(),
            did_properties: BTreeMap::new(),
            iid_properties: BTreeMap::new(),
            combat_mode: CombatMode::NonCombat,
            noclip: false,
            inventory: HashSet::new(),
            equipment: HashMap::new(),
            last_sent_stats: None,
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::properties::{EnchantmentTypeFlags, PropertyInt};

    fn set_attr(player: &mut PlayerState, attr: stats::AttributeType, val: u32) {
        player.attributes.insert(
            attr,
            stats::Attribute {
                attr_type: attr,
                ranks: 0,
                start: val,
                spent_xp: 0,
                next_rank_xp: None,
                base: val,
                current: val,
            },
        );
    }

    #[test]
    fn test_stat_calculations() {
        let mut player = PlayerState::new();

        // Setup attributes
        set_attr(&mut player, stats::AttributeType::StrengthAttr, 100);
        set_attr(&mut player, stats::AttributeType::EnduranceAttr, 100);
        set_attr(&mut player, stats::AttributeType::QuicknessAttr, 100);
        set_attr(&mut player, stats::AttributeType::CoordinationAttr, 100);
        set_attr(&mut player, stats::AttributeType::FocusAttr, 100);
        set_attr(&mut player, stats::AttributeType::SelfAttr, 100);

        // Test Vital Bonuses
        assert_eq!(
            player.calculate_vital_attribute_contribution(stats::VitalType::Health, false),
            50
        );
        assert_eq!(
            player.calculate_vital_attribute_contribution(stats::VitalType::Stamina, false),
            100
        );
        assert_eq!(
            player.calculate_vital_attribute_contribution(stats::VitalType::Mana, false),
            100
        );

        // Test Vital Base Calculation
        player.vital_bases.insert(
            stats::VitalType::Health,
            VitalBase {
                ranks: 50,
                start: 0,
            },
        );
        assert_eq!(player.calculate_vital_base(stats::VitalType::Health), 100);

        // Test Skill Math
        assert_eq!(
            player.derive_skill_value(stats::SkillType::MeleeDefense, 10, 4, false),
            81
        );
        assert_eq!(
            player.derive_skill_value(stats::SkillType::Run, 5, 0, false),
            105
        );
    }

    #[test]
    fn test_stat_floors() {
        let mut player = PlayerState::new();

        // 1. Attribute floor check
        // Base 100, debuff by 200 -> should floor at 10 (since base >= 10)
        set_attr(&mut player, stats::AttributeType::StrengthAttr, 100);
        player.enchantments.push(Enchantment {
            spell_id: 1,
            layer: 1,
            spell_category: 1,
            has_spell_set_id: 0,
            power_level: 1,
            start_time: 0.0,
            duration: 1000.0,
            caster_guid: Guid(50000001),
            degrade_modifier: 0.0,
            degrade_limit: -666.0,
            last_time_degraded: 0.0,
            stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::AttributeType::StrengthAttr as u32,
            stat_mod_value: -200.0,
            spell_set_id: None,
        });
        assert_eq!(
            player.get_attribute_current(stats::AttributeType::StrengthAttr),
            10
        );

        // Attribute base 5, debuff by 10 -> should floor at 1
        set_attr(&mut player, stats::AttributeType::EnduranceAttr, 5);
        player.enchantments.push(Enchantment {
            spell_id: 2,
            layer: 1,
            spell_category: 2,
            has_spell_set_id: 0,
            power_level: 1,
            start_time: 0.0,
            duration: 1000.0,
            caster_guid: Guid(50000001),
            degrade_modifier: 0.0,
            degrade_limit: -666.0,
            last_time_degraded: 0.0,
            stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::AttributeType::EnduranceAttr as u32,
            stat_mod_value: -100.0,
            spell_set_id: None,
        });
        assert_eq!(
            player.get_attribute_current(stats::AttributeType::EnduranceAttr),
            1
        );

        // 2. Vital floor check
        // Base 100, debuff by 200 -> should floor at 5
        player.vital_bases.insert(
            stats::VitalType::Health,
            VitalBase {
                ranks: 0,
                start: 100,
            },
        );
        // Attribute contribution for health is Str/2. Str is 10 (buffed)
        // Total base = 100 (base) + 5 (attr bonus) = 105.
        // Debuff by 200.
        player.enchantments.push(Enchantment {
            spell_id: 3,
            layer: 1,
            spell_category: 3,
            has_spell_set_id: 0,
            power_level: 1,
            start_time: 0.0,
            duration: 1000.0,
            caster_guid: Guid(50000001),
            degrade_modifier: 0.0,
            degrade_limit: -666.0,
            last_time_degraded: 0.0,
            stat_mod_type: (EnchantmentTypeFlags::SECOND_ATT | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::VitalType::Health as u32,
            stat_mod_value: -200.0,
            spell_set_id: None,
        });
        assert_eq!(player.calculate_vital_current(stats::VitalType::Health), 5);

        // 3. Skill floor check (0)
        player.skill_bases.insert(
            stats::SkillType::MeleeDefense,
            SkillBase {
                ranks: 100,
                init: 0,
            },
        );
        // Skill formula for MeleeDefense is (Quick + Coord) / 3.
        // Str is 10, End is 1. (These are unrelated but Quick/Coord are default 0 if not set)
        set_attr(&mut player, stats::AttributeType::QuicknessAttr, 10);
        set_attr(&mut player, stats::AttributeType::CoordinationAttr, 10);
        // (10+10)/3 = 7. Total base = 7 + 100 = 107.
        player.enchantments.push(Enchantment {
            spell_id: 4,
            layer: 1,
            spell_category: 4,
            has_spell_set_id: 0,
            power_level: 1,
            start_time: 0.0,
            duration: 1000.0,
            caster_guid: Guid(50000001),
            degrade_modifier: 0.0,
            degrade_limit: -666.0,
            last_time_degraded: 0.0,
            stat_mod_type: (EnchantmentTypeFlags::SKILL | EnchantmentTypeFlags::ADDITIVE).bits(),
            stat_mod_key: stats::SkillType::MeleeDefense as u32,
            stat_mod_value: -200.0,
            spell_set_id: None,
        });
        assert_eq!(
            player.derive_skill_value(stats::SkillType::MeleeDefense, 100, 0, true),
            0
        );

        // 4. Armor level check (can stay negative for Armor Self / Imperil logic)
        player
            .int_properties
            .insert(PropertyInt::ArmorLevel as u32, 10);
        player.enchantments.push(Enchantment {
            spell_id: 5,
            layer: 1,
            spell_category: 5,
            has_spell_set_id: 0,
            power_level: 1,
            start_time: 0.0,
            duration: 1000.0,
            caster_guid: Guid(50000001),
            degrade_modifier: 0.0,
            degrade_limit: -666.0,
            last_time_degraded: 0.0,
            stat_mod_type: (EnchantmentTypeFlags::BODY_ARMOR_VALUE
                | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: 0,
            stat_mod_value: -20.0,
            spell_set_id: None,
        });
        player.emit_derived_stats(&mut Vec::new());
        // 10 - 20 = -10.
        assert_eq!(player.armor, -10);
    }

    #[test]
    fn test_buff_calculations() {
        use holtburger_common::properties::EnchantmentTypeFlags;

        let mut player = PlayerState::new();
        set_attr(&mut player, stats::AttributeType::StrengthAttr, 100);
        set_attr(&mut player, stats::AttributeType::CoordinationAttr, 100);

        // Add a Strength Buff (+20 additive)
        player.enchantments.push(Enchantment {
            spell_category: 1, // strength group
            power_level: 100,
            stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::AttributeType::StrengthAttr as u32,
            stat_mod_value: 20.0,
            ..Default::default()
        });

        // Add a Skill Multiplier (1.10x)
        player.enchantments.push(Enchantment {
            spell_category: 2, // axe group
            power_level: 100,
            stat_mod_type: (EnchantmentTypeFlags::SKILL | EnchantmentTypeFlags::MULTIPLICATIVE)
                .bits(),
            stat_mod_key: stats::SkillType::Axe as u32,
            stat_mod_value: 1.10,
            ..Default::default()
        });

        // Strength should be 120
        assert_eq!(
            player.get_attribute_current(stats::AttributeType::StrengthAttr),
            120
        );

        // Heavy Weapons skill: (Str + Coord) / 3 + Ranks + Init
        // (120 + 100) / 3 = 73.33 -> 73
        // Base was (100 + 100) / 3 = 66.66 -> 67
        player.skill_bases.insert(
            stats::SkillType::HeavyWeapons,
            SkillBase { ranks: 10, init: 0 },
        );

        let val = player.derive_skill_value(stats::SkillType::HeavyWeapons, 10, 0, true);
        assert_eq!(val, 73 + 10); // 83

        // Test Stacking: Add a weaker Strength buff
        player.enchantments.push(Enchantment {
            spell_category: 1, // same strength group
            power_level: 50,   // Lower power
            stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::AttributeType::StrengthAttr as u32,
            stat_mod_value: 10.0,
            ..Default::default()
        });

        // Should still be 120
        assert_eq!(
            player.get_attribute_current(stats::AttributeType::StrengthAttr),
            120
        );

        // Add a STRONGER Strength buff
        player.enchantments.push(Enchantment {
            spell_category: 1, // same group
            power_level: 200,  // Higher power
            stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::AttributeType::StrengthAttr as u32,
            stat_mod_value: 30.0,
            ..Default::default()
        });

        // Should now be 130
        assert_eq!(
            player.get_attribute_current(stats::AttributeType::StrengthAttr),
            130
        );
    }

    #[test]
    fn test_health_rounding() {
        use holtburger_common::properties::EnchantmentTypeFlags;

        let mut player = PlayerState::new();
        // Endurance 101 / 2 = 50.5 -> should be 51
        set_attr(&mut player, stats::AttributeType::EnduranceAttr, 101);
        player.vital_bases.insert(
            stats::VitalType::Health,
            VitalBase {
                ranks: 0,
                start: 100,
            },
        );

        let health_base = player.calculate_vital_base(stats::VitalType::Health);
        assert_eq!(
            health_base, 151,
            "Base Health contribution from 101 Endurance should be 51 (rounded)"
        );

        // Add an Endurance buff of +10 (Total 111)
        player.enchantments.push(Enchantment {
            spell_category: 3, // endurance group
            stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::AttributeType::EnduranceAttr as u32,
            stat_mod_value: 10.0,
            power_level: 100,
            ..Default::default()
        });

        // Current Endurance should be 111. 111 / 2 = 55.5 -> 56.
        // Total health should be 100 (start) + 56 (bonus) = 156.
        let health_current = player.calculate_vital_current(stats::VitalType::Health);
        assert_eq!(
            health_current, 156,
            "Current Health with 111 Endurance should be 156 (111/2=55.5 rounded to 56)"
        );
    }

    #[test]
    fn test_vector_update_routing() {
        use crate::world::WorldEvent;
        use holtburger_common::Vector3;
        use holtburger_protocol::messages::GameMessage;
        use holtburger_protocol::messages::VectorUpdateData;

        let mut player = PlayerState::new();
        player.guid = Guid(0x50000001);

        let data = VectorUpdateData {
            guid: Guid(0x50000001),
            velocity: Vector3::new(1.0, 2.0, 3.0),
            omega: Vector3::new(0.1, 0.2, 0.3),
            instance_sequence: 123,
            vector_sequence: 456,
        };

        let msg = GameMessage::VectorUpdate(Box::new(data));
        let mut events = Vec::new();
        let handled = player.handle_message(&msg, &mut events, None);

        assert!(handled);
        assert_eq!(events.len(), 1);
        if let WorldEvent::EntityVectorUpdated {
            guid,
            velocity,
            omega,
        } = &events[0]
        {
            assert_eq!(*guid, Guid(0x50000001));
            assert_eq!(velocity.x, 1.0);
            assert_eq!(omega.x, 0.1);
        } else {
            panic!("Expected EntityVectorUpdated event");
        }
    }

    #[test]
    fn test_heal_command_updates() {
        use holtburger_protocol::messages::{
            GameMessage, PrivateUpdateVitalCurrentData, PrivateUpdateVitalData,
        };

        let mut player = PlayerState::new();
        player.guid = Guid(0x50000001);

        // 1. Initial login: PrivateUpdateVital for Health (ID 1), Stamina (ID 3), Mana (ID 5)
        let vitals_to_init = [(1, "Health"), (3, "Stamina"), (5, "Mana")];
        for (id, _name) in vitals_to_init {
            let msg = GameMessage::PrivateUpdateVital(Box::new(PrivateUpdateVitalData {
                sequence: 1,
                object_guid: None,
                vital: id,
                ranks: 0,
                start: 100,
                xp: 0,
                current: 50,
            }));
            player.handle_message(&msg, &mut Vec::new(), None);
        }

        // Verify they are in the map
        assert!(player.vitals.contains_key(&stats::VitalType::Health));
        assert!(player.vitals.contains_key(&stats::VitalType::Stamina));
        assert!(player.vitals.contains_key(&stats::VitalType::Mana));

        // 2. Simulate @heal: PrivateUpdateVitalCurrent for Health (ID 2), Stamina (ID 4), Mana (ID 6)
        let heal_updates = [(2, 100), (4, 100), (6, 100)];
        for (id, val) in heal_updates {
            let msg =
                GameMessage::PrivateUpdateVitalCurrent(Box::new(PrivateUpdateVitalCurrentData {
                    sequence: 2,
                    object_guid: None,
                    vital: id,
                    current: val,
                }));
            let mut events = Vec::new();
            let handled = player.handle_message(&msg, &mut events, None);
            assert!(handled, "Failed to handle vital update for ID {}", id);
            assert_eq!(events.len(), 1);
        }

        // 3. Verify final state
        assert_eq!(
            player
                .vitals
                .get(&stats::VitalType::Health)
                .unwrap()
                .current,
            100
        );
        assert_eq!(
            player
                .vitals
                .get(&stats::VitalType::Stamina)
                .unwrap()
                .current,
            100
        );
        assert_eq!(
            player.vitals.get(&stats::VitalType::Mana).unwrap().current,
            100
        );
    }
}

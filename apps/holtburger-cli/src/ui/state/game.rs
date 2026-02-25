use std::collections::{HashMap, HashSet};
use std::time::Instant;

use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_core::world::context::WorldContext;
use holtburger_core::world::entity::Entity;
use holtburger_core::world::stats::{
    Attribute, AttributeType, CharacterLevelInfo, Skill, SkillType, Vital, VitalType,
};
use holtburger_protocol::messages::EquipMask;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::magic::Enchantment;

#[derive(Debug, Clone)]
pub struct GameData {
    /// Current character name once selected.
    pub character_name: Option<String>,
    /// Unique ID of the player character.
    pub player_guid: Option<Guid>,
    /// Info about level, luminance, and XP.
    pub level_info: Option<CharacterLevelInfo>,
    /// Base and current values for Strength, Endurance, etc.
    pub attributes: HashMap<AttributeType, Attribute>,
    /// Health, Stamina, and Mana values.
    pub vitals: HashMap<VitalType, Vital>,
    /// Skills like Sword, Mace, Magic Defense.
    pub skills: HashMap<SkillType, Skill>,
    /// Calculated damage resistance values.
    pub resistances: holtburger_core::world::stats::Resistances,
    /// Total armor value.
    pub armor: i32,
    /// Current vitae penalty (0.0 to 1.0, where 1.0 is no penalty).
    pub vitae: f32,
    /// Current position in the world.
    pub player_pos: Option<WorldPosition>,
    /// Active enchantments on the player.
    pub player_enchantments: Vec<Enchantment>,
    /// List of learned spell IDs.
    pub player_spells: Vec<u32>,
    /// User-friendly names for spells.
    pub spell_names: HashMap<u32, String>,
    /// Details about spell effects.
    pub spell_info: HashMap<u32, Box<holtburger_dat::file_type::spell_table::SpellBase>>,
    /// Master skill system table.
    pub skill_table: Option<std::sync::Arc<holtburger_dat::file_type::skill_table::SkillTable>>,
    /// Local cache of nearby entities.
    pub entities: HashMap<Guid, Entity>,
    /// Current estimated server time and when it was last synced.
    pub server_time: Option<(f64, Instant)>,
    /// Server name (e.g. "Morningthaw").
    pub world_name: String,
    /// Current combat stances.
    pub combat_mode: CombatMode,
    /// Whether we can walk through walls (debug feature).
    pub noclip: bool,
    /// Every entity currently in player's pack.
    pub inventory: HashSet<Guid>,
    /// Map of GUIDs currently equipped on the character.
    pub equipment: HashMap<Guid, EquipMask>,
    /// Current vendor state (inventory and multipliers).
    pub vendor: Option<holtburger_core::world::state::VendorState>,
    /// Current active trade with another player.
    pub trade: Option<holtburger_core::world::state::TradeState>,
}

impl Default for GameData {
    fn default() -> Self {
        Self {
            character_name: None,
            player_guid: None,
            level_info: None,
            attributes: HashMap::new(),
            vitals: HashMap::new(),
            skills: HashMap::new(),
            resistances: holtburger_core::world::stats::Resistances::default(),
            armor: 0,
            vitae: 1.0,
            player_pos: None,
            player_enchantments: Vec::new(),
            player_spells: Vec::new(),
            spell_names: HashMap::new(),
            spell_info: HashMap::new(),
            skill_table: None,
            entities: HashMap::new(),
            server_time: None,
            world_name: "Dereth".to_string(), // Default
            combat_mode: CombatMode::NonCombat,
            noclip: false,
            inventory: HashSet::new(),
            equipment: HashMap::new(),
            vendor: None,
            trade: None,
        }
    }
}

impl GameData {
    pub fn new(guid: Guid, name: String, world_name: String) -> Self {
        Self {
            character_name: Some(name),
            player_guid: Some(guid),
            world_name,
            ..Self::default()
        }
    }

    pub fn update_inventory_recursive(&mut self, root: Guid, owned: bool) {
        let mut stack = vec![root];
        while let Some(current) = stack.pop() {
            if owned {
                self.inventory.insert(current);
            } else {
                self.inventory.remove(&current);
                self.equipment.remove(&current);
            }

            let mut children = Vec::new();
            for (&guid, entity) in &self.entities {
                if entity.container_id() == Some(current) {
                    children.push(guid);
                }
            }
            stack.extend(children);
        }
    }

    pub fn current_server_time(&self) -> f64 {
        match self.server_time {
            Some((server_val, local_then)) => {
                let elapsed = local_then.elapsed().as_secs_f64();
                server_val + elapsed
            }
            None => std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64(),
        }
    }
}

impl WorldContext for GameData {
    fn get_player_guid(&self) -> Option<Guid> {
        self.player_guid
    }

    fn get_entity(&self, guid: Guid) -> Option<&Entity> {
        self.entities.get(&guid)
    }

    fn iter_inventory(&self) -> impl Iterator<Item = Guid> + '_ {
        self.inventory.iter().copied()
    }

    fn iter_equipment(&self) -> impl Iterator<Item = Guid> + '_ {
        self.equipment.keys().copied()
    }

    fn iter_entities(&self) -> impl Iterator<Item = &Entity> + '_ {
        self.entities.values()
    }

    fn get_vendor(&self) -> Option<&holtburger_core::world::state::VendorState> {
        self.vendor.as_ref()
    }
}

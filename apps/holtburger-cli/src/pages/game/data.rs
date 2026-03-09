use std::collections::{HashMap, HashSet};

use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    PropertyInt, WorldObjectExt as _, WorldObjectPropertyAccessors,
};
use holtburger_protocol::messages::EquipMask;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_world::context::WorldContext;
use holtburger_world::entity::Entity;
use holtburger_world::spell::SpellCatalog;
use holtburger_world::stats::{
    Attribute, AttributeType, CharacterLevelInfo, Resistances, Skill, SkillType, Vital, VitalType,
};
use std::sync::Arc;

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
    pub resistances: Resistances,
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
    /// Full spell catalog loaded from portal.dat.
    pub spell_catalog: Option<Arc<SpellCatalog>>,
    /// Local cache of nearby entities.
    pub entities: HashMap<Guid, Entity>,
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
    /// Current active trade with another player.
    pub trade: Option<holtburger_world::state::TradeState>,
    /// Currently open containers in the world.
    pub open_containers: HashSet<Guid>,
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
            resistances: Resistances::default(),
            armor: 0,
            vitae: 1.0,
            player_pos: None,
            player_enchantments: Vec::new(),
            player_spells: Vec::new(),
            spell_catalog: None,
            entities: HashMap::new(),
            world_name: "Dereth".to_string(), // Default
            combat_mode: CombatMode::NonCombat,
            noclip: false,
            inventory: HashSet::new(),
            equipment: HashMap::new(),
            trade: None,
            open_containers: HashSet::new(),
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

    pub fn get_container_counts(&self) -> HashMap<Guid, u32> {
        let mut counts = HashMap::new();
        for entity in self.entities.values() {
            if let Some(container_id) = entity.container_id() {
                *counts.entry(container_id).or_insert(0) += 1;
            }
        }
        counts
    }

    pub fn get_burden(&self) -> Option<f32> {
        let player_guid = self.player_guid?;
        let player_entity = self.entities.get(&player_guid)?;

        // Sum up the burden of all items in player's possession.
        // In the CLI, `inventory` tracking includes:
        // 1. Items directly in the player's main pack (ContainerId == player_guid)
        // 2. Items in sub-packs (ContainerId == subpack_guid, recursively tracked)
        // 3. Items currently wielded/equipped (WielderId == player_guid)
        let mut encumbrance = 0.0;
        for guid in self.inventory.iter() {
            if let Some(item) = self.entities.get(guid) {
                encumbrance += item.get_int_prop(PropertyInt::EncumbranceVal).unwrap_or(0) as f32;
            }
        }

        let strength = self
            .attributes
            .get(&AttributeType::StrengthAttr)
            .map(|a| a.current)
            .unwrap_or(0) as f32;

        if strength <= 0.0 {
            return Some(3.0);
        }

        let num_augs = player_entity
            .get_int_prop(PropertyInt::AugmentationIncreasedCarryingCapacity)
            .unwrap_or(0)
            .max(0) as f32;

        let mut bonus_burden = 30.0 * num_augs;
        if bonus_burden > 150.0 {
            bonus_burden = 150.0;
        }

        let capacity = 150.0 * strength + strength * bonus_burden;

        if capacity <= 0.0 {
            return Some(3.0);
        }

        Some(encumbrance / capacity)
    }

    pub fn spell_name(&self, spell_id: u32) -> Option<&str> {
        self.spell_catalog
            .as_ref()
            .and_then(|catalog| catalog.resolve_name(spell_id))
    }

    pub fn spell_name_or_fallback(&self, spell_id: u32) -> String {
        self.spell_name(spell_id)
            .map(str::to_string)
            .unwrap_or_else(|| format!("Spell #{}", spell_id))
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

    fn is_open_container(&self, guid: Guid) -> bool {
        self.open_containers.contains(&guid)
    }
}

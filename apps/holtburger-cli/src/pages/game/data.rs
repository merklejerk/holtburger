use crate::pages::game::combat::CombatRuntimeState;
use std::collections::{HashMap, HashSet, VecDeque};

use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    PropertyInt, WorldObjectExt as _, WorldObjectPropertyAccessors,
};
use holtburger_common::{CharacterOption, CharacterOptions1, CharacterOptions2, Guid};
use holtburger_core::PlayerCharacterOptions;
use holtburger_protocol::messages::EquipMask;
use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_world::context::WorldContext;
use holtburger_world::entity::Entity;
use holtburger_world::spell::SpellCatalog;
use holtburger_world::stats::{
    Attribute, AttributeType, CharacterLevelInfo, Resistances, Skill, SkillType, Vital, VitalType,
};
use std::sync::Arc;

const OPENED_CONTAINER_HISTORY_LIMIT: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CuratedCharacterOption {
    CraftSuccessDialog,
    AutoAcceptFellowshipRequests,
    IgnoreFellowshipRequests,
    IgnoreTradeRequests,
    AllowItemGive,
    AllegianceChat,
    GeneralChat,
    TradeChat,
    LfgChat,
    RoleplayChat,
    SocietyChat,
}

impl CuratedCharacterOption {
    pub const ALL: [Self; 11] = [
        Self::CraftSuccessDialog,
        Self::AutoAcceptFellowshipRequests,
        Self::IgnoreFellowshipRequests,
        Self::IgnoreTradeRequests,
        Self::AllowItemGive,
        Self::AllegianceChat,
        Self::GeneralChat,
        Self::TradeChat,
        Self::LfgChat,
        Self::RoleplayChat,
        Self::SocietyChat,
    ];

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "craft-success-dialog" | "craft-success" => Some(Self::CraftSuccessDialog),
            "auto-accept-fellowship" | "auto-fellowship" => {
                Some(Self::AutoAcceptFellowshipRequests)
            }
            "ignore-fellowship" | "ignore-fellowship-requests" => {
                Some(Self::IgnoreFellowshipRequests)
            }
            "ignore-trade" | "ignore-trade-requests" => Some(Self::IgnoreTradeRequests),
            "allow-item-give" | "allow-give" => Some(Self::AllowItemGive),
            "allegiance-chat" => Some(Self::AllegianceChat),
            "general-chat" => Some(Self::GeneralChat),
            "trade-chat" => Some(Self::TradeChat),
            "lfg-chat" => Some(Self::LfgChat),
            "roleplay-chat" => Some(Self::RoleplayChat),
            "society-chat" => Some(Self::SocietyChat),
            _ => None,
        }
    }

    pub fn canonical_name(self) -> &'static str {
        match self {
            Self::CraftSuccessDialog => "craft-success-dialog",
            Self::AutoAcceptFellowshipRequests => "auto-accept-fellowship",
            Self::IgnoreFellowshipRequests => "ignore-fellowship",
            Self::IgnoreTradeRequests => "ignore-trade",
            Self::AllowItemGive => "allow-item-give",
            Self::AllegianceChat => "allegiance-chat",
            Self::GeneralChat => "general-chat",
            Self::TradeChat => "trade-chat",
            Self::LfgChat => "lfg-chat",
            Self::RoleplayChat => "roleplay-chat",
            Self::SocietyChat => "society-chat",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::CraftSuccessDialog => "Show crafting success chance confirmations",
            Self::AutoAcceptFellowshipRequests => "Automatically accept fellowship requests",
            Self::IgnoreFellowshipRequests => "Ignore incoming fellowship requests",
            Self::IgnoreTradeRequests => "Ignore incoming trade requests",
            Self::AllowItemGive => "Let other players hand you items",
            Self::AllegianceChat => "Listen to allegiance chat",
            Self::GeneralChat => "Listen to general chat",
            Self::TradeChat => "Listen to trade chat",
            Self::LfgChat => "Listen to LFG chat",
            Self::RoleplayChat => "Listen to roleplay chat",
            Self::SocietyChat => "Listen to society chat",
        }
    }

    pub fn character_option(self) -> CharacterOption {
        match self {
            Self::CraftSuccessDialog => CharacterOption::UseCraftingChanceOfSuccessDialog,
            Self::AutoAcceptFellowshipRequests => {
                CharacterOption::AutomaticallyAcceptFellowshipRequests
            }
            Self::IgnoreFellowshipRequests => CharacterOption::IgnoreFellowshipRequests,
            Self::IgnoreTradeRequests => CharacterOption::IgnoreAllTradeRequests,
            Self::AllowItemGive => CharacterOption::LetOtherPlayersGiveYouItems,
            Self::AllegianceChat => CharacterOption::ListenToAllegianceChat,
            Self::GeneralChat => CharacterOption::ListenToGeneralChat,
            Self::TradeChat => CharacterOption::ListenToTradeChat,
            Self::LfgChat => CharacterOption::ListenToLFGChat,
            Self::RoleplayChat => CharacterOption::ListenToRoleplayChat,
            Self::SocietyChat => CharacterOption::ListenToSocietyChat,
        }
    }

    pub fn is_enabled(self, options: PlayerCharacterOptions) -> bool {
        match self {
            Self::CraftSuccessDialog => options
                .options1
                .contains(CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG),
            Self::AutoAcceptFellowshipRequests => options
                .options1
                .contains(CharacterOptions1::AUTO_ACCEPT_FELLOW_REQUEST),
            Self::IgnoreFellowshipRequests => options
                .options1
                .contains(CharacterOptions1::IGNORE_FELLOWSHIP_REQUESTS),
            Self::IgnoreTradeRequests => options
                .options1
                .contains(CharacterOptions1::IGNORE_TRADE_REQUESTS),
            Self::AllowItemGive => options.options1.contains(CharacterOptions1::ALLOW_GIVE),
            Self::AllegianceChat => options
                .options1
                .contains(CharacterOptions1::HEAR_ALLEGIANCE_CHAT),
            Self::GeneralChat => options
                .options2
                .contains(CharacterOptions2::HEAR_GENERAL_CHAT),
            Self::TradeChat => options
                .options2
                .contains(CharacterOptions2::HEAR_TRADE_CHAT),
            Self::LfgChat => options.options2.contains(CharacterOptions2::HEAR_LFG_CHAT),
            Self::RoleplayChat => options
                .options2
                .contains(CharacterOptions2::HEAR_ROLEPLAY_CHAT),
            Self::SocietyChat => options
                .options2
                .contains(CharacterOptions2::HEAR_SOCIETY_CHAT),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CombatProfileLevel {
    Low,
    #[default]
    Medium,
    High,
}

impl CombatProfileLevel {
    pub fn cycle(self) -> Self {
        match self {
            Self::Low => Self::Medium,
            Self::Medium => Self::High,
            Self::High => Self::Low,
        }
    }

    pub fn wire_value(self) -> f32 {
        match self {
            Self::Low => 0.0,
            Self::Medium => 0.5,
            Self::High => 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CombatControlState {
    pub profile_level: CombatProfileLevel,
    pub attack_height: AttackHeight,
}

impl Default for CombatControlState {
    fn default() -> Self {
        Self {
            profile_level: CombatProfileLevel::Medium,
            attack_height: AttackHeight::Medium,
        }
    }
}

impl CombatControlState {
    pub fn cycle_attack_height(&mut self) {
        self.attack_height = match self.attack_height {
            AttackHeight::Low => AttackHeight::Medium,
            AttackHeight::Medium => AttackHeight::High,
            AttackHeight::High => AttackHeight::Low,
        };
    }

    pub fn cycle_profile_level(&mut self) {
        self.profile_level = self.profile_level.cycle();
    }
}

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
    /// Last grounded state reported by the server for the player.
    pub player_grounded: Option<bool>,
    /// Active enchantments on the player.
    pub player_enchantments: Vec<Enchantment>,
    /// List of learned spell IDs.
    pub player_spells: Vec<u32>,
    /// Projected current player character option masks from the core client view.
    pub player_options: Option<PlayerCharacterOptions>,
    /// Full spell catalog loaded from portal.dat.
    pub spell_catalog: Option<Arc<SpellCatalog>>,
    /// Local cache of nearby entities.
    pub entities: HashMap<Guid, Entity>,
    /// Server name (e.g. "Morningthaw").
    pub world_name: String,
    /// Current combat stances.
    pub combat_mode: CombatMode,
    /// Runtime-only combat state derived from feedback events and stance updates.
    pub combat_runtime: CombatRuntimeState,
    /// Local CLI combat controls for melee power or missile accuracy and attack height.
    pub combat_controls: CombatControlState,
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
    /// Recently opened world containers retained for nearby-tab labeling.
    opened_container_history: VecDeque<Guid>,
    opened_container_history_set: HashSet<Guid>,
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
            player_grounded: None,
            player_enchantments: Vec::new(),
            player_spells: Vec::new(),
            player_options: None,
            spell_catalog: None,
            entities: HashMap::new(),
            world_name: "Dereth".to_string(), // Default
            combat_mode: CombatMode::NonCombat,
            combat_runtime: CombatRuntimeState::default(),
            combat_controls: CombatControlState::default(),
            noclip: false,
            inventory: HashSet::new(),
            equipment: HashMap::new(),
            trade: None,
            open_containers: HashSet::new(),
            opened_container_history: VecDeque::new(),
            opened_container_history_set: HashSet::new(),
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

    pub fn get_burden(&self) -> Option<f32> {
        let player_guid = self.player_guid?;
        let player_entity = self.entities.get(&player_guid)?;

        // Sum up the burden of all items in player's possession.
        // In the CLI, `inventory` tracking includes:
        // 1. Items directly in the player's main pack (ContainerId == player_guid)
        // 2. Items in sub-packs (ContainerId == subpack_guid, recursively tracked)
        // 3. Items currently wielded/equipped (WielderId == player_guid)
        //
        // NOTE: ACE Server pre-calculates EncumbranceVal for containers to include all children.
        // To avoid double-counting, we ONLY sum items that are NOT inside a container we've
        // already counted (i.e. their container is the player_guid directly).
        let mut encumbrance = 0.0;
        for guid in self.inventory.iter() {
            if let Some(item) = self.entities.get(guid) {
                // If this item is inside another container that is also in our inventory,
                // we skip it because the container's EncumbranceVal already includes it.
                if let Some(container_id) = item.container_id()
                    && self.inventory.contains(&container_id)
                    && Some(container_id) != self.player_guid
                {
                    continue;
                }
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

        let capacity = (150.0 * strength) + (num_augs * 30.0 * strength);

        if capacity <= 0.0 {
            return Some(3.0);
        }

        Some(encumbrance / capacity)
    }

    pub fn get_run_rate(&self) -> Option<f32> {
        let run_skill = self.skills.get(&SkillType::Run)?.current as f32;
        let burden = self.get_burden().unwrap_or(3.0);
        let load_mod = if burden < 1.0 {
            1.0
        } else if burden < 2.0 {
            2.0 - burden
        } else {
            0.0
        };

        if run_skill >= 800.0 {
            Some(18.0 / 4.0)
        } else {
            Some((load_mod * (run_skill / (run_skill + 200.0) * 11.0) + 4.0) / 4.0)
        }
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

    pub fn curated_option_enabled(&self, option: CuratedCharacterOption) -> Option<bool> {
        self.player_options
            .map(|player_options| option.is_enabled(player_options))
    }

    pub fn track_container_opened(&mut self, guid: Guid) {
        self.open_containers.insert(guid);

        if self.opened_container_history_set.contains(&guid) {
            self.opened_container_history
                .retain(|existing| *existing != guid);
        } else {
            self.opened_container_history_set.insert(guid);
        }

        self.opened_container_history.push_back(guid);

        while self.opened_container_history.len() > OPENED_CONTAINER_HISTORY_LIMIT {
            if let Some(evicted) = self.opened_container_history.pop_front() {
                self.opened_container_history_set.remove(&evicted);
            }
        }
    }

    pub fn track_container_closed(&mut self, guid: Guid) {
        self.open_containers.remove(&guid);
    }

    pub fn has_opened_container_before(&self, guid: Guid) -> bool {
        self.opened_container_history_set.contains(&guid)
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

#[cfg(test)]
mod tests {
    use super::{CuratedCharacterOption, GameData, OPENED_CONTAINER_HISTORY_LIMIT};
    use holtburger_common::Guid;
    use holtburger_common::{CharacterOptions1, CharacterOptions2};
    use holtburger_core::PlayerCharacterOptions;

    #[test]
    fn opened_container_history_is_bounded() {
        let mut data = GameData::default();

        for raw in 1..=(OPENED_CONTAINER_HISTORY_LIMIT as u32 + 1) {
            data.track_container_opened(Guid(raw));
        }

        assert!(!data.has_opened_container_before(Guid(1)));
        assert!(data.has_opened_container_before(Guid(2)));
        assert!(data.has_opened_container_before(Guid(OPENED_CONTAINER_HISTORY_LIMIT as u32 + 1,)));
    }

    #[test]
    fn reopening_container_refreshes_history_entry() {
        let mut data = GameData::default();
        let first = Guid(1);

        data.track_container_opened(first);

        for raw in 2..=(OPENED_CONTAINER_HISTORY_LIMIT as u32) {
            data.track_container_opened(Guid(raw));
        }

        data.track_container_opened(first);
        data.track_container_opened(Guid(OPENED_CONTAINER_HISTORY_LIMIT as u32 + 1));

        assert!(data.has_opened_container_before(first));
        assert!(!data.has_opened_container_before(Guid(2)));
    }

    #[test]
    fn curated_character_option_parses_aliases() {
        assert_eq!(
            CuratedCharacterOption::parse("craft-success"),
            Some(CuratedCharacterOption::CraftSuccessDialog)
        );
        assert_eq!(
            CuratedCharacterOption::parse("ignore-trade-requests"),
            Some(CuratedCharacterOption::IgnoreTradeRequests)
        );
        assert_eq!(CuratedCharacterOption::parse("wat"), None);
    }

    #[test]
    fn curated_option_enabled_uses_projected_masks() {
        let data = GameData {
            player_options: Some(PlayerCharacterOptions {
                options1: CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG,
                options2: CharacterOptions2::HEAR_TRADE_CHAT,
            }),
            ..Default::default()
        };

        assert_eq!(
            data.curated_option_enabled(CuratedCharacterOption::CraftSuccessDialog),
            Some(true)
        );
        assert_eq!(
            data.curated_option_enabled(CuratedCharacterOption::TradeChat),
            Some(true)
        );
        assert_eq!(
            data.curated_option_enabled(CuratedCharacterOption::GeneralChat),
            Some(false)
        );
    }
}

use crate::pages::game::combat::CombatRuntimeState;
use std::collections::{HashMap, HashSet, VecDeque};

use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    PropertyInt, WorldObjectExt as _, WorldObjectPropertyAccessors,
};
use holtburger_common::{CharacterOption, CharacterOptions1, CharacterOptions2, Guid};
use holtburger_core::{PlayerCharacterOptions, RuntimeBodyViewCache};
use holtburger_dat::file_type::SkillTable;
use holtburger_protocol::messages::EquipMask;
use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_world::SelfMovementKinematics;
use holtburger_world::SpatialEntitySample;
use holtburger_world::context::WorldContext;
use holtburger_world::entity::Entity;
use holtburger_world::spell::{SpellCatalog, SpellInfo};
use holtburger_world::state::FellowshipState;
use holtburger_world::stats::{
    Attribute, AttributeType, CharacterLevelInfo, Resistances, Skill, SkillType, Vital, VitalType,
};
use std::sync::Arc;

const OPENED_CONTAINER_HISTORY_LIMIT: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CuratedCharacterOption {
    CraftSuccessDialog,
    AutoAcceptFellowshipRequests,
    IgnoreAllegianceRequests,
    IgnoreFellowshipRequests,
    IgnoreTradeRequests,
    AllowItemGive,
    ShareXp,
    ShareLoot,
    AcceptLootPermit,
    AllegianceChat,
    GeneralChat,
    TradeChat,
    LfgChat,
    RoleplayChat,
    SocietyChat,
}

impl CuratedCharacterOption {
    pub const ALL: [Self; 15] = [
        Self::CraftSuccessDialog,
        Self::AutoAcceptFellowshipRequests,
        Self::IgnoreAllegianceRequests,
        Self::IgnoreFellowshipRequests,
        Self::IgnoreTradeRequests,
        Self::AllowItemGive,
        Self::ShareXp,
        Self::ShareLoot,
        Self::AcceptLootPermit,
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
            "ignore-allegiance" | "ignore-allegiance-requests" => {
                Some(Self::IgnoreAllegianceRequests)
            }
            "ignore-fellowship" | "ignore-fellowship-requests" => {
                Some(Self::IgnoreFellowshipRequests)
            }
            "ignore-trade" | "ignore-trade-requests" => Some(Self::IgnoreTradeRequests),
            "allow-item-give" | "allow-give" => Some(Self::AllowItemGive),
            "share-xp" | "share-fellowship-xp" => Some(Self::ShareXp),
            "share-loot" | "share-fellowship-loot" => Some(Self::ShareLoot),
            "accept-loot-permit" | "accept-loot-permits" | "accept-corpse-looting" => {
                Some(Self::AcceptLootPermit)
            }
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
            Self::IgnoreAllegianceRequests => "ignore-allegiance",
            Self::IgnoreFellowshipRequests => "ignore-fellowship",
            Self::IgnoreTradeRequests => "ignore-trade",
            Self::AllowItemGive => "allow-item-give",
            Self::ShareXp => "share-xp",
            Self::ShareLoot => "share-loot",
            Self::AcceptLootPermit => "accept-loot-permit",
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
            Self::IgnoreAllegianceRequests => "Ignore incoming allegiance requests",
            Self::IgnoreFellowshipRequests => "Ignore incoming fellowship requests",
            Self::IgnoreTradeRequests => "Ignore incoming trade requests",
            Self::AllowItemGive => "Let other players hand you items",
            Self::ShareXp => "Share fellowship XP and luminance when leading",
            Self::ShareLoot => "Enable fellowship loot sharing when leading",
            Self::AcceptLootPermit => "Accept corpse looting permission grants",
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
            Self::IgnoreAllegianceRequests => CharacterOption::IgnoreAllegianceRequests,
            Self::IgnoreFellowshipRequests => CharacterOption::IgnoreFellowshipRequests,
            Self::IgnoreTradeRequests => CharacterOption::IgnoreAllTradeRequests,
            Self::AllowItemGive => CharacterOption::LetOtherPlayersGiveYouItems,
            Self::ShareXp => CharacterOption::ShareFellowshipExpAndLuminance,
            Self::ShareLoot => CharacterOption::ShareFellowshipLoot,
            Self::AcceptLootPermit => CharacterOption::AcceptCorpseLootingPermissions,
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
            Self::IgnoreAllegianceRequests => options
                .options1
                .contains(CharacterOptions1::IGNORE_ALLEGIANCE_REQUESTS),
            Self::IgnoreFellowshipRequests => options
                .options1
                .contains(CharacterOptions1::IGNORE_FELLOWSHIP_REQUESTS),
            Self::IgnoreTradeRequests => options
                .options1
                .contains(CharacterOptions1::IGNORE_TRADE_REQUESTS),
            Self::AllowItemGive => options.options1.contains(CharacterOptions1::ALLOW_GIVE),
            Self::ShareXp => options
                .options1
                .contains(CharacterOptions1::FELLOWSHIP_SHARE_XP),
            Self::ShareLoot => options
                .options1
                .contains(CharacterOptions1::FELLOWSHIP_SHARE_LOOT),
            Self::AcceptLootPermit => options
                .options1
                .contains(CharacterOptions1::ACCEPT_LOOT_PERMITS),
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
    /// Account name used for the world-entry handshake.
    pub account_name: String,
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
    /// Last authoritative player position projected from entity-style view events.
    pub player_pos: Option<WorldPosition>,
    /// Last grounded state reported by the server for the player.
    pub player_grounded: Option<bool>,
    /// Active enchantments on the player.
    pub player_enchantments: Vec<Enchantment>,
    /// List of learned spell IDs.
    pub player_spells: Vec<u32>,
    /// Projected current player character option masks from the core client view.
    pub player_options: Option<PlayerCharacterOptions>,
    /// Mirrored runtime-body read cache fed from core runtime-body snapshot and delta events.
    pub runtime_body_cache: RuntimeBodyViewCache,
    /// Projected shared self-movement kinematics from core/world.
    pub self_movement_kinematics: Option<SelfMovementKinematics>,
    /// Frontend-owned spell metadata lookup cache.
    pub spell_catalog: Option<Arc<SpellCatalog>>,
    /// Loaded portal skill table for skill formulas and skill costs.
    pub skill_table: Option<Arc<SkillTable>>,
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
    /// Every entity currently in player's pack.
    pub inventory: HashSet<Guid>,
    /// Map of GUIDs currently equipped on the character.
    pub equipment: HashMap<Guid, EquipMask>,
    /// Current active trade with another player.
    pub trade: Option<holtburger_world::state::TradeState>,
    /// Current fellowship or party state projected from the core client.
    pub party: Option<FellowshipState>,
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
            account_name: String::new(),
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
            runtime_body_cache: RuntimeBodyViewCache::default(),
            self_movement_kinematics: None,
            spell_catalog: None,
            skill_table: None,
            entities: HashMap::new(),
            world_name: "Dereth".to_string(), // Default
            combat_mode: CombatMode::NonCombat,
            combat_runtime: CombatRuntimeState::default(),
            combat_controls: CombatControlState::default(),
            inventory: HashSet::new(),
            equipment: HashMap::new(),
            trade: None,
            party: None,
            open_containers: HashSet::new(),
            opened_container_history: VecDeque::new(),
            opened_container_history_set: HashSet::new(),
        }
    }
}

impl GameData {
    pub fn new(guid: Guid, name: String, world_name: String) -> Self {
        Self::new_with_account(guid, name, String::new(), world_name)
    }

    pub fn new_with_account(
        guid: Guid,
        name: String,
        account_name: String,
        world_name: String,
    ) -> Self {
        Self {
            character_name: Some(name),
            account_name,
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

    pub fn spell_catalog(&self) -> Option<Arc<SpellCatalog>> {
        self.spell_catalog.clone()
    }

    pub fn skill_table(&self) -> Option<Arc<SkillTable>> {
        self.skill_table.clone()
    }

    pub fn spell_info(&self, spell_id: u32) -> Option<SpellInfo> {
        self.spell_catalog()
            .and_then(|catalog| catalog.get(spell_id).cloned())
    }

    pub fn spell_name(&self, spell_id: u32) -> Option<String> {
        self.spell_catalog()
            .and_then(|catalog| catalog.resolve_name(spell_id).map(str::to_string))
    }

    pub fn spell_name_or_fallback(&self, spell_id: u32) -> String {
        self.spell_name(spell_id)
            .unwrap_or_else(|| format!("Spell #{}", spell_id))
    }

    pub fn curated_option_enabled(&self, option: CuratedCharacterOption) -> Option<bool> {
        self.player_options
            .map(|player_options| option.is_enabled(player_options))
    }

    pub fn runtime_player_position(&self) -> Option<WorldPosition> {
        let guid = self.player_guid?;
        preferred_runtime_pose(self.runtime_body_cache.projected_pose(guid)).or(self.player_pos)
    }

    pub fn runtime_position_for_guid(&self, guid: Guid) -> Option<WorldPosition> {
        if Some(guid) == self.player_guid {
            return self.runtime_player_position();
        }

        preferred_runtime_pose(self.runtime_body_cache.projected_pose(guid))
            .or_else(|| self.entities.get(&guid).map(|entity| entity.position))
    }

    pub fn distance_position_for_guid(&self, guid: Guid) -> Option<WorldPosition> {
        if Some(guid) == self.player_guid {
            return self.runtime_player_position();
        }

        self.entities.get(&guid).map(|entity| entity.position)
    }

    pub fn runtime_sample_for_guid(&self, guid: Guid) -> Option<SpatialEntitySample> {
        if Some(guid) == self.player_guid {
            if let Some(sample) = self.runtime_body_cache.spatial_sample(guid) {
                return Some(sample);
            }

            let pose = self.player_pos?;
            let (velocity, omega, motion_state) = self
                .entities
                .get(&guid)
                .map(|entity| (entity.velocity, entity.omega, entity.motion_snapshot))
                .unwrap_or_default();

            return Some(SpatialEntitySample {
                guid,
                authoritative_pose: pose,
                projected_pose: pose,
                velocity,
                omega,
                motion_state,
                projection_mode: holtburger_world::SpatialSampleMode::AuthoritativeOnly,
            });
        }

        self.entities.get(&guid).map(|entity| {
            self.runtime_body_cache
                .spatial_sample_or_authoritative(entity)
        })
    }

    pub fn runtime_heading(&self) -> Option<f32> {
        self.runtime_player_position()
            .map(|position| position.rotation.to_heading())
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

    pub fn current_open_container(&self) -> Option<Guid> {
        self.opened_container_history
            .iter()
            .rev()
            .copied()
            .find(|guid| self.open_containers.contains(guid))
    }

    pub fn has_opened_container_before(&self, guid: Guid) -> bool {
        self.opened_container_history_set.contains(&guid)
    }
}

fn preferred_runtime_pose(position: Option<WorldPosition>) -> Option<WorldPosition> {
    position.filter(|position| position.landblock_id != Guid::NULL)
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

    fn get_player_attribute_current(&self, attr: AttributeType) -> Option<u32> {
        self.attributes
            .get(&attr)
            .map(|attribute| attribute.current)
    }

    fn get_player_skill_current(&self, skill: SkillType) -> Option<u32> {
        self.skills.get(&skill).map(|skill| skill.current)
    }

    fn get_player_int_property(&self, prop: PropertyInt) -> Option<i32> {
        let player_guid = self.player_guid?;
        self.entities.get(&player_guid)?.get_int_prop(prop)
    }
}

#[cfg(test)]
mod tests {
    use super::{CuratedCharacterOption, GameData, OPENED_CONTAINER_HISTORY_LIMIT};
    use holtburger_common::Guid;
    use holtburger_common::Vector3;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{PropertyInt, WorldObjectPropertyAccessorsMut};
    use holtburger_common::{CharacterOptions1, CharacterOptions2};
    use holtburger_core::ClientViewEvent;
    use holtburger_core::PlayerCharacterOptions;
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::context::WorldContextExt;
    use holtburger_world::entity::{Entity, EntityMotionSnapshot};
    use holtburger_world::stats::{Attribute, AttributeType};
    use holtburger_world::{
        ContactState, RuntimeSpatialBodyView, SpatialBodyId, SpatialSampleMode,
    };
    use std::time::Instant;

    fn seed_runtime_body(
        data: &mut GameData,
        body_id: SpatialBodyId,
        authoritative_pose: WorldPosition,
        runtime_pose: WorldPosition,
    ) {
        data.runtime_body_cache.apply_view_event(
            &ClientViewEvent::RuntimeBodyUpserted {
                body: Box::new(RuntimeSpatialBodyView {
                    body_id,
                    authoritative_pose: Some(authoritative_pose),
                    runtime_pose,
                    velocity: Vector3::zero(),
                    omega: Vector3::zero(),
                    motion_state: None,
                    contact: ContactState::Grounded,
                    sample_mode: SpatialSampleMode::SimulatingMotionState,
                }),
            },
            Instant::now(),
        );
    }

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
    fn distance_position_uses_projected_player_and_authoritative_other_entities() {
        let player_guid = Guid(0x5000_0001);
        let target_guid = Guid(0x5000_0002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());

        let authoritative_player = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let projected_player = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(10.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let authoritative_target = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(50.0, 0.0, 0.0),
            ..WorldPosition::default()
        };
        let projected_target = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(90.0, 0.0, 0.0),
            ..WorldPosition::default()
        };

        data.player_pos = Some(authoritative_player);
        data.entities.insert(
            player_guid,
            Entity::new(player_guid, "Player".to_string(), authoritative_player),
        );
        data.entities.insert(
            target_guid,
            Entity::new(target_guid, "Target".to_string(), authoritative_target),
        );

        seed_runtime_body(
            &mut data,
            SpatialBodyId::LocalPlayer(player_guid),
            authoritative_player,
            projected_player,
        );
        seed_runtime_body(
            &mut data,
            SpatialBodyId::Entity(target_guid),
            authoritative_target,
            projected_target,
        );

        assert_eq!(
            data.distance_position_for_guid(player_guid),
            Some(projected_player)
        );
        assert_eq!(
            data.distance_position_for_guid(target_guid),
            Some(authoritative_target)
        );
    }

    #[test]
    fn runtime_player_position_ignores_placeholder_runtime_pose() {
        let player_guid = Guid(0x5000_0001);
        let authoritative_player = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(12.0, 34.0, 56.0),
            ..WorldPosition::default()
        };
        let placeholder_runtime = WorldPosition::default();
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(authoritative_player);

        seed_runtime_body(
            &mut data,
            SpatialBodyId::LocalPlayer(player_guid),
            authoritative_player,
            placeholder_runtime,
        );

        assert_eq!(data.runtime_player_position(), Some(authoritative_player));
        assert_eq!(
            data.distance_position_for_guid(player_guid),
            Some(authoritative_player)
        );
    }

    #[test]
    fn runtime_position_for_guid_ignores_placeholder_runtime_pose() {
        let target_guid = Guid(0x5000_0002);
        let authoritative_target = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(90.0, 12.0, 1.0),
            ..WorldPosition::default()
        };
        let mut data = GameData::default();
        data.entities.insert(
            target_guid,
            Entity::new(target_guid, "Target".to_string(), authoritative_target),
        );

        seed_runtime_body(
            &mut data,
            SpatialBodyId::Entity(target_guid),
            authoritative_target,
            WorldPosition::default(),
        );

        assert_eq!(
            data.runtime_position_for_guid(target_guid),
            Some(authoritative_target)
        );
    }

    #[test]
    fn runtime_sample_for_local_player_uses_runtime_body_motion_snapshot() {
        let player_guid = Guid(0x5000_0001);
        let authoritative_player = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            ..WorldPosition::default()
        };
        let cached_motion = EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand(0x0001)),
            ..Default::default()
        };
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(authoritative_player);

        data.runtime_body_cache.apply_view_event(
            &ClientViewEvent::RuntimeBodyUpserted {
                body: Box::new(RuntimeSpatialBodyView {
                    body_id: SpatialBodyId::LocalPlayer(player_guid),
                    authoritative_pose: Some(authoritative_player),
                    runtime_pose: authoritative_player,
                    velocity: Vector3::zero(),
                    omega: Vector3::zero(),
                    motion_state: Some(cached_motion),
                    contact: ContactState::Grounded,
                    sample_mode: SpatialSampleMode::SimulatingMotionState,
                }),
            },
            Instant::now(),
        );

        assert!(matches!(
            data.runtime_sample_for_guid(player_guid),
            Some(holtburger_world::SpatialEntitySample {
                motion_state: Some(EntityMotionSnapshot {
                    forward_command: Some(InterpretedMotionCommand(0x0001)),
                    ..
                }),
                ..
            })
        ));
    }
    #[test]
    fn curated_character_option_parses_aliases() {
        assert_eq!(
            CuratedCharacterOption::parse("craft-success"),
            Some(CuratedCharacterOption::CraftSuccessDialog)
        );
        assert_eq!(
            CuratedCharacterOption::parse("ignore-allegiance-requests"),
            Some(CuratedCharacterOption::IgnoreAllegianceRequests)
        );
        assert_eq!(
            CuratedCharacterOption::parse("share-fellowship-loot"),
            Some(CuratedCharacterOption::ShareLoot)
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
                options1: CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG
                    | CharacterOptions1::IGNORE_ALLEGIANCE_REQUESTS
                    | CharacterOptions1::FELLOWSHIP_SHARE_XP
                    | CharacterOptions1::FELLOWSHIP_SHARE_LOOT
                    | CharacterOptions1::ACCEPT_LOOT_PERMITS,
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
            data.curated_option_enabled(CuratedCharacterOption::IgnoreAllegianceRequests),
            Some(true)
        );
        assert_eq!(
            data.curated_option_enabled(CuratedCharacterOption::ShareXp),
            Some(true)
        );
        assert_eq!(
            data.curated_option_enabled(CuratedCharacterOption::ShareLoot),
            Some(true)
        );
        assert_eq!(
            data.curated_option_enabled(CuratedCharacterOption::AcceptLootPermit),
            Some(true)
        );
        assert_eq!(
            data.curated_option_enabled(CuratedCharacterOption::GeneralChat),
            Some(false)
        );
    }

    #[test]
    fn player_burden_uses_cached_strength_and_player_properties() {
        let player_guid = Guid(1);
        let item_guid = Guid(2);

        let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
        player.set_int_prop(PropertyInt::AugmentationIncreasedCarryingCapacity, 1);

        let mut item = Entity::new(item_guid, "Pack Item".to_string(), WorldPosition::default());
        item.set_int_prop(PropertyInt::EncumbranceVal, 300);
        item.properties.iids.insert(
            holtburger_common::properties::PropertyInstanceId::Container,
            player_guid,
        );

        let data = GameData {
            player_guid: Some(player_guid),
            attributes: std::collections::HashMap::from([(
                AttributeType::StrengthAttr,
                Attribute {
                    attr_type: AttributeType::StrengthAttr,
                    ranks: 0,
                    start: 100,
                    spent_xp: 0,
                    next_rank_xp: None,
                    base: 100,
                    current: 100,
                },
            )]),
            entities: std::collections::HashMap::from([(player_guid, player), (item_guid, item)]),
            inventory: std::collections::HashSet::from([item_guid]),
            ..Default::default()
        };

        assert_eq!(data.player_burden(), Some(300.0 / 18_000.0));
    }
}

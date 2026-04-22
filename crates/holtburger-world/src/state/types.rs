use holtburger_common::Guid;
use holtburger_common::properties::{
    EnchantmentTypeFlags, EquipMask, PropertyFloat, PropertyInt, PropertyInt64, PropertyString,
    WorldObjectExt as _, WorldObjectPropertyAccessors, WorldObjectPropertyAccessorsMut,
};
use holtburger_content::SoulEmoteCatalog;
use holtburger_dat::file_type::{MotionKinematics, SkillTable, XpTable};
use holtburger_protocol::messages::GameMessage;
use holtburger_protocol::messages::combat::CombatMode;
use std::sync::Arc;

use crate::entity::{Entity, EntityManager};
use crate::player::PlayerState;
use crate::spatial::{BasicSpatialPhysics, SpatialPhysics, SpatialScene};
use crate::spell::{SpellCatalog, SpellInfo};
use crate::state::fellowship::FellowshipState;
use crate::state::liveness::EntityLifecycleStore;
use crate::state::self_movement::SelfMovementCapabilities;
use crate::state::trade::TradeState;
use crate::stats;
use crate::vendor::VendorState;
use crate::{WorldBootstrap, WorldEvent};

pub struct ServerTimeSync {
    pub server_time: f64,
    pub local_time: std::time::Instant,
}

/// The authoritative state of the game world.
///
/// `WorldState` owns entity/spatial/trade/vendor state plus the invariants that tie those systems
/// together. Protocol routing itself lives in `crate::handlers`; `WorldState::handle_message()` is
/// just the stable facade used by callers such as `holtburger-core`.
///
/// NOTE: The player `Entity` is the authoritative holder of player world/object state.
/// `self.player` only owns local-player/session overlays such as sequencing, stat caches,
/// enchantments, inventory/equipment indices, and related derived-state bookkeeping.
/// Live local runtime motion is world-owned through `SpatialScene`, which composes
/// shared body-sampling state without exposing it as an app-facing projection surface.
///
/// !!! CRITICAL !!!
/// Use `set_player_*` and related authoritative world mutation helpers for server-confirmed
/// player updates and reconciliation. Use the runtime-body helpers for routine local simulation.
/// Hand-writing to `self.entities` or scene body state directly will break the
/// authority/runtime split and is not allowed.
pub struct WorldState {
    pub entities: EntityManager,
    pub player: PlayerState,
    pub server_time: Option<ServerTimeSync>,
    pub xp_table: Arc<XpTable>,
    pub skill_table: Arc<SkillTable>,
    pub spell_catalog: Arc<SpellCatalog>,
    pub soul_emote_catalog: Arc<SoulEmoteCatalog>,
    pub motion_kinematics: Arc<MotionKinematics>,
    pub scene: SpatialScene,
    pub vendor: Option<VendorState>,
    pub fellowship: Option<FellowshipState>,
    pub trade: Option<TradeState>,
    pub open_containers: std::collections::HashSet<Guid>,
    pub(crate) entity_lifecycle: EntityLifecycleStore,
    pub(crate) self_movement_capabilities_override: Option<SelfMovementCapabilities>,
}

impl WorldState {
    pub fn player_entity(&self) -> Option<&Entity> {
        let guid = self.player.guid;
        (guid != Guid::NULL)
            .then(|| self.entities.get(guid))
            .flatten()
    }

    pub fn player_entity_mut(&mut self) -> Option<&mut Entity> {
        let guid = self.player.guid;
        (guid != Guid::NULL)
            .then(|| self.entities.get_mut(guid))
            .flatten()
    }

    pub fn player_position(&self) -> Option<holtburger_common::position::WorldPosition> {
        self.player_entity().map(|entity| entity.position)
    }

    pub fn player_landblock(&self) -> Option<Guid> {
        self.player_position()
            .map(|position| position.landblock_id)
            .filter(|landblock| *landblock != Guid::NULL)
    }

    pub fn player_properties(
        &self,
    ) -> Option<&holtburger_common::properties::WorldObjectProperties> {
        self.player_entity().map(|entity| &entity.properties)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn seed_local_player_entity(
        &mut self,
        guid: Guid,
        name: impl Into<String>,
        position: holtburger_common::position::WorldPosition,
    ) {
        self.player.guid = guid;
        self.add_entity(Entity::new(guid, name.into(), position));
    }

    pub fn player_int_property(&self, property: PropertyInt) -> Option<i32> {
        self.player_properties()
            .and_then(|properties| properties.get_int_prop(property))
    }

    pub fn player_int64_property(&self, property: PropertyInt64) -> Option<i64> {
        self.player_properties()
            .and_then(|properties| properties.get_int64_prop(property))
    }

    pub fn player_float_property(&self, property: PropertyFloat) -> Option<f64> {
        self.player_properties()
            .and_then(|properties| properties.get_float_prop(property))
    }

    pub fn player_string_property(&self, property: PropertyString) -> Option<&str> {
        self.player_properties()
            .and_then(|properties| properties.get_string_prop(property))
    }

    pub fn player_level(&self) -> u32 {
        self.player_int_property(PropertyInt::Level).unwrap_or(0) as u32
    }

    pub fn player_total_experience(&self) -> u64 {
        self.player_int64_property(PropertyInt64::TotalExperience)
            .unwrap_or(0) as u64
    }

    pub fn player_available_experience(&self) -> u64 {
        self.player_int64_property(PropertyInt64::AvailableExperience)
            .unwrap_or(0) as u64
    }

    pub fn player_unspent_skill_points(&self) -> u32 {
        self.player_int_property(PropertyInt::AvailableSkillCredits)
            .unwrap_or(0) as u32
    }

    pub fn player_available_luminance(&self) -> u64 {
        self.player_int64_property(PropertyInt64::AvailableLuminance)
            .unwrap_or(0) as u64
    }

    pub fn player_combat_mode(&self) -> CombatMode {
        let value = self
            .player_int_property(PropertyInt::CombatMode)
            .unwrap_or(0);
        CombatMode::from_repr(value as u32).unwrap_or(CombatMode::NonCombat)
    }

    pub fn player_name(&self) -> &str {
        self.player_string_property(PropertyString::Name)
            .unwrap_or("Unknown")
    }

    pub fn player_armor(&self) -> i32 {
        let base_armor = self
            .player_int_property(PropertyInt::ArmorLevel)
            .unwrap_or(0);
        i32::max(
            -400,
            crate::magic::get_enchanted_armor(base_armor, &self.player.enchantments),
        )
    }

    pub fn player_vitae(&self) -> f32 {
        self.player.vitae()
    }

    fn player_resistance_augmentation(&self, prop: PropertyFloat) -> i32 {
        let augmentation_prop = match prop {
            PropertyFloat::ResistSlash => PropertyInt::AugmentationResistanceSlash,
            PropertyFloat::ResistPierce => PropertyInt::AugmentationResistancePierce,
            PropertyFloat::ResistBludgeon => PropertyInt::AugmentationResistanceBlunt,
            PropertyFloat::ResistFire => PropertyInt::AugmentationResistanceFire,
            PropertyFloat::ResistCold => PropertyInt::AugmentationResistanceFrost,
            PropertyFloat::ResistAcid => PropertyInt::AugmentationResistanceAcid,
            PropertyFloat::ResistElectric => PropertyInt::AugmentationResistanceLightning,
            PropertyFloat::ResistNether => PropertyInt::AugmentationResistanceNether,
            _ => return 0,
        };

        self.player_int_property(augmentation_prop).unwrap_or(0)
    }

    pub fn player_resistance_current(&self, prop: PropertyFloat) -> f32 {
        let base = self.player_float_property(prop).unwrap_or(1.0) as f32;
        let strength_base = self
            .player
            .get_attribute_base(crate::stats::AttributeType::StrengthAttr);
        let endurance_base = self
            .player
            .get_attribute_base(crate::stats::AttributeType::EnduranceAttr);
        let augmentation_resistance = self.player_resistance_augmentation(prop);

        crate::magic::get_player_enchanted_resistance(
            base,
            &self.player.enchantments,
            prop as u32,
            strength_base,
            endurance_base,
            augmentation_resistance,
        )
    }

    pub fn player_resistances(&self) -> stats::Resistances {
        stats::Resistances {
            slash: self.player_resistance_current(PropertyFloat::ResistSlash),
            pierce: self.player_resistance_current(PropertyFloat::ResistPierce),
            bludgeon: self.player_resistance_current(PropertyFloat::ResistBludgeon),
            fire: self.player_resistance_current(PropertyFloat::ResistFire),
            cold: self.player_resistance_current(PropertyFloat::ResistCold),
            acid: self.player_resistance_current(PropertyFloat::ResistAcid),
            electric: self.player_resistance_current(PropertyFloat::ResistElectric),
            nether: self.player_resistance_current(PropertyFloat::ResistNether),
        }
    }

    pub(crate) fn emit_player_derived_stats(&mut self, events: &mut Vec<WorldEvent>) {
        self.player.refresh_cached_derived_stat_inputs();

        let current = crate::player::types::LastSentStats {
            attributes: self.player.attribute_snapshot(),
            vitals: self.player.vital_snapshot(),
            skills: self.player.skill_snapshot(),
            resistances: self.player_resistances(),
            armor: self.player_armor(),
            vitae: self.player_vitae(),
        };

        if self.player.last_emitted_derived_stats.as_ref() == Some(&current) {
            return;
        }

        self.player.last_emitted_derived_stats = Some(current.clone());
        events.push(WorldEvent::DerivedStatsUpdated(Box::new(
            crate::DerivedStatsData {
                attributes: current.attributes,
                vitals: current.vitals,
                skills: current.skills,
                resistances: current.resistances,
                armor: current.armor,
                vitae: current.vitae,
            },
        )));
    }

    /// Stable public entry point for applying a decoded game message to world state.
    ///
    /// Feature handlers own the orchestration order; this method preserves the external API while
    /// keeping routing separate from the state model itself.
    pub fn handle_message(&mut self, msg: &GameMessage) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        crate::handlers::handle_message(self, msg, &mut events);
        events
    }

    pub fn set_server_time_sync(
        &mut self,
        server_time: f64,
        local_time: std::time::Instant,
    ) -> Vec<WorldEvent> {
        self.server_time = Some(ServerTimeSync {
            server_time,
            local_time,
        });
        vec![WorldEvent::ServerTimeUpdate(server_time)]
    }

    pub fn get_level_info(&self) -> stats::CharacterLevelInfo {
        let table = &self.xp_table;
        let level = self.player_level();
        let total_xp = self.player_total_experience();
        let unspent_xp = self.player_available_experience();

        let level_idx = level as usize;
        let next_level_idx = level_idx + 1;

        if next_level_idx >= table.character_level_xp_list.len() {
            // Already max level
            let level_xp = *table.character_level_xp_list.get(level_idx).unwrap_or(&0);
            return stats::CharacterLevelInfo {
                level,
                current_xp: total_xp,
                unspent_xp,
                unspent_skill_points: self.player_unspent_skill_points(),
                available_luminance: self.player_available_luminance(),
                next_level_xp: level_xp,
                xp_into_level: total_xp.saturating_sub(level_xp),
                xp_for_next_level: 0,
            };
        }

        let level_xp = table.character_level_xp_list[level_idx];
        let next_level_xp = table.character_level_xp_list[next_level_idx];

        stats::CharacterLevelInfo {
            level,
            current_xp: total_xp,
            unspent_xp,
            unspent_skill_points: self.player_unspent_skill_points(),
            available_luminance: self.player_available_luminance(),
            next_level_xp,
            xp_into_level: total_xp.saturating_sub(level_xp),
            xp_for_next_level: next_level_xp.saturating_sub(level_xp),
        }
    }

    pub fn resolve_spell_name(&self, spell_id: u32) -> Option<String> {
        self.spell_catalog
            .resolve_name(spell_id)
            .map(str::to_string)
    }

    pub fn resolve_spell_info(&self, spell_id: u32) -> Option<SpellInfo> {
        self.spell_catalog.get(spell_id).cloned()
    }

    pub fn get_player_enchanted_int(&self, key: PropertyInt) -> i32 {
        let base = self
            .player_entity()
            .and_then(|e| e.get_int_prop(key))
            .unwrap_or(0);

        if key == PropertyInt::ArmorLevel {
            crate::magic::get_enchanted_armor(base, &self.player.enchantments)
        } else {
            let mult = crate::magic::get_enchantment_multiplier(
                &self.player.enchantments,
                EnchantmentTypeFlags::INT.bits(),
                key as u32,
            );
            let add = crate::magic::get_enchantment_additive(
                &self.player.enchantments,
                EnchantmentTypeFlags::INT.bits(),
                key as u32,
            );
            ((base as f32 * mult) + add).round() as i32
        }
    }

    pub fn get_player_enchanted_float(&self, key: PropertyFloat) -> f32 {
        if matches!(
            key,
            PropertyFloat::ResistSlash
                | PropertyFloat::ResistPierce
                | PropertyFloat::ResistBludgeon
                | PropertyFloat::ResistFire
                | PropertyFloat::ResistCold
                | PropertyFloat::ResistAcid
                | PropertyFloat::ResistElectric
                | PropertyFloat::ResistNether
        ) {
            return self.player_resistance_current(key);
        }

        let base = self
            .player_entity()
            .and_then(|e| e.get_float_prop(key))
            .map(|f| f as f32)
            .unwrap_or(1.0);

        crate::magic::get_enchanted_resistance(base, &self.player.enchantments, key as u32)
    }

    pub fn new(bootstrap: Arc<WorldBootstrap>) -> Self {
        Self::new_with_spatial_physics(bootstrap, Arc::new(BasicSpatialPhysics))
    }

    pub fn new_with_spatial_physics(
        bootstrap: Arc<WorldBootstrap>,
        spatial_physics: Arc<dyn SpatialPhysics>,
    ) -> Self {
        Self {
            entities: EntityManager::new(),
            player: PlayerState::new(),
            server_time: None,
            xp_table: Arc::clone(&bootstrap.xp_table),
            skill_table: Arc::clone(&bootstrap.skill_table),
            spell_catalog: bootstrap.spell_catalog(),
            soul_emote_catalog: Arc::clone(&bootstrap.soul_emote_catalog),
            motion_kinematics: Arc::clone(&bootstrap.motion_kinematics),
            scene: SpatialScene::new_with_physics(spatial_physics),
            vendor: None,
            fellowship: None,
            trade: None,
            open_containers: std::collections::HashSet::new(),
            entity_lifecycle: EntityLifecycleStore::default(),
            self_movement_capabilities_override: None,
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn synthetic() -> Self {
        Self::synthetic_with_spatial_physics(Arc::new(BasicSpatialPhysics))
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn synthetic_with_spatial_physics(spatial_physics: Arc<dyn SpatialPhysics>) -> Self {
        Self::new_with_spatial_physics(Arc::new(WorldBootstrap::synthetic()), spatial_physics)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn set_motion_kinematics(&mut self, motion_kinematics: MotionKinematics) {
        self.motion_kinematics = Arc::new(motion_kinematics);
    }

    pub fn current_server_time(&self) -> f64 {
        match &self.server_time {
            Some(sync) => {
                let elapsed = sync.local_time.elapsed().as_secs_f64();
                sync.server_time + elapsed
            }
            None => {
                // Fallback to wall clock if no sync yet
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64()
            }
        }
    }

    pub fn add_entity(&mut self, entity: Entity) {
        let guid = entity.guid;
        let pos = entity.position;
        let velocity = entity.velocity;
        let omega = entity.omega;

        self.entities.insert(entity);
        self.scene.update_entity(guid, pos.landblock_id, pos);
        self.reconcile_authoritative_body(
            guid,
            pos,
            velocity,
            omega,
            crate::spatial::AuthoritativeBodySync::Snapshot,
        );
    }

    pub fn remove_entity<G: Into<Guid> + Copy>(&mut self, guid: G) -> Option<Entity> {
        let guid = guid.into();
        if let Some(entity) = self.entities.remove(guid) {
            self.scene.remove_entity(guid, entity.position.landblock_id);
            self.retire_authoritative_body_for_guid(guid);
            self.entity_lifecycle.clear(guid);

            let dependent_guids: Vec<_> = self
                .entities
                .iter()
                .filter(|dependent| {
                    dependent.container_id() == Some(guid)
                        || dependent.wielder_id() == Some(guid)
                        || dependent.physics_parent_id == Some(guid)
                })
                .map(|dependent| dependent.guid)
                .collect();

            for dependent_guid in dependent_guids {
                let mut detached = false;
                let mut detached_wielder = false;

                if let Some(dependent) = self.entities.get_mut(dependent_guid) {
                    if dependent.container_id() == Some(guid) {
                        dependent.set_container_id(None);
                        detached = true;
                    }

                    if dependent.wielder_id() == Some(guid) {
                        dependent.set_wielder_id(None);
                        dependent.set_int_prop(
                            PropertyInt::CurrentWieldedLocation,
                            EquipMask::NONE.bits() as i32,
                        );
                        detached = true;
                        detached_wielder = true;
                    }

                    if dependent.physics_parent_id == Some(guid) {
                        dependent.physics_parent_id = None;
                        detached = true;
                    }
                }

                if detached_wielder {
                    let _ = self.clear_entity_world_presence(dependent_guid);
                }

                if detached {
                    self.sync_player_ownership_for_entity(dependent_guid);
                    let _ = self
                        .mark_entity_immediately_eligible_for_pruning_if_unretained(dependent_guid);
                }
            }

            Some(entity)
        } else {
            None
        }
    }
}

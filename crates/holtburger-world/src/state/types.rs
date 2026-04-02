use anyhow::{Context, Result};
use binrw::BinRead;
use holtburger_common::Guid;
use holtburger_common::properties::{
    EnchantmentTypeFlags, EquipMask, PropertyFloat, PropertyInt, WorldObjectExt as _,
    WorldObjectPropertyAccessors, WorldObjectPropertyAccessorsMut,
};
use holtburger_dat::file_type::{MotionKinematics, SkillTable, SpellTable, XpTable};
use holtburger_dat::{
    MountedResourceProvider, ResourceProvider, ResourceScope, ScopedResourceResolver,
};
use holtburger_protocol::messages::GameMessage;
use std::sync::Arc;

use crate::WorldEvent;
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
/// NOTE: The player's authoritative state is partially mirrored between `self.player`
/// (session sequence data plus authoritative snapshots) and the `Entity` map.
/// Live local runtime motion is world-owned through `SpatialScene`, which composes
/// shared body-sampling state without exposing it as an app-facing projection surface.
///
/// !!! CRITICAL !!!
/// Use `set_player_*` and related authoritative world mutation helpers for server-confirmed
/// player updates and reconciliation. Use the runtime-body helpers for routine local simulation.
/// Hand-writing to `self.player.position`, `self.entities`, or scene body state directly will
/// break the authority/runtime split and is not allowed.
pub struct WorldState {
    pub entities: EntityManager,
    pub player: PlayerState,
    pub server_time: Option<ServerTimeSync>,
    pub resources: Option<Arc<ScopedResourceResolver>>,
    pub xp_table: XpTable,
    pub skill_table: Arc<SkillTable>,
    pub spell_catalog: Arc<SpellCatalog>,
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
        let level = self.player.level();
        let total_xp = self.player.total_experience();
        let unspent_xp = self.player.available_experience();

        let level_idx = level as usize;
        let next_level_idx = level_idx + 1;

        if next_level_idx >= table.character_level_xp_list.len() {
            // Already max level
            let level_xp = *table.character_level_xp_list.get(level_idx).unwrap_or(&0);
            return stats::CharacterLevelInfo {
                level,
                current_xp: total_xp,
                unspent_xp,
                unspent_skill_points: self.player.unspent_skill_points(),
                available_luminance: self.player.available_luminance(),
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
            unspent_skill_points: self.player.unspent_skill_points(),
            available_luminance: self.player.available_luminance(),
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
            .entities
            .get(self.player.guid)
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
            return self.player.get_resistance_current(key);
        }

        let base = self
            .entities
            .get(self.player.guid)
            .and_then(|e| e.get_float_prop(key))
            .map(|f| f as f32)
            .unwrap_or(1.0);

        crate::magic::get_enchanted_resistance(base, &self.player.enchantments, key as u32)
    }

    pub fn new(resources: Arc<ScopedResourceResolver>) -> Result<Self> {
        Self::new_with_spatial_physics(resources, Arc::new(BasicSpatialPhysics))
    }

    pub fn new_with_spatial_physics(
        resources: Arc<ScopedResourceResolver>,
        spatial_physics: Arc<dyn SpatialPhysics>,
    ) -> Result<Self> {
        let skill_table_data = resources
            .get_file_for::<SkillTable>()
            .context("missing required skill table from mounted resources")?;
        let skill_table = SkillTable::read(&mut std::io::Cursor::new(skill_table_data))
            .context("failed to parse required skill table")?;

        let xp_table_data = resources
            .get_file_for::<XpTable>()
            .context("missing required XP table from mounted resources")?;
        let xp_table = XpTable::read(&mut std::io::Cursor::new(xp_table_data))
            .context("failed to parse required XP table")?;

        let spell_table_data = resources
            .get_file_for::<SpellTable>()
            .context("missing required spell table from mounted resources")?;
        let spell_table = SpellTable::read(&mut std::io::Cursor::new(spell_table_data))
            .context("failed to parse required spell table")?;

        let motion_kinematics_data = resources
            .get_file_for::<MotionKinematics>()
            .context("missing required motion kinematics table from mounted resources")?;
        let motion_kinematics =
            MotionKinematics::read(&mut std::io::Cursor::new(motion_kinematics_data))
                .context("failed to parse required motion kinematics table")?;

        Ok(Self {
            entities: EntityManager::new(),
            player: PlayerState::new(),
            server_time: None,
            resources: Some(resources),
            xp_table,
            skill_table: Arc::new(skill_table),
            spell_catalog: Arc::new(spell_table.into()),
            motion_kinematics: Arc::new(motion_kinematics),
            scene: SpatialScene::new_with_physics(spatial_physics),
            vendor: None,
            fellowship: None,
            trade: None,
            open_containers: std::collections::HashSet::new(),
            entity_lifecycle: EntityLifecycleStore::default(),
            self_movement_capabilities_override: None,
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn synthetic() -> Self {
        Self::synthetic_with_spatial_physics(Arc::new(BasicSpatialPhysics))
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn synthetic_with_spatial_physics(spatial_physics: Arc<dyn SpatialPhysics>) -> Self {
        Self {
            entities: EntityManager::new(),
            player: PlayerState::new(),
            server_time: None,
            resources: None,
            xp_table: XpTable::default(),
            skill_table: Arc::new(SkillTable::default()),
            spell_catalog: Arc::new(SpellCatalog::default()),
            motion_kinematics: Arc::new(MotionKinematics::default()),
            scene: SpatialScene::new_with_physics(spatial_physics),
            vendor: None,
            fellowship: None,
            trade: None,
            open_containers: std::collections::HashSet::new(),
            entity_lifecycle: EntityLifecycleStore::default(),
            self_movement_capabilities_override: None,
        }
    }

    pub fn with_provider_for_namespace(
        namespace: &str,
        provider: Arc<dyn ResourceProvider>,
    ) -> Result<Self> {
        Self::new(Arc::new(ScopedResourceResolver::from_mounted([
            MountedResourceProvider::with_namespace(namespace, provider)?,
        ])))
    }

    pub fn with_provider(
        scope: ResourceScope,
        provider: Arc<dyn ResourceProvider>,
    ) -> Result<Self> {
        Self::with_provider_for_namespace(scope.namespace(), provider)
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
                    }

                    if dependent.physics_parent_id == Some(guid) {
                        dependent.physics_parent_id = None;
                        detached = true;
                    }
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

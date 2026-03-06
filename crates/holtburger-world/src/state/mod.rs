mod mutations;
mod physics;
#[cfg(test)]
mod tests;
mod trade;

pub use trade::{TradeSide, TradeState};

use super::StateEvent;
use super::entity::{Entity, EntityManager};
use super::hydration::WorldObjectPropertiesHydrationExt;
use super::player::PlayerState;
use super::spatial::SpatialScene;
use super::stats;
use super::vendor::{CoreVendorItem, VendorState};
use binrw::BinRead;
use holtburger_common::properties::{
    EnchantmentTypeFlags, EquipMask, PropertyFloat, PropertyInstanceId, PropertyInt,
    PropertyString, PropertyUpdate, WorldObjectPropertyAccessors, WorldObjectPropertyAccessorsMut,
};
use holtburger_common::{Guid, Vector3};
use holtburger_dat::ResourceProvider;
use holtburger_dat::file_type::{SkillTable, SpellTable, XpTable};
use std::sync::Arc;

use holtburger_protocol::messages::*;

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
/// NOTE: The player's state is partially mirrored between `self.player` (session sequence data)
/// and the `Entity` map (physical landblock/coords/velocity).
///
/// !!! CRITICAL !!!
/// ALWAYS use the `set_player_*` mutation methods to update player position or velocity.
/// Hand-writing to `self.player.position` or `self.entities` directly will cause
/// physics desyncs and is considered "highly sus" behavior.
pub struct WorldState {
    pub entities: EntityManager,
    pub player: PlayerState,
    pub server_time: Option<ServerTimeSync>,
    pub portal_dat: Option<Arc<dyn ResourceProvider>>,
    pub cell_dat: Option<Arc<dyn ResourceProvider>>,
    pub xp_table: Option<XpTable>,
    pub skill_table: Option<Arc<SkillTable>>,
    pub spell_table: Option<Arc<SpellTable>>,
    pub scene: SpatialScene,
    pub vendor: Option<VendorState>,
    pub trade: Option<TradeState>,
    pub open_containers: std::collections::HashSet<Guid>,
}

impl WorldState {
    /// Stable public entry point for applying a decoded game message to world state.
    ///
    /// Feature handlers own the orchestration order; this method preserves the external API while
    /// keeping routing separate from the state model itself.
    pub fn handle_message(&mut self, msg: &GameMessage) -> Vec<StateEvent> {
        let mut events = Vec::new();
        crate::handlers::handle_message(self, msg, &mut events);
        events
    }

    pub fn get_level_info(&self) -> Option<stats::CharacterLevelInfo> {
        let table = self.xp_table.as_ref()?;
        let level = self.player.level();
        let total_xp = self.player.total_experience();
        let unspent_xp = self.player.available_experience();

        let level_idx = level as usize;
        let next_level_idx = level_idx + 1;

        if next_level_idx >= table.character_level_xp_list.len() {
            // Already max level
            let level_xp = *table.character_level_xp_list.get(level_idx).unwrap_or(&0);
            return Some(stats::CharacterLevelInfo {
                level,
                current_xp: total_xp,
                unspent_xp,
                unspent_skill_points: self.player.unspent_skill_points(),
                available_luminance: self.player.available_luminance(),
                next_level_xp: level_xp,
                xp_into_level: total_xp.saturating_sub(level_xp),
                xp_for_next_level: 0,
            });
        }

        let level_xp = table.character_level_xp_list[level_idx];
        let next_level_xp = table.character_level_xp_list[next_level_idx];

        Some(stats::CharacterLevelInfo {
            level,
            current_xp: total_xp,
            unspent_xp,
            unspent_skill_points: self.player.unspent_skill_points(),
            available_luminance: self.player.available_luminance(),
            next_level_xp,
            xp_into_level: total_xp.saturating_sub(level_xp),
            xp_for_next_level: next_level_xp.saturating_sub(level_xp),
        })
    }

    pub fn get_player_spell_names(&self) -> std::collections::HashMap<u32, String> {
        let mut names = std::collections::HashMap::new();
        if let Some(table) = &self.spell_table {
            // Player's known spells
            for spell_id in self.player.spells.keys() {
                if let Some(spell) = table.spells.get(spell_id) {
                    names.insert(*spell_id, spell.name.clone());
                }
            }
            // Enchantments currently active on the player
            for enc in &self.player.enchantments {
                let spell_id = enc.spell_id as u32;
                if let Some(spell) = table.spells.get(&spell_id) {
                    names.insert(spell_id, spell.name.clone());
                }
            }
        }
        names
    }

    pub fn resolve_spell_name(&self, spell_id: u32) -> Option<String> {
        self.spell_table
            .as_ref()?
            .spells
            .get(&spell_id)
            .map(|s| s.name.clone())
    }

    pub fn resolve_spell_info(
        &self,
        spell_id: u32,
    ) -> Option<holtburger_dat::file_type::spell_table::SpellBase> {
        self.spell_table.as_ref()?.spells.get(&spell_id).cloned()
    }

    pub fn get_player_enchanted_int(&self, key: PropertyInt) -> i32 {
        let base = self
            .entities
            .get(self.player.guid)
            .and_then(|e| e.get_int_prop(key))
            .unwrap_or(0);

        if key == PropertyInt::ArmorLevel {
            super::magic::get_enchanted_armor(base, &self.player.enchantments)
        } else {
            let mult = super::magic::get_enchantment_multiplier(
                &self.player.enchantments,
                EnchantmentTypeFlags::INT.bits(),
                key as u32,
            );
            let add = super::magic::get_enchantment_additive(
                &self.player.enchantments,
                EnchantmentTypeFlags::INT.bits(),
                key as u32,
            );
            ((base as f32 * mult) + add).round() as i32
        }
    }

    pub fn get_player_enchanted_float(&self, key: PropertyFloat) -> f32 {
        let base = self
            .entities
            .get(self.player.guid)
            .and_then(|e| e.get_float_prop(key))
            .map(|f| f as f32)
            .unwrap_or(1.0);

        super::magic::get_enchanted_resistance(base, &self.player.enchantments, key as u32)
    }

    pub fn new(
        portal_dat: Option<Arc<dyn ResourceProvider>>,
        cell_dat: Option<Arc<dyn ResourceProvider>>,
    ) -> Self {
        let mut skill_table = None;
        if let Some(db) = &portal_dat {
            // Skill Table
            if let Ok(data) = db.get_file(SkillTable::FILE_ID) {
                let mut cursor = std::io::Cursor::new(data);
                if let Ok(table) = SkillTable::read(&mut cursor) {
                    skill_table = Some(Arc::new(table));
                }
            }
        }

        Self {
            entities: EntityManager::new(),
            player: PlayerState::new(),
            server_time: None,
            portal_dat,
            cell_dat,
            xp_table: None,
            skill_table,
            spell_table: None,
            scene: SpatialScene::new(),
            vendor: None,
            trade: None,
            open_containers: std::collections::HashSet::new(),
        }
    }

    pub fn load_deferred_tables(&mut self) {
        if let Some(db) = &self.portal_dat {
            if self.xp_table.is_none()
                && let Ok(data) = db.get_file(XpTable::FILE_ID)
                && let Ok(table) = XpTable::read(&mut std::io::Cursor::new(data))
            {
                self.xp_table = Some(table);
            }
            if self.spell_table.is_none()
                && let Ok(data) = db.get_file(SpellTable::FILE_ID)
                && let Ok(table) = SpellTable::read(&mut std::io::Cursor::new(data))
            {
                self.spell_table = Some(Arc::new(table));
            }
        }
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
        let lb = entity.position.landblock_id;

        self.entities.insert(entity);
        self.scene.update_entity(guid, lb, lb);
    }

    pub fn remove_entity<G: Into<Guid> + Copy>(&mut self, guid: G) -> Option<Entity> {
        let guid = guid.into();
        if let Some(entity) = self.entities.remove(guid) {
            self.scene.remove_entity(guid, entity.position.landblock_id);
            Some(entity)
        } else {
            None
        }
    }
}

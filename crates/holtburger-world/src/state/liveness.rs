use std::collections::{HashMap, HashSet};

use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt as _;

use crate::WorldEvent;
use crate::context::WorldContextExt;
use crate::entity::Entity;
use crate::state::WorldState;

const ACE_DESTRUCTION_TIMEOUT_SECS: f64 = 25.0;
const CONSERVATIVE_VISIBILITY_DISTANCE_M: f32 = 384.0;

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct EntityLifecycleState {
    pub explicit_delete_requested: bool,
    pub prune_deadline: Option<f64>,
    pub trade_preview: bool,
    pub container_preview: bool,
}

impl EntityLifecycleState {
    fn is_empty(&self) -> bool {
        !self.explicit_delete_requested
            && self.prune_deadline.is_none()
            && !self.trade_preview
            && !self.container_preview
    }
}

#[derive(Debug, Default)]
pub(crate) struct EntityLifecycleStore {
    by_guid: HashMap<Guid, EntityLifecycleState>,
}

impl EntityLifecycleStore {
    pub fn get(&self, guid: Guid) -> Option<&EntityLifecycleState> {
        self.by_guid.get(&guid)
    }

    pub fn get_or_default_mut(&mut self, guid: Guid) -> &mut EntityLifecycleState {
        self.by_guid.entry(guid).or_default()
    }

    pub fn clear(&mut self, guid: Guid) {
        self.by_guid.remove(&guid);
    }

    pub fn compact(&mut self, guid: Guid) {
        if self
            .by_guid
            .get(&guid)
            .is_some_and(EntityLifecycleState::is_empty)
        {
            self.by_guid.remove(&guid);
        }
    }

    pub fn tracked_guids(&self) -> impl Iterator<Item = Guid> + '_ {
        self.by_guid.keys().copied()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntityUpsertKind {
    Inserted,
    Replaced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct EntityRetentionSnapshot {
    pub in_world: bool,
    pub held_by_player: bool,
    pub equipped_by_player: bool,
    pub inside_open_container: bool,
    pub has_container_owner: bool,
    pub has_wielder_owner: bool,
    pub has_parent_owner: bool,
    pub trade_preview: bool,
    pub container_preview: bool,
    pub explicit_delete_requested: bool,
    pub prune_deadline_expired: bool,
}

impl EntityRetentionSnapshot {
    pub fn has_preview_retention(self) -> bool {
        self.trade_preview || (self.container_preview && self.inside_open_container)
    }

    pub fn has_nonworld_retention(self) -> bool {
        self.held_by_player
            || self.equipped_by_player
            || self.inside_open_container
            || self.has_container_owner
            || self.has_wielder_owner
            || self.has_parent_owner
            || self.has_preview_retention()
    }

    pub fn has_authoritative_retention(self) -> bool {
        self.in_world
            || self.held_by_player
            || self.equipped_by_player
            || self.inside_open_container
            || self.has_container_owner
            || self.has_wielder_owner
            || self.has_parent_owner
    }

    pub fn is_retained(self) -> bool {
        self.has_authoritative_retention() || self.has_preview_retention()
    }
}

impl WorldState {
    fn current_visible_world_guids(&self) -> HashSet<Guid> {
        if self.player.guid == Guid::NULL {
            return HashSet::new();
        }

        let Some(player_landblock) = self.player_landblock() else {
            return HashSet::new();
        };

        let nearby_guids = self.scene.get_nearby_entities(player_landblock);

        self.entities
            .iter()
            .filter(|entity| entity.guid != self.player.guid)
            .filter(|entity| entity.position.landblock_id != Guid::NULL)
            .filter(|entity| self.is_entity_world_participant(entity.guid))
            .filter(|entity| self.is_conservatively_visible_world_entity(entity, &nearby_guids))
            .map(|entity| entity.guid)
            .collect()
    }

    // TODO: Replace this conservative approximation with ACE-parity cell visibility.
    // ACE decides visibility from the current ObjCell, not just from landblock adjacency.
    // Proper parity here requires consulting cell.dat envcell records so we can:
    // 1. detect whether the player's current cell is an EnvCell,
    // 2. read SeenOutside for that cell,
    // 3. union the current envcell with its VisibleCells,
    // 4. merge outdoor landblock-neighborhood visibility only for SeenOutside envcells.
    // Until we wire that up, prefer retaining too much over pruning too aggressively.
    fn is_conservatively_visible_world_entity(
        &self,
        entity: &Entity,
        nearby_guids: &HashSet<Guid>,
    ) -> bool {
        nearby_guids.contains(&entity.guid)
            || self.player_position().is_some_and(|position| {
                position.distance_to(&entity.position) <= CONSERVATIVE_VISIBILITY_DISTANCE_M
            })
    }

    fn maintain_visibility_prune_deadlines(&mut self, now: f64) {
        let visible_guids = self.current_visible_world_guids();
        let world_entity_guids: Vec<_> = self
            .entities
            .iter()
            .filter(|entity| entity.guid != self.player.guid)
            .filter(|entity| entity.position.landblock_id != Guid::NULL)
            .map(|entity| entity.guid)
            .collect();

        for guid in world_entity_guids {
            if visible_guids.contains(&guid) {
                self.clear_entity_prune_deadline(guid);
                continue;
            }

            let Some(snapshot) = self.retention_snapshot(guid, now) else {
                continue;
            };

            if snapshot.explicit_delete_requested || snapshot.has_nonworld_retention() {
                self.clear_entity_prune_deadline(guid);
                continue;
            }

            if self
                .entity_lifecycle_state(guid)
                .and_then(|state| state.prune_deadline)
                .is_none()
            {
                self.set_entity_prune_deadline(guid, now + ACE_DESTRUCTION_TIMEOUT_SECS);
            }
        }
    }

    pub(crate) fn trade_contains_item(&self, guid: Guid) -> bool {
        self.trade.as_ref().is_some_and(|trade| {
            trade.self_side.items.contains(&guid) || trade.partner_side.items.contains(&guid)
        })
    }

    pub(crate) fn entity_lifecycle_state(&self, guid: Guid) -> Option<&EntityLifecycleState> {
        self.entity_lifecycle.get(guid)
    }

    pub(crate) fn mark_entity_explicit_delete(&mut self, guid: Guid) {
        self.entity_lifecycle
            .get_or_default_mut(guid)
            .explicit_delete_requested = true;
    }

    pub(crate) fn clear_entity_explicit_delete(&mut self, guid: Guid) {
        if let Some(state) = self.entity_lifecycle.by_guid.get_mut(&guid) {
            state.explicit_delete_requested = false;
        }
        self.entity_lifecycle.compact(guid);
    }

    pub(crate) fn set_entity_prune_deadline(&mut self, guid: Guid, deadline: f64) {
        self.entity_lifecycle
            .get_or_default_mut(guid)
            .prune_deadline = Some(deadline);
    }

    pub(crate) fn clear_entity_prune_deadline(&mut self, guid: Guid) {
        if let Some(state) = self.entity_lifecycle.by_guid.get_mut(&guid) {
            state.prune_deadline = None;
        }
        self.entity_lifecycle.compact(guid);
    }

    pub(crate) fn mark_trade_preview(&mut self, guid: Guid) {
        self.entity_lifecycle.get_or_default_mut(guid).trade_preview = true;
    }

    pub(crate) fn clear_trade_preview(&mut self, guid: Guid) {
        if let Some(state) = self.entity_lifecycle.by_guid.get_mut(&guid) {
            state.trade_preview = false;
        }
        self.entity_lifecycle.compact(guid);
    }

    pub(crate) fn mark_container_preview(&mut self, guid: Guid) {
        self.entity_lifecycle
            .get_or_default_mut(guid)
            .container_preview = true;
    }

    pub(crate) fn clear_container_preview(&mut self, guid: Guid) {
        if let Some(state) = self.entity_lifecycle.by_guid.get_mut(&guid) {
            state.container_preview = false;
        }
        self.entity_lifecycle.compact(guid);
    }

    pub(crate) fn retention_snapshot(
        &self,
        guid: Guid,
        now: f64,
    ) -> Option<EntityRetentionSnapshot> {
        let entity = self.entities.get(guid)?;
        let container_id = entity.container_id();
        let open_container =
            container_id.is_some_and(|container| self.open_containers.contains(&container));
        let lifecycle = self.entity_lifecycle.get(guid);
        let container_preview = lifecycle.is_some_and(|state| state.container_preview);

        Some(EntityRetentionSnapshot {
            in_world: entity.position.landblock_id != Guid::NULL,
            held_by_player: self.is_in_player_inventory(guid),
            equipped_by_player: self.is_equipped_item(guid),
            inside_open_container: open_container,
            has_container_owner: container_id.is_some() && (!container_preview || open_container),
            has_wielder_owner: entity
                .wielder_id()
                .is_some_and(|wielder| self.entities.get(wielder).is_some()),
            has_parent_owner: entity.physics_parent_id.is_some(),
            trade_preview: lifecycle.is_some_and(|state| state.trade_preview),
            container_preview,
            explicit_delete_requested: lifecycle
                .is_some_and(|state| state.explicit_delete_requested),
            prune_deadline_expired: lifecycle
                .and_then(|state| state.prune_deadline)
                .is_some_and(|deadline| deadline <= now),
        })
    }

    pub(crate) fn reconcile_entity_retention(
        &mut self,
        guid: Guid,
    ) -> Option<EntityRetentionSnapshot> {
        let snapshot = self.retention_snapshot(guid, self.current_server_time())?;
        if snapshot.is_retained() {
            self.clear_entity_prune_deadline(guid);
        }
        Some(snapshot)
    }

    pub(crate) fn should_evict_entity(&self, guid: Guid, now: f64) -> bool {
        let Some(snapshot) = self.retention_snapshot(guid, now) else {
            return false;
        };

        if snapshot.explicit_delete_requested {
            return true;
        }

        if snapshot.has_nonworld_retention() {
            return false;
        }

        snapshot.prune_deadline_expired
    }

    pub(crate) fn sweep_entity(
        &mut self,
        guid: Guid,
        now: f64,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if !self.should_evict_entity(guid, now) {
            return false;
        }

        if self.remove_entity(guid).is_some() {
            if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
                events.push(WorldEvent::RuntimeBodyRemoved { body_id });
            }
            events.push(WorldEvent::EntityDespawned(guid));
            true
        } else {
            self.entity_lifecycle.clear(guid);
            false
        }
    }

    pub(crate) fn sweep_eviction_queue(&mut self, now: f64, events: &mut Vec<WorldEvent>) {
        let candidates: Vec<_> = self.entity_lifecycle.tracked_guids().collect();
        for guid in candidates {
            let _ = self.sweep_entity(guid, now, events);
        }
    }

    pub fn is_entity_client_visible(&self, guid: Guid) -> bool {
        self.entities.get(guid).is_some()
            && !self
                .entity_lifecycle
                .get(guid)
                .is_some_and(|state| state.explicit_delete_requested)
    }

    pub fn is_entity_world_participant(&self, guid: Guid) -> bool {
        self.get_visible_entity(guid)
            .is_some_and(|entity| entity.position.landblock_id != Guid::NULL)
    }

    pub fn get_visible_entity(&self, guid: Guid) -> Option<&Entity> {
        self.entities
            .get_filtered(guid, |entity| self.is_entity_client_visible(entity.guid))
    }

    pub fn iter_visible_entities(&self) -> impl Iterator<Item = &Entity> + '_ {
        self.entities
            .iter_filtered(move |entity| self.is_entity_client_visible(entity.guid))
    }

    pub fn get_nearby_world_entities(&self) -> Vec<Entity> {
        if self.player.guid == Guid::NULL {
            return Vec::new();
        }

        let Some(lb) = self.player_landblock() else {
            return Vec::new();
        };

        let nearby_guids = self.scene.get_nearby_entities(lb);
        nearby_guids
            .into_iter()
            .filter(|guid| self.is_entity_world_participant(*guid))
            .filter_map(|guid| self.entities.get(guid).cloned())
            .collect()
    }

    pub fn tick(&mut self) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let now = self.current_server_time();
        self.sweep_eviction_queue(now, &mut events);
        self.maintain_visibility_prune_deadlines(now);

        events
    }

    pub(crate) fn upsert_entity_from_create(
        &mut self,
        entity: Entity,
        events: &mut Vec<WorldEvent>,
    ) -> EntityUpsertKind {
        let guid = entity.guid;
        let preserve_container_preview = entity
            .container_id()
            .is_some_and(|container| self.open_containers.contains(&container))
            || self
                .entities
                .get(guid)
                .and_then(|existing| existing.container_id())
                .is_some_and(|container| self.open_containers.contains(&container));

        self.clear_entity_explicit_delete(guid);
        self.clear_entity_prune_deadline(guid);
        if !self.trade_contains_item(guid) {
            self.clear_trade_preview(guid);
        }
        if !preserve_container_preview {
            self.clear_container_preview(guid);
        }

        if let Some(old_lb) = self
            .entities
            .get(guid)
            .map(|existing| existing.position.landblock_id)
        {
            self.entities.insert(entity.clone());
            self.scene.update_entity(guid, old_lb, entity.position);
            self.reconcile_authoritative_body(
                guid,
                entity.position,
                entity.velocity,
                entity.omega,
                crate::spatial::AuthoritativeBodySync::Snapshot,
            );
            events.push(WorldEvent::EntityReplaced(Box::new(entity)));
            EntityUpsertKind::Replaced
        } else {
            self.add_entity(entity.clone());
            events.push(WorldEvent::EntitySpawned(Box::new(entity)));
            EntityUpsertKind::Inserted
        }
    }
}

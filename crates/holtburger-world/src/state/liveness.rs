use std::collections::{HashMap, HashSet};

use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_common::sequence::is_newer_u16;
use holtburger_protocol::messages::object::messages::description::ObjDescEventData;
use holtburger_protocol::messages::object::types::ModelData;

use crate::WorldEvent;
use crate::context::WorldContextExt;
use crate::entity::Entity;
use crate::state::WorldState;

const ACE_DESTRUCTION_TIMEOUT_SECS: f64 = 25.0;
const CONSERVATIVE_VISIBILITY_DISTANCE_M: f32 = 384.0;

/// Server request that can retire every current incarnation or one exact instance sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntityDeleteRequest {
    /// Non-generation-scoped removal produced by inventory and ownership transitions.
    Unconditional,
    /// Network deletion that applies only to the named server object incarnation.
    Instance(u16),
}

impl EntityDeleteRequest {
    fn applies_to(self, instance_sequence: u16) -> bool {
        match self {
            Self::Unconditional => true,
            Self::Instance(sequence) => sequence == instance_sequence,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct EntityLifecycleState {
    /// Pending deletion authority, including future instance deletes queued like retail SmartBox.
    pub delete_request: Option<EntityDeleteRequest>,
    pub prune_deadline: Option<f64>,
    pub trade_preview: bool,
    pub container_preview: bool,
    /// Complete appearance for a not-yet-materialized future object incarnation.
    pub pending_visual_description: Option<PendingVisualDescription>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PendingVisualDescription {
    pub instance_sequence: u16,
    pub visual_description_sequence: u16,
    pub model_data: ModelData,
}

impl EntityLifecycleState {
    fn is_empty(&self) -> bool {
        self.delete_request.is_none()
            && self.prune_deadline.is_none()
            && !self.trade_preview
            && !self.container_preview
            && self.pending_visual_description.is_none()
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

/// Delete disposition after applying one authoritative object description.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntityCreateDisposition {
    /// The description is newer than any queued delete or has no queued delete.
    Active,
    /// A previously queued delete names the description's exact instance sequence.
    DeleteRequested,
}

/// Retail SmartBox disposition for an instance-sequenced object deletion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntityInstanceDeleteDisposition {
    /// The request names the currently materialized incarnation.
    Applied,
    /// The request names a future incarnation or arrived before its object description.
    Queued,
    /// The request names an incarnation older than the currently materialized one.
    Stale,
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
    /// Whether current deletion authority applies to this entity's exact incarnation.
    pub current_instance_delete_requested: bool,
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
    /// Applies or queues one complete visual description under retail's two sequence domains.
    pub(crate) fn apply_object_visual_description(
        &mut self,
        data: &ObjDescEventData,
        events: &mut Vec<WorldEvent>,
    ) {
        let Some(entity) = self.entities.get_mut(data.guid) else {
            self.entity_lifecycle
                .get_or_default_mut(data.guid)
                .pending_visual_description = Some(PendingVisualDescription::from(data));
            return;
        };
        let current_instance = entity.instance_sequence();
        if data.instance_sequence == current_instance {
            if is_newer_u16(
                data.visual_desc_sequence,
                entity.visual_description_sequence(),
            ) {
                entity.apply_visual_description(&data.model_data, data.visual_desc_sequence);
                events.push(WorldEvent::EntityAppearanceUpdated { guid: data.guid });
            }
            return;
        }
        if !is_newer_u16(data.instance_sequence, current_instance) {
            return;
        }

        let incoming = PendingVisualDescription::from(data);
        let state = self.entity_lifecycle.get_or_default_mut(data.guid);
        let replace = state
            .pending_visual_description
            .as_ref()
            .is_none_or(|pending| {
                is_newer_u16(incoming.instance_sequence, pending.instance_sequence)
                    || (incoming.instance_sequence == pending.instance_sequence
                        && is_newer_u16(
                            incoming.visual_description_sequence,
                            pending.visual_description_sequence,
                        ))
            });
        if replace {
            state.pending_visual_description = Some(incoming);
        }
    }

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

            if snapshot.current_instance_delete_requested || snapshot.has_nonworld_retention() {
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
            .delete_request = Some(EntityDeleteRequest::Unconditional);
    }

    /// Applies SmartBox's three-way instance-timestamp disposition from acclient.c:137144-137176:
    /// exact deletes apply, future deletes queue, and stale deletes cannot retire a later instance.
    pub(crate) fn request_entity_instance_delete(
        &mut self,
        guid: Guid,
        instance_sequence: u16,
    ) -> EntityInstanceDeleteDisposition {
        let current_sequence = self.entities.get(guid).map(Entity::instance_sequence);
        let disposition = match current_sequence {
            Some(current) if current == instance_sequence => {
                EntityInstanceDeleteDisposition::Applied
            }
            Some(current) if is_newer_u16(instance_sequence, current) => {
                EntityInstanceDeleteDisposition::Queued
            }
            Some(_) => EntityInstanceDeleteDisposition::Stale,
            None => EntityInstanceDeleteDisposition::Queued,
        };
        if disposition == EntityInstanceDeleteDisposition::Stale {
            return disposition;
        }

        let state = self.entity_lifecycle.get_or_default_mut(guid);
        match state.delete_request {
            Some(EntityDeleteRequest::Unconditional) => {}
            Some(EntityDeleteRequest::Instance(pending))
                if disposition == EntityInstanceDeleteDisposition::Applied
                    || is_newer_u16(instance_sequence, pending) =>
            {
                state.delete_request = Some(EntityDeleteRequest::Instance(instance_sequence));
            }
            None => {
                state.delete_request = Some(EntityDeleteRequest::Instance(instance_sequence));
            }
            Some(EntityDeleteRequest::Instance(_)) => {}
        }
        disposition
    }

    /// Reconciles a create against a queued delete without letting stale delete traffic win.
    fn reconcile_entity_delete_after_create(&mut self, guid: Guid) -> bool {
        let Some(instance_sequence) = self.entities.get(guid).map(Entity::instance_sequence) else {
            return false;
        };
        let mut applies_to_instance = false;
        if let Some(state) = self.entity_lifecycle.by_guid.get_mut(&guid) {
            applies_to_instance = matches!(
                state.delete_request,
                Some(EntityDeleteRequest::Instance(pending)) if pending == instance_sequence
            );
            let clear = match state.delete_request {
                None => false,
                Some(EntityDeleteRequest::Unconditional) => true,
                Some(EntityDeleteRequest::Instance(pending)) => {
                    is_newer_u16(instance_sequence, pending)
                }
            };
            if clear {
                state.delete_request = None;
            }
        }
        self.entity_lifecycle.compact(guid);
        applies_to_instance
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
            has_parent_owner: entity
                .attachment
                .is_some_and(|attachment| self.entities.get(attachment.parent).is_some()),
            trade_preview: lifecycle.is_some_and(|state| state.trade_preview),
            container_preview,
            current_instance_delete_requested: self.current_instance_delete_requested(guid),
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

        if snapshot.current_instance_delete_requested {
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

        if let Some(removed) = self.remove_entity(guid) {
            if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
                events.push(WorldEvent::RuntimeBodyRemoved { body_id });
            }
            events.push(WorldEvent::EntityDespawned {
                guid,
                generation: u64::from(removed.instance_sequence()),
            });
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
        self.entities.get(guid).is_some() && !self.current_instance_delete_requested(guid)
    }

    fn current_instance_delete_requested(&self, guid: Guid) -> bool {
        let Some(instance_sequence) = self.entities.get(guid).map(Entity::instance_sequence) else {
            return false;
        };
        self.entity_lifecycle.get(guid).is_some_and(|state| {
            state
                .delete_request
                .is_some_and(|request| request.applies_to(instance_sequence))
        })
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
        mut entity: Entity,
        events: &mut Vec<WorldEvent>,
    ) -> EntityCreateDisposition {
        let guid = entity.guid;
        self.reconcile_pending_visual_description_for_create(&mut entity);
        let preserve_container_preview = entity
            .container_id()
            .is_some_and(|container| self.open_containers.contains(&container))
            || self
                .entities
                .get(guid)
                .and_then(|existing| existing.container_id())
                .is_some_and(|container| self.open_containers.contains(&container));

        self.clear_entity_prune_deadline(guid);
        if !self.trade_contains_item(guid) {
            self.clear_trade_preview(guid);
        }
        if !preserve_container_preview {
            self.clear_container_preview(guid);
        }

        if self.entities.get(guid).is_some() {
            self.entities.insert(entity.clone());
            self.initialize_authoritative_body(
                guid,
                entity.position,
                entity.velocity,
                entity.omega,
            );
            events.push(WorldEvent::EntityReplaced(Box::new(entity)));
        } else {
            self.add_entity(entity.clone());
            events.push(WorldEvent::EntitySpawned(Box::new(entity)));
        }
        if self.reconcile_entity_delete_after_create(guid) {
            EntityCreateDisposition::DeleteRequested
        } else {
            EntityCreateDisposition::Active
        }
    }

    fn reconcile_pending_visual_description_for_create(&mut self, entity: &mut Entity) {
        let Some(state) = self.entity_lifecycle.by_guid.get_mut(&entity.guid) else {
            return;
        };
        let Some(pending) = state.pending_visual_description.as_ref() else {
            return;
        };
        if pending.instance_sequence == entity.instance_sequence() {
            if is_newer_u16(
                pending.visual_description_sequence,
                entity.visual_description_sequence(),
            ) {
                entity.apply_visual_description(
                    &pending.model_data,
                    pending.visual_description_sequence,
                );
            }
            state.pending_visual_description = None;
        } else if is_newer_u16(entity.instance_sequence(), pending.instance_sequence) {
            state.pending_visual_description = None;
        }
        self.entity_lifecycle.compact(entity.guid);
    }
}

impl From<&ObjDescEventData> for PendingVisualDescription {
    fn from(data: &ObjDescEventData) -> Self {
        Self {
            instance_sequence: data.instance_sequence,
            visual_description_sequence: data.visual_desc_sequence,
            model_data: data.model_data.clone(),
        }
    }
}

use std::collections::HashMap;

use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_common::sequence::is_newer_u16;
use holtburger_protocol::messages::object::messages::description::ObjDescEventData;
use holtburger_protocol::messages::object::types::ModelData;

use super::entity_dependencies::ScenePlacementScope;
use super::pose_orientation::recover_pose_orientation;
use super::visibility::{EntityVisibility, VisibilitySnapshot};
use crate::CollisionScene;
use crate::WorldEvent;
use crate::context::{WorldContext, WorldContextExt};
use crate::entity::Entity;
use crate::state::WorldState;

pub(crate) const ACE_DESTRUCTION_TIMEOUT_SECS: f64 = 25.0;
/// Cleanup authority stays paired with its deadline so visibility cannot cancel other cleanup.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct EntityPruneRequest {
    /// Why local retention may expire; server deletion remains a separate authority.
    pub reason: EntityPruneReason,
    /// Server-clock deadline, preserving the existing shared time domain.
    pub deadline: f64,
}

/// Local cleanup decisions have distinct cancellation contracts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntityPruneReason {
    /// Inventory access was withdrawn; retain the description for follow-up protocol messages.
    InventoryRemoval,
    /// Continuous, proven exclusion from the observer's authored visibility.
    Visibility,
    /// Unretained preview, transfer, or dependent description ready for cleanup.
    Unretained,
}

/// Server request that can retire every current incarnation or one exact instance sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntityDeleteRequest {
    /// Non-generation-scoped removal of an unretained dependent description.
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
    /// Local expiration authority and its deadline, independent of explicit server deletion.
    pub prune_request: Option<EntityPruneRequest>,
    pub trade_preview: bool,
    pub container_preview: bool,
    /// Dispatched transfers awaiting an item-scoped result; retains this item and its subtree.
    pub inventory_transfer_requests: u32,
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
            && self.prune_request.is_none()
            && !self.trade_preview
            && !self.container_preview
            && self.inventory_transfer_requests == 0
            && self.pending_visual_description.is_none()
    }
}

#[derive(Debug, Default)]
pub(crate) struct EntityLifecycleStore {
    by_guid: HashMap<Guid, EntityLifecycleState>,
    revision: u64,
}

impl EntityLifecycleStore {
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn get(&self, guid: Guid) -> Option<&EntityLifecycleState> {
        self.by_guid.get(&guid)
    }

    pub fn get_mut(&mut self, guid: Guid) -> Option<&mut EntityLifecycleState> {
        let state = self.by_guid.get_mut(&guid)?;
        self.revision = self.revision.wrapping_add(1);
        Some(state)
    }

    pub fn get_or_default_mut(&mut self, guid: Guid) -> &mut EntityLifecycleState {
        self.revision = self.revision.wrapping_add(1);
        self.by_guid.entry(guid).or_default()
    }

    pub fn clear(&mut self, guid: Guid) {
        if self.by_guid.remove(&guid).is_some() {
            self.revision = self.revision.wrapping_add(1);
        }
    }

    pub fn compact(&mut self, guid: Guid) {
        if self
            .by_guid
            .get(&guid)
            .is_some_and(EntityLifecycleState::is_empty)
        {
            self.by_guid.remove(&guid);
            self.revision = self.revision.wrapping_add(1);
        }
    }

    pub fn tracked_guids(&self) -> impl Iterator<Item = Guid> + '_ {
        self.by_guid.keys().copied()
    }
}

/// Equality key capturing every external input to `VisibilitySnapshot` and prune maintenance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VisibilityMaintenanceFingerprint {
    collision_topology: Option<(u64, u64)>,
    player_guid: Guid,
    player_landblock: Option<Guid>,
    entities_cursor: crate::dirty_log::DirtyGuidCursor,
    lifecycle_revision: u64,
    storage_revision: u64,
    world_container_root: Option<Guid>,
    trade_signature: Option<(u32, u64)>,
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
    /// Description retention only; never grants ownership, access, or semantic admission.
    pub inventory_transfer_pending: bool,
    /// Inventory access is withdrawn, but follow-up protocol messages still need the description.
    pub inventory_removal_pending: bool,
    /// Whether current deletion authority applies to this entity's exact incarnation.
    pub current_instance_delete_requested: bool,
    /// Whether the current local cleanup authority has reached its deadline.
    pub prune_request_expired: bool,
}

impl EntityRetentionSnapshot {
    pub fn has_preview_retention(self) -> bool {
        self.trade_preview || (self.container_preview && self.inside_open_container)
    }

    pub fn has_nonworld_retention(self) -> bool {
        self.inventory_transfer_pending
            || self.held_by_player
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
        self.has_authoritative_retention()
            || self.has_preview_retention()
            || self.inventory_transfer_pending
            || self.inventory_removal_pending
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

    fn maintain_entity_prune_requests(&mut self, now: f64, visibility: &VisibilitySnapshot) {
        let candidates: Vec<_> = self
            .entities
            .iter()
            .filter(|entity| entity.guid != self.player.guid)
            .filter(|entity| {
                entity.position.landblock_id != Guid::NULL
                    || entity.placement_intent != crate::EntityPlacementIntent::Independent
            })
            .map(|entity| (entity.guid, entity.position))
            .collect();
        for (guid, position) in candidates {
            let Some(retention) = self.retention_snapshot(guid, now) else {
                continue;
            };
            if retention.inventory_removal_pending {
                continue;
            }
            if retention.current_instance_delete_requested || retention.has_nonworld_retention() {
                self.clear_entity_prune_request(guid);
                continue;
            }
            let reason = if retention.in_world {
                self.clear_entity_prune_reason(guid, EntityPruneReason::Unretained);
                if visibility.get(guid, position) != EntityVisibility::Outside {
                    self.clear_entity_prune_reason(guid, EntityPruneReason::Visibility);
                    continue;
                }
                EntityPruneReason::Visibility
            } else {
                // An unresolved attachment has no world visibility to classify. Its description
                // gets the existing grace period to acquire a parent, independent of room data.
                self.clear_entity_prune_reason(guid, EntityPruneReason::Visibility);
                EntityPruneReason::Unretained
            };
            if self
                .entity_lifecycle_state(guid)
                .and_then(|state| state.prune_request)
                .is_none()
            {
                let request = EntityPruneRequest {
                    reason,
                    deadline: now + ACE_DESTRUCTION_TIMEOUT_SECS,
                };
                self.entity_lifecycle.get_or_default_mut(guid).prune_request = Some(request);
            }
        }
    }

    /// Invalidate uncertain visibility evidence before sweeping even an already due request.
    fn invalidate_unavailable_visibility(&mut self, visibility: &VisibilitySnapshot) {
        let guids: Vec<_> = self
            .entity_lifecycle
            .tracked_guids()
            .filter(|guid| {
                self.entities.get(*guid).is_some_and(|entity| {
                    visibility.get(*guid, entity.position) == EntityVisibility::Unavailable
                })
            })
            .collect();
        for guid in guids {
            self.clear_entity_prune_reason(guid, EntityPruneReason::Visibility);
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

    /// Retail behavior is to withdraw inventory access immediately and retain descriptions for
    /// 25 seconds. The following instance delete must find the old description rather than queue
    /// against a future create which can reuse the same instance sequence.
    pub(crate) fn remove_inventory_object(&mut self, guid: Guid, events: &mut Vec<WorldEvent>) {
        let removed: Vec<_> = std::iter::once(guid)
            .chain(self.storage.owned_items(guid))
            .collect();
        let deadline = self.current_server_time() + ACE_DESTRUCTION_TIMEOUT_SECS;
        for guid in removed {
            self.retire_entity_storage(guid);
            if self.entities.get(guid).is_some() {
                self.entity_lifecycle.get_or_default_mut(guid).prune_request =
                    Some(EntityPruneRequest {
                        reason: EntityPruneReason::InventoryRemoval,
                        deadline,
                    });
                self.withdraw_entity_inventory_location(guid, events);
            }
        }
    }

    fn inventory_removal_pending(&self, guid: Guid) -> bool {
        self.entity_lifecycle.get(guid).is_some_and(|state| {
            state
                .prune_request
                .is_some_and(|request| request.reason == EntityPruneReason::InventoryRemoval)
        })
    }

    /// Retained protocol descriptions do not grant scene or client semantic access.
    pub(super) fn entity_description_withdrawn(&self, entity: &Entity) -> bool {
        self.instance_delete_applies(entity) || self.inventory_removal_pending(entity.guid)
    }

    pub(crate) fn mark_entity_explicit_delete(&mut self, guid: Guid) {
        // Accepted deletion retires storage immediately, before deferred scene eviction.
        self.retire_entity_storage(guid);
        self.entity_lifecycle
            .get_or_default_mut(guid)
            .delete_request = Some(EntityDeleteRequest::Unconditional);
        self.entities.record_mutation(guid);
    }

    /// Applies SmartBox's three-way instance-timestamp disposition: exact deletes apply, future
    /// deletes queue, and stale deletes cannot retire a later instance.
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
        if disposition == EntityInstanceDeleteDisposition::Applied {
            self.retire_entity_storage(guid);
        }
        self.entities.record_mutation(guid);
        disposition
    }

    /// Reconciles a create against a queued delete without letting stale delete traffic win.
    fn reconcile_entity_delete_after_create(&mut self, guid: Guid) -> bool {
        let Some(instance_sequence) = self.entities.get(guid).map(Entity::instance_sequence) else {
            return false;
        };
        let mut applies_to_instance = false;
        if let Some(state) = self.entity_lifecycle.get_mut(guid) {
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
        if applies_to_instance {
            self.retire_entity_storage(guid);
        }
        applies_to_instance
    }

    pub(crate) fn request_unretained_entity_prune(&mut self, guid: Guid, deadline: f64) {
        if self.inventory_removal_pending(guid) {
            return;
        }
        self.entity_lifecycle.get_or_default_mut(guid).prune_request = Some(EntityPruneRequest {
            reason: EntityPruneReason::Unretained,
            deadline,
        });
    }

    pub(crate) fn clear_entity_prune_request(&mut self, guid: Guid) {
        if let Some(state) = self.entity_lifecycle.get_mut(guid) {
            state.prune_request = None;
        }
        self.entity_lifecycle.compact(guid);
    }

    pub(super) fn clear_entity_prune_reason(&mut self, guid: Guid, reason: EntityPruneReason) {
        if self
            .entity_lifecycle_state(guid)
            .and_then(|state| state.prune_request)
            .is_some_and(|request| request.reason == reason)
        {
            self.clear_entity_prune_request(guid);
        }
    }

    pub(crate) fn mark_trade_preview(&mut self, guid: Guid) {
        self.entity_lifecycle.get_or_default_mut(guid).trade_preview = true;
    }

    pub(crate) fn clear_trade_preview(&mut self, guid: Guid) {
        if let Some(state) = self.entity_lifecycle.get_mut(guid) {
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
        if let Some(state) = self.entity_lifecycle.get_mut(guid) {
            state.container_preview = false;
        }
        self.entity_lifecycle.compact(guid);
    }

    /// Preserve a known item involved in external storage until its dispatched move resolves.
    /// ACE pickup completion sends containment, not a replacement item description.
    pub fn retain_inventory_transfer(&mut self, guid: Guid) {
        self.entity_lifecycle
            .get_or_default_mut(guid)
            .inventory_transfer_requests += 1;
    }

    /// Release one request after success, rejection, or failed send. Other requests still retain it.
    pub fn finish_inventory_transfer(&mut self, guid: Guid) {
        let Some(state) = self.entity_lifecycle.get_mut(guid) else {
            return;
        };
        if state.inventory_transfer_requests == 0 {
            return;
        }
        state.inventory_transfer_requests -= 1;
        if state.inventory_transfer_requests != 0 {
            return;
        }
        self.prune_finished_inventory_transfer(guid);
    }

    fn prune_finished_inventory_transfer(&mut self, guid: Guid) {
        self.entity_lifecycle.compact(guid);
        let contents: Vec<_> = std::iter::once(guid)
            .chain(self.storage.owned_items(guid))
            .collect();
        self.mark_container_preview_entities_for_prune(&contents);
    }

    /// Character/session teardown abandons requests that can no longer complete here.
    pub fn clear_inventory_transfers(&mut self) {
        let pending: Vec<_> = self
            .entity_lifecycle
            .by_guid
            .iter()
            .filter_map(|(&guid, state)| (state.inventory_transfer_requests != 0).then_some(guid))
            .collect();
        for guid in pending {
            self.entity_lifecycle
                .get_or_default_mut(guid)
                .inventory_transfer_requests = 0;
            self.prune_finished_inventory_transfer(guid);
        }
    }

    fn has_pending_inventory_transfer(&self, guid: Guid) -> bool {
        let mut current = Some(guid);
        while let Some(guid) = current {
            if self
                .entity_lifecycle
                .get(guid)
                .is_some_and(|state| state.inventory_transfer_requests != 0)
            {
                return true;
            }
            // Follow accepted storage links; no separate request-owned containment graph.
            current = self
                .storage
                .location(guid)
                .map(|location| location.parent());
        }
        false
    }

    pub(crate) fn retention_snapshot(
        &self,
        guid: Guid,
        now: f64,
    ) -> Option<EntityRetentionSnapshot> {
        let entity = self.entities.get(guid)?;
        let container_id = entity.container_id();
        let open_container = self.is_world_container_content(guid);
        let lifecycle = self.entity_lifecycle.get(guid);
        let container_preview = lifecycle.is_some_and(|state| state.container_preview);

        let in_world = self.is_entity_world_participant(guid);

        Some(EntityRetentionSnapshot {
            in_world,
            held_by_player: self.is_in_player_inventory(guid),
            equipped_by_player: self.is_equipped_item(guid),
            inside_open_container: open_container,
            has_container_owner: container_id.is_some() && (!container_preview || open_container),
            has_wielder_owner: entity.wielder_id().is_some_and(|wielder| {
                self.entities.get(wielder).is_some() && (entity.attachment().is_none() || in_world)
            }),
            has_parent_owner: entity.attachment().is_some_and(|_| in_world),
            trade_preview: lifecycle.is_some_and(|state| state.trade_preview),
            container_preview,
            inventory_transfer_pending: self.has_pending_inventory_transfer(guid),
            inventory_removal_pending: self.inventory_removal_pending(guid),
            current_instance_delete_requested: self.current_instance_delete_requested(guid),
            prune_request_expired: lifecycle
                .and_then(|state| state.prune_request)
                .is_some_and(|request| request.deadline <= now),
        })
    }

    pub(crate) fn reconcile_entity_retention(
        &mut self,
        guid: Guid,
    ) -> Option<EntityRetentionSnapshot> {
        // Accepted storage declarations re-admit a retained description. Old description IIDs
        // alone cannot cancel inventory removal.
        if self.storage.location(guid).is_some() {
            self.clear_entity_prune_reason(guid, EntityPruneReason::InventoryRemoval);
        }
        let snapshot = self.retention_snapshot(guid, self.current_server_time())?;
        if snapshot.inventory_removal_pending {
            return Some(snapshot);
        }
        if snapshot.has_nonworld_retention() {
            self.clear_entity_prune_request(guid);
        } else if snapshot.is_retained() {
            self.clear_entity_prune_reason(guid, EntityPruneReason::Unretained);
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

        if snapshot.inventory_removal_pending {
            return snapshot.prune_request_expired;
        }

        if snapshot.has_nonworld_retention() {
            return false;
        }

        snapshot.prune_request_expired
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
        self.entities
            .get(guid)
            .is_some_and(|entity| !self.entity_description_withdrawn(entity))
    }

    pub(super) fn current_instance_delete_requested(&self, guid: Guid) -> bool {
        self.entities
            .get(guid)
            .is_some_and(|entity| self.instance_delete_applies(entity))
    }

    /// Test deletion against the retained incarnation already borrowed by the caller.
    /// Placement and visible-entity queries must not repeat identity lookups to inspect its sequence.
    pub(super) fn instance_delete_applies(&self, entity: &Entity) -> bool {
        self.entity_lifecycle.get(entity.guid).is_some_and(|state| {
            state
                .delete_request
                .is_some_and(|request| request.applies_to(entity.instance_sequence()))
        })
    }

    pub fn is_entity_world_participant(&self, guid: Guid) -> bool {
        matches!(
            self.resolve_scene_placement(guid),
            Ok(crate::ResolvedScenePlacement::Independent
                | crate::ResolvedScenePlacement::Attached { .. })
        )
    }

    pub fn get_visible_entity(&self, guid: Guid) -> Option<&Entity> {
        self.entities
            .get_filtered(guid, |entity| !self.entity_description_withdrawn(entity))
    }

    pub fn iter_visible_entities(&self) -> impl Iterator<Item = &Entity> + '_ {
        self.entities
            .iter_filtered(move |entity| !self.entity_description_withdrawn(entity))
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

    fn visibility_maintenance_fingerprint(
        &self,
        collision_topology: Option<(u64, u64)>,
    ) -> VisibilityMaintenanceFingerprint {
        let player_landblock = self
            .local_player_runtime_pose()
            .filter(|pose| pose.landblock_id != Guid::NULL)
            .map(|pose| pose.landblock_id);
        let trade_signature = self.trade.as_ref().map(|trade| {
            use std::hash::{Hash as _, Hasher as _};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            trade.self_side.items.hash(&mut hasher);
            trade.partner_side.items.hash(&mut hasher);
            (trade.revision, hasher.finish())
        });
        VisibilityMaintenanceFingerprint {
            collision_topology,
            player_guid: self.player.guid,
            player_landblock,
            entities_cursor: self.entities.mutation_cursor(),
            lifecycle_revision: self.entity_lifecycle.revision(),
            storage_revision: self.storage.revision(),
            world_container_root: self.world_container.root(),
            trade_signature,
        }
    }

    /// Advances lifecycle cleanup using explicit static scene coverage; absence never proves exclusion.
    pub fn tick(&mut self, collision: Option<&CollisionScene>) -> Vec<WorldEvent> {
        self.seed_scene_placements();
        let mut events = Vec::new();
        let now = self.current_server_time();
        let collision_topology = collision.map(|scene| (scene.lineage(), scene.revision()));
        let initial_fingerprint = self.visibility_maintenance_fingerprint(collision_topology);
        let visibility_dirty_before =
            self.last_visibility_fingerprint.as_ref() != Some(&initial_fingerprint);
        let mut visibility = if visibility_dirty_before {
            let snapshot = VisibilitySnapshot::capture(self, collision);
            self.invalidate_unavailable_visibility(&snapshot);
            Some(snapshot)
        } else {
            None
        };

        self.sweep_eviction_queue(now, &mut events);
        self.prepare_deferred_entity_messages(&mut events);

        let mutations = self.entities.take_mutations();
        let placement_scope =
            if self.player.guid != self.entity_dependencies.last_reconciled_player_guid {
                self.entity_dependencies.last_reconciled_player_guid = self.player.guid;
                self.entities.clear_mutations();
                ScenePlacementScope::All
            } else {
                ScenePlacementScope::ChangedEntities(mutations)
            };
        self.reconcile_scene_placements(&mut events, placement_scope);

        let post_fingerprint = self.visibility_maintenance_fingerprint(collision_topology);
        if visibility.is_some() || post_fingerprint != initial_fingerprint {
            let snapshot = match visibility.take() {
                Some(snapshot) if post_fingerprint == initial_fingerprint => snapshot,
                _ => VisibilitySnapshot::capture(self, collision),
            };
            self.maintain_entity_prune_requests(now, &snapshot);
            self.last_visibility_fingerprint =
                Some(self.visibility_maintenance_fingerprint(collision_topology));
        }

        events
    }

    pub(crate) fn upsert_entity_from_create(
        &mut self,
        mut entity: Entity,
        events: &mut Vec<WorldEvent>,
    ) -> EntityCreateDisposition {
        let guid = entity.guid;
        self.clear_entity_prune_reason(guid, EntityPruneReason::InventoryRemoval);
        // A same-incarnation refresh cannot undo a witnessed local death or restart its cursor.
        let preserve_death = guid == self.player.guid
            && self.player_is_dead()
            && self.entities.get(guid).is_some_and(|previous| {
                previous.instance_sequence() == entity.instance_sequence()
                    && !holtburger_common::sequence::is_newer_u16(
                        entity.teleport_sequence(),
                        self.player.teleport_sequence,
                    )
            });
        if preserve_death && let Some(previous) = self.entities.get(guid) {
            entity.preserve_death_motion_from(previous);
        }
        if guid == self.player.guid
            && !preserve_death
            && let Some(style) = entity
                .network_motion
                .snapshot()
                .and_then(|motion| motion.current_style)
        {
            self.player
                .update_last_server_motion_style(style.interpreted());
        }
        if entity.position.landblock_id != Guid::NULL {
            entity.position = recover_pose_orientation(
                guid,
                entity.position,
                self.entities
                    .get(guid)
                    .map(|current| current.position.rotation),
            );
        }
        if let Some(previous) = self.entities.get(guid)
            && previous.instance_sequence() == entity.instance_sequence()
        {
            // Same-incarnation descriptions must not restart timing, lose retained health, or replay death edges.
            entity.summon_observation = previous.summon_observation.clone();
            entity.health = previous.health;
            if entity
                .network_motion
                .snapshot()
                .is_some_and(|motion| motion.indicates_death_motion())
            {
                entity.summon_observation.ended = true;
            }
        }
        self.reconcile_pending_visual_description_for_create(&mut entity);
        // A public object description does not replace the local player's private qualities.
        if guid == self.player.guid
            && let Some(current) = self.entities.get(guid)
        {
            self.player
                .property_retention
                .retain_into(&current.properties, &mut entity.properties);
        }

        let preserve_container_preview = self
            .entity_lifecycle
            .get(guid)
            .is_some_and(|state| state.container_preview)
            || self.is_world_container_content(guid);

        if !preserve_container_preview || self.is_world_container_content(guid) {
            self.clear_entity_prune_request(guid);
        }
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
            let snapshot = self
                .entities
                .get(guid)
                .and_then(|entity| entity.network_motion.snapshot());
            if !preserve_death {
                self.reset_authored_motion(guid, snapshot);
            }
            EntityCreateDisposition::Active
        }
    }

    fn reconcile_pending_visual_description_for_create(&mut self, entity: &mut Entity) {
        let Some(state) = self.entity_lifecycle.get_mut(entity.guid) else {
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

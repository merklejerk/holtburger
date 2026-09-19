//! Confirmed external storage access, independent of roster hydration and window state.

use holtburger_common::{Guid, properties::WorldObjectExt};
use serde::{Deserialize, Serialize};

use crate::WorldState;

/// One external storage root whose use has been confirmed by a contents response.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WorldContainerState {
    /// No external contents may be accessed through a container session.
    #[default]
    Closed,
    /// Access follows accepted storage relationships beneath this root.
    Open {
        /// Server-confirmed external root; child rosters never replace it.
        root: Guid,
    },
}

impl WorldContainerState {
    /// Identity consumed by request coordination and frontend current-container views.
    pub fn root(self) -> Option<Guid> {
        match self {
            Self::Closed => None,
            Self::Open { root } => Some(root),
        }
    }
}

impl WorldState {
    /// Current confirmed access, separate from whether any particular roster is known.
    pub fn world_container(&self) -> WorldContainerState {
        self.world_container
    }

    /// Root or descendant available through the current external access lifetime.
    pub fn has_world_container_access(&self, guid: Guid) -> bool {
        self.world_container
            .root()
            .is_some_and(|root| guid == root || self.storage.owned_by(guid, root))
    }

    /// Contents eligible for external access; excludes the root itself.
    pub fn is_world_container_content(&self, guid: Guid) -> bool {
        self.world_container
            .root()
            .is_some_and(|root| self.storage.owned_by(guid, root))
    }

    /// Announced descendants, including pending descriptions, for admission/publication.
    pub fn world_container_contents(&self) -> impl Iterator<Item = Guid> + '_ {
        self.world_container
            .root()
            .into_iter()
            .flat_map(|root| self.storage.owned_items(root))
    }

    /// Core calls this only after correlating a root roster with a dispatched use.
    pub fn confirm_world_container(&mut self, root: Guid) {
        if self.world_container.root() == Some(root) {
            return;
        }
        self.close_world_container();
        self.world_container = WorldContainerState::Open { root };
        let contents: Vec<_> = self.world_container_contents().collect();
        for guid in contents {
            self.mark_container_preview(guid);
            let _ = self.reconcile_entity_retention(guid);
        }
    }

    /// Uses canonical body poses and authored setup dimensions, independently of rendering.
    /// Missing preparation is unknown, not evidence that access range was exceeded.
    /// RETAIL DIVERGENCE: acclient.c:417918 reports out of range when a physics object is
    /// absent. Applying that rule to asynchronous shared geometry preparation would revoke
    /// confirmed access during loading. Caller census: only the external-root range poll;
    /// unknown geometry neither grants access nor restores previously revoked access.
    pub fn within_use_radius(&self, actor: Guid, target: Guid) -> Option<bool> {
        let target_entity = self.get_visible_entity(target)?;
        let distance = self.physical_cylinder_distance(actor, target)?;
        // ACE WorldObject_Use.cs::IsWithinUseRadiusOf supplies 0.6 when not authored.
        Some(f64::from(distance) <= target_entity.use_radius().unwrap_or(0.6))
    }

    /// ACE-compatible separation between two prepared physical cylinders.
    ///
    /// This is a shared geometry fact. Callers choose the interaction-specific reach threshold.
    pub fn physical_cylinder_distance(&self, actor: Guid, target: Guid) -> Option<f32> {
        let actor_body = self.scene.body_for_guid(actor)?;
        let target_body = self.scene.body_for_guid(target)?;
        let actor_geometry = actor_body.physical.as_ref()?.dynamic.as_ref()?;
        let target_geometry = target_body.physical.as_ref()?.dynamic.as_ref()?;
        let actor_setup = &actor_geometry.collision.target_geometry;
        let target_setup = &target_geometry.collision.target_geometry;
        Some(use_cylinder_distance(
            actor_body.pose.distance_to(&target_body.pose),
            actor_body.pose.coords.z,
            actor_setup.setup_radius * actor_geometry.object_scale,
            actor_setup.setup_height * actor_geometry.object_scale,
            target_body.pose.coords.z,
            target_setup.setup_radius * target_geometry.object_scale,
            target_setup.setup_height * target_geometry.object_scale,
        ))
    }

    /// Retire access before storage links disappear so pending descendants are released too.
    pub(crate) fn retire_entity_storage(&mut self, guid: Guid) {
        if self.world_container.root() == Some(guid) {
            // Removal callers publish the resulting state; no close acknowledgement is required
            // for a root which the server has deleted or world retention has retired.
            self.close_world_container();
        }
        self.storage.retire(guid);
    }

    /// Revoke access without destroying relationships or items retained by another owner.
    pub fn close_world_container(&mut self) {
        if self.world_container == WorldContainerState::Closed {
            return;
        }
        let contents: Vec<_> = self.world_container_contents().collect();
        self.world_container = WorldContainerState::Closed;
        self.mark_container_preview_entities_for_prune(&contents);
    }
}

/// ACE Physics/Common/Position.cs::CylinderDistance (retail acclient.c:446301).
/// Reach uses the full three-dimensional offset, not horizontal separation. Replacing it
/// with conventional cylinder separation changes the server's vertical use-range boundary.
fn use_cylinder_distance(
    origin_distance: f32,
    z: f32,
    radius: f32,
    height: f32,
    other_z: f32,
    other_radius: f32,
    other_height: f32,
) -> f32 {
    let reach = origin_distance - (radius + other_radius);
    let vertical_gap = if z <= other_z {
        other_z - (z + height)
    } else {
        z - (other_z + other_height)
    };
    if vertical_gap > 0.0 && reach > 0.0 {
        vertical_gap.hypot(reach)
    } else if vertical_gap < 0.0 && reach < 0.0 {
        -vertical_gap.hypot(reach)
    } else {
        reach
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WorldEvent;
    use crate::{context::WorldContextExt, entity_facts::EntityDescription};
    use holtburger_common::properties::{InventoryEntryKind, ItemType};
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, InventoryPutObjInContainerEventData,
        ObjectDescriptionData, ViewContentsEventData, ViewContentsEventItem,
    };

    const PLAYER: Guid = Guid(0x50000001);
    const ROOT: Guid = Guid(0x80000001);
    const PACK: Guid = Guid(0x80000002);
    const ITEM: Guid = Guid(0x80000003);

    fn event(world: &mut WorldState, event: GameEvent) -> Vec<WorldEvent> {
        world.handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: PLAYER,
            sequence: 0,
            event,
        })))
    }

    fn roster(world: &mut WorldState, parent: Guid, items: &[(Guid, InventoryEntryKind)]) {
        event(
            world,
            GameEvent::ViewContents(Box::new(ViewContentsEventData {
                container: parent,
                items: items
                    .iter()
                    .map(|&(guid, container_type)| ViewContentsEventItem {
                        guid,
                        container_type,
                    })
                    .collect(),
            })),
        );
    }

    fn describe(world: &mut WorldState, guid: Guid, parent: Guid) {
        let mut description = ObjectDescriptionData::with_guid(guid);
        description.public_weenie_desc.name = Some("Stored item".into());
        description.public_weenie_desc.item_type = ItemType::MISC.bits();
        description.public_weenie_desc.container_id = Some(parent);
        world.handle_message(&GameMessage::ObjectCreate(Box::new(description)));
    }

    fn fixture() -> WorldState {
        let mut world = WorldState::synthetic();
        world.player.guid = PLAYER;
        roster(&mut world, ROOT, &[(PACK, InventoryEntryKind::Container)]);
        roster(&mut world, PACK, &[(ITEM, InventoryEntryKind::Item)]);
        world
    }

    #[test]
    fn accepted_root_deletion_releases_pending_subtree_before_retiring_links() {
        let mut world = fixture();
        describe(&mut world, ROOT, Guid::NULL);
        world.confirm_world_container(ROOT);
        let delete = |sequence| {
            GameMessage::ObjectDelete(Box::new(holtburger_protocol::messages::ObjectDeleteData {
                guid: ROOT,
                instance_sequence: sequence,
            }))
        };
        // A future-instance delete must not retire the current root.
        world.handle_message(&delete(1));
        assert_eq!(world.world_container().root(), Some(ROOT));
        world.handle_message(&delete(0));
        assert_eq!(world.world_container(), WorldContainerState::Closed);
        assert!(world.client_entity_facts(ITEM).unwrap().is_none());
        describe(&mut world, ITEM, PACK);
        assert!(!world.is_world_container_content(ITEM));
        assert!(world.client_entity_facts(ITEM).unwrap().is_none());
    }

    #[test]
    fn root_eviction_and_transfer_revoke_access_without_losing_owned_subtrees() {
        let mut world = fixture();
        describe(&mut world, ROOT, Guid::NULL);
        world.confirm_world_container(ROOT);
        world.remove_entity(ROOT);
        assert_eq!(world.world_container(), WorldContainerState::Closed);
        assert!(world.client_entity_facts(ITEM).unwrap().is_none());

        let mut world = fixture();
        world.confirm_world_container(ROOT);
        event(
            &mut world,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: ROOT,
                container_guid: PLAYER,
                slot: 0,
                container_type: InventoryEntryKind::Container,
            })),
        );
        assert_eq!(world.world_container(), WorldContainerState::Closed);
        assert!(world.is_owned_by_player(ITEM));
        assert!(world.client_entity_facts(ITEM).unwrap().is_some());
    }

    #[test]
    fn cylinder_use_distance_preserves_server_vertical_and_overlap_branches() {
        assert_eq!(
            use_cylinder_distance(4.0, 0.0, 0.5, 2.0, 0.0, 0.5, 2.0),
            3.0
        );
        assert_eq!(
            use_cylinder_distance(5.0, 0.0, 0.5, 1.0, 4.0, 0.5, 2.0),
            5.0
        );
        assert_eq!(
            use_cylinder_distance(5.0, 4.0, 0.5, 2.0, 0.0, 0.5, 1.0),
            5.0
        );
        assert_eq!(
            use_cylinder_distance(0.0, 0.0, 0.5, 1.0, 0.0, 0.5, 1.0),
            -2.0_f32.sqrt()
        );
    }

    #[test]
    fn in_flight_pack_retains_descriptions_but_not_closed_access_until_all_requests_resolve() {
        let mut world = fixture();
        describe(&mut world, PACK, ROOT);
        describe(&mut world, ITEM, PACK);
        world.confirm_world_container(ROOT);
        world.retain_inventory_transfer(PACK);
        world.retain_inventory_transfer(PACK);
        world.close_world_container();
        world.tick();
        for guid in [PACK, ITEM] {
            assert!(world.entities.get(guid).is_some());
            assert!(world.client_entity_facts(guid).unwrap().is_none());
            assert!(crate::interaction::pickup_candidate(&world, guid).is_none());
        }
        let reject = GameEvent::InventoryServerSaveFailed(Box::new(
            holtburger_protocol::messages::InventoryServerSaveFailedEventData {
                item_guid: PACK,
                error: holtburger_protocol::errors::WeenieError::YoureTooBusy,
            },
        ));
        event(&mut world, reject.clone());
        world.tick();
        assert!(world.entities.get(ITEM).is_some());
        event(&mut world, reject);
        // Explicitly sweep the child before its parent; cleanup must not rely on hash order.
        assert!(world.sweep_entity(ITEM, world.current_server_time(), &mut Vec::new()));
        assert!(world.sweep_entity(PACK, world.current_server_time(), &mut Vec::new()));
    }

    #[test]
    fn completed_pack_pickup_preserves_retained_subtree_and_session_reset_releases_abandoned_moves()
    {
        for succeeds in [true, false] {
            let mut world = fixture();
            describe(&mut world, PACK, ROOT);
            describe(&mut world, ITEM, PACK);
            world.confirm_world_container(ROOT);
            world.retain_inventory_transfer(PACK);
            world.close_world_container();
            world.tick();
            if succeeds {
                event(
                    &mut world,
                    GameEvent::InventoryPutObjInContainer(Box::new(
                        InventoryPutObjInContainerEventData {
                            item_guid: PACK,
                            container_guid: PLAYER,
                            slot: 0,
                            container_type: InventoryEntryKind::Container,
                        },
                    )),
                );
                world.tick();
                for guid in [PACK, ITEM] {
                    let facts = world.client_entity_facts(guid).unwrap().unwrap();
                    assert!(facts.owned_by_player);
                    assert!(matches!(facts.description, EntityDescription::Known { .. }));
                }
            } else {
                world.clear_inventory_transfers();
                assert!(world.sweep_entity(ITEM, world.current_server_time(), &mut Vec::new()));
                assert!(world.sweep_entity(PACK, world.current_server_time(), &mut Vec::new()));
            }
        }
    }

    #[test]
    fn root_confirmation_admits_pending_descendants_without_child_rosters_switching_access() {
        let mut world = fixture();
        assert_eq!(world.world_container(), WorldContainerState::Closed);
        assert!(world.client_entity_facts(ITEM).unwrap().is_none());
        world.confirm_world_container(ROOT);
        let pending = world
            .client_entity_facts(ITEM)
            .unwrap()
            .expect("announced descendant");
        assert_eq!(pending.description, EntityDescription::Pending);
        assert!(!pending.can_pick_up);
        roster(&mut world, PACK, &[(ITEM, InventoryEntryKind::Item)]);
        assert_eq!(world.world_container().root(), Some(ROOT));
        describe(&mut world, ITEM, PACK);
        assert!(
            world
                .client_entity_facts(ITEM)
                .unwrap()
                .unwrap()
                .can_pick_up
        );
        assert!(world.is_world_container_content(ITEM));
        assert!(
            world
                .current_usable_location_flags(ITEM, None)
                .contains(holtburger_common::properties::Usable::VIEWED)
        );
        world.close_world_container();
        assert!(
            !world
                .current_usable_location_flags(ITEM, None)
                .contains(holtburger_common::properties::Usable::VIEWED)
        );
    }

    #[test]
    fn description_before_roster_becomes_accessible_only_after_confirmation() {
        let mut world = WorldState::synthetic();
        describe(&mut world, ITEM, ROOT);
        assert!(crate::interaction::pickup_candidate(&world, ITEM).is_none());
        roster(&mut world, ROOT, &[(ITEM, InventoryEntryKind::Item)]);
        world.confirm_world_container(ROOT);
        assert!(crate::interaction::pickup_candidate(&world, ITEM).is_some());
    }

    #[test]
    fn close_before_first_description_does_not_readmit_late_contents() {
        let mut world = fixture();
        world.confirm_world_container(ROOT);
        world.close_world_container();
        assert!(world.client_entity_facts(ITEM).unwrap().is_none());
        describe(&mut world, ITEM, PACK);
        assert!(world.client_entity_facts(ITEM).unwrap().is_none());
        assert!(crate::interaction::pickup_candidate(&world, ITEM).is_none());
        world.sweep_eviction_queue(world.current_server_time(), &mut Vec::new());
        assert!(world.entities.get(ITEM).is_none());
    }

    #[test]
    fn whole_pack_transfer_survives_former_root_closure_including_pending_children() {
        let mut world = fixture();
        world.confirm_world_container(ROOT);
        describe(&mut world, PACK, ROOT);
        event(
            &mut world,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: PACK,
                container_guid: PLAYER,
                slot: 0,
                container_type: InventoryEntryKind::Container,
            })),
        );
        world.close_world_container();
        roster(&mut world, ROOT, &[]);
        assert!(world.is_owned_by_player(PACK));
        assert!(world.is_owned_by_player(ITEM));
        assert!(world.client_entity_facts(ITEM).unwrap().is_some());
        describe(&mut world, ITEM, PACK);
        world.sweep_eviction_queue(world.current_server_time(), &mut Vec::new());
        assert!(world.entities.get(ITEM).is_some());
        assert!(!world.is_world_container_content(ITEM));
    }

    #[test]
    fn roster_withdrawal_releases_a_former_pack_subtree() {
        let mut world = fixture();
        world.confirm_world_container(ROOT);
        describe(&mut world, PACK, ROOT);
        describe(&mut world, ITEM, PACK);
        roster(&mut world, ROOT, &[]);
        assert!(world.client_entity_facts(ITEM).unwrap().is_none());
        // Pruning is deferred; each withdrawn identity is independently eligible.
        for guid in [ITEM, PACK] {
            assert!(world.sweep_entity(guid, world.current_server_time(), &mut Vec::new()));
        }
    }

    #[test]
    fn closure_preserves_trade_retention_without_granting_pickup() {
        let mut world = fixture();
        world.confirm_world_container(ROOT);
        describe(&mut world, ITEM, PACK);
        world.mark_trade_preview(ITEM);
        world.close_world_container();
        world.sweep_eviction_queue(world.current_server_time(), &mut Vec::new());
        assert!(world.entities.get(ITEM).is_some());
        assert!(
            !world
                .client_entity_facts(ITEM)
                .unwrap()
                .unwrap()
                .can_pick_up
        );
    }

    #[test]
    fn replacement_roster_does_not_restore_former_contents_on_reopening() {
        let mut world = fixture();
        world.confirm_world_container(ROOT);
        describe(&mut world, ITEM, PACK);
        world.close_world_container();
        roster(&mut world, ROOT, &[]);
        world.confirm_world_container(ROOT);
        assert!(!world.is_world_container_content(ITEM));
        assert!(crate::interaction::pickup_candidate(&world, ITEM).is_none());
        assert!(world.client_entity_facts(ITEM).unwrap().is_none());
    }
}

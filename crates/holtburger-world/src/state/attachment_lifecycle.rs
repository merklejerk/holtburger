//! World-owned attachment messages, dependency reconciliation and scene transitions.

use crate::{PhysicsAttachment, ResolvedScenePlacement, WorldEvent, WorldState};
use holtburger_common::sequence::is_newer_u16;
use holtburger_common::{Guid, ParentLocation, Placement, Vector3};
use holtburger_protocol::messages::object::messages::description::PhysicsChildData;
use holtburger_protocol::messages::{ParentEventData, PickupEventData, UpdatePositionData};
use std::collections::{HashMap, VecDeque};

/// A parent's announcement that some object hangs from one of its attach points.
///
/// The parent knows where the child hangs but not which pose the child adopts, so `placement`
/// comes from the child's own description when it arrives.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct AnnouncedAttachment {
    /// Parent supplying the attachment-location hint.
    pub(crate) parent: Guid,
    /// Attach point; the child description supplies its own placement.
    pub(crate) location: ParentLocation,
    /// Missing-child lifetime, matching retail's placeholder destruction scheduling.
    pub(crate) deadline: f64,
}

/// Attachment-specific input which cannot yet be applied to its intended endpoint.
#[derive(Debug, Clone)]
pub(crate) enum DeferredPlacementMessage {
    /// Parent instance and child position are separate sequence domains.
    Parent(ParentEventData),
    /// Pickup cannot retire a missing or future object incarnation early.
    Pickup(PickupEventData),
    /// Independent position shares the child timestamp and can supersede attachment intent.
    Position(UpdatePositionData),
}

/// A queued relationship transition with a bounded missing-dependency lifetime.
#[derive(Debug)]
struct DeferredPlacementEntry {
    /// Original typed input, interpreted only once its prerequisites are available.
    message: DeferredPlacementMessage,
    /// The endpoint whose arrival permits another admission attempt.
    waiting: PlacementWait,
}

/// Missing endpoints expire; future incarnations of retained endpoints share their data lifetime.
#[derive(Debug, Clone, Copy)]
enum PlacementWait {
    Missing { guid: Guid, deadline: f64 },
    FutureInstance { guid: Guid },
}

impl PlacementWait {
    fn guid(self) -> Guid {
        match self {
            Self::Missing { guid, .. } | Self::FutureInstance { guid } => guid,
        }
    }

    fn expired(self, now: f64) -> bool {
        matches!(self, Self::Missing { deadline, .. } if now >= deadline)
    }
}

/// One owner for parent announcements, delayed transitions and scene-change detection.
#[derive(Debug, Default)]
pub(crate) struct AttachmentLifecycle {
    /// Parent-supplied hints consumed when a child description arrives.
    pub announcements: HashMap<Guid, AnnouncedAttachment>,
    /// Preserve arrival order; sequence gates are rechecked when endpoints become available.
    pending: VecDeque<DeferredPlacementEntry>,
    /// Last reconciled incarnation/placement, used only to emit placement transitions once.
    reconciled: HashMap<Guid, (u16, ResolvedScenePlacement)>,
}

impl WorldState {
    /// End missing-endpoint lifetimes before new input can refer to a fresh placeholder.
    pub(crate) fn expire_missing_placement_dependencies(&mut self) {
        let now = self.current_server_time();
        self.attachments
            .announcements
            .retain(|_, link| now < link.deadline);
        self.attachments
            .pending
            .retain(|entry| !entry.waiting.expired(now));
    }

    /// Withdraw old relationships omitted by a replacement's complete child description.
    /// Listed children are rebound below while retaining their own authored pose.
    pub(crate) fn withdraw_replaced_parent_children(
        &mut self,
        parent: Guid,
        children: Option<&[PhysicsChildData]>,
    ) {
        // Retail SetChildren first unparents the previous children (acclient.c:299698).
        // Replacement must not bind previous-generation relationships to the new parent data.
        let old_children: Vec<_> = self
            .entities
            .iter()
            .filter(|entity| {
                entity
                    .attachment()
                    .is_some_and(|attachment| attachment.parent == parent)
                    && !children
                        .into_iter()
                        .flatten()
                        .any(|child| child.guid == entity.guid)
            })
            .map(|entity| entity.guid)
            .collect();
        for child in old_children {
            self.entities
                .get_mut(child)
                .expect("collected child")
                .set_attachment(None);
        }
        self.attachments.announcements.retain(|guid, link| {
            link.parent != parent
                || children
                    .into_iter()
                    .flatten()
                    .any(|child| child.guid == *guid)
        });
    }

    /// Record the children a parent announced, applying each one that has already arrived.
    ///
    /// A parent may name children the client has not received yet. Retail answers that with
    /// placeholder objects (`CObjectMaint::SetChildren`); we keep the link and apply it on arrival,
    /// which avoids a second object lifetime authority alongside the entity store.
    pub(crate) fn retain_announced_children(
        &mut self,
        parent: Guid,
        children: Option<&[PhysicsChildData]>,
    ) {
        let Some(children) = children else {
            return;
        };
        for child in children {
            let Some(location) = ParentLocation::from_key(child.location_id) else {
                log::warn!(
                    "Object {parent:?} announced child {:?} at unknown attach point {}",
                    child.guid,
                    child.location_id
                );
                continue;
            };
            // A present child supplies its own pose and needs no missing-object deadline.
            if let Some(existing) = self.entities.get(child.guid) {
                let placement = existing
                    .attachment()
                    .map_or(Placement::Default, |attachment| attachment.placement);
                self.attach_child_to(
                    child.guid,
                    PhysicsAttachment {
                        parent,
                        location,
                        placement,
                    },
                );
                continue;
            }
            let link = AnnouncedAttachment {
                parent,
                location,
                // GetNullObject schedules only a newly-created placeholder. Reannouncing an
                // existing missing child does not refresh it (acclient.c:299511, 299698).
                deadline: self
                    .attachments
                    .announcements
                    .get(&child.guid)
                    .map(|link| link.deadline)
                    .or_else(|| {
                        self.attachments
                            .pending
                            .iter()
                            .find_map(|entry| match entry.waiting {
                                PlacementWait::Missing { guid, deadline } if guid == child.guid => {
                                    Some(deadline)
                                }
                                _ => None,
                            })
                    })
                    .unwrap_or_else(|| {
                        self.current_server_time() + super::liveness::ACE_DESTRUCTION_TIMEOUT_SECS
                    }),
            };

            self.attachments.announcements.insert(child.guid, link);
        }
    }

    /// Apply an announcement that arrived before its child did.
    ///
    /// The child's own description wins when it names an attachment: it carries both the attach
    /// point and the pose, where the announcement carries only the attach point.
    pub(crate) fn resolve_announced_attachment(&mut self, guid: Guid, placement_key: u32) {
        let Some(link) = self.attachments.announcements.remove(&guid) else {
            return;
        };
        if self.current_server_time() >= link.deadline {
            return;
        }
        if self
            .entities
            .get(guid)
            .is_none_or(|entity| entity.attachment().is_some())
        {
            return;
        }
        let Some(placement) = Placement::from_key(placement_key) else {
            log::warn!("Child {guid:?} arrived with unknown placement {placement_key}");
            return;
        };
        self.attach_child_to(
            guid,
            PhysicsAttachment {
                parent: link.parent,
                location: link.location,
                placement,
            },
        );
    }

    fn attach_child_to(&mut self, guid: Guid, attachment: PhysicsAttachment) {
        let Some(entity) = self.entities.get_mut(guid) else {
            return;
        };
        entity.set_attachment(Some(attachment));
        let _ = self.reconcile_entity_retention(guid);
    }

    /// Retire input tied to a removed incarnation while preserving explicitly future input.
    pub(crate) fn retire_attachment_endpoint(&mut self, guid: Guid, instance: u16) {
        self.attachments
            .pending
            .retain(|entry| match &entry.message {
                DeferredPlacementMessage::Parent(data) => {
                    data.child_guid != guid
                        && (data.parent_guid != guid
                            || is_newer_u16(data.parent_instance_sequence, instance))
                }
                DeferredPlacementMessage::Pickup(data) => {
                    data.guid != guid || is_newer_u16(data.instance_sequence, instance)
                }
                DeferredPlacementMessage::Position(data) => {
                    data.guid != guid || is_newer_u16(data.pos.instance_sequence, instance)
                }
            });
    }

    /// Apply now or retain only this placement-specific message until its dependencies arrive.
    pub(crate) fn receive_placement_message(
        &mut self,
        message: DeferredPlacementMessage,
        events: &mut Vec<WorldEvent>,
    ) {
        if let Err(guid) = self.try_placement_message(&message, events) {
            self.defer_placement_message(message, guid);
        }
    }

    fn defer_placement_message(&mut self, message: DeferredPlacementMessage, guid: Guid) {
        let waiting = if self.entities.get(guid).is_some() {
            PlacementWait::FutureInstance { guid }
        } else {
            let now = self.current_server_time();
            let deadline = now + super::liveness::ACE_DESTRUCTION_TIMEOUT_SECS;
            // QueueBlobForObject refreshes the missing object's destruction time, not each
            // individual packet's lifetime (acclient.c:299661, 299488). Expired work stays expired.
            for entry in &mut self.attachments.pending {
                if entry.waiting.guid() == guid && !entry.waiting.expired(now) {
                    entry.waiting = PlacementWait::Missing { guid, deadline };
                }
            }
            if let Some(link) = self.attachments.announcements.get_mut(&guid)
                && now < link.deadline
            {
                link.deadline = deadline;
            }
            PlacementWait::Missing { guid, deadline }
        };
        self.attachments
            .pending
            .push_back(DeferredPlacementEntry { message, waiting });
    }

    fn try_placement_message(
        &mut self,
        message: &DeferredPlacementMessage,
        events: &mut Vec<WorldEvent>,
    ) -> Result<(), Guid> {
        let (child, instance, position) = match message {
            DeferredPlacementMessage::Parent(data) => {
                if data.parent_guid != Guid::NULL {
                    let Some(parent) = self.entities.get(data.parent_guid) else {
                        return Err(data.parent_guid);
                    };
                    if is_newer_u16(data.parent_instance_sequence, parent.instance_sequence()) {
                        return Err(data.parent_guid);
                    }
                    if data.parent_instance_sequence != parent.instance_sequence() {
                        return Ok(());
                    }
                }
                (data.child_guid, None, data.child_position_sequence)
            }
            DeferredPlacementMessage::Pickup(data) => (
                data.guid,
                Some(data.instance_sequence),
                data.position_sequence,
            ),
            DeferredPlacementMessage::Position(data) => (
                data.guid,
                Some(data.pos.instance_sequence),
                data.pos.position_sequence,
            ),
        };
        let Some(entity) = self.entities.get(child) else {
            return Err(child);
        };
        if let Some(instance) = instance {
            if is_newer_u16(instance, entity.instance_sequence()) {
                return Err(child);
            }
            if instance != entity.instance_sequence() {
                return Ok(());
            }
        }
        if !is_newer_u16(position, entity.position_sequence()) {
            return Ok(());
        }
        if let DeferredPlacementMessage::Position(data) = message {
            self.apply_entity_position_pack(child, &data.pos, events);
            return Ok(());
        }
        let attachment = match message {
            DeferredPlacementMessage::Parent(data) if data.parent_guid != Guid::NULL => {
                match PhysicsAttachment::from_wire(data.parent_guid, data.location, data.placement)
                {
                    Ok(attachment) => Some(attachment),
                    Err(error) => {
                        log::error!("ParentEvent for {child:?} has invalid attachment: {error}");
                        return Ok(());
                    }
                }
            }
            _ => None,
        };
        let entity = self
            .entities
            .get_mut(child)
            .expect("endpoint checked in this world mutation");
        entity.apply_remote_position_sequence_only(position);
        entity.set_attachment(attachment);
        if matches!(message, DeferredPlacementMessage::Pickup(_)) {
            if let Some(pos) = self.clear_entity_world_presence(child) {
                events.push(WorldEvent::EntityMoved { guid: child, pos });
            }
            let snapshot = self.reconcile_entity_retention(child);
            if snapshot.is_some_and(|retention| !retention.is_retained()) {
                self.mark_entity_explicit_delete(child);
            }
        }
        Ok(())
    }

    /// Establish observation baselines for data inserted through non-network world APIs.
    pub(crate) fn seed_scene_placements(&mut self) {
        for entity in self.entities.iter() {
            if !self.attachments.reconciled.contains_key(&entity.guid)
                && let Ok(placement) = self.resolve_scene_placement(entity.guid)
            {
                self.attachments
                    .reconciled
                    .insert(entity.guid, (entity.instance_sequence(), placement));
            }
        }
    }

    /// Recheck delayed transitions and resolve all dependent scene placements before publication.
    pub(crate) fn reconcile_scene_placements(&mut self, events: &mut Vec<WorldEvent>) {
        let now = self.current_server_time();
        self.attachments
            .announcements
            .retain(|_, link| now < link.deadline);
        // Process each existing entry once. Keeping the queue in place lets a changed missing
        // prerequisite refresh other input for that endpoint without refreshing on every tick.
        for _ in 0..self.attachments.pending.len() {
            let entry = self
                .attachments
                .pending
                .pop_front()
                .expect("counted pending entry");
            if entry.waiting.expired(now) {
                continue;
            }
            if let Err(guid) = self.try_placement_message(&entry.message, events) {
                let same_prerequisite = entry.waiting.guid() == guid
                    && matches!(entry.waiting, PlacementWait::Missing { .. })
                        == self.entities.get(guid).is_none();
                if same_prerequisite {
                    self.attachments.pending.push_back(entry);
                } else {
                    self.defer_placement_message(entry.message, guid);
                }
            }
        }
        let guids: Vec<_> = self.entities.iter().map(|entity| entity.guid).collect();
        self.attachments
            .reconciled
            .retain(|guid, _| self.entities.get(*guid).is_some());
        for guid in guids {
            let placement = match self.resolve_scene_placement(guid) {
                Ok(placement) => placement,
                Err(error) => {
                    log::error!("Cannot reconcile scene placement: {error}");
                    self.retire_authoritative_body_for_guid(guid);
                    continue;
                }
            };
            if let ResolvedScenePlacement::Attached { root, .. } = placement {
                if guid != self.player.guid {
                    let root_position = self
                        .entities
                        .get(root)
                        .expect("resolved root exists")
                        .position;
                    // Attached bodies carry delegated pose, never independent physical demand.
                    if let Some(body_id) = self.runtime_body_id_for_guid(guid)
                        && self
                            .scene
                            .body(body_id)
                            .is_some_and(|body| body.physical.is_some())
                    {
                        let initial_cell = root_position
                            .is_indoors()
                            .then_some(root_position.landblock_id);
                        let _ = self.scene.set_dynamic_physical_body(
                            body_id,
                            None,
                            crate::PhysicalCollisionFilter::ALL,
                            initial_cell,
                        );
                    }
                    let needs_body = self
                        .runtime_body_id_for_guid(guid)
                        .and_then(|body_id| self.scene.body(body_id))
                        .is_none();
                    if needs_body
                        || self.entities.get(guid).expect("retained entity").position
                            != root_position
                    {
                        self.entities
                            .get_mut(guid)
                            .expect("retained entity")
                            .position = root_position;
                        self.initialize_authoritative_body(
                            guid,
                            root_position,
                            Vector3::zero(),
                            Vector3::zero(),
                        );
                        events.push(WorldEvent::EntityMoved {
                            guid,
                            pos: root_position,
                        });
                    }
                }
            } else if matches!(placement, ResolvedScenePlacement::Unresolved(_))
                && let Some(body_id) = self.runtime_body_id_for_guid(guid)
                && self.scene.body(body_id).is_some()
            {
                self.retire_authoritative_body_for_guid(guid);
                events.push(WorldEvent::RuntimeBodyRemoved { body_id });
            }
            let generation = self
                .entities
                .get(guid)
                .expect("retained entity")
                .instance_sequence();
            if let Some((previous_generation, previous_placement)) = self
                .attachments
                .reconciled
                .insert(guid, (generation, placement))
                && (previous_generation, previous_placement) != (generation, placement)
            {
                events.push(WorldEvent::EntityScenePlacementChanged {
                    guid,
                    generation,
                    previous_generation,
                    placement,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::WorldContextExt;
    use crate::entity::Entity;
    use crate::state::ServerTimeSync;
    use crate::{EntityPlacementIntent, SpatialBodyId};
    use holtburger_common::position::WorldPosition;
    use holtburger_protocol::messages::object::messages::description::PhysicsDescParent;
    use holtburger_protocol::messages::{
        GameMessage, ObjectDescriptionData, PositionPack, UpdatePositionData, UpdatePositionFlag,
    };
    use std::time::Instant;

    fn position() -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0xda55_0001),
            ..WorldPosition::default()
        }
    }

    fn parent_event(
        parent: Guid,
        child: Guid,
        instance: u16,
        position_sequence: u16,
    ) -> GameMessage {
        GameMessage::ParentEvent(Box::new(ParentEventData {
            parent_guid: parent,
            child_guid: child,
            location: ParentLocation::RightHand as u32,
            placement: Placement::RightHandCombat as u32,
            parent_instance_sequence: instance,
            child_position_sequence: position_sequence,
        }))
    }

    fn create(world: &mut WorldState, guid: Guid, parent: Option<Guid>) -> Vec<WorldEvent> {
        let mut data = ObjectDescriptionData::with_guid(guid);
        data.pos = Some(position());
        data.parent = parent.map(|id| PhysicsDescParent {
            id,
            location_id: ParentLocation::RightHand as u32,
        });
        data.animation_frame = Some(Placement::RightHandCombat as u32);
        world.handle_message(&GameMessage::ObjectCreate(Box::new(data)))
    }

    #[test]
    fn described_child_is_retained_until_parent_admits_it_then_withdraws_on_removal() {
        let mut world = WorldState::synthetic();
        let child = Guid(1);
        let parent = Guid(2);
        create(&mut world, child, Some(parent));
        assert!(world.entities.get(child).is_some());
        assert!(!world.is_entity_world_participant(child));
        assert!(world.scene.body(SpatialBodyId::Entity(child)).is_none());
        let events = create(&mut world, parent, None);
        assert!(world.is_entity_world_participant(child));
        assert!(world.scene.body(SpatialBodyId::Entity(child)).is_some());
        assert!(events.iter().any(|event| matches!(event,
            WorldEvent::EntityScenePlacementChanged { guid, generation: 0, previous_generation: 0,
                placement: ResolvedScenePlacement::Attached { root, .. } }
                if *guid == child && *root == parent)));
        world.remove_entity(parent);
        assert_eq!(
            world.entities.get(child).unwrap().placement_intent,
            EntityPlacementIntent::Withdrawn
        );
        assert!(!world.is_entity_world_participant(child));
        create(&mut world, parent, None);
        assert!(
            !world.is_entity_world_participant(child),
            "a recreated GUID cannot revive a retired link"
        );
    }

    #[test]
    fn future_parent_event_applies_when_the_named_incarnation_arrives() {
        let mut world = WorldState::synthetic();
        world.server_time = Some(ServerTimeSync {
            server_time: 0.0,
            local_time: Instant::now(),
        });
        let child = Guid(1);
        let parent = Guid(2);
        create(&mut world, child, None);
        create(&mut world, parent, None);
        let next_instance = world
            .entities
            .get(parent)
            .unwrap()
            .instance_sequence()
            .wrapping_add(1);
        let next_position = world
            .entities
            .get(child)
            .unwrap()
            .position_sequence()
            .wrapping_add(1);
        world.handle_message(&parent_event(parent, child, next_instance, next_position));
        assert!(world.entities.get(child).unwrap().attachment().is_none());

        // Existing endpoints do not acquire a missing-object packet deadline in retail.
        world.server_time = Some(ServerTimeSync {
            server_time: super::super::liveness::ACE_DESTRUCTION_TIMEOUT_SECS + 1.0,
            local_time: Instant::now(),
        });
        let mut replacement = Entity::new(parent, "replacement".into(), position());
        replacement.apply_remote_position_sample(position(), next_instance, 0, 0);
        world.add_entity(replacement);
        world.tick();

        let entity = world.entities.get(child).unwrap();
        assert_eq!(entity.attachment().unwrap().parent, parent);
        assert_eq!(entity.position_sequence(), next_position);
        assert!(world.is_entity_world_participant(child));
        assert!(world.attachments.pending.is_empty());
    }

    #[test]
    fn future_parent_event_cannot_override_a_newer_independent_position() {
        let mut world = WorldState::synthetic();
        let child = Guid(1);
        let parent = Guid(2);
        create(&mut world, child, None);
        create(&mut world, parent, None);
        world.handle_message(&parent_event(parent, child, 1, 1));
        assert_eq!(world.entities.get(child).unwrap().position_sequence(), 0);
        world.handle_message(&GameMessage::UpdatePosition(Box::new(UpdatePositionData {
            guid: child,
            pos: PositionPack {
                pos: position(),
                position_sequence: 2,
                flags: UpdatePositionFlag::HAS_CONTACT,
                ..Default::default()
            },
        })));
        let mut replacement = Entity::new(parent, "replacement".into(), position());
        replacement.apply_remote_position_sample(position(), 1, 0, 0);
        world.add_entity(replacement);
        world.tick();
        assert_eq!(
            world.entities.get(child).unwrap().placement_intent,
            EntityPlacementIntent::Independent
        );
        assert_eq!(world.entities.get(child).unwrap().position_sequence(), 2);
    }

    #[test]
    fn parent_and_pickup_share_wrapping_position_order() {
        let mut world = WorldState::synthetic();
        let child = Guid(1);
        let parent = Guid(2);
        create(&mut world, child, None);
        create(&mut world, parent, None);
        world
            .entities
            .get_mut(child)
            .unwrap()
            .apply_remote_position_sequence_only(u16::MAX);
        world.handle_message(&parent_event(parent, child, 0, 0));
        assert!(world.entities.get(child).unwrap().attachment().is_some());
        world.handle_message(&GameMessage::PickupEvent(Box::new(PickupEventData {
            guid: child,
            instance_sequence: 0,
            position_sequence: u16::MAX,
        })));
        assert!(world.entities.get(child).unwrap().attachment().is_some());
        world.handle_message(&GameMessage::PickupEvent(Box::new(PickupEventData {
            guid: child,
            instance_sequence: 0,
            position_sequence: 1,
        })));
        assert_eq!(
            world.entities.get(child).unwrap().placement_intent,
            EntityPlacementIntent::Withdrawn
        );
        world.handle_message(&parent_event(parent, child, 0, 0));
        assert_eq!(world.entities.get(child).unwrap().position_sequence(), 1);
        assert!(!world.is_entity_world_participant(child));
    }

    #[test]
    fn only_queued_endpoint_traffic_refreshes_an_announced_child_lifetime() {
        for queue_message in [false, true] {
            let mut world = WorldState::synthetic();
            let child = Guid(1);
            let parent = Guid(2);
            let timeout = super::super::liveness::ACE_DESTRUCTION_TIMEOUT_SECS;
            world.server_time = Some(ServerTimeSync {
                server_time: 0.0,
                local_time: Instant::now(),
            });
            let mut description = ObjectDescriptionData::with_guid(parent);
            description.pos = Some(position());
            description.children = Some(vec![PhysicsChildData {
                guid: child,
                location_id: ParentLocation::RightHand as u32,
            }]);
            world.handle_message(&GameMessage::ObjectCreate(Box::new(description.clone())));
            world.server_time = Some(ServerTimeSync {
                server_time: timeout / 2.0,
                local_time: Instant::now(),
            });
            if queue_message {
                // A duplicate position timestamp cannot attach after creation. Any relationship
                // observed below must come from the still-live parent announcement.
                world.handle_message(&parent_event(parent, child, 0, 0));
            } else {
                world.handle_message(&GameMessage::UpdateObject(Box::new(description)));
            }
            world.server_time = Some(ServerTimeSync {
                server_time: timeout + 1.0,
                local_time: Instant::now(),
            });
            create(&mut world, child, None);
            assert_eq!(
                world.entities.get(child).unwrap().attachment().is_some(),
                queue_message
            );
        }
    }

    #[test]
    fn missing_parent_traffic_refreshes_all_waiting_children() {
        let mut world = WorldState::synthetic();
        let first_child = Guid(1);
        let second_child = Guid(2);
        let parent = Guid(3);
        let timeout = super::super::liveness::ACE_DESTRUCTION_TIMEOUT_SECS;
        world.server_time = Some(ServerTimeSync {
            server_time: 0.0,
            local_time: Instant::now(),
        });
        world.handle_message(&parent_event(parent, first_child, 0, 1));
        world.server_time = Some(ServerTimeSync {
            server_time: timeout / 2.0,
            local_time: Instant::now(),
        });
        world.handle_message(&parent_event(parent, second_child, 0, 1));
        world.server_time = Some(ServerTimeSync {
            server_time: timeout + 1.0,
            local_time: Instant::now(),
        });
        create(&mut world, parent, None);
        create(&mut world, first_child, None);
        create(&mut world, second_child, None);
        for child in [first_child, second_child] {
            assert_eq!(
                world
                    .entities
                    .get(child)
                    .unwrap()
                    .attachment()
                    .unwrap()
                    .parent,
                parent
            );
            assert!(world.is_entity_world_participant(child));
        }
    }

    #[test]
    fn missing_endpoint_input_expires_before_later_descriptions_arrive() {
        let mut world = WorldState::synthetic();
        let child = Guid(1);
        let parent = Guid(2);
        world.server_time = Some(ServerTimeSync {
            server_time: 0.0,
            local_time: Instant::now(),
        });
        world.handle_message(&parent_event(parent, child, 0, 1));
        world.server_time = Some(ServerTimeSync {
            server_time: super::super::liveness::ACE_DESTRUCTION_TIMEOUT_SECS + 1.0,
            local_time: Instant::now(),
        });
        create(&mut world, parent, None);
        create(&mut world, child, None);
        assert_eq!(
            world.entities.get(child).unwrap().placement_intent,
            EntityPlacementIntent::Independent
        );
        assert_eq!(world.entities.get(child).unwrap().position_sequence(), 0);
    }
    #[test]
    fn unresolved_expiry_removes_orphans_but_preserves_owned_inventory_data() {
        let mut world = WorldState::synthetic();
        let orphan = Guid(1);
        let owned = Guid(2);
        let player = Guid(3);
        let absent_parent = Guid(4);
        world.server_time = Some(ServerTimeSync {
            server_time: 0.0,
            local_time: Instant::now(),
        });
        world.seed_local_player_entity(player, "Player", position());
        create(&mut world, orphan, Some(absent_parent));
        create(&mut world, owned, Some(absent_parent));
        assert!(world.move_entity_into_container(owned, player, &mut Vec::new()));
        world.tick();
        assert!(world.is_in_player_inventory(owned));
        assert!(!world.is_entity_world_participant(owned));
        world.server_time = Some(ServerTimeSync {
            server_time: super::super::liveness::ACE_DESTRUCTION_TIMEOUT_SECS + 1.0,
            local_time: Instant::now(),
        });
        world.tick();
        assert!(world.entities.get(orphan).is_none());
        assert!(world.entities.get(owned).is_some());
        assert!(world.is_in_player_inventory(owned));
    }
}

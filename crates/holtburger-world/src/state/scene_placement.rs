//! Resolves retained entity placement without depending on frontend or collision asset readiness.

use std::collections::BTreeSet;

use holtburger_common::Guid;

use crate::{EntityPlacementIntent, PhysicsAttachment, WorldState};

/// World-owned placement facts consumed by scene admission, selection and presentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolvedScenePlacement {
    /// The entity supplies its own authoritative world position.
    Independent,
    /// A complete attachment chain terminates at a placed entity.
    Attached {
        /// The immediate relationship used by the renderer's part hierarchy.
        attachment: PhysicsAttachment,
        /// The independent ancestor whose spatial scope the child inherits.
        root: Guid,
    },
    /// Retained data does not currently establish usable scene placement.
    Unresolved(UnresolvedScenePlacement),
}

/// A normal missing prerequisite, distinct from a contradictory attachment graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnresolvedScenePlacement {
    /// The requested entity or one of its ancestors has not arrived.
    MissingEntity { guid: Guid },
    /// An endpoint is subject to deletion of its current incarnation.
    DeletedEntity { guid: Guid },
    /// The independent endpoint has no authoritative world location.
    UnplacedEntity { guid: Guid },
}

/// Invalid relationships cannot be interpreted as missing prerequisites.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ScenePlacementError {
    /// Revisited an endpoint while resolving the requested entity's parent chain.
    #[error("attachment ancestry for entity 0x{child:08X} contains a cycle at 0x{ancestor:08X}")]
    CyclicAttachment { child: Guid, ancestor: Guid },
}

impl WorldState {
    /// Resolve placement from retained authoritative facts, before creating any runtime body.
    ///
    /// Body or asset existence must not be a prerequisite here: this decision is also consumed
    /// by body creation. The immediate attachment and independent root are computed together so
    /// downstream consumers do not each walk ancestry or substitute the child's old position.
    pub fn resolve_scene_placement(
        &self,
        guid: Guid,
    ) -> Result<ResolvedScenePlacement, ScenePlacementError> {
        let mut visited = BTreeSet::new();
        let mut current = guid;
        let mut immediate = None;
        loop {
            if !visited.insert(current) {
                return Err(ScenePlacementError::CyclicAttachment {
                    child: guid,
                    ancestor: current,
                });
            }
            let Some(entity) = self.entities.get(current) else {
                return Ok(ResolvedScenePlacement::Unresolved(
                    UnresolvedScenePlacement::MissingEntity { guid: current },
                ));
            };
            if !self.is_entity_client_visible(current) {
                return Ok(ResolvedScenePlacement::Unresolved(
                    UnresolvedScenePlacement::DeletedEntity { guid: current },
                ));
            }
            if let Some(attachment) = entity.attachment() {
                if current == guid {
                    immediate = Some(attachment);
                }
                current = attachment.parent;
                continue;
            }
            if entity.placement_intent == EntityPlacementIntent::Withdrawn
                || entity.position.landblock_id == Guid::NULL
            {
                return Ok(ResolvedScenePlacement::Unresolved(
                    UnresolvedScenePlacement::UnplacedEntity { guid: current },
                ));
            }
            return Ok(match immediate {
                Some(attachment) => ResolvedScenePlacement::Attached {
                    attachment,
                    root: current,
                },
                None => ResolvedScenePlacement::Independent,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use holtburger_common::properties::{PropertyInt, WorldObjectPropertyAccessors};
    use holtburger_common::{ParentLocation, Placement};
    use holtburger_protocol::messages::movement::messages::vector::VectorUpdateData;
    use holtburger_protocol::messages::{GameMessage, inventory::types::SetStackSizeData};

    use super::*;
    use crate::entity::Entity;

    fn attached(world: &mut WorldState, child: Guid, parent: Guid) -> PhysicsAttachment {
        let attachment = PhysicsAttachment {
            parent,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        };
        let mut entity = Entity::new(child, "child".into(), Default::default());
        // A stale independent position must never override unresolved attachment intent.
        entity.position.landblock_id = Guid(0xda55_0001);
        entity.set_attachment(Some(attachment));
        world.entities.insert(entity);
        attachment
    }

    #[test]
    fn a_chain_resolves_only_when_its_independent_ancestor_is_placed() {
        let mut world = WorldState::synthetic();
        let child = Guid(1);
        let parent = Guid(2);
        let root = Guid(3);
        let attachment = attached(&mut world, child, parent);
        attached(&mut world, parent, root);
        assert_eq!(
            world.resolve_scene_placement(child),
            Ok(ResolvedScenePlacement::Unresolved(
                UnresolvedScenePlacement::MissingEntity { guid: root }
            ))
        );
        world
            .entities
            .insert(Entity::new(root, "root".into(), Default::default()));
        assert_eq!(
            world.resolve_scene_placement(child),
            Ok(ResolvedScenePlacement::Unresolved(
                UnresolvedScenePlacement::UnplacedEntity { guid: root }
            ))
        );
        world.entities.get_mut(root).unwrap().position.landblock_id = Guid(0xda55_0001);
        assert_eq!(
            world.resolve_scene_placement(child),
            Ok(ResolvedScenePlacement::Attached { attachment, root })
        );
        // Resolution is independent of body/content preparation, avoiding circular admission.
        assert!(
            world
                .scene
                .body(crate::SpatialBodyId::Entity(root))
                .is_none()
        );
        world.mark_entity_explicit_delete(root);
        assert_eq!(
            world.resolve_scene_placement(child),
            Ok(ResolvedScenePlacement::Unresolved(
                UnresolvedScenePlacement::DeletedEntity { guid: root }
            ))
        );
    }

    #[test]
    fn a_cycle_is_an_error_even_if_each_endpoint_retains_a_world_position() {
        let mut world = WorldState::synthetic();
        let child = Guid(1);
        let parent = Guid(2);
        attached(&mut world, child, parent);
        attached(&mut world, parent, child);
        assert_eq!(
            world.resolve_scene_placement(child),
            Err(ScenePlacementError::CyclicAttachment {
                child,
                ancestor: child
            })
        );
    }

    #[test]
    fn unresolved_data_accepts_updates_without_vector_recovery_creating_a_body() {
        let mut world = WorldState::synthetic();
        let child = Guid(1);
        attached(&mut world, child, Guid(2));
        let velocity = holtburger_common::Vector3::new(3.0, 0.0, 0.0);
        world.handle_message(&GameMessage::VectorUpdate(Box::new(VectorUpdateData {
            guid: child,
            velocity,
            omega: holtburger_common::Vector3::zero(),
            instance_sequence: 0,
            vector_sequence: 1,
        })));
        world.handle_message(&GameMessage::SetStackSize(Box::new(SetStackSizeData {
            sequence: 1,
            object_guid: child,
            stack_size: 9,
            value: 90,
        })));
        let entity = world.entities.get(child).unwrap();
        assert_eq!(entity.velocity, velocity);
        assert_eq!(entity.vector_sequence(), 1);
        assert_eq!(entity.get_int_prop(PropertyInt::StackSize), Some(9));
        assert_eq!(entity.position.landblock_id, Guid(0xda55_0001));
        assert!(
            world
                .scene
                .body(crate::SpatialBodyId::Entity(child))
                .is_none()
        );
    }
}

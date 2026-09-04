//! Correlated client-camera selection queries over the current immutable collision snapshot.

use holtburger_common::{Guid, Vector3};
use holtburger_world::{
    EntitySelectionCandidateResult, EntitySelectionRayRequest, EntitySelectionUnavailable,
};

use super::camera::ClientCameraIdentity;

/// Monotonic frontend action identity echoed by the asynchronous result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EntitySelectionQuerySequence(pub u64);

/// One renderer-sampled camera ray. World owns its fixed maximum distance.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EntitySelectionQueryRequest {
    pub camera: ClientCameraIdentity,
    pub sequence: EntitySelectionQuerySequence,
    pub anchor: Guid,
    pub start: Vector3,
    pub direction: Vector3,
    pub previous_cell: Option<Guid>,
}

/// Typed inability to decide a selection action; this is diagnostic state, not UX copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntitySelectionQueryUnavailable {
    StaleCamera,
    CollisionCoordinatorUnavailable,
    MissingCollisionOwner { owner: Guid },
}

#[derive(Debug, Clone, PartialEq)]
pub enum EntitySelectionQueryOutcome {
    Available {
        static_limit_distance: f32,
        candidate_guids: Vec<Guid>,
    },
    Unavailable(EntitySelectionQueryUnavailable),
}

/// Correlated result emitted after the client authority samples current world state.
#[derive(Debug, Clone, PartialEq)]
pub struct EntitySelectionQueryResult {
    pub sequence: EntitySelectionQuerySequence,
    pub outcome: EntitySelectionQueryOutcome,
}

impl super::ClientRuntime {
    pub(super) fn query_entity_selection_candidates(
        &mut self,
        request: EntitySelectionQueryRequest,
    ) -> anyhow::Result<()> {
        self.poll_selection_envelopes();
        let outcome = if self.camera.identity() != Some(request.camera) {
            EntitySelectionQueryOutcome::Unavailable(EntitySelectionQueryUnavailable::StaleCamera)
        } else if let Some(snapshot) = self
            .collision_coordinator
            .as_ref()
            .map(super::collision::ClientCollisionCoordinator::snapshot)
        {
            match self.world.query_entity_selection_candidates(
                &snapshot.scene,
                EntitySelectionRayRequest {
                    anchor: request.anchor,
                    start: request.start,
                    direction: request.direction,
                    previous_cell: request.previous_cell,
                },
            )? {
                EntitySelectionCandidateResult::Available(available) => {
                    EntitySelectionQueryOutcome::Available {
                        static_limit_distance: available.static_limit_distance,
                        candidate_guids: available.candidate_guids,
                    }
                }
                EntitySelectionCandidateResult::Unavailable(
                    EntitySelectionUnavailable::MissingCollisionOwner { owner },
                ) => EntitySelectionQueryOutcome::Unavailable(
                    EntitySelectionQueryUnavailable::MissingCollisionOwner { owner },
                ),
            }
        } else {
            EntitySelectionQueryOutcome::Unavailable(
                EntitySelectionQueryUnavailable::CollisionCoordinatorUnavailable,
            )
        };
        let _ = self.client_view_event_tx.send(
            super::types::ClientViewEvent::EntitySelectionQueryResult(EntitySelectionQueryResult {
                sequence: request.sequence,
                outcome,
            }),
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_camera_produces_a_correlated_unavailable_event() {
        let mut client =
            crate::client::builder::build_test_client(crate::client::ClientState::InWorld);
        let mut events = client.client_view_event_tx.subscribe();
        client
            .query_entity_selection_candidates(EntitySelectionQueryRequest {
                camera: ClientCameraIdentity {
                    camera_generation: 9,
                    player_guid: Guid(0x5000_0001),
                    entity_generation: 2,
                },
                sequence: EntitySelectionQuerySequence(44),
                anchor: Guid(0xda55_ffff),
                start: Vector3::zero(),
                direction: Vector3::new(1.0, 0.0, 0.0),
                previous_cell: None,
            })
            .unwrap();

        let super::super::types::ClientViewEvent::EntitySelectionQueryResult(result) =
            events.try_recv().unwrap()
        else {
            panic!("selection query should emit its correlated event");
        };
        assert_eq!(result.sequence, EntitySelectionQuerySequence(44));
        assert_eq!(
            result.outcome,
            EntitySelectionQueryOutcome::Unavailable(EntitySelectionQueryUnavailable::StaleCamera,)
        );
    }
}

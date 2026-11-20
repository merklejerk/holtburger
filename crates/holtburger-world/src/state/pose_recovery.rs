use holtburger_common::{Guid, Quaternion, Vector3, position::WorldPosition};

/// Smallest usable quaternion magnitude; below this, normalization amplifies float noise.
const MIN_ORIENTATION_MAGNITUDE: f64 = f32::EPSILON as f64;

pub(crate) fn vector_is_finite(value: Vector3) -> bool {
    value.x.is_finite() && value.y.is_finite() && value.z.is_finite()
}

fn usable_orientation(rotation: Quaternion) -> bool {
    let components = [rotation.w, rotation.x, rotation.y, rotation.z];
    components.iter().all(|value| value.is_finite())
        && components
            .iter()
            .map(|value| f64::from(*value).powi(2))
            .sum::<f64>()
            > MIN_ORIENTATION_MAGNITUDE * MIN_ORIENTATION_MAGNITUDE
}

/// Replaces malformed incoming kinematic vectors (velocity, acceleration, omega) with zero so
/// server NaN math cannot poison dead reckoning, collision queries, or presentation snapshots.
pub(crate) fn recover_vector(guid: Guid, field: &str, value: Vector3) -> Vector3 {
    if vector_is_finite(value) {
        return value;
    }
    log::warn!(
        "entity {guid} received unusable {field} {:?}; using zero vector",
        value,
    );
    Vector3::zero()
}

/// Repairs malformed incoming coordinates and orientations, retaining valid authored rotations
/// and prior placement whenever available.
///
/// RETAIL DIVERGENCE: rejects non-unit frames, and returns before caching an invalid unpacked
/// frame. We explicitly recover malformed network poses and vectors rather than letting them reach
/// dead reckoning, collision queries, or presentation. Reverting this recovery lets one malformed
/// entity prevent world presentation or crash collision validation.
/// Live census: one zero-orientation Rat Burrow (0x80007D5F, WCID 36235) among three received
/// Rat Burrow creates in cell block 0x482D on 2026-09-16; one point-blank spell projectile
/// (0x8000A2E5) carrying NaN orientation and NaN velocity on 2026-11-20. Identity orientation or
/// cleared placement is an approximation when no prior valid state exists; subsequent valid
/// authority replaces it without special state.
pub(crate) fn recover_pose(
    guid: Guid,
    mut pose: WorldPosition,
    previous: Option<WorldPosition>,
) -> WorldPosition {
    let previous_placed =
        previous.filter(|prior| prior.landblock_id != Guid::NULL && vector_is_finite(prior.coords));
    if !vector_is_finite(pose.coords) {
        if let Some(prior) = previous_placed {
            log::warn!(
                "entity {guid} received unusable coordinates {:?}; retaining previous placement {:?}",
                pose.coords,
                prior.coords,
            );
            pose.landblock_id = prior.landblock_id;
            pose.coords = prior.coords;
        } else {
            log::warn!(
                "entity {guid} received unusable coordinates {:?}; clearing world placement",
                pose.coords,
            );
            return WorldPosition {
                landblock_id: Guid::NULL,
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            };
        }
    }
    if usable_orientation(pose.rotation) {
        return pose;
    }
    let previous_rotation = previous
        .map(|prior| prior.rotation)
        .filter(|rotation| usable_orientation(*rotation));
    let recovered = previous_rotation.unwrap_or_else(Quaternion::identity);
    log::warn!(
        "entity {guid} received unusable orientation {:?}; using {} orientation {:?}",
        pose.rotation,
        if previous_rotation.is_some() {
            "previous"
        } else {
            "identity"
        },
        recovered,
    );
    pose.rotation = recovered;
    pose
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthoritativePoseEffect, AuthoritativePoseResetCause, WorldEvent, WorldState,
        entity::Entity, spatial::SpatialBodyId,
    };
    use holtburger_common::Vector3;
    use holtburger_protocol::messages::{
        GameMessage, ObjectDescriptionData, PositionPack, ServerAutonomousPositionData,
        UpdatePositionFlag,
    };

    fn pose(rotation: Quaternion) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x482D0026),
            coords: Vector3::new(99.297, 131.672, 6.105),
            rotation,
        }
    }

    #[test]
    fn unusable_orientations_retain_previous_or_use_identity_without_changing_position() {
        let previous = Quaternion::from_heading(1.0);
        for rotation in [
            Quaternion::default(),
            Quaternion {
                w: f32::NAN,
                ..Quaternion::identity()
            },
            Quaternion {
                x: f32::INFINITY,
                ..Quaternion::identity()
            },
            Quaternion {
                w: MIN_ORIENTATION_MAGNITUDE as f32 / 2.0,
                ..Quaternion::default()
            },
        ] {
            let incoming = pose(rotation);
            for (prior, expected) in [
                (Some(pose(previous)), previous),
                (None, Quaternion::identity()),
                (Some(pose(rotation)), Quaternion::identity()),
            ] {
                assert_eq!(recover_pose(Guid(1), incoming, prior), pose(expected));
            }
        }
        // Authored non-unit rotations remain lossless; this is recovery, not normalization.
        let authored = pose(Quaternion {
            w: 0.923,
            x: 0.0,
            y: 0.0,
            z: -0.382,
        });
        assert_eq!(
            recover_pose(Guid(1), authored, Some(pose(previous))),
            authored
        );
    }

    #[test]
    fn nan_projectile_create_and_updates_never_poison_pose_or_dead_reckoning() {
        use crate::spatial::{
            ContactState, RetainedBodyKinematics, SolveBodyInput, SpatialBodyId,
            advance_body_kinematics,
        };
        use holtburger_protocol::messages::movement::VectorUpdateData;
        use std::time::Duration;

        let mut state = WorldState::synthetic();
        let guid = Guid(0x8000A2E5);
        let nan_vec = Vector3::new(f32::NAN, f32::NAN, f32::NAN);
        let nan_rot = Quaternion {
            w: f32::NAN,
            x: f32::NAN,
            y: f32::NAN,
            z: f32::NAN,
        };
        let mut description = ObjectDescriptionData::with_guid(guid);
        description.pos = Some(pose(nan_rot));
        description.velocity = Some(nan_vec);
        description.acceleration = Some(nan_vec);
        description.omega = Some(nan_vec);
        state.handle_message(&GameMessage::ObjectCreate(Box::new(description)));

        let entity = state.entities.get(guid).unwrap();
        assert_eq!(entity.position, pose(Quaternion::identity()));
        assert_eq!(entity.velocity, Vector3::zero());
        assert_eq!(entity.acceleration, Vector3::zero());
        assert_eq!(entity.omega, Vector3::zero());

        // Subsequent NaN coordinates and vectors retain valid placement and stay finite.
        let mut bad_pos = pose(nan_rot);
        bad_pos.coords = nan_vec;
        assert!(state.apply_entity_position_pack(
            guid,
            &PositionPack {
                pos: bad_pos,
                velocity: Some(nan_vec),
                position_sequence: 1,
                flags: UpdatePositionFlag::HAS_VELOCITY | UpdatePositionFlag::HAS_CONTACT,
                ..PositionPack::default()
            },
            &mut Vec::new(),
        ));
        assert_eq!(
            state.entities.get(guid).unwrap().position,
            pose(Quaternion::identity())
        );
        assert_eq!(state.entities.get(guid).unwrap().velocity, Vector3::zero());

        state.handle_message(&GameMessage::VectorUpdate(Box::new(VectorUpdateData {
            guid,
            velocity: nan_vec,
            omega: nan_vec,
            instance_sequence: 0,
            vector_sequence: 1,
        })));
        assert_eq!(state.entities.get(guid).unwrap().velocity, Vector3::zero());
        assert_eq!(state.entities.get(guid).unwrap().omega, Vector3::zero());

        // Defense in depth: even a direct NaN vector in dead reckoning cannot poison pose coords.
        let solved = advance_body_kinematics(
            &SolveBodyInput {
                body_id: SpatialBodyId::Entity(guid),
                pose: pose(Quaternion::identity()),
                retained: RetainedBodyKinematics {
                    velocity: nan_vec,
                    acceleration: Vector3::zero(),
                    omega: Vector3::zero(),
                },
                authored_offset: None,
                contact: ContactState::Airborne,
                motion_policy: crate::EntityMotionPolicy::Simulate,
            },
            Duration::from_millis(30),
        );
        assert_eq!(solved.pose.coords, pose(Quaternion::identity()).coords);
    }

    #[test]
    fn nan_coords_on_fresh_create_clears_world_placement_until_valid_update() {
        let mut state = WorldState::synthetic();
        let guid = Guid(0x8000A2E6);
        let mut bad_pose = pose(Quaternion::identity());
        bad_pose.coords = Vector3::new(f32::NAN, f32::INFINITY, 0.0);
        let mut description = ObjectDescriptionData::with_guid(guid);
        description.pos = Some(bad_pose);
        state.handle_message(&GameMessage::ObjectCreate(Box::new(description)));

        assert_eq!(
            state.entities.get(guid).unwrap().position,
            WorldPosition {
                landblock_id: Guid::NULL,
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            }
        );
        assert!(state.scene.body(SpatialBodyId::Entity(guid)).is_none());

        let valid = pose(Quaternion::from_heading(0.5));
        assert!(state.apply_entity_position_pack(
            guid,
            &PositionPack {
                pos: valid,
                position_sequence: 1,
                flags: UpdatePositionFlag::HAS_CONTACT,
                ..PositionPack::default()
            },
            &mut Vec::new(),
        ));
        assert_eq!(state.entities.get(guid).unwrap().position, valid);
        assert_eq!(state.runtime_pose_for_guid(guid), Some(valid));
    }

    #[test]
    fn zero_orientation_create_and_replacement_publish_usable_world_poses() {
        let mut state = WorldState::synthetic();
        let guid = Guid(0x80007D5F);
        let mut description = ObjectDescriptionData::with_guid(guid);
        description.pos = Some(pose(Quaternion::default()));
        state.handle_message(&GameMessage::ObjectCreate(Box::new(description.clone())));
        assert_eq!(
            state.entities.get(guid).unwrap().position,
            pose(Quaternion::identity())
        );
        assert_eq!(
            state.runtime_pose_for_guid(guid),
            Some(pose(Quaternion::identity()))
        );

        let valid = Quaternion::from_heading(0.7);
        description.pos = Some(pose(valid));
        state.handle_message(&GameMessage::UpdateObject(Box::new(description.clone())));
        description.pos = Some(pose(Quaternion::default()));
        state.handle_message(&GameMessage::UpdateObject(Box::new(description)));
        assert_eq!(state.entities.get(guid).unwrap().position, pose(valid));
        assert_eq!(state.runtime_pose_for_guid(guid), Some(pose(valid)));
    }

    #[test]
    fn remote_position_recovery_keeps_translation_and_yields_to_valid_authority() {
        let mut state = WorldState::synthetic();
        let guid = Guid(7);
        let previous = Quaternion::from_heading(0.7);
        state.add_entity(Entity::new(guid, "Remote".into(), pose(previous)));
        for (sequence, rotation, expected) in [
            (1, Quaternion::default(), previous),
            (
                2,
                Quaternion::from_heading(1.2),
                Quaternion::from_heading(1.2),
            ),
        ] {
            let mut incoming = pose(rotation);
            incoming.coords.x += f32::from(sequence);
            assert!(state.apply_entity_position_pack(
                guid,
                &PositionPack {
                    pos: incoming,
                    position_sequence: sequence,
                    flags: UpdatePositionFlag::HAS_CONTACT,
                    ..PositionPack::default()
                },
                &mut Vec::new()
            ));
            let expected = WorldPosition {
                rotation: expected,
                ..incoming
            };
            assert_eq!(state.entities.get(guid).unwrap().position, expected);
            assert_eq!(
                state
                    .scene
                    .body(SpatialBodyId::Entity(guid))
                    .unwrap()
                    .authoritative_pose(),
                Some(expected)
            );
        }
    }

    #[test]
    fn forced_remote_pose_recovers_before_publication_and_ignores_stale_authority() {
        let mut state = WorldState::synthetic();
        let guid = Guid(7);
        let previous = Quaternion::from_heading(0.7);
        state.add_entity(Entity::new(guid, "Remote".into(), pose(previous)));
        let mut incoming = pose(Quaternion::default());
        incoming.coords.x += 1.0;
        let mut message = ServerAutonomousPositionData {
            guid,
            position: incoming,
            instance_sequence: 0,
            teleport_sequence: 2,
            force_position_sequence: 2,
            server_control_sequence: 0,
            contact_flags: 0,
        };
        let events =
            state.handle_message(&GameMessage::AutonomousPosition(Box::new(message.clone())));
        let expected = WorldPosition {
            rotation: previous,
            ..incoming
        };
        assert_eq!(state.entities.get(guid).unwrap().position, expected);
        assert_eq!(state.runtime_pose_for_guid(guid), Some(expected));
        assert!(events.iter().any(|event| matches!(event,
            WorldEvent::ForcedReposition { pos, .. } if *pos == expected)));

        message.teleport_sequence -= 1;
        message.position.coords.x += 1.0;
        let events = state.handle_message(&GameMessage::AutonomousPosition(Box::new(message)));
        assert!(events.is_empty());
        assert_eq!(state.entities.get(guid).unwrap().position, expected);
        assert_eq!(state.runtime_pose_for_guid(guid), Some(expected));
    }

    #[test]
    fn player_pose_reset_publishes_the_same_recovered_pose_it_commits() {
        let mut state = WorldState::synthetic();
        let guid = Guid(7);
        let previous = Quaternion::from_heading(0.7);
        state.seed_local_player_entity(guid, "Player", pose(previous));
        let mut incoming = pose(Quaternion::default());
        incoming.coords.x += 1.0;
        let events = state.apply_player_pose_effect(AuthoritativePoseEffect::Reset {
            pose: incoming,
            cause: AuthoritativePoseResetCause::Teleport,
        });
        let expected = WorldPosition {
            rotation: previous,
            ..incoming
        };
        assert_eq!(state.player_position(), Some(expected));
        assert_eq!(state.runtime_pose_for_guid(guid), Some(expected));
        assert!(events.iter().any(|event| matches!(event,
            WorldEvent::EntityMoved { pos, .. } if *pos == expected)));
    }
}

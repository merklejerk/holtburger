use holtburger_common::{Guid, Quaternion, position::WorldPosition};

/// Smallest usable quaternion magnitude; below this, normalization amplifies float noise.
const MIN_ORIENTATION_MAGNITUDE: f64 = f32::EPSILON as f64;

fn usable_orientation(rotation: Quaternion) -> bool {
    let components = [rotation.w, rotation.x, rotation.y, rotation.z];
    components.iter().all(|value| value.is_finite())
        && components
            .iter()
            .map(|value| f64::from(*value).powi(2))
            .sum::<f64>()
            > MIN_ORIENTATION_MAGNITUDE * MIN_ORIENTATION_MAGNITUDE
}

/// Repairs only unusable incoming orientations, retaining position and valid authored rotations.
///
/// RETAIL DIVERGENCE: acclient.c:342262 rejects non-unit frames, and :342361 returns before
/// caching an invalid unpacked frame. We explicitly recover malformed network orientations
/// rather than letting them reach presentation. Reverting this recovery lets one malformed
/// entity prevent world presentation. Live census: one zero-orientation Rat Burrow (0x80007D5F,
/// WCID 36235) among three received Rat Burrow creates in cell block 0x482D on 2026-09-16.
/// Identity is an approximation when no previous usable orientation exists; its heading can
/// differ from server intent, but subsequent valid authority replaces it without special state.
pub(super) fn recover_pose_orientation(
    guid: Guid,
    mut pose: WorldPosition,
    previous: Option<Quaternion>,
) -> WorldPosition {
    if usable_orientation(pose.rotation) {
        return pose;
    }
    let previous = previous.filter(|rotation| usable_orientation(*rotation));
    let recovered = previous.unwrap_or_else(Quaternion::identity);
    log::warn!(
        "entity {guid} received unusable orientation {:?}; using {} orientation {:?}",
        pose.rotation,
        if previous.is_some() {
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
                (Some(previous), previous),
                (None, Quaternion::identity()),
                (Some(rotation), Quaternion::identity()),
            ] {
                assert_eq!(
                    recover_pose_orientation(Guid(1), incoming, prior),
                    pose(expected)
                );
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
            recover_pose_orientation(Guid(1), authored, Some(previous)),
            authored
        );
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
                    .authoritative_pose,
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

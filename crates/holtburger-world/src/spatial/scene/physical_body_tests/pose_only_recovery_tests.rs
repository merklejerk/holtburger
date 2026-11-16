//! Recovery through the real pose-only composition/commit path, including constraint damping.

use super::*;
use crate::spatial::pose_reconciliation::recovery::RECOVERY_WINDOW_SECONDS;
use crate::spatial::{PHYSICAL_RETURN_START_THRESHOLD_M, retail_constraint_distances};

/// A discrepancy beyond the travel budget stalls interpolation without faking rejected movement.
fn stalled_scene(cell: u32) -> (SpatialScene, SpatialBodyId, WorldPosition) {
    let start = WorldPosition {
        landblock_id: Guid(cell),
        ..pose(Vector3::zero())
    };
    let mut target = start;
    target.coords.x += retail_constraint_distances(start).1 + PHYSICAL_RETURN_START_THRESHOLD_M;
    let id = SpatialBodyId::Entity(Guid(42));
    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(id, start, Instant::now()));
    (scene, id, target)
}

fn receive(scene: &mut SpatialScene, id: SpatialBodyId, target: WorldPosition) {
    assert!(scene.apply_authoritative_body_effect(
        id,
        AuthoritativePoseEffect::Interpolate {
            pose: target,
            keep_heading: false,
            adjusted_max_speed_mps: None,
        },
        AuthoritativeBodyVectors::default(),
        Instant::now()
    ));
}

fn tick(scene: &mut SpatialScene, id: SpatialBodyId, seconds: f32) -> RuntimeBodyAdvanceKind {
    let body = scene.body(id).unwrap();
    let input = SolveBodyInput {
        motion_policy: crate::EntityMotionPolicy::Simulate,
        body_id: id,
        pose: body.pose,
        contact: body.contact,
        authored_offset: None,
        retained: body.retained,
    };
    let (solved, kind) = scene
        .advance_pose_only_body_kinematics(&input, Duration::from_secs_f32(seconds))
        .expect("pose-only body remains registered");
    assert!(scene.apply_solved_runtime_body_kinematics(&solved));
    kind
}

#[test]
fn repeated_pose_only_targets_recover_in_the_expiring_tick() {
    for cell in [0xda55_0001, 0xda55_0100] {
        for seconds in [
            MOBILE_CONTACT_TICK_SECONDS,
            MOBILE_CONTACT_TICK_SECONDS / 2.0,
        ] {
            for moving in [false, true] {
                let (mut scene, id, mut target) = stalled_scene(cell);
                let original = scene.body(id).unwrap().pose;
                let mut recovered_at = None;
                let mut elapsed = 0.0;
                let ticks = (RECOVERY_WINDOW_SECONDS * 2.0 / seconds).ceil() as usize;
                for _ in 0..ticks {
                    if moving {
                        target.coords.y += seconds;
                    }
                    // Retarget on every tick, including the tick immediately before recovery.
                    receive(&mut scene, id, target);
                    let kind = tick(&mut scene, id, seconds);
                    elapsed += seconds;
                    if matches!(kind, RuntimeBodyAdvanceKind::CorrectionSnap) {
                        assert!(
                            recovered_at.is_none(),
                            "one discrepancy must not cause repeated snaps"
                        );
                        assert_eq!(
                            scene.body(id).unwrap().pose,
                            target,
                            "commit latest target immediately"
                        );
                        recovered_at = Some(elapsed);
                    } else if recovered_at.is_none() {
                        assert_eq!(
                            scene.body(id).unwrap().pose,
                            original,
                            "real travel damping causes the stall"
                        );
                    }
                }
                let recovered_at = recovered_at.expect("retargeting must not postpone recovery");
                assert!((recovered_at - RECOVERY_WINDOW_SECONDS).abs() <= seconds * 2.0);
                assert!(
                    scene.body(id).unwrap().pose.distance_to(&target)
                        < PHYSICAL_RETURN_START_THRESHOLD_M
                );
            }
        }
    }
}

#[test]
fn pose_only_contact_loss_discards_stall_history_until_new_eligible_authority() {
    let (mut scene, id, target) = stalled_scene(0xda55_0001);
    let seconds = RECOVERY_WINDOW_SECONDS / 4.0;
    receive(&mut scene, id, target);
    for _ in 0..3 {
        assert!(matches!(
            tick(&mut scene, id, seconds),
            RuntimeBodyAdvanceKind::Integrated
        ));
    }
    assert!(scene.apply_authoritative_body_effect(
        id,
        AuthoritativePoseEffect::Observe { pose: target },
        AuthoritativeBodyVectors::default(),
        Instant::now()
    ));
    for _ in 0..8 {
        assert!(matches!(
            tick(&mut scene, id, seconds),
            RuntimeBodyAdvanceKind::Integrated
        ));
    }
    receive(&mut scene, id, target);
    for _ in 0..3 {
        assert!(matches!(
            tick(&mut scene, id, seconds),
            RuntimeBodyAdvanceKind::Integrated
        ));
    }
    assert!(matches!(
        tick(&mut scene, id, seconds),
        RuntimeBodyAdvanceKind::CorrectionSnap
    ));
    assert_eq!(scene.body(id).unwrap().pose, target);
}

#[test]
fn removing_physics_cannot_restore_revoked_contact_evidence() {
    let (mut scene, id, target) = stalled_scene(0xda55_0001);
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(grounded_definition(), false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    receive(&mut scene, id, target);
    assert!(scene.apply_authoritative_body_effect(
        id,
        AuthoritativePoseEffect::Observe { pose: target },
        AuthoritativeBodyVectors::default(),
        Instant::now()
    ));
    scene
        .set_dynamic_physical_body(id, None, PhysicalCollisionFilter::ALL, None)
        .unwrap();
    for _ in 0..3 {
        assert_eq!(
            tick(&mut scene, id, RECOVERY_WINDOW_SECONDS),
            RuntimeBodyAdvanceKind::Integrated,
            "physics hydration cannot authorize an obsolete correction"
        );
    }
    receive(&mut scene, id, target);
    assert_eq!(
        tick(&mut scene, id, RECOVERY_WINDOW_SECONDS),
        RuntimeBodyAdvanceKind::CorrectionSnap
    );
}

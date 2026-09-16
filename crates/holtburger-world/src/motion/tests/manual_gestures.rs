use super::*;
use holtburger_common::Guid;

const RELEASE: u32 = 0x4000_002b;
const REACH: u32 = 0x4000_0018;
const ENTRY_ANIM: u32 = 0x0300_0010;
const RETURN_ANIM: u32 = 0x0300_0011;
const HOLD_ANIM: u32 = 0x0300_0012;
const STOP_ANIM: u32 = 0x0300_0013;

fn gesture_catalog() -> MotionSequenceCatalog {
    build_gesture_catalog(false)
}

fn build_gesture_catalog(with_stop: bool) -> MotionSequenceCatalog {
    let cycles = [
        (STAND, STAND_ANIM, 4.0),
        (WALK, WALK_ANIM, 4.0),
        (RELEASE, HOLD_ANIM, 4.0),
        (REACH, HOLD_ANIM, 4.0),
        (MotionCommand::FALLING.raw(), STAND_ANIM, 4.0),
    ]
    .into_iter()
    .map(|(command, animation, rate)| {
        (
            MotionTable::cycle_key(STYLE, command),
            motion(vec![clip(animation, rate)], None, None),
        )
    })
    .collect();
    let mut links = HashMap::from([
        (
            MotionTable::cycle_key(STYLE, STAND),
            HashMap::from([
                (RELEASE, motion(vec![clip(ENTRY_ANIM, 4.0)], None, None)),
                (REACH, motion(vec![clip(ENTRY_ANIM, 4.0)], None, None)),
                (WINDUP, motion(vec![clip(ACTION_ANIM, 4.0)], None, None)),
            ]),
        ),
        (
            MotionTable::cycle_key(STYLE, RELEASE),
            HashMap::from([(STAND, motion(vec![clip(RETURN_ANIM, 4.0)], None, None))]),
        ),
        (
            MotionTable::cycle_key(STYLE, REACH),
            HashMap::from([(STAND, motion(vec![clip(RETURN_ANIM, 4.0)], None, None))]),
        ),
    ]);
    if with_stop {
        links.insert(
            MotionTable::cycle_key(STYLE, WALK),
            HashMap::from([(STAND, motion(vec![clip(STOP_ANIM, 4.0)], None, None))]),
        );
    }
    MotionSequenceCatalog::assemble(
        [MotionTable {
            id: 0x0900_0001,
            default_style: STYLE,
            style_defaults: HashMap::from([(STYLE, STAND)]),
            cycles,
            modifiers: HashMap::new(),
            links,
        }],
        [
            animation(STAND_ANIM, 4, 0.0),
            animation(WALK_ANIM, 4, 1.0),
            animation(ENTRY_ANIM, 4, 0.25),
            animation(RETURN_ANIM, 4, 0.5),
            animation(HOLD_ANIM, 4, 0.0),
            animation(STOP_ANIM, 4, 0.125),
            animation(ACTION_ANIM, 4, 0.1),
        ],
        [],
    )
    .unwrap()
}

fn order(command: u32) -> MotionOrder {
    MotionOrder {
        forward: Some((MotionCommand(command), 1.0)),
        ..MotionOrder::default()
    }
}

#[test]
fn movement_preserves_gesture_entry_hold_and_return_timing() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    for command in [RELEASE, REACH] {
        let mut idle = BodyMotionRuntime::new(table);
        idle.accept_order(table, order(command));
        let mut moving = idle.clone();
        for _ in 0..6 {
            idle.drive(table, order(command), 0.25);
            let tick = moving.drive_manual(
                table,
                order(WALK),
                CharacterMotionPresentation::Grounded,
                0.25,
            );
            assert_eq!(tick.offset.translation.y, 1.0);
            assert_eq!(
                moving
                    .motion_playback()
                    .and_then(|motion| motion.ordinary)
                    .map(|layer| layer.clip),
                idle.motion_playback()
                    .and_then(|motion| motion.ordinary)
                    .map(|layer| layer.clip)
            );
            assert_eq!(
                moving.sequence().frame_number(),
                idle.sequence().frame_number()
            );
        }
        idle.accept_order(table, MotionOrder::default());
        moving.accept_order(table, MotionOrder::default());
        for _ in 0..3 {
            idle.drive(table, MotionOrder::default(), 0.25);
            moving.drive_manual(
                table,
                order(WALK),
                CharacterMotionPresentation::Grounded,
                0.25,
            );
            assert_eq!(
                moving
                    .motion_playback()
                    .and_then(|motion| motion.ordinary)
                    .map(|layer| layer.clip)
                    .unwrap()
                    .animation_id(),
                RETURN_ANIM
            );
            assert_eq!(
                moving.sequence().frame_number(),
                idle.sequence().frame_number()
            );
            assert_eq!(moving.tick().offset.translation.y, 1.0);
        }
        moving.drive_manual(
            table,
            order(WALK),
            CharacterMotionPresentation::Grounded,
            0.5,
        );
        assert_eq!(
            moving
                .motion_playback()
                .and_then(|motion| motion.locomotion)
                .map(|layer| layer.clip)
                .unwrap()
                .animation_id(),
            WALK_ANIM
        );
        assert_eq!(moving.state().substate, MotionCommand(STAND));
    }
}

#[test]
fn stopped_input_preserves_reach_and_new_input_does_not_restart_it() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut runtime = BodyMotionRuntime::new(table);
    runtime.accept_order(table, order(REACH));
    runtime.drive_manual(
        table,
        order(WALK),
        CharacterMotionPresentation::Grounded,
        0.25,
    );
    runtime.drive_manual(
        table,
        MotionOrder::default(),
        CharacterMotionPresentation::Grounded,
        0.25,
    );
    // With no locomotion stop link, the still-playing gesture regains authored displacement.
    assert_eq!(runtime.tick().offset.translation.y, 0.25);
    assert_eq!(runtime.sequence().frame_number(), 2.0);
    runtime.drive_manual(
        table,
        order(WALK),
        CharacterMotionPresentation::Grounded,
        0.25,
    );
    assert_eq!(runtime.sequence().frame_number(), 3.0);
    assert_eq!(runtime.tick().offset.translation.y, 1.0);
}

#[test]
fn queued_windups_continue_while_moving_and_release_remains_the_return_destination() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut idle = BodyMotionRuntime::new(table);
    for sequence in 1..=2 {
        idle.enqueue_action(EntityMotionAction {
            command: MotionCommand(WINDUP),
            ..action(sequence)
        });
    }
    idle.drive(table, MotionOrder::default(), 0.0);
    idle.accept_order(table, order(RELEASE));
    let mut moving = idle.clone();
    for _ in 0..32 {
        idle.drive(table, order(RELEASE), 0.25);
        moving.drive_manual(
            table,
            order(WALK),
            CharacterMotionPresentation::Grounded,
            0.25,
        );
        assert_eq!(moving.active_action(), idle.active_action());
        assert_eq!(moving.action_count(), idle.action_count());
        assert_eq!(
            moving
                .motion_playback()
                .and_then(|motion| motion.ordinary)
                .map(|layer| layer.clip),
            idle.motion_playback()
                .and_then(|motion| motion.ordinary)
                .map(|layer| layer.clip)
        );
        assert_eq!(moving.tick().offset.translation.y, 1.0);
    }
    assert_eq!(moving.action_count(), 0);
    assert_eq!(moving.state().substate, MotionCommand(RELEASE));
}

#[test]
fn airborne_transition_retires_gesture_without_retiring_manual_playback() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut runtime = BodyMotionRuntime::new(table);
    runtime.accept_order(table, order(RELEASE));
    runtime.drive_manual(
        table,
        order(WALK),
        CharacterMotionPresentation::Falling,
        0.0,
    );
    assert_eq!(runtime.state().substate, MotionCommand::FALLING);
    assert!(!runtime.has_pending_gesture());
    assert!(runtime.has_manual_locomotion());
}

#[test]
fn gesture_physics_hooks_survive_manual_displacement_override() {
    let mut hooked_action = hook_animation();
    hooked_action.id = ACTION_ANIM;
    let catalog = catalog_with_action_animation(COMBAT_STAND, 4.0, hooked_action);
    let table = catalog.table(0x0900_0001).unwrap();
    let mut idle = BodyMotionRuntime::new(table);
    idle.enqueue_action(EntityMotionAction {
        command: MotionCommand(WINDUP),
        ..action(1)
    });
    let mut moving = idle.clone();
    let mut hooks = Vec::new();
    for _ in 0..4 {
        idle.drive(table, MotionOrder::default(), 0.25);
        moving.drive_manual(
            table,
            order(WALK),
            CharacterMotionPresentation::Grounded,
            0.25,
        );
        assert_eq!(moving.tick().hooks, idle.tick().hooks);
        assert_eq!(moving.tick().action_completed, idle.tick().action_completed);
        hooks.extend(moving.tick().hooks.clone());
    }
    assert!(!hooks.is_empty());
}

#[test]
fn independent_manual_playback_matches_ordinary_start_and_stop_displacement() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut ordinary = BodyMotionRuntime::new(table);
    let mut manual = BodyMotionRuntime::new(table);
    for _ in 0..8 {
        ordinary.drive(table, order(WALK), 0.25);
        manual.drive_manual(
            table,
            order(WALK),
            CharacterMotionPresentation::Grounded,
            0.25,
        );
        assert_eq!(manual.tick().offset, ordinary.tick().offset);
    }
    for _ in 0..8 {
        ordinary.drive(table, MotionOrder::default(), 0.25);
        manual.drive_manual(
            table,
            MotionOrder::default(),
            CharacterMotionPresentation::Grounded,
            0.25,
        );
        assert_eq!(manual.tick().offset, ordinary.tick().offset);
    }
    assert_eq!(manual.tick().offset, RigidTransform::identity());
}

#[test]
fn stop_transition_keeps_owning_displacement_for_every_tick_under_a_gesture() {
    let catalog = build_gesture_catalog(true);
    let table = catalog.table(0x0900_0001).unwrap();
    let mut runtime = BodyMotionRuntime::new(table);
    runtime.accept_order(table, order(RELEASE));
    runtime.drive_manual(
        table,
        order(WALK),
        CharacterMotionPresentation::Grounded,
        0.25,
    );
    for _ in 0..4 {
        runtime.drive_manual(
            table,
            MotionOrder::default(),
            CharacterMotionPresentation::Grounded,
            0.25,
        );
        assert_eq!(runtime.tick().offset.translation.y, 0.125);
        assert!(runtime.manual_displacement());
        assert!(runtime.has_pending_gesture());
    }
    runtime.drive_manual(
        table,
        MotionOrder::default(),
        CharacterMotionPresentation::Grounded,
        0.25,
    );
    assert_eq!(runtime.tick().offset, RigidTransform::identity());
    assert!(!runtime.manual_displacement());
    assert!(runtime.has_pending_gesture());
}

#[test]
fn manual_turning_and_strafe_preserve_windup_clock() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut runtime = BodyMotionRuntime::new(table);
    runtime.enqueue_action(EntityMotionAction {
        command: MotionCommand(WINDUP),
        ..action(1)
    });
    let mut idle = runtime.clone();
    let mut locomotion = BodyMotionRuntime::new(table);
    for drive in [
        MotionOrder {
            sidestep: Some((MotionCommand(MODIFIER), 1.0)),
            ..MotionOrder::default()
        },
        MotionOrder {
            turn: Some((MotionCommand(DUAL_TURN), 1.0)),
            ..MotionOrder::default()
        },
    ] {
        idle.drive(table, MotionOrder::default(), 0.1);
        locomotion.drive(table, drive, 0.1);
        runtime.drive_manual(table, drive, CharacterMotionPresentation::Grounded, 0.1);
        assert_eq!(runtime.active_action(), idle.active_action());
        assert_eq!(
            runtime.sequence().frame_number(),
            idle.sequence().frame_number()
        );
        assert_eq!(runtime.tick().offset, locomotion.tick().offset);
    }
}

#[test]
fn finishing_windup_does_not_clear_a_newer_release_target() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let caster = Guid(1);
    let target = Guid(2);
    let mut registry = MotionRuntimeRegistry::new();
    registry.enqueue_action(
        table,
        caster,
        EntityMotionAction {
            command: MotionCommand(WINDUP),
            ..action(1)
        },
    );
    registry.drive(table, caster, MotionOrder::default(), 0.0);
    let mut runtime = registry.get(caster).unwrap().clone();
    runtime.accept_order(table, order(RELEASE));
    registry.replace_body(caster, runtime);
    registry.admit_sticky_target(table, caster, Some(target), std::time::Instant::now());
    for _ in 0..5 {
        registry.drive_manual(
            table,
            caster,
            order(WALK),
            CharacterMotionPresentation::Grounded,
            0.25,
        );
        let runtime = registry.get(caster).unwrap();
        assert!(runtime.manual_displacement());
        assert_eq!(runtime.sticky_target(), Some(target));
    }
    assert_eq!(registry.get(caster).unwrap().action_count(), 0);
}

#[test]
fn projection_exposes_both_tracks_with_stable_occurrences_and_receiver_owned_phase() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut runtime = BodyMotionRuntime::new(table);
    runtime.accept_order(table, order(REACH));
    runtime.drive_manual(
        table,
        order(WALK),
        CharacterMotionPresentation::Grounded,
        0.1,
    );
    let first = runtime.motion_playback().unwrap();
    assert_eq!(first.activity, OrdinaryMotionActivity::Gesture);
    assert_eq!(first.ordinary.unwrap().clip.animation_id(), ENTRY_ANIM);
    assert_eq!(first.locomotion.unwrap().clip.animation_id(), WALK_ANIM);
    runtime.drive_manual(
        table,
        order(WALK),
        CharacterMotionPresentation::Grounded,
        0.1,
    );
    assert_eq!(
        runtime.motion_playback(),
        Some(first),
        "host frame advancement is not projected"
    );
    runtime.drive_manual(
        table,
        MotionOrder {
            forward: Some((MotionCommand(WALK), 2.0)),
            ..MotionOrder::default()
        },
        CharacterMotionPresentation::Grounded,
        0.0,
    );
    let retimed = runtime.motion_playback().unwrap();
    assert_eq!(retimed.ordinary, first.ordinary);
    assert_eq!(
        retimed.locomotion.unwrap().playback_id,
        first.locomotion.unwrap().playback_id
    );
    assert_ne!(
        retimed.locomotion.unwrap().clip,
        first.locomotion.unwrap().clip
    );
}

#[test]
fn repeated_identical_windups_have_distinct_occurrences() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut runtime = BodyMotionRuntime::new(table);
    runtime.enqueue_action(EntityMotionAction {
        command: MotionCommand(WINDUP),
        ..action(1)
    });
    runtime.drive(table, MotionOrder::default(), 0.0);
    let first = runtime.motion_playback().unwrap().ordinary.unwrap();
    runtime.drive(table, MotionOrder::default(), 1.25);
    assert_eq!(runtime.action_count(), 0);
    runtime.enqueue_action(EntityMotionAction {
        command: MotionCommand(WINDUP),
        ..action(2)
    });
    runtime.drive(table, MotionOrder::default(), 0.0);
    let next = runtime.motion_playback().unwrap().ordinary.unwrap();
    assert_eq!(first.clip, next.clip);
    assert_ne!(first.playback_id, next.playback_id);
    assert_eq!(
        runtime.clone().motion_playback(),
        runtime.motion_playback(),
        "provisional clones preserve identity"
    );
}

#[test]
fn admitted_windups_and_release_preserve_running_locomotion() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let caster = Guid(1);
    let mut registry = MotionRuntimeRegistry::new();
    registry.drive_manual(
        table,
        caster,
        order(WALK),
        CharacterMotionPresentation::Grounded,
        0.25,
    );
    let locomotion = registry
        .get(caster)
        .unwrap()
        .motion_playback()
        .unwrap()
        .locomotion;
    assert!(locomotion.is_some());

    // Exercise both a batched pair of windups and a later packet before spell release.
    for (command, windups) in [(STAND, vec![1, 2]), (STAND, vec![3]), (RELEASE, vec![])] {
        registry.accept_remote(
            table,
            caster,
            RemoteMotionInput {
                snapshot: EntityMotionSnapshot {
                    forward_command: Some(InterpretedMotionCommand(command as u16)),
                    ..EntityMotionSnapshot::default()
                },
                pose: holtburger_common::position::WorldPosition::default(),
                contact: MotionContact::RequiresSupport(ContactState::Grounded),
                target: None,
                frame_policy: RemoteFramePolicy::Body,
                omega: Vector3::zero(),
            },
            windups.into_iter().map(|sequence| EntityMotionAction {
                command: MotionCommand(WINDUP),
                ..action(sequence)
            }),
            None,
        );
        assert_eq!(
            registry
                .get(caster)
                .unwrap()
                .motion_playback()
                .unwrap()
                .locomotion,
            locomotion,
            "packet admission must preserve the current locomotion occurrence"
        );
        // Cross both queued action boundaries without restarting the hidden walking clip.
        for _ in 0..12 {
            let tick = registry.drive_manual(
                table,
                caster,
                order(WALK),
                CharacterMotionPresentation::Grounded,
                0.25,
            );
            assert_eq!(tick.offset.translation.y, 1.0);
            assert_eq!(
                registry
                    .get(caster)
                    .unwrap()
                    .motion_playback()
                    .unwrap()
                    .locomotion,
                locomotion
            );
        }
        assert_eq!(registry.get(caster).unwrap().action_count(), 0);
    }
}

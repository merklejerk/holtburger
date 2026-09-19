use super::*;
use holtburger_common::Guid;

const RELEASE: u32 = 0x4000_002b;
const REACH: u32 = 0x4000_0018;
const MISSILE_RELOAD: u32 = 0x4000_0016;
const MISSILE_AIM: u32 = 0x4000_001e;
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
        (MISSILE_RELOAD, HOLD_ANIM, 4.0),
        (MISSILE_AIM, HOLD_ANIM, 4.0),
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
                (
                    MISSILE_RELOAD,
                    motion(vec![clip(ENTRY_ANIM, 4.0)], None, None),
                ),
                (MISSILE_AIM, motion(vec![clip(ENTRY_ANIM, 4.0)], None, None)),
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
        (
            MotionTable::cycle_key(STYLE, MISSILE_RELOAD),
            HashMap::from([(STAND, motion(vec![clip(RETURN_ANIM, 4.0)], None, None))]),
        ),
        (
            MotionTable::cycle_key(STYLE, MISSILE_AIM),
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
    for command in [RELEASE, REACH, MISSILE_AIM, MISSILE_RELOAD] {
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
    for presentation in [
        CharacterMotionPresentation::Grounded,
        CharacterMotionPresentation::Falling,
    ] {
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
            moving.drive_manual(table, order(WALK), presentation, 0.25);
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
            assert_eq!(
                moving.tick().offset.translation.y,
                if presentation == CharacterMotionPresentation::Grounded {
                    1.0
                } else {
                    0.0
                }
            );
        }
        assert_eq!(moving.action_count(), 0);
        assert_eq!(moving.state().substate, MotionCommand(RELEASE));
    }
}

#[test]
fn gestures_continue_through_takeoff_airborne_input_release_and_landing() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    for command in [RELEASE, REACH, MISSILE_AIM, MISSILE_RELOAD] {
        let mut idle = BodyMotionRuntime::new(table);
        idle.accept_order(table, order(command));
        let mut airborne = idle.clone();
        for (presentation, input) in [
            (CharacterMotionPresentation::Grounded, order(WALK)),
            (CharacterMotionPresentation::Falling, order(WALK)),
            (CharacterMotionPresentation::Falling, MotionOrder::default()),
            (CharacterMotionPresentation::Falling, MotionOrder::default()),
            (
                CharacterMotionPresentation::Grounded,
                MotionOrder::default(),
            ),
        ] {
            idle.drive(table, order(command), 0.25);
            airborne.drive_manual(table, input, presentation, 0.25);
            let playback = airborne.motion_playback().unwrap();
            assert_eq!(playback.ordinary, idle.motion_playback().unwrap().ordinary);
            assert_eq!(playback.activity, OrdinaryMotionActivity::Gesture);
            assert!(airborne.has_pending_gesture());
            assert!(airborne.has_manual_locomotion());
            assert_eq!(airborne.tick().hooks, idle.tick().hooks);
            assert_eq!(playback.locomotion_command_active, input.forward.is_some());
            if presentation == CharacterMotionPresentation::Falling {
                let mut falling = BodyMotionRuntime::new(table);
                falling.drive(table, order(MotionCommand::FALLING.raw()), 0.25);
                assert_eq!(
                    playback.locomotion.unwrap().clip,
                    falling.motion_playback().unwrap().ordinary.unwrap().clip,
                );
                assert_eq!(airborne.tick().offset.translation.y, 0.0);
            }
        }
    }
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
fn admitted_windups_and_release_preserve_manual_locomotion() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    for contact in [ContactState::Grounded, ContactState::Airborne] {
        let presentation = CharacterMotionPresentation::resolve(contact, false, false);
        let caster = Guid(1);
        let mut registry = MotionRuntimeRegistry::new();
        registry.drive_manual(table, caster, order(WALK), presentation, 0.25);
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
                    contact: MotionContact::RequiresSupport(contact),
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
            let runtime = registry.get(caster).unwrap();
            assert!(runtime.permits_gesture_locomotion(table));
            assert_eq!(
                runtime.motion_playback().unwrap().activity,
                OrdinaryMotionActivity::Gesture
            );
            // Cross both queued action boundaries without restarting the hidden locomotion clip.
            for _ in 0..12 {
                let tick = registry.drive_manual(table, caster, order(WALK), presentation, 0.25);
                assert_eq!(
                    tick.offset.translation.y,
                    if contact == ContactState::Grounded {
                        1.0
                    } else {
                        0.0
                    }
                );
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
}

#[test]
fn retained_locomotion_does_not_report_active_commands_after_release() {
    let catalog = build_gesture_catalog(true);
    let table = catalog.table(0x0900_0001).unwrap();
    for manual in [false, true] {
        let mut runtime = BodyMotionRuntime::new(table);
        runtime.accept_order(table, order(RELEASE));
        for (input, active) in [
            (order(WALK), true),
            (MotionOrder::default(), false),
            (order(WALK), true),
        ] {
            if manual {
                runtime.drive_manual(table, input, CharacterMotionPresentation::Grounded, 0.1);
            } else {
                runtime.present_locomotion(table, input, 0.1);
            }
            let playback = runtime.motion_playback().unwrap();
            assert!(playback.locomotion.is_some());
            assert_eq!(playback.locomotion_command_active, active);
        }
    }
}

#[test]
fn airborne_stance_changes_skip_grounded_routes_without_discarding_casting() {
    let falling = MotionCommand::FALLING.raw();
    let styles = [STYLE, COMBAT_STYLE];
    let catalog = MotionSequenceCatalog::assemble(
        [MotionTable {
            id: 0x0900_0001,
            default_style: STYLE,
            style_defaults: styles.into_iter().map(|style| (style, STAND)).collect(),
            cycles: styles
                .into_iter()
                .flat_map(|style| {
                    [
                        (STAND, STAND_ANIM),
                        (falling, WALK_ANIM),
                        (RELEASE, HOLD_ANIM),
                    ]
                    .map(|(command, anim)| {
                        (
                            MotionTable::cycle_key(style, command),
                            motion(vec![clip(anim, 4.0)], None, None),
                        )
                    })
                })
                .collect(),
            modifiers: HashMap::new(),
            links: styles
                .into_iter()
                .flat_map(|style| {
                    [
                        (
                            MotionTable::cycle_key(style, STAND),
                            HashMap::from([
                                (falling, motion(vec![clip(ENTRY_ANIM, 4.0)], None, None)),
                                (
                                    if style == STYLE { COMBAT_STYLE } else { STYLE },
                                    motion(vec![clip(STOP_ANIM, 4.0)], None, None),
                                ),
                            ]),
                        ),
                        (
                            MotionTable::cycle_key(style, falling),
                            HashMap::from([(
                                STAND,
                                motion(vec![clip(RETURN_ANIM, 4.0)], None, None),
                            )]),
                        ),
                    ]
                })
                .collect(),
        }],
        [
            STAND_ANIM,
            WALK_ANIM,
            HOLD_ANIM,
            ENTRY_ANIM,
            STOP_ANIM,
            RETURN_ANIM,
        ]
        .map(|id| animation(id, 4, 0.0)),
        [],
    )
    .unwrap();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut runtime = BodyMotionRuntime::new(table);
    runtime.accept_order(table, order(RELEASE));
    runtime.drive_manual(
        table,
        MotionOrder {
            style: Some(MotionCommand(STYLE)),
            ..MotionOrder::default()
        },
        CharacterMotionPresentation::Falling,
        0.0,
    );
    let takeoff = runtime.motion_playback().unwrap();
    assert_eq!(takeoff.locomotion.unwrap().clip.animation_id(), ENTRY_ANIM);
    // Rejected stance selection must not discard the takeoff already in progress.
    let mut rejected = runtime.clone();
    rejected.drive_manual(
        table,
        MotionOrder {
            style: Some(MotionCommand(0x8000_ffff)),
            ..MotionOrder::default()
        },
        CharacterMotionPresentation::Falling,
        0.0,
    );
    assert_eq!(
        rejected.motion_playback().unwrap().locomotion,
        takeoff.locomotion
    );
    // Both directions occur during a real cast: entering magic stance and returning from it.
    for style in [COMBAT_STYLE, STYLE] {
        runtime.drive_manual(
            table,
            MotionOrder {
                style: Some(MotionCommand(style)),
                ..MotionOrder::default()
            },
            CharacterMotionPresentation::Falling,
            0.1,
        );
        let playback = runtime.motion_playback().unwrap();
        assert_eq!(playback.activity, OrdinaryMotionActivity::Gesture);
        assert_eq!(playback.ordinary, takeoff.ordinary);
        assert_eq!(playback.locomotion.unwrap().clip.animation_id(), WALK_ANIM);
    }
    // Unsupported cast content must leave an observer's authored takeoff intact.
    let guid = Guid(1);
    let mut unsupported = MotionRuntimeRegistry::new();
    unsupported.drive_remote(
        table,
        guid,
        remote_gesture_input(STAND, ContactState::Airborne),
        0.1,
    );
    let takeoff = unsupported.motion_playback(guid).unwrap().ordinary;
    assert_eq!(takeoff.unwrap().clip.animation_id(), ENTRY_ANIM);
    unsupported.accept_remote(
        table,
        guid,
        remote_gesture_input(REACH, ContactState::Airborne),
        [],
        None,
    );
    assert_eq!(unsupported.motion_playback(guid).unwrap().ordinary, takeoff);

    let guid = Guid(1);
    let mut registry = MotionRuntimeRegistry::new();
    for style in [STYLE, COMBAT_STYLE, STYLE] {
        let mut input = remote_gesture_input(RELEASE, ContactState::Airborne);
        input.snapshot.current_style =
            Some(holtburger_protocol::messages::movement::MotionStance::from_repr(style).unwrap());
        registry.accept_remote(table, guid, input, [], None);
        let mut input = remote_gesture_input(RELEASE, ContactState::Airborne);
        input.snapshot.current_style =
            Some(holtburger_protocol::messages::movement::MotionStance::from_repr(style).unwrap());
        registry.drive_remote(table, guid, input, 0.1);
        registry.present_locomotion(
            table,
            guid,
            MotionOrder {
                style: Some(MotionCommand(style)),
                forward: Some((MotionCommand::FALLING, 1.0)),
                ..MotionOrder::default()
            },
            0.1,
        );
        let playback = registry.motion_playback(guid).unwrap();
        assert_eq!(playback.activity, OrdinaryMotionActivity::Gesture);
        assert_eq!(
            registry.state(guid).unwrap().substate,
            MotionCommand(RELEASE)
        );
        assert_eq!(playback.locomotion.unwrap().clip.animation_id(), WALK_ANIM);
    }
}

/// Remote packets carry the gesture independently of the observer's support state.
fn remote_gesture_input(command: u32, contact: ContactState) -> RemoteMotionInput {
    RemoteMotionInput {
        snapshot: EntityMotionSnapshot {
            forward_command: Some(InterpretedMotionCommand(command as u16)),
            ..EntityMotionSnapshot::default()
        },
        pose: holtburger_common::position::WorldPosition::default(),
        contact: MotionContact::RequiresSupport(contact),
        target: None,
        frame_policy: RemoteFramePolicy::Command,
        omega: Vector3::zero(),
    }
}

#[test]
fn remote_gestures_keep_their_clock_through_airborne_admission_and_return() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = Guid(1);
    for initial_contact in [ContactState::Grounded, ContactState::Airborne] {
        let mut registry = MotionRuntimeRegistry::new();
        // Start with an established airborne observer too: eligibility must not require
        // its previous ordinary state to be an idle or casting pose.
        registry.drive_remote(
            table,
            guid,
            remote_gesture_input(STAND, initial_contact),
            0.1,
        );
        for (command, windups) in [(STAND, vec![1, 2]), (RELEASE, vec![]), (STAND, vec![])] {
            registry.accept_remote(
                table,
                guid,
                remote_gesture_input(command, initial_contact),
                windups.into_iter().map(|sequence| EntityMotionAction {
                    command: MotionCommand(WINDUP),
                    ..action(sequence)
                }),
                None,
            );
            let mut grounded = registry.get(guid).unwrap().clone();
            assert_eq!(
                grounded.motion_playback().unwrap().activity,
                OrdinaryMotionActivity::Gesture
            );
            for contact in [
                ContactState::Airborne,
                ContactState::Sliding,
                ContactState::Grounded,
            ] {
                for _ in 0..2 {
                    grounded.drive(table, order(command), 0.25);
                    let tick = registry
                        .drive_remote(table, guid, remote_gesture_input(command, contact), 0.25)
                        .clone();
                    let runtime = registry.get(guid).unwrap();
                    assert_eq!(
                        runtime.sequence().frame_number(),
                        grounded.sequence().frame_number()
                    );
                    assert_eq!(
                        runtime
                            .motion_playback()
                            .unwrap()
                            .ordinary
                            .map(|layer| layer.clip),
                        grounded
                            .motion_playback()
                            .unwrap()
                            .ordinary
                            .map(|layer| layer.clip)
                    );
                    assert_eq!(tick.hooks, grounded.tick().hooks);
                    assert_eq!(tick.action_completed, grounded.tick().action_completed);
                    // The observed leg track cannot mutate the physical source or cast cursor.
                    let sample = runtime.remote_motion_sample();
                    registry.present_locomotion(
                        table,
                        guid,
                        order(WALK).with_character_presentation(
                            CharacterMotionPresentation::resolve(contact, false, false),
                        ),
                        0.25,
                    );
                    assert_eq!(registry.get(guid).unwrap().remote_motion_sample(), sample);
                }
            }
        }
    }
}

#[test]
fn remote_missile_aim_and_reload_compose_with_observed_locomotion() {
    let catalog = gesture_catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = Guid(1);
    for command in [MISSILE_AIM, MISSILE_RELOAD] {
        let mut registry = MotionRuntimeRegistry::new();
        registry.accept_remote(
            table,
            guid,
            remote_gesture_input(command, ContactState::Grounded),
            [],
            None,
        );
        let ordinary = registry.motion_playback(guid).unwrap().ordinary;
        for contact in [
            ContactState::Grounded,
            ContactState::Airborne,
            ContactState::Sliding,
        ] {
            registry.drive_remote(table, guid, remote_gesture_input(command, contact), 0.25);
            registry.present_locomotion(
                table,
                guid,
                order(WALK).with_character_presentation(CharacterMotionPresentation::resolve(
                    contact, false, false,
                )),
                0.25,
            );
            let playback = registry.motion_playback(guid).unwrap();
            assert_eq!(playback.activity, OrdinaryMotionActivity::Gesture);
            assert_eq!(playback.ordinary, ordinary);
            assert!(playback.locomotion.is_some());
            assert_eq!(
                registry.state(guid).unwrap().substate,
                MotionCommand(command)
            );
        }
    }
}

#[test]
fn remote_airborne_windups_deliver_hooks_once_and_complete() {
    let mut hooked_action = hook_animation();
    hooked_action.id = ACTION_ANIM;
    let catalog = catalog_with_action_animation(COMBAT_STAND, 4.0, hooked_action);
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = Guid(1);
    let mut registry = MotionRuntimeRegistry::new();
    registry.accept_remote(
        table,
        guid,
        remote_gesture_input(STAND, ContactState::Airborne),
        [EntityMotionAction {
            command: MotionCommand(WINDUP),
            ..action(1)
        }],
        None,
    );
    let mut grounded = registry.get(guid).unwrap().clone();
    let mut hooks = Vec::new();
    let mut completions = 0;
    for _ in 0..4 {
        grounded.drive(table, order(STAND), 0.25);
        let tick = registry.drive_remote(
            table,
            guid,
            remote_gesture_input(STAND, ContactState::Airborne),
            0.25,
        );
        assert_eq!(tick.hooks, grounded.tick().hooks);
        assert_eq!(tick.action_completed, grounded.tick().action_completed);
        hooks.extend(tick.hooks.clone());
        completions += usize::from(tick.action_completed);
    }
    assert!(!hooks.is_empty());
    assert_eq!(completions, 1);
}

#[test]
fn remote_directives_and_unrelated_actions_keep_airborne_priority() {
    let motion_catalog = gesture_catalog();
    let table = motion_catalog.table(0x0900_0001).unwrap();
    let guid = Guid(1);
    let mut registry = MotionRuntimeRegistry::new();
    registry.accept_remote(
        table,
        guid,
        remote_gesture_input(RELEASE, ContactState::Airborne),
        [],
        None,
    );
    let mut directed = remote_gesture_input(RELEASE, ContactState::Airborne);
    directed.snapshot.directive = Some(crate::entity::EntityMotionDirective::TurnToHeading {
        admission: EntityMotionAdmission {
            object_instance_sequence: 1,
            movement_sequence: 2,
            server_control_sequence: 3,
            is_autonomous: false,
        },
        params: crate::entity::EntityTurnToParameters {
            flags: 0,
            speed: OrderedMotionScalar::from_f32(1.0).unwrap(),
            desired_heading_degrees: OrderedMotionScalar::from_f32(0.0).unwrap(),
        },
    });
    registry.accept_remote(table, guid, directed, [], None);
    assert_eq!(
        registry.state(guid).unwrap().substate,
        MotionCommand::FALLING
    );

    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    registry.enqueue_action(table, guid, action(1));
    registry.drive(table, guid, MotionOrder::default(), 0.1);
    registry.accept_remote(
        table,
        guid,
        remote_gesture_input(RELEASE, ContactState::Airborne),
        [],
        None,
    );
    assert_ne!(
        registry.state(guid).unwrap().substate,
        MotionCommand(RELEASE)
    );
    assert_eq!(registry.get(guid).unwrap().action_count(), 1);
}

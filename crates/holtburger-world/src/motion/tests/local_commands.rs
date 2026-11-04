use super::*;
use crate::entity::{EntityMotionAdmission, OrderedMotionScalar};
use holtburger_common::Guid;

const BOW: MotionCommand = MotionCommand(0x4300_00ec);
const BOW_ANIM: u32 = 0x0300_0020;
const WAVE: MotionCommand = MotionCommand(0x1300_0087);

fn local_catalog() -> MotionSequenceCatalog {
    let data = |id| motion(vec![clip(id, 4.0)], None, None);
    MotionSequenceCatalog::assemble(
        [MotionTable {
            id: TABLE,
            default_style: STYLE,
            style_defaults: HashMap::from([(STYLE, STAND), (COMBAT_STYLE, COMBAT_STAND)]),
            cycles: HashMap::from([
                (MotionTable::cycle_key(STYLE, STAND), data(STAND_ANIM)),
                (
                    MotionTable::cycle_key(COMBAT_STYLE, COMBAT_STAND),
                    data(STAND_ANIM),
                ),
                (MotionTable::cycle_key(STYLE, BOW.raw()), data(BOW_ANIM)),
                (MotionTable::cycle_key(STYLE, WALK), data(WALK_ANIM)),
            ]),
            modifiers: HashMap::new(),
            links: HashMap::from([
                (
                    MotionTable::cycle_key(STYLE, STAND),
                    HashMap::from([(ACTION, data(ACTION_ANIM)), (WAVE.raw(), data(ACTION_ANIM))]),
                ),
                (
                    MotionTable::cycle_key(STYLE, BOW.raw()),
                    HashMap::from([(STAND, data(LINK_ANIM)), (ACTION, data(ACTION_ANIM))]),
                ),
            ]),
        }],
        [STAND_ANIM, BOW_ANIM, WALK_ANIM, ACTION_ANIM, LINK_ANIM].map(|id| animation(id, 4, 0.0)),
        [],
    )
    .unwrap()
}

const TABLE: u32 = 0x0900_0001;
const BODY: Guid = Guid(1);

fn submit(
    registry: &mut MotionRuntimeRegistry,
    table: &MotionSequenceTable,
    command: MotionCommand,
    sequence: u16,
) -> MotionCommandAdmissionOutcome {
    registry.submit_local_command(
        table,
        BODY,
        MotionCommand(table.default_style),
        crate::motion::LocalMotionCommand {
            command,
            request_id: Some(u32::from(sequence)),
        },
        OrderedMotionScalar::from_f32(1.0).unwrap(),
        EntityMotionAdmission {
            object_instance_sequence: 0,
            movement_sequence: sequence,
            server_control_sequence: 0,
            is_autonomous: true,
        },
    )
}

#[test]
fn local_pose_advances_and_remains_selected_until_new_manual_movement() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    assert_eq!(
        submit(&mut registry, table, BOW, 1),
        MotionCommandAdmissionOutcome::Accepted
    );
    registry.advance_local_command(table, BODY, 0.25).unwrap();
    let runtime = registry.get(BODY).unwrap();
    assert_eq!(runtime.state().substate, BOW);
    let before = runtime.collision_pose();
    // Idle input left over from an earlier manual controller does not erase the newer pose.
    registry.drive_manual(
        table,
        BODY,
        MotionOrder::default(),
        CharacterMotionPresentation::Grounded,
        0.25,
    );
    let runtime = registry.get(BODY).unwrap();
    assert!(runtime.has_local_command());
    assert_eq!(runtime.state().substate, BOW);
    assert_ne!(runtime.collision_pose(), before);
    registry.drive_manual(
        table,
        BODY,
        MotionOrder {
            forward: Some((MotionCommand(WALK), 1.0)),
            ..Default::default()
        },
        CharacterMotionPresentation::Grounded,
        0.25,
    );
    let runtime = registry.get(BODY).unwrap();
    assert!(!runtime.has_local_command());
    assert_eq!(runtime.state().substate, MotionCommand(WALK));
}

#[test]
fn local_action_returns_to_retained_pose_and_pose_replacement_does_not_enter_action_queue() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    submit(&mut registry, table, BOW, 1);
    submit(&mut registry, table, MotionCommand(ACTION), 2);
    registry.advance_local_command(table, BODY, 0.0).unwrap();
    assert_eq!(registry.get(BODY).unwrap().action_count(), 1);
    registry.advance_local_command(table, BODY, 2.0).unwrap();
    let runtime = registry.get(BODY).unwrap();
    assert_eq!(runtime.state().substate, BOW);
    assert_eq!(runtime.action_count(), 0);
    assert!(runtime.has_local_command());
    submit(&mut registry, table, BOW, 3);
    assert_eq!(registry.get(BODY).unwrap().action_count(), 0);
}

#[test]
fn action_then_pose_retargets_the_action_return_and_retains_the_action_queue_bound() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    submit(&mut registry, table, MotionCommand(ACTION), 1);
    registry.advance_local_command(table, BODY, 0.0).unwrap();
    submit(&mut registry, table, BOW, 2);
    registry.advance_local_command(table, BODY, 2.0).unwrap();
    assert_eq!(registry.state(BODY).unwrap().substate, BOW);
    for sequence in 3..3 + MAX_AUTHORED_ACTIONS as u16 {
        assert_eq!(
            submit(&mut registry, table, MotionCommand(ACTION), sequence),
            MotionCommandAdmissionOutcome::Accepted
        );
    }
    assert_eq!(
        submit(
            &mut registry,
            table,
            MotionCommand(ACTION),
            3 + MAX_AUTHORED_ACTIONS as u16
        ),
        MotionCommandAdmissionOutcome::QueueFull
    );
    registry.release_local_command(BODY);
    assert!(!registry.get(BODY).unwrap().has_local_command());
}

#[test]
fn unsupported_local_command_class_does_not_acquire_playback_ownership() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    assert_eq!(
        submit(&mut registry, table, MotionCommand(STYLE), 1),
        MotionCommandAdmissionOutcome::Unsupported
    );
    assert!(!registry.get(BODY).unwrap().has_local_command());
    assert_eq!(registry.get(BODY).unwrap().action_count(), 0);
}

#[test]
fn social_activity_tracks_queued_actions_and_held_poses_until_they_are_left() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    for sequence in 1..=2 {
        assert_eq!(
            submit(&mut registry, table, WAVE, sequence),
            MotionCommandAdmissionOutcome::Accepted
        );
    }
    assert_eq!(
        registry
            .get(BODY)
            .unwrap()
            .motion_playback()
            .unwrap()
            .activity,
        OrdinaryMotionActivity::Emote
    );
    registry.advance_local_command(table, BODY, 0.5);
    assert_eq!(
        registry
            .get(BODY)
            .unwrap()
            .motion_playback()
            .unwrap()
            .activity,
        OrdinaryMotionActivity::Emote
    );
    for _ in 0..2 {
        registry.advance_local_command(table, BODY, 2.0);
    }
    assert_eq!(
        registry
            .get(BODY)
            .unwrap()
            .motion_playback()
            .unwrap()
            .activity,
        OrdinaryMotionActivity::Locomotion
    );
    submit(&mut registry, table, BOW, 3);
    registry.advance_local_command(table, BODY, 100.0);
    assert_eq!(
        registry
            .get(BODY)
            .unwrap()
            .motion_playback()
            .unwrap()
            .activity,
        OrdinaryMotionActivity::Emote
    );
    registry.drive_manual(
        table,
        BODY,
        MotionOrder {
            forward: Some((MotionCommand(WALK), 1.0)),
            ..Default::default()
        },
        CharacterMotionPresentation::Grounded,
        4.0,
    );
    assert_eq!(
        registry
            .get(BODY)
            .unwrap()
            .motion_playback()
            .unwrap()
            .activity,
        OrdinaryMotionActivity::Locomotion
    );
}

#[test]
fn gameplay_postures_retain_their_target_and_transition_to_each_other() {
    use crate::motion::RestPosture;
    let postures = [
        RestPosture::Standing,
        RestPosture::Crouching,
        RestPosture::Sitting,
        RestPosture::Lying,
    ];
    let data = |id| motion(vec![clip(id, 4.0)], None, None);
    let catalog = MotionSequenceCatalog::assemble(
        [MotionTable {
            id: TABLE,
            default_style: STYLE,
            style_defaults: HashMap::from([(STYLE, RestPosture::Standing.command().raw())]),
            cycles: postures
                .into_iter()
                .map(|posture| {
                    (
                        MotionTable::cycle_key(STYLE, posture.command().raw()),
                        data(STAND_ANIM),
                    )
                })
                .chain([(MotionTable::cycle_key(STYLE, WALK), data(WALK_ANIM))])
                .collect(),
            modifiers: HashMap::new(),
            links: postures
                .map(|from| {
                    (
                        MotionTable::cycle_key(STYLE, from.command().raw()),
                        postures
                            .into_iter()
                            .filter(|to| *to != from)
                            .map(|to| (to.command().raw(), data(LINK_ANIM)))
                            .collect(),
                    )
                })
                .into(),
        }],
        [
            animation(STAND_ANIM, 4, 0.0),
            animation(LINK_ANIM, 4, 0.0),
            animation(WALK_ANIM, 4, 0.0),
        ],
        [],
    )
    .unwrap();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    for (index, posture) in postures
        .into_iter()
        .chain([RestPosture::Standing])
        .enumerate()
    {
        assert_eq!(
            submit(&mut registry, table, posture.command(), index as u16 + 1),
            MotionCommandAdmissionOutcome::Accepted
        );
        for _ in 0..20 {
            registry.advance_local_command(table, BODY, 0.5);
        }
        let runtime = registry.get(BODY).unwrap();
        assert_eq!(
            runtime.has_local_command(),
            posture != RestPosture::Standing
        );
        assert_eq!(runtime.state().substate, posture.command());
        let playback = runtime.motion_playback().unwrap();
        assert_eq!(playback.rest_posture, Some(posture));
        assert_ne!(playback.activity, OrdinaryMotionActivity::Emote);
    }
    // Check movement takeover separately so the loop above really exercises posture-to-posture links.
    for posture in postures
        .into_iter()
        .filter(|posture| *posture != RestPosture::Standing)
    {
        assert_eq!(
            submit(&mut registry, table, posture.command(), 20),
            MotionCommandAdmissionOutcome::Accepted
        );
        registry.drive_manual(
            table,
            BODY,
            MotionOrder {
                forward: Some((MotionCommand::WALK_FORWARD, 1.0)),
                ..MotionOrder::default()
            },
            CharacterMotionPresentation::Grounded,
            0.5,
        );
        let runtime = registry.get(BODY).unwrap();
        assert!(!runtime.has_local_command());
        assert_eq!(runtime.state().substate, MotionCommand::WALK_FORWARD);
    }
    assert_eq!(RestPosture::from_command(BOW), None);
    assert_eq!(
        RestPosture::from_command(MotionCommand(0x4300_00f7)),
        None,
        "social kneel is not a rest posture"
    );
    assert_eq!(
        RestPosture::from_command(MotionCommand(0x4300_013d)),
        None,
        "social sit is not a rest posture"
    );
}

#[test]
fn local_action_reports_admission_and_exact_completion_even_with_one_large_tick() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    submit(&mut registry, table, WAVE, 1);
    registry.advance_local_command(table, BODY, 2.0);
    assert_eq!(
        registry.take_local_feedback(BODY),
        vec![
            LocalMotionFeedback {
                request_id: 1,
                outcome: LocalMotionOutcome::Accepted
            },
            LocalMotionFeedback {
                request_id: 1,
                outcome: LocalMotionOutcome::Completed
            },
        ]
    );
}

#[test]
fn unavailable_local_action_reports_failure_instead_of_disappearing() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    let shake_fist = MotionCommand(0x1300_0079);
    submit(&mut registry, table, shake_fist, 1);
    registry.advance_local_command(table, BODY, 0.0);
    assert_eq!(
        registry.take_local_feedback(BODY),
        vec![
            LocalMotionFeedback {
                request_id: 1,
                outcome: LocalMotionOutcome::Accepted
            },
            LocalMotionFeedback {
                request_id: 1,
                outcome: LocalMotionOutcome::Unsupported
            },
        ]
    );
}

#[test]
fn held_local_pose_completes_only_after_its_exit_reaches_locomotion() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    submit(&mut registry, table, BOW, 1);
    registry.advance_local_command(table, BODY, 20.0);
    assert_eq!(
        registry.take_local_feedback(BODY),
        vec![LocalMotionFeedback {
            request_id: 1,
            outcome: LocalMotionOutcome::Accepted
        }]
    );
    registry.drive_manual(
        table,
        BODY,
        MotionOrder {
            forward: Some((MotionCommand(WALK), 1.0)),
            ..MotionOrder::default()
        },
        CharacterMotionPresentation::Grounded,
        0.0,
    );
    assert!(registry.take_local_feedback(BODY).is_empty());
    registry.drive_manual(
        table,
        BODY,
        MotionOrder {
            forward: Some((MotionCommand(WALK), 1.0)),
            ..MotionOrder::default()
        },
        CharacterMotionPresentation::Grounded,
        2.0,
    );
    assert_eq!(
        registry.take_local_feedback(BODY),
        vec![LocalMotionFeedback {
            request_id: 1,
            outcome: LocalMotionOutcome::Completed
        }]
    );
}

#[test]
fn caller_identity_is_not_narrowed_to_the_wrapping_wire_stamp() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    let request_id = u32::MAX;
    registry.submit_local_command(
        table,
        BODY,
        MotionCommand(table.default_style),
        crate::motion::LocalMotionCommand {
            command: WAVE,
            request_id: Some(request_id),
        },
        OrderedMotionScalar::from_f32(1.0).unwrap(),
        EntityMotionAdmission {
            object_instance_sequence: 0,
            movement_sequence: 1,
            server_control_sequence: 0,
            is_autonomous: true,
        },
    );
    registry.advance_local_command(table, BODY, 2.0);
    assert_eq!(
        registry.take_local_feedback(BODY),
        vec![
            LocalMotionFeedback {
                request_id,
                outcome: LocalMotionOutcome::Accepted
            },
            LocalMotionFeedback {
                request_id,
                outcome: LocalMotionOutcome::Completed
            },
        ]
    );
}

#[test]
fn local_action_routes_from_the_accepted_stance_instead_of_retained_combat_playback() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    registry.drive(
        table,
        BODY,
        MotionOrder {
            style: Some(MotionCommand(COMBAT_STYLE)),
            ..MotionOrder::default()
        },
        0.0,
    );
    assert_eq!(registry.state(BODY).unwrap().style.raw(), COMBAT_STYLE);
    submit(&mut registry, table, WAVE, 1);
    registry.advance_local_command(table, BODY, 2.0);
    assert_eq!(registry.state(BODY).unwrap().style.raw(), STYLE);
    assert_eq!(
        registry.take_local_feedback(BODY),
        vec![
            LocalMotionFeedback {
                request_id: 1,
                outcome: LocalMotionOutcome::Accepted
            },
            LocalMotionFeedback {
                request_id: 1,
                outcome: LocalMotionOutcome::Completed
            },
        ]
    );
}

#[test]
fn unavailable_pose_does_not_replace_the_retained_pose_or_its_completion_owner() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    submit(&mut registry, table, BOW, 1);
    assert_eq!(
        submit(&mut registry, table, MotionCommand(0x4300_0144), 2),
        MotionCommandAdmissionOutcome::Unsupported
    );
    assert_eq!(registry.state(BODY).unwrap().substate, BOW);
    assert_eq!(
        registry.take_local_feedback(BODY),
        vec![LocalMotionFeedback {
            request_id: 1,
            outcome: LocalMotionOutcome::Accepted
        }]
    );
}

#[test]
fn new_one_shot_emote_replaces_a_held_pose_and_finishes_at_standing() {
    for advance_held_pose in [false, true] {
        let catalog = local_catalog();
        let table = catalog.table(TABLE).unwrap();
        let mut registry = MotionRuntimeRegistry::new();
        submit(&mut registry, table, BOW, 1);
        if advance_held_pose {
            registry.advance_local_command(table, BODY, 2.0);
        }
        registry.take_local_feedback(BODY);
        assert_eq!(
            submit(&mut registry, table, WAVE, 2),
            MotionCommandAdmissionOutcome::Accepted
        );
        assert_eq!(
            registry.take_local_feedback(BODY),
            vec![
                LocalMotionFeedback {
                    request_id: 1,
                    outcome: LocalMotionOutcome::Superseded
                },
                LocalMotionFeedback {
                    request_id: 2,
                    outcome: LocalMotionOutcome::Accepted
                },
            ]
        );
        registry.advance_local_command(table, BODY, 0.0);
        assert!(registry.take_local_feedback(BODY).is_empty());
        registry.advance_local_command(table, BODY, 3.0);
        assert_eq!(registry.state(BODY).unwrap().substate.raw(), STAND);
        assert_eq!(
            registry.take_local_feedback(BODY),
            vec![LocalMotionFeedback {
                request_id: 2,
                outcome: LocalMotionOutcome::Completed
            }]
        );
    }
}

#[test]
fn removed_body_results_survive_recreation_until_consumed() {
    for bulk_removal in [false, true] {
        let catalog = local_catalog();
        let table = catalog.table(TABLE).unwrap();
        let mut registry = MotionRuntimeRegistry::new();
        submit(&mut registry, table, MotionCommand(ACTION), 1);
        submit(&mut registry, table, BOW, 2);
        registry.advance_local_command(table, BODY, 0.0);
        registry.take_local_feedback(BODY);
        if bulk_removal {
            registry.retain_bodies(|_| false);
        } else {
            registry.forget(BODY);
        }
        submit(&mut registry, table, BOW, 3);
        assert_eq!(
            registry.take_local_feedback(BODY),
            vec![
                LocalMotionFeedback {
                    request_id: 1,
                    outcome: LocalMotionOutcome::Cancelled
                },
                LocalMotionFeedback {
                    request_id: 2,
                    outcome: LocalMotionOutcome::Cancelled
                },
                LocalMotionFeedback {
                    request_id: 3,
                    outcome: LocalMotionOutcome::Accepted
                },
            ]
        );
    }
}

#[test]
fn a_new_caller_epoch_retires_correlation_without_interrupting_playback() {
    let catalog = local_catalog();
    let table = catalog.table(TABLE).unwrap();
    let mut registry = MotionRuntimeRegistry::new();
    submit(&mut registry, table, BOW, 1);
    submit(&mut registry, table, MotionCommand(ACTION), 2);
    registry.advance_local_command(table, BODY, 0.0);
    registry.retire_local_requests(BODY);
    assert_eq!(registry.get(BODY).unwrap().action_count(), 1);
    submit(&mut registry, table, WAVE, 3);
    registry.advance_local_command(table, BODY, 3.0);
    registry.advance_local_command(table, BODY, 3.0);
    assert_eq!(
        registry.take_local_feedback(BODY),
        vec![
            LocalMotionFeedback {
                request_id: 3,
                outcome: LocalMotionOutcome::Accepted
            },
            LocalMotionFeedback {
                request_id: 3,
                outcome: LocalMotionOutcome::Completed
            },
        ]
    );
}

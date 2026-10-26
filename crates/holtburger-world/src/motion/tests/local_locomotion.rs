use super::*;
use holtburger_common::properties::{PropertyDataId, WorldObjectPropertyAccessorsMut};

const NATIVE_TABLE: u32 = 0x0900_1000;
const NATIVE_IDLE: u32 = 0x4000_0004;
const NATIVE_IDLE_ANIMATION: u32 = 0x0300_1000;
const NATIVE_RUN_ANIMATION: u32 = 0x0300_1001;
const NATIVE_ACTION_ANIMATION: u32 = 0x0300_1002;
const NATIVE_DEAD_ANIMATION: u32 = 0x0300_1003;
const BASELINE_STEP: f32 = 1.0;
const NATIVE_RUN_STEP: f32 = 2.0;
const FRAME_RATE: f32 = 4.0;
const DT: f32 = 1.0 / FRAME_RATE;
const TURN_RATE: f32 = -1.5;
const SIDESTEP_SPEED: f32 = 2.0;

fn catalog() -> MotionSequenceCatalog {
    catalog_with_walk(None)
}

fn catalog_with_walk(walk: Option<MotionData>) -> MotionSequenceCatalog {
    catalog_with_motion(walk, true, [BASELINE_STEP; 4])
}

fn catalog_with_motion(
    walk: Option<MotionData>,
    native_turn: bool,
    baseline_steps: [f32; 4],
) -> MotionSequenceCatalog {
    catalog_with_steps(
        walk,
        native_turn.then(|| motion(vec![], None, Some(Vector3::new(0.0, 0.0, TURN_RATE)))),
        baseline_steps,
        [NATIVE_RUN_STEP; 4],
    )
}

fn catalog_with_steps(
    walk: Option<MotionData>,
    native_turn: Option<MotionData>,
    baseline_steps: [f32; 4],
    native_steps: [f32; 4],
) -> MotionSequenceCatalog {
    let mut native = MotionTable {
        id: NATIVE_TABLE,
        default_style: STYLE,
        style_defaults: HashMap::from([(STYLE, NATIVE_IDLE)]),
        cycles: HashMap::from([
            (
                MotionTable::cycle_key(STYLE, NATIVE_IDLE),
                motion(vec![clip(NATIVE_IDLE_ANIMATION, FRAME_RATE)], None, None),
            ),
            (
                MotionTable::cycle_key(STYLE, RUN),
                motion(vec![clip(NATIVE_RUN_ANIMATION, FRAME_RATE)], None, None),
            ),
            (
                MotionTable::cycle_key(STYLE, MotionCommand::DEAD.raw()),
                motion(vec![clip(NATIVE_DEAD_ANIMATION, 0.0)], None, None),
            ),
        ]),
        modifiers: HashMap::from([(
            MotionTable::cycle_key(STYLE, MotionCommand::TURN_LEFT.raw()),
            motion(vec![], None, Some(Vector3::new(0.0, 0.0, TURN_RATE * -3.0))),
        )]),
        links: HashMap::from([(
            MotionTable::cycle_key(STYLE, NATIVE_IDLE),
            HashMap::from([(
                WINDUP,
                motion(vec![clip(NATIVE_ACTION_ANIMATION, FRAME_RATE)], None, None),
            )]),
        )]),
    };
    if let Some(walk) = walk {
        native
            .cycles
            .insert(MotionTable::cycle_key(STYLE, WALK), walk);
    }
    if let Some(turn) = native_turn {
        native.modifiers.insert(
            MotionTable::cycle_key(STYLE, MotionCommand::TURN.raw()),
            turn,
        );
    } else {
        native.modifiers.clear();
    }
    let baseline = MotionTable {
        id: PLAYER_LOCOMOTION_BASELINE_TABLE,
        default_style: STYLE,
        style_defaults: HashMap::from([(STYLE, STAND)]),
        cycles: HashMap::from([
            (
                MotionTable::cycle_key(STYLE, STAND),
                motion(vec![clip(STAND_ANIM, FRAME_RATE)], None, None),
            ),
            (
                MotionTable::cycle_key(STYLE, WALK),
                motion(vec![clip(WALK_ANIM, FRAME_RATE)], None, None),
            ),
        ]),
        modifiers: HashMap::from([
            (
                MotionTable::cycle_key(STYLE, MotionCommand::SIDESTEP.raw()),
                motion(vec![], Some(Vector3::new(SIDESTEP_SPEED, 0.0, 0.0)), None),
            ),
            (
                MotionTable::cycle_key(STYLE, MotionCommand::TURN.raw()),
                motion(vec![], None, Some(Vector3::new(0.0, 0.0, TURN_RATE))),
            ),
        ]),
        links: HashMap::new(),
    };
    let mut baseline_walk = animation(WALK_ANIM, 4, BASELINE_STEP);
    for (frame, step) in baseline_walk.pos_frames.iter_mut().zip(baseline_steps) {
        frame.origin = Vector3::new(0.0, step, 0.0);
    }
    baseline_walk.part_frames[0].hooks.push(AnimationHook {
        hook_type: 6,
        direction: 1,
        payload: AnimationHookPayload::Ethereal(EtherealHookPayload { ethereal: true }),
    });
    let mut native_action = animation(NATIVE_ACTION_ANIMATION, 4, 0.0);
    native_action.part_frames[0].hooks.push(AnimationHook {
        hook_type: 6,
        direction: 1,
        payload: AnimationHookPayload::Ethereal(EtherealHookPayload { ethereal: false }),
    });
    let mut native_run = animation(NATIVE_RUN_ANIMATION, 4, NATIVE_RUN_STEP);
    for (frame, step) in native_run.pos_frames.iter_mut().zip(native_steps) {
        frame.origin = Vector3::new(0.0, step, 0.0);
    }
    MotionSequenceCatalog::assemble(
        [native, baseline],
        [
            animation(NATIVE_IDLE_ANIMATION, 4, 0.0),
            native_run,
            animation(STAND_ANIM, 4, 0.0),
            animation(NATIVE_DEAD_ANIMATION, 4, 0.0),
            native_action,
            baseline_walk,
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

fn assert_native_pose(runtime: &BodyMotionRuntime) {
    let playback = runtime.motion_playback().unwrap();
    for layer in [playback.ordinary, playback.locomotion]
        .into_iter()
        .flatten()
    {
        assert!(matches!(
            layer.clip.animation_id(),
            NATIVE_IDLE_ANIMATION
                | NATIVE_RUN_ANIMATION
                | NATIVE_ACTION_ANIMATION
                | NATIVE_DEAD_ANIMATION
        ));
    }
    assert!(matches!(
        runtime.collision_pose(),
        AuthoredCollisionPose::Animation {
            animation_id: NATIVE_IDLE_ANIMATION
                | NATIVE_RUN_ANIMATION
                | NATIVE_ACTION_ANIMATION
                | NATIVE_DEAD_ANIMATION,
            ..
        }
    ));
}

#[test]
fn baseline_walk_preserves_exact_root_phase_and_native_turn_without_baseline_hooks() {
    let catalog = catalog();
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    let input = MotionOrder {
        turn: Some((MotionCommand::TURN, 1.0)),
        ..order(WALK)
    };
    for _ in 0..8 {
        let tick = runtime.drive_manual_with_fallback(
            native,
            Some(baseline),
            input,
            CharacterMotionPresentation::Grounded,
            DT,
        );
        assert!((tick.offset.translation.y - BASELINE_STEP).abs() < 0.00001);
        let expected = RigidTransform::identity().rotate(Vector3::new(0.0, 0.0, TURN_RATE * DT));
        assert_eq!(tick.offset.rotation, expected.rotation);
        assert!(tick.hooks.is_empty());
        assert_native_pose(&runtime);
    }
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        MotionOrder::default(),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(runtime.tick().offset, RigidTransform::identity());
    assert_native_pose(&runtime);
}

#[test]
fn native_run_combines_with_fallback_sidestep_uses_whole_interval_rates() {
    let catalog = catalog();
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    let input = MotionOrder {
        sidestep: Some((MotionCommand::SIDESTEP, 1.0)),
        ..order(RUN)
    };
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        input,
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(
        runtime.tick().offset.translation,
        Vector3::new(SIDESTEP_SPEED * DT, NATIVE_RUN_STEP, 0.0)
    );
    assert_native_pose(&runtime);
}

#[test]
fn native_run_combines_with_fallback_turn_uses_whole_interval_rates() {
    let catalog = catalog_with_motion(None, false, [BASELINE_STEP; 4]);
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    let input = MotionOrder {
        turn: Some((MotionCommand::TURN, 1.0)),
        ..order(RUN)
    };
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        input,
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(runtime.tick().offset.translation.y, NATIVE_RUN_STEP);
    assert_eq!(
        runtime.tick().offset.rotation,
        RigidTransform::identity()
            .rotate(Vector3::new(0.0, 0.0, TURN_RATE * DT))
            .rotation
    );
    assert_native_pose(&runtime);
}

#[test]
fn variable_baseline_roots_are_averaged_independently_of_presentation_and_tick_size() {
    let steps = [
        BASELINE_STEP,
        BASELINE_STEP * 2.0,
        BASELINE_STEP * 3.0,
        BASELINE_STEP * 4.0,
    ];
    let mean_step = steps.iter().sum::<f32>() / steps.len() as f32;
    let catalog = catalog_with_motion(None, true, steps);
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut actual = BodyMotionRuntime::new(native);
    for dt in [DT, DT / 3.0, DT * 2.0, 0.0, DT] {
        actual.drive_manual_with_fallback(
            native,
            Some(baseline),
            order(WALK),
            CharacterMotionPresentation::Grounded,
            dt,
        );
        assert!((actual.tick().offset.translation.y - mean_step * FRAME_RATE * dt).abs() < 0.00001);
        actual.present_locomotion(native, order(WALK), dt);
        assert_native_pose(&actual);
    }
}

#[test]
fn missing_falling_and_post_solve_presentation_never_publish_retained_baseline_clips() {
    let catalog = catalog();
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        order(WALK),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    let tick = runtime.tick().clone();
    runtime.present_locomotion(native, order(WALK), DT);
    assert_eq!(runtime.tick(), &tick);
    for quantum in [0.0, DT] {
        runtime.drive_manual_with_fallback(
            native,
            Some(baseline),
            order(WALK),
            CharacterMotionPresentation::Falling,
            quantum,
        );
        assert_native_pose(&runtime);
    }
}

#[test]
fn native_modifier_is_selected_before_any_baseline_rate() {
    let catalog = catalog();
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let mut state = MotionState::default();
    let mut sequence = MotionSequenceRuntime::new();
    set_default_state(native, &mut state, &mut sequence);
    let selection = super::super::selection::select_native(
        native,
        &mut state,
        &mut sequence,
        MotionCommand::TURN,
        1.0,
    );
    let super::super::selection::NativeSelection::Selected(row) = selection else {
        panic!("native turn should be selected")
    };
    assert_eq!(
        row.sequence().omega,
        Some(Vector3::new(0.0, 0.0, TURN_RATE))
    );
}

#[test]
fn native_modifier_guard_does_not_inherit_destination_style_fallback() {
    let catalog = catalog();
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let mut state = MotionState::default();
    let mut sequence = MotionSequenceRuntime::new();
    set_default_state(native, &mut state, &mut sequence);
    state.style = MotionCommand(COMBAT_STYLE);
    // A default-style cycle can provide a destination, but is not the exact active-style cycle
    // required to admit modifiers. Native semantics must remain unchanged for local/remote calls.
    assert!(
        select_motion(
            native,
            &mut state,
            &mut sequence,
            MotionCommand::RUN_FORWARD,
            1.0
        )
        .is_modelled()
    );
    assert!(matches!(
        super::super::selection::select_native(
            native,
            &mut state,
            &mut sequence,
            MotionCommand::TURN,
            1.0
        ),
        super::super::selection::NativeSelection::Prohibited
    ));
}

#[test]
fn native_state_restriction_does_not_select_an_unrestricted_baseline_row() {
    let mut restricted = motion(vec![clip(NATIVE_RUN_ANIMATION, FRAME_RATE)], None, None);
    restricted.bitfield = 2;
    let catalog = catalog_with_walk(Some(restricted));
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let mut state = MotionState::default();
    let mut sequence = MotionSequenceRuntime::new();
    set_default_state(native, &mut state, &mut sequence);
    select_motion(
        native,
        &mut state,
        &mut sequence,
        MotionCommand::RUN_FORWARD,
        1.0,
    );
    assert_eq!(
        select_motion(
            native,
            &mut state,
            &mut sequence,
            MotionCommand::WALK_FORWARD,
            1.0
        ),
        MotionSelectionOutcome::Unmodelled
    );
    assert_eq!(state.substate, MotionCommand::RUN_FORWARD);
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    runtime.drive_manual(
        native,
        order(RUN),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        MotionOrder {
            sidestep: Some((MotionCommand::SIDESTEP, 1.0)),
            ..order(WALK)
        },
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(
        runtime.tick().offset.translation,
        Vector3::new(SIDESTEP_SPEED * DT, 0.0, 0.0)
    );
}

#[test]
fn native_held_pose_is_not_mistaken_for_missing_movement() {
    let catalog = catalog_with_walk(Some(motion(
        vec![clip(NATIVE_RUN_ANIMATION, 0.0)],
        None,
        None,
    )));
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        order(WALK),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(runtime.tick().offset, RigidTransform::identity());
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        MotionOrder {
            sidestep: Some((MotionCommand::SIDESTEP, 1.0)),
            ..order(WALK)
        },
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(
        runtime.tick().offset.translation,
        Vector3::new(SIDESTEP_SPEED * DT, 0.0, 0.0)
    );
    assert_native_pose(&runtime);
}

#[test]
fn fallback_rate_changes_and_reverse_do_not_retain_stride_phase() {
    let catalog = catalog_with_motion(
        None,
        true,
        [
            BASELINE_STEP,
            BASELINE_STEP * 2.0,
            BASELINE_STEP * 3.0,
            BASELINE_STEP * 4.0,
        ],
    );
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    let mean_speed = BASELINE_STEP * 2.5 * FRAME_RATE;
    for rate in [1.0, 0.0, 2.0, -1.0, -2.0] {
        let input = MotionOrder {
            forward: Some((MotionCommand::WALK_FORWARD, rate)),
            ..Default::default()
        };
        let tick = runtime.drive_manual_with_fallback(
            native,
            Some(baseline),
            input,
            CharacterMotionPresentation::Grounded,
            DT / 2.0,
        );
        assert!((tick.offset.translation.y - mean_speed * rate * DT / 2.0).abs() < 0.00001);
        assert_native_pose(&runtime);
    }
}

#[test]
fn table_rebind_establishes_new_native_pose_and_hooks() {
    let catalog = catalog();
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        order(WALK),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_native_pose(&runtime);
    // The body now legitimately owns the baseline table. Its clips and hooks become native.
    runtime.drive_manual(
        baseline,
        order(WALK),
        CharacterMotionPresentation::Grounded,
        0.0,
    );
    assert_eq!(runtime.motion_table_id(), PLAYER_LOCOMOTION_BASELINE_TABLE);
    assert_eq!(
        runtime
            .motion_playback()
            .unwrap()
            .locomotion
            .unwrap()
            .clip
            .animation_id(),
        WALK_ANIM
    );
    assert_eq!(runtime.tick().offset, RigidTransform::identity());
    runtime.drive_manual(
        baseline,
        order(WALK),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert!(
        !runtime.tick().hooks.is_empty(),
        "the new body's native animation must regain its own hooks"
    );
}

#[test]
fn absent_baseline_does_not_invent_motion_and_remote_drive_remains_native_only() {
    let catalog = catalog();
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let mut local = BodyMotionRuntime::new(native);
    local.drive_manual_with_fallback(
        native,
        None,
        order(WALK),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(local.tick().offset, RigidTransform::identity());
    assert_native_pose(&local);
    let mut remote = BodyMotionRuntime::new(native);
    remote.drive(native, order(WALK), DT);
    assert_eq!(remote.tick().offset, RigidTransform::identity());
}

#[test]
fn controller_summary_uses_the_same_native_and_baseline_rows_as_physical_selection() {
    let mut world = crate::WorldState::synthetic();
    let guid = holtburger_common::Guid(0x5000_0001);
    world.seed_local_player_entity(guid, "Creature", Default::default());
    world.player_entity_mut().unwrap().properties.set_did_prop(
        PropertyDataId::MotionTable,
        holtburger_common::Guid(NATIVE_TABLE),
    );
    world.set_motion_sequences(catalog());
    let resolved = world.resolve_self_movement_kinematics().unwrap();
    assert_eq!(
        resolved.base_walk_forward_speed(),
        BASELINE_STEP * FRAME_RATE
    );
    assert_eq!(
        resolved.base_run_forward_speed(),
        NATIVE_RUN_STEP * FRAME_RATE
    );
    assert_eq!(
        resolved.base_turn_right_speed_rad_per_sec(),
        TURN_RATE.abs()
    );
    assert_eq!(resolved.base_turn_left_speed_rad_per_sec(), TURN_RATE.abs());
}

#[test]
fn fallback_movement_preserves_native_gesture_hooks_and_cannot_override_death() {
    let catalog = catalog();
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut moving = BodyMotionRuntime::new(native);
    let mut idle = BodyMotionRuntime::new(native);
    let windup = EntityMotionAction {
        command: MotionCommand(WINDUP),
        ..action(1)
    };
    moving.enqueue_action(windup);
    idle.enqueue_action(windup);
    let mut fired = Vec::new();
    for _ in 0..4 {
        idle.drive(native, MotionOrder::default(), DT);
        moving.drive_manual_with_fallback(
            native,
            Some(baseline),
            order(WALK),
            CharacterMotionPresentation::Grounded,
            DT,
        );
        assert_eq!(moving.tick().hooks, idle.tick().hooks);
        assert_eq!(moving.tick().offset.translation.y, BASELINE_STEP);
        fired.extend(moving.tick().hooks.clone());
        assert_native_pose(&moving);
    }
    assert_eq!(fired.len(), 1);
    assert_eq!(fired[0].animation_id, NATIVE_ACTION_ANIMATION);
    moving.accept_order(native, order(MotionCommand::DEAD.raw()));
    moving.drive_manual_with_fallback(
        native,
        Some(baseline),
        order(WALK),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(moving.state().substate, MotionCommand::DEAD);
    assert_eq!(moving.tick().offset, RigidTransform::identity());
    assert_native_pose(&moving);
}

#[test]
fn native_stride_stays_exact_until_missing_channel_requires_whole_interval_rates() {
    let native_steps = [NATIVE_RUN_STEP, 0.0, NATIVE_RUN_STEP * 3.0, 0.0];
    let catalog = catalog_with_steps(
        None,
        Some(motion(
            vec![],
            None,
            Some(Vector3::new(0.0, 0.0, TURN_RATE)),
        )),
        [BASELINE_STEP; 4],
        native_steps,
    );
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    // Exact native per-frame stride is preserved on supported movement.
    for step in native_steps {
        runtime.drive_manual_with_fallback(
            native,
            Some(baseline),
            order(RUN),
            CharacterMotionPresentation::Grounded,
            DT,
        );
        assert_eq!(runtime.tick().offset.translation.y, step);
    }
    // Missing strafe switches the entire interval to mean rates, including native forward.
    let mixed = MotionOrder {
        sidestep: Some((MotionCommand::SIDESTEP, 1.0)),
        ..order(RUN)
    };
    let mean_step = native_steps.iter().sum::<f32>() / native_steps.len() as f32;
    for _ in 0..native_steps.len() {
        runtime.drive_manual_with_fallback(
            native,
            Some(baseline),
            mixed,
            CharacterMotionPresentation::Grounded,
            DT,
        );
        assert_eq!(
            runtime.tick().offset.translation,
            Vector3::new(SIDESTEP_SPEED * DT, mean_step, 0.0)
        );
        assert_native_pose(&runtime);
    }
    // Returning to native movement resumes its existing cursor, without retained rate actuation.
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        order(RUN),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(
        runtime.tick().offset.translation,
        Vector3::new(0.0, native_steps[0], 0.0)
    );
}

#[test]
fn mean_rates_weight_clip_durations_and_add_explicit_vectors() {
    let explicit = Vector3::new(3.0, 0.0, 0.0);
    let omega = Vector3::new(0.0, 0.0, TURN_RATE);
    // Eight units of native travel over one second, then two seconds in a stationary clip.
    let catalog = catalog_with_walk(Some(motion(
        vec![
            clip(NATIVE_RUN_ANIMATION, FRAME_RATE),
            clip(NATIVE_IDLE_ANIMATION, FRAME_RATE / 2.0),
        ],
        Some(explicit),
        Some(omega),
    )));
    let row = catalog
        .table(NATIVE_TABLE)
        .unwrap()
        .cycle(STYLE, WALK)
        .unwrap();
    let rates = super::super::rates::MotionRates::from_cycle(row);
    assert_eq!(rates.velocity.x, explicit.x);
    assert!((rates.velocity.y - NATIVE_RUN_STEP * FRAME_RATE / 3.0).abs() < 0.00001);
    assert_eq!(rates.omega, omega);
}

#[test]
fn signed_clip_windows_and_zero_rate_holds_preserve_explicit_physics() {
    let explicit = Vector3::new(SIDESTEP_SPEED, 0.0, 0.0);
    let mut reversed = clip(NATIVE_RUN_ANIMATION, -FRAME_RATE);
    reversed.low_frame = 1;
    reversed.high_frame = 2;
    let catalog = catalog_with_walk(Some(motion(vec![reversed], Some(explicit), None)));
    let row = catalog
        .table(NATIVE_TABLE)
        .unwrap()
        .cycle(STYLE, WALK)
        .unwrap();
    let rates = super::super::rates::MotionRates::from_cycle(row);
    assert_eq!(
        rates.velocity,
        Vector3::new(explicit.x, -NATIVE_RUN_STEP * FRAME_RATE, 0.0)
    );

    let catalog = catalog_with_walk(Some(motion(
        vec![clip(NATIVE_RUN_ANIMATION, 0.0)],
        Some(explicit),
        None,
    )));
    let row = catalog
        .table(NATIVE_TABLE)
        .unwrap()
        .cycle(STYLE, WALK)
        .unwrap();
    assert_eq!(
        super::super::rates::MotionRates::from_cycle(row).velocity,
        explicit
    );
}

#[test]
fn missing_walk_replaces_retained_run_travel_and_stop_retires_fallback() {
    let catalog = catalog();
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        order(RUN),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        order(WALK),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(runtime.tick().offset.translation.y, BASELINE_STEP);
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        MotionOrder::default(),
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(runtime.tick().offset, RigidTransform::identity());
}

#[test]
fn mean_root_turn_preserves_full_revolutions_and_reverse_direction() {
    let frames = 4;
    let mut spin = animation(NATIVE_RUN_ANIMATION, frames, 0.0);
    let quarter_turn = std::f32::consts::TAU / frames as f32;
    for frame in &mut spin.pos_frames {
        frame.orientation =
            Quaternion::from_axis_angle(Vector3::new(0.0, 0.0, 1.0), quarter_turn).unwrap();
    }
    let table = MotionTable {
        id: NATIVE_TABLE,
        default_style: STYLE,
        style_defaults: HashMap::from([(STYLE, NATIVE_IDLE)]),
        cycles: HashMap::from([
            (
                MotionTable::cycle_key(STYLE, WALK),
                motion(vec![clip(NATIVE_RUN_ANIMATION, FRAME_RATE)], None, None),
            ),
            (
                MotionTable::cycle_key(STYLE, RUN),
                motion(vec![clip(NATIVE_RUN_ANIMATION, -FRAME_RATE)], None, None),
            ),
        ]),
        modifiers: HashMap::new(),
        links: HashMap::new(),
    };
    let catalog = MotionSequenceCatalog::assemble([table], [spin], []).unwrap();
    let table = catalog.table(NATIVE_TABLE).unwrap();
    for (command, sign) in [(WALK, 1.0), (RUN, -1.0)] {
        let rates =
            super::super::rates::MotionRates::from_cycle(table.cycle(STYLE, command).unwrap());
        assert!((rates.omega.z - quarter_turn * FRAME_RATE * sign).abs() < 0.00001);
    }
}

#[test]
fn missing_support_presentation_does_not_cancel_an_active_native_gesture() {
    let catalog = catalog();
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    for presentation in [
        CharacterMotionPresentation::Ready,
        CharacterMotionPresentation::Falling,
    ] {
        let windup = EntityMotionAction {
            command: MotionCommand(WINDUP),
            ..action(1)
        };
        let mut subject = BodyMotionRuntime::new(native);
        let mut reference = BodyMotionRuntime::new(native);
        subject.enqueue_action(windup);
        reference.enqueue_action(windup);
        for _ in 0..4 {
            reference.drive(native, MotionOrder::default(), DT);
            subject.drive_manual_with_fallback(
                native,
                Some(baseline),
                MotionOrder::default(),
                presentation,
                DT,
            );
            assert_eq!(subject.active_action(), reference.active_action());
            assert_eq!(
                subject.tick().action_completed,
                reference.tick().action_completed
            );
            assert_eq!(subject.tick().hooks, reference.tick().hooks);
        }
    }
}

#[test]
fn fallback_preserves_native_modifiers_explicit_only_physics() {
    let catalog = catalog_with_steps(
        None,
        Some(motion(
            vec![clip(NATIVE_RUN_ANIMATION, FRAME_RATE)],
            None,
            Some(Vector3::new(0.0, 0.0, TURN_RATE)),
        )),
        [BASELINE_STEP; 4],
        [NATIVE_RUN_STEP; 4],
    );
    let native = catalog.table(NATIVE_TABLE).unwrap();
    let baseline = catalog.table(PLAYER_LOCOMOTION_BASELINE_TABLE).unwrap();
    let mut runtime = BodyMotionRuntime::new(native);
    let input = MotionOrder {
        sidestep: Some((MotionCommand::SIDESTEP, 1.0)),
        turn: Some((MotionCommand::TURN, 1.0)),
        ..order(RUN)
    };
    runtime.drive_manual_with_fallback(
        native,
        Some(baseline),
        input,
        CharacterMotionPresentation::Grounded,
        DT,
    );
    assert_eq!(
        runtime.tick().offset.translation,
        Vector3::new(SIDESTEP_SPEED * DT, NATIVE_RUN_STEP, 0.0)
    );
}

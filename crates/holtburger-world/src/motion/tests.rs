use super::registry::RETAIL_RUN_FORWARD_BASE_SPEED_MPS;
use super::*;
use crate::entity::{
    EntityMotionAction, EntityMotionActionSource, EntityMotionAdmission, EntityMotionSnapshot,
    OrderedMotionScalar,
};
use crate::spatial::ContactState;
use holtburger_common::{Quaternion, RigidTransform, Vector3};
use holtburger_content::{MotionHookDirection, MotionSequenceCatalog, MotionSequenceTable};
use holtburger_dat::file_type::animation::AnimationFlags;
use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
use holtburger_dat::file_type::setup_model::{
    AnimationFrame, AnimationHook, AnimationHookPayload, EtherealHookPayload,
};
use holtburger_dat::file_type::{Animation, MotionTable};
use holtburger_dat::graphics::Frame;
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use std::collections::HashMap;

const STYLE: u32 = 0x8000_003D;
const COMBAT_STYLE: u32 = 0x8000_003C;
const STAND: u32 = 0x4500_0003;
const COMBAT_STAND: u32 = 0x4100_0050;
const WALK: u32 = MotionTable::WALK_FORWARD_COMMAND;
const RUN: u32 = MotionTable::RUN_FORWARD_COMMAND;
const MODIFIER: u32 = 0x2000_0021;
const SECOND_MODIFIER: u32 = 0x2000_0022;
const DUAL_TURN: u32 = MotionTable::TURN_RIGHT_COMMAND;
const HOOKED: u32 = 0x4500_0009;
const ACTION: u32 = 0x1000_004A;

const STAND_ANIM: u32 = 0x0300_0001;
const WALK_ANIM: u32 = 0x0300_0002;
const RUN_ANIM: u32 = 0x0300_0003;
const LINK_ANIM: u32 = 0x0300_0004;
const HOOK_ANIM: u32 = 0x0300_0005;
const SIDESTEP_ANIM: u32 = 0x0300_0006;
const ACTION_ANIM: u32 = 0x0300_0007;

/// High halves copied independently from retail's 412-entry `dword_7C8190` initializer.
const RETAIL_INTERPRETED_COMMAND_PREFIXES: [u16; 412] = [
    0x8000, 0x8500, 0x8500, 0x4100, 0x4000, 0x4500, 0x4500, 0x4400, 0x4000, 0x4000, 0x4000, 0x4000,
    0x4000, 0x6500, 0x6500, 0x6500, 0x6500, 0x4000, 0x4100, 0x4100, 0x4100, 0x4000, 0x4000, 0x4000,
    0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000,
    0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000,
    0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x4000, 0x2000, 0x2500,
    0x8000, 0x8000, 0x8000, 0x8000, 0x8000, 0x8000, 0x8000, 0x8000, 0x8000, 0x8000, 0x8000, 0x8000,
    0x8000, 0x8000, 0x1000, 0x1000, 0x1300, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000,
    0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000,
    0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000,
    0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000,
    0x1000, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300,
    0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300,
    0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1200,
    0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x0800, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900,
    0x0900, 0x0800, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0D00, 0x0D00,
    0x0D00, 0x0800, 0x0800, 0x0800, 0x0900, 0x0900, 0x0D00, 0x0D00, 0x0D00, 0x0D00, 0x0D00, 0x0D00,
    0x0900, 0x0C00, 0x0900, 0x0900, 0x0900, 0x0D00, 0x0900, 0x0900, 0x0900, 0x0900, 0x1300, 0x1300,
    0x1300, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x4000, 0x1200, 0x0900, 0x0900, 0x0900,
    0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x1200, 0x4000, 0x4000, 0x1000, 0x1000,
    0x4000, 0x4000, 0x4000, 0x0900, 0x8000, 0x8000, 0x4300, 0x4300, 0x4300, 0x4300, 0x4300, 0x4300,
    0x4300, 0x4300, 0x4300, 0x4300, 0x4300, 0x4300, 0x4300, 0x4300, 0x4300, 0x4200, 0x4300, 0x4300,
    0x4300, 0x4300, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900,
    0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x1000, 0x1000, 0x1000, 0x1000, 0x0900, 0x0900,
    0x0900, 0x0900, 0x0900, 0x0900, 0x4300, 0x1300, 0x4300, 0x4300, 0x4300, 0x0900, 0x1000, 0x1000,
    0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000,
    0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1300, 0x4000, 0x4000,
    0x4000, 0x4000, 0x1000, 0x8000, 0x8000, 0x4300, 0x4300, 0x4300, 0x4300, 0x4300, 0x4300, 0x4300,
    0x4300, 0x4300, 0x4300, 0x4300, 0x4300, 0x4300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300, 0x1300,
    0x1300, 0x1300, 0x1300, 0x1000, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900,
    0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x1000, 0x1000, 0x1000,
    0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x0900, 0x1000, 0x1000, 0x1000,
    0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000,
    0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000,
    0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000,
    0x1000, 0x1000, 0x1000, 0x1000,
];

#[test]
fn every_retail_interpreted_command_expands_exactly() {
    for (index, prefix) in RETAIL_INTERPRETED_COMMAND_PREFIXES.into_iter().enumerate() {
        let interpreted = InterpretedMotionCommand(index as u16);
        assert_eq!(
            MotionCommand::from_interpreted(interpreted),
            Some(MotionCommand((u32::from(prefix) << 16) | index as u32)),
            "interpreted command {index}"
        );
    }

    assert_eq!(
        MotionCommand::from_interpreted(InterpretedMotionCommand(412)),
        None
    );
    assert_eq!(
        MotionCommand::from_interpreted(InterpretedMotionCommand(u16::MAX)),
        None
    );
}

#[test]
fn retained_non_locomotion_commands_survive_motion_order_reduction() {
    for (interpreted, expected) in [
        (InterpretedMotionCommand::DEAD, 0x4000_0011),
        (InterpretedMotionCommand(74), 0x1000_004A),
    ] {
        let order = MotionOrder::from_snapshot(EntityMotionSnapshot {
            forward_command: Some(interpreted),
            ..EntityMotionSnapshot::default()
        });

        assert_eq!(order.forward, Some((MotionCommand(expected), 1.0)));
    }
}

#[test]
fn character_presentation_resolves_support_and_preserves_turn() {
    let grounded = MotionOrder {
        style: Some(MotionCommand(STYLE)),
        forward: Some((MotionCommand::RUN_FORWARD, 1.5)),
        sidestep: Some((MotionCommand::SIDESTEP, 1.0)),
        turn: Some((MotionCommand::TURN, 0.5)),
    };

    assert_eq!(
        CharacterMotionPresentation::resolve(ContactState::Grounded, false, false),
        CharacterMotionPresentation::Grounded
    );
    assert_eq!(
        grounded.with_character_presentation(CharacterMotionPresentation::Grounded),
        grounded
    );

    let ready = grounded.with_character_presentation(CharacterMotionPresentation::resolve(
        ContactState::Grounded,
        false,
        true,
    ));
    assert_eq!(ready.forward, Some((MotionCommand::READY, 1.0)));
    assert_eq!(ready.sidestep, None);
    assert_eq!(ready.turn, grounded.turn);

    for contact in [ContactState::Airborne, ContactState::Sliding] {
        let falling = grounded.with_character_presentation(CharacterMotionPresentation::resolve(
            contact, false, false,
        ));
        assert_eq!(falling.forward, Some((MotionCommand::FALLING, 1.0)));
        assert_eq!(falling.sidestep, None);
        assert_eq!(falling.turn, grounded.turn);
    }

    let launching = grounded.with_character_presentation(CharacterMotionPresentation::resolve(
        ContactState::Grounded,
        true,
        false,
    ));
    assert_eq!(launching.forward, Some((MotionCommand::FALLING, 1.0)));
}

/// Builds an animation whose every frame translates `step` along local Y.
fn animation(id: u32, frames: usize, step: f32) -> Animation {
    animation_with_step(id, frames, Vector3::new(0.0, step, 0.0))
}

fn animation_with_step(id: u32, frames: usize, step: Vector3) -> Animation {
    Animation {
        id,
        flags: AnimationFlags::POS_FRAMES,
        num_parts: 0,
        num_frames: frames as u32,
        pos_frames: (0..frames)
            .map(|_| Frame {
                origin: step,
                orientation: Quaternion::identity(),
            })
            .collect(),
        part_frames: (0..frames)
            .map(|_| AnimationFrame {
                frames: Vec::new(),
                hooks: Vec::new(),
            })
            .collect(),
    }
}

/// An animation with one ethereal hook on each of frames 1 and 2, in opposite directions.
fn hook_animation() -> Animation {
    let mut animation = animation(HOOK_ANIM, 4, 0.0);
    animation.part_frames[1].hooks.push(AnimationHook {
        hook_type: 6,
        direction: 1,
        payload: AnimationHookPayload::Ethereal(EtherealHookPayload { ethereal: true }),
    });
    animation.part_frames[2].hooks.push(AnimationHook {
        hook_type: 6,
        direction: -1,
        payload: AnimationHookPayload::Ethereal(EtherealHookPayload { ethereal: false }),
    });
    animation.part_frames[3].hooks.push(AnimationHook {
        hook_type: 6,
        direction: 1,
        payload: AnimationHookPayload::Ethereal(EtherealHookPayload { ethereal: true }),
    });
    animation
}

fn clip(anim_id: u32, framerate: f32) -> AnimData {
    AnimData {
        anim_id,
        low_frame: 0,
        high_frame: -1,
        framerate,
    }
}

fn motion(anims: Vec<AnimData>, velocity: Option<Vector3>, omega: Option<Vector3>) -> MotionData {
    let mut flags = MotionDataFlags::empty();
    flags.set(MotionDataFlags::HAS_VELOCITY, velocity.is_some());
    flags.set(MotionDataFlags::HAS_OMEGA, omega.is_some());
    MotionData {
        bitfield: 0,
        flags,
        anims,
        velocity,
        omega,
    }
}

/// A table with a stand/walk/run cycle set, links between them, one modifier, and a combat style.
fn catalog() -> MotionSequenceCatalog {
    catalog_with_combat_default(STAND)
}

/// Builds the shared table fixture with an independently selectable combat resting substate.
fn catalog_with_combat_default(combat_default: u32) -> MotionSequenceCatalog {
    let mut cycles = HashMap::new();
    cycles.insert(
        MotionTable::cycle_key(STYLE, STAND),
        motion(vec![clip(STAND_ANIM, 10.0)], None, None),
    );
    cycles.insert(
        MotionTable::cycle_key(STYLE, WALK),
        motion(vec![clip(WALK_ANIM, 4.0)], None, None),
    );
    cycles.insert(
        MotionTable::cycle_key(STYLE, RUN),
        motion(
            vec![clip(RUN_ANIM, 8.0)],
            Some(Vector3::new(3.0, 0.0, 0.0)),
            None,
        ),
    );
    cycles.insert(
        MotionTable::cycle_key(STYLE, HOOKED),
        motion(vec![clip(HOOK_ANIM, 4.0)], None, None),
    );
    let mut standing_turn = motion(
        vec![clip(STAND_ANIM, 4.0)],
        None,
        Some(Vector3::new(0.0, 0.0, 0.5)),
    );
    standing_turn.bitfield = 2;
    cycles.insert(MotionTable::cycle_key(STYLE, DUAL_TURN), standing_turn);
    cycles.insert(
        MotionTable::cycle_key(COMBAT_STYLE, combat_default),
        motion(vec![clip(STAND_ANIM, 10.0)], None, None),
    );

    let mut modifiers = HashMap::new();
    modifiers.insert(
        MotionTable::cycle_key(STYLE, MODIFIER),
        motion(Vec::new(), None, Some(Vector3::new(0.0, 0.0, 0.5))),
    );
    modifiers.insert(
        MotionTable::cycle_key(STYLE, SECOND_MODIFIER),
        motion(Vec::new(), None, Some(Vector3::new(0.25, 0.0, 0.0))),
    );
    modifiers.insert(
        MotionTable::cycle_key(STYLE, DUAL_TURN),
        motion(Vec::new(), None, Some(Vector3::new(0.0, 0.0, 0.5))),
    );

    // Links: stand->walk, walk->stand, stand->run, run->stand, and stand->combat style.
    let mut links: HashMap<u32, HashMap<u32, MotionData>> = HashMap::new();
    links
        .entry(MotionTable::cycle_key(STYLE, STAND))
        .or_default()
        .extend([
            (WALK, motion(vec![clip(LINK_ANIM, 2.0)], None, None)),
            (RUN, motion(vec![clip(LINK_ANIM, 2.0)], None, None)),
            (COMBAT_STYLE, motion(vec![clip(LINK_ANIM, 2.0)], None, None)),
            (ACTION, motion(vec![clip(ACTION_ANIM, 4.0)], None, None)),
        ]);
    links
        .entry(MotionTable::cycle_key(STYLE, WALK))
        .or_default()
        .extend([(STAND, motion(vec![clip(LINK_ANIM, 2.0)], None, None))]);
    links
        .entry(MotionTable::cycle_key(STYLE, RUN))
        .or_default()
        .extend([(STAND, motion(vec![clip(LINK_ANIM, 2.0)], None, None))]);

    let table = MotionTable {
        id: 0x0900_0001,
        default_style: STYLE,
        style_defaults: HashMap::from([(STYLE, STAND), (COMBAT_STYLE, combat_default)]),
        cycles,
        modifiers,
        links,
    };

    MotionSequenceCatalog::assemble(
        [table],
        [
            animation(STAND_ANIM, 4, 0.0),
            animation(WALK_ANIM, 4, 1.0),
            animation(RUN_ANIM, 4, 2.0),
            animation(LINK_ANIM, 2, 0.5),
            hook_animation(),
            animation(ACTION_ANIM, 4, 0.25),
        ],
        [],
    )
    .expect("fixture catalog should assemble")
}

struct Body {
    state: MotionState,
    sequence: MotionSequenceRuntime,
}

fn standing(table: &MotionSequenceTable) -> Body {
    let mut body = Body {
        state: MotionState::default(),
        sequence: MotionSequenceRuntime::new(),
    };
    assert_eq!(
        set_default_state(table, &mut body.state, &mut body.sequence),
        MotionSelectionOutcome::Selected
    );
    body
}

fn animation_ids(sequence: &MotionSequenceRuntime) -> Vec<u32> {
    sequence
        .clips()
        .iter()
        .map(|node| node.animation().id)
        .collect()
}

fn action(sequence: u16) -> EntityMotionAction {
    EntityMotionAction {
        command: MotionCommand(ACTION),
        speed: OrderedMotionScalar::from_f32(1.0).unwrap(),
        action_sequence: sequence,
        is_autonomous: false,
        admission: EntityMotionAdmission {
            object_instance_sequence: 1,
            movement_sequence: sequence,
            server_control_sequence: 2,
            is_autonomous: false,
        },
        source: EntityMotionActionSource::CommandList,
    }
}

#[test]
fn action_from_default_owns_an_exact_completion_boundary_and_return_cycle() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut body = standing(table);

    assert_eq!(
        select_action(
            table,
            &mut body.state,
            &mut body.sequence,
            MotionCommand(ACTION),
            1.0,
        ),
        ActionSelectionOutcome::Selected,
    );
    assert_eq!(animation_ids(&body.sequence), vec![ACTION_ANIM, STAND_ANIM]);
    let tick = body.sequence.advance(1.1);
    assert!(tick.action_completed);
    assert_eq!(
        body.sequence.current_clip().unwrap().node.animation().id,
        STAND_ANIM,
    );
}

#[test]
fn action_without_direct_route_uses_default_and_returns_to_current_substate() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut body = standing(table);
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );
    body.sequence.advance(1.1);

    assert_eq!(
        select_action(
            table,
            &mut body.state,
            &mut body.sequence,
            MotionCommand(ACTION),
            1.0,
        ),
        ActionSelectionOutcome::Selected,
    );
    assert_eq!(
        animation_ids(&body.sequence),
        vec![LINK_ANIM, ACTION_ANIM, LINK_ANIM, WALK_ANIM],
    );
}

#[test]
fn runtime_queue_is_bounded_and_returns_to_latest_steady_order() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = holtburger_common::Guid(0x5000_0001);
    let mut registry = MotionRuntimeRegistry::new();
    for sequence in 1..=6 {
        assert_eq!(
            registry.enqueue_action(table, guid, action(sequence)),
            MotionActionEnqueueOutcome::Queued,
        );
    }
    assert_eq!(
        registry.enqueue_action(table, guid, action(7)),
        MotionActionEnqueueOutcome::Overflow,
    );
    registry.drive(
        table,
        guid,
        MotionOrder {
            style: Some(MotionCommand(STYLE)),
            ..MotionOrder::default()
        },
        0.0,
    );
    assert_eq!(registry.get(guid).unwrap().active_action(), Some(action(1)));

    registry.drive(
        table,
        guid,
        MotionOrder {
            style: Some(MotionCommand(STYLE)),
            forward: Some((MotionCommand(WALK), 1.0)),
            ..MotionOrder::default()
        },
        0.0,
    );
    assert_eq!(
        animation_ids(registry.get(guid).unwrap().sequence()),
        vec![ACTION_ANIM, LINK_ANIM, WALK_ANIM],
        "steady movement must replace the return tail without restarting the action prefix",
    );
    registry.drive(
        table,
        guid,
        MotionOrder {
            style: Some(MotionCommand(STYLE)),
            forward: Some((MotionCommand(WALK), 1.0)),
            ..MotionOrder::default()
        },
        1.1,
    );
    assert_eq!(registry.get(guid).unwrap().active_action(), Some(action(2)));
    assert_eq!(registry.state(guid).unwrap().substate, MotionCommand(WALK));
}

#[test]
fn default_state_selects_the_tables_own_style_and_substate() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let body = standing(table);

    assert_eq!(body.state.style, MotionCommand(STYLE));
    assert_eq!(body.state.substate, MotionCommand(STAND));
    assert_eq!(body.state.substate_mod, 1.0);
    assert_eq!(animation_ids(&body.sequence), vec![STAND_ANIM]);
    assert_eq!(body.sequence.frame_number(), 0.0);
}

#[test]
fn walking_from_a_stand_plays_the_transition_before_the_cycle() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);

    let outcome = select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );

    assert_eq!(outcome, MotionSelectionOutcome::Selected);
    assert_eq!(body.state.substate, MotionCommand(WALK));
    assert_eq!(animation_ids(&body.sequence), vec![LINK_ANIM, WALK_ANIM]);
    assert!(
        !body.sequence.is_cyclic(),
        "playback starts on the transition clip, not the cycle"
    );
}

#[test]
fn stopping_a_substate_returns_to_the_styles_default() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );
    // Play out the stand-to-walk transition so the cursor is on the walk cycle itself.
    body.sequence.advance(1.0);
    assert_eq!(animation_ids(&body.sequence), vec![WALK_ANIM]);

    let outcome = stop_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
    );

    assert_eq!(outcome, MotionSelectionOutcome::Selected);
    assert_eq!(body.state.substate, MotionCommand(STAND));
    assert_eq!(animation_ids(&body.sequence), vec![LINK_ANIM, STAND_ANIM]);
}

/// Different pending destinations retain their authored order until a later selection supersedes
/// them.
#[test]
fn distinct_unplayed_substate_transitions_remain_ordered() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );

    stop_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
    );

    assert_eq!(
        animation_ids(&body.sequence),
        vec![LINK_ANIM, LINK_ANIM, STAND_ANIM]
    );
    assert!(!body.sequence.is_cyclic());
}

/// Retail removes the transition suffix between two pending selections of the same substate
/// (`MotionTableManager::remove_redundant_links`, `acclient.c:317225-317290`).
#[test]
fn reselecting_a_pending_substate_collapses_the_redundant_suffix() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );
    stop_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
    );

    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );

    assert_eq!(body.state.substate, MotionCommand(WALK));
    assert_eq!(animation_ids(&body.sequence), vec![LINK_ANIM, WALK_ANIM]);
    assert!(!body.sequence.is_cyclic());
}

/// Repeated press/release edges may reach distinct host ticks, but their transition history must
/// remain bounded when the final held input repeats the pending forward destination.
#[test]
fn repeated_forward_taps_then_hold_do_not_accumulate_a_transition_backlog() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = BodyMotionRuntime::new(table);
    let order = |forward| MotionOrder {
        style: Some(MotionCommand(STYLE)),
        forward,
        sidestep: None,
        turn: None,
    };

    for _ in 0..3 {
        body.drive(table, order(Some((MotionCommand(WALK), 1.0))), 1.0 / 30.0);
        body.drive(table, order(None), 1.0 / 30.0);
    }
    body.drive(table, order(Some((MotionCommand(WALK), 1.0))), 1.0 / 30.0);

    assert_eq!(body.state().substate, MotionCommand(WALK));
    assert_eq!(animation_ids(body.sequence()), vec![LINK_ANIM, WALK_ANIM]);
}

#[test]
fn adjusted_interpolation_speed_retains_the_last_valid_run_rate() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = BodyMotionRuntime::new(table);
    let order = |forward| MotionOrder {
        style: Some(MotionCommand(STYLE)),
        forward,
        sidestep: None,
        turn: None,
    };

    assert_eq!(body.adjusted_max_speed_mps(), None);
    body.drive(
        table,
        order(Some((MotionCommand::RUN_FORWARD, 1.75))),
        1.0 / 30.0,
    );
    assert_eq!(
        body.adjusted_max_speed_mps(),
        Some(1.75 * RETAIL_RUN_FORWARD_BASE_SPEED_MPS)
    );
    body.drive(table, order(None), 1.0 / 30.0);
    assert_eq!(
        body.adjusted_max_speed_mps(),
        Some(1.75 * RETAIL_RUN_FORWARD_BASE_SPEED_MPS)
    );
    body.drive(
        table,
        order(Some((MotionCommand::RUN_FORWARD, f32::NAN))),
        1.0 / 30.0,
    );
    assert_eq!(
        body.adjusted_max_speed_mps(),
        Some(1.75 * RETAIL_RUN_FORWARD_BASE_SPEED_MPS)
    );
}

/// Transition clips the cursor has passed are dropped, so an interrupted body does not accumulate
/// a growing backlog of played-out links.
#[test]
fn departed_transition_clips_are_dropped_once_the_cursor_passes_them() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );
    assert_eq!(animation_ids(&body.sequence), vec![LINK_ANIM, WALK_ANIM]);

    body.sequence.advance(1.0);

    assert_eq!(animation_ids(&body.sequence), vec![WALK_ANIM]);
    assert!(body.sequence.is_cyclic());
}

/// Re-issuing the running substate at a new speed in the same direction must rescale the clips
/// rather than restart them, or every speed nudge would snap the animation back to its first frame.
#[test]
fn a_same_direction_speed_change_rescales_instead_of_restarting() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );
    body.sequence.advance(0.4);
    let advanced_frame = body.sequence.frame_number();
    let clips_before = animation_ids(&body.sequence);
    assert!(advanced_frame > 0.0);

    let outcome = select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        2.0,
    );

    assert_eq!(outcome, MotionSelectionOutcome::Selected);
    assert_eq!(body.state.substate_mod, 2.0);
    assert_eq!(animation_ids(&body.sequence), clips_before);
    assert_eq!(body.sequence.frame_number(), advanced_frame);
}

/// Reversing direction cannot reuse the running clips, so it routes out through the style default.
#[test]
fn reversing_direction_routes_through_the_style_default() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );

    let outcome = select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        -1.0,
    );

    assert_eq!(outcome, MotionSelectionOutcome::Selected);
    assert_eq!(body.state.substate_mod, -1.0);
    assert!(
        body.sequence
            .clips()
            .iter()
            .any(|node| node.framerate() < 0.0),
        "the reversed cycle plays backwards"
    );
}

#[test]
fn a_style_change_transitions_into_the_new_styles_default_substate() {
    let catalog = catalog_with_combat_default(COMBAT_STAND);
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);

    let outcome = select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(COMBAT_STYLE),
        1.0,
    );

    assert_eq!(outcome, MotionSelectionOutcome::Selected);
    assert_eq!(body.state.style, MotionCommand(COMBAT_STYLE));
    assert_eq!(body.state.substate, MotionCommand(COMBAT_STAND));
    assert_eq!(
        select_motion(
            table,
            &mut body.state,
            &mut body.sequence,
            MotionCommand(COMBAT_STYLE),
            1.0,
        ),
        MotionSelectionOutcome::AlreadyActive
    );
}

#[test]
fn a_command_the_table_does_not_model_leaves_the_body_alone() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    let before = body.state.clone();

    let outcome = select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(0x4500_00FF),
        1.0,
    );

    assert_eq!(outcome, MotionSelectionOutcome::Unmodelled);
    assert_eq!(body.state, before);
    assert_eq!(animation_ids(&body.sequence), vec![STAND_ANIM]);
}

#[test]
fn a_modifier_layers_its_omega_onto_the_running_cycle_and_stops_cleanly() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);

    let outcome = select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(MODIFIER),
        1.0,
    );

    assert_eq!(outcome, MotionSelectionOutcome::Selected);
    assert_eq!(body.state.modifiers().len(), 1);
    assert_eq!(body.sequence.omega(), Vector3::new(0.0, 0.0, 0.5));

    stop_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(MODIFIER),
    );

    assert!(body.state.modifiers().is_empty());
    assert_eq!(body.sequence.omega(), Vector3::zero());
}

#[test]
fn a_negative_canonical_turn_retires_before_action_and_return_idle() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);

    assert_eq!(
        select_motion(
            table,
            &mut body.state,
            &mut body.sequence,
            MotionCommand(DUAL_TURN),
            -1.0,
        ),
        MotionSelectionOutcome::Selected
    );
    assert_eq!(body.sequence.omega(), Vector3::new(0.0, 0.0, -0.5));

    assert_eq!(
        stop_motion(
            table,
            &mut body.state,
            &mut body.sequence,
            MotionCommand(DUAL_TURN),
        ),
        MotionSelectionOutcome::Selected
    );
    assert!(body.state.modifiers().is_empty());
    assert_eq!(body.sequence.omega(), Vector3::zero());
    assert_eq!(
        select_action(
            table,
            &mut body.state,
            &mut body.sequence,
            MotionCommand(ACTION),
            1.0,
        ),
        ActionSelectionOutcome::Selected,
    );
    assert_eq!(body.sequence.omega(), Vector3::zero());
    body.sequence.advance(1.1);
    assert_eq!(body.sequence.omega(), Vector3::zero());
    assert_eq!(
        body.sequence.current_clip().unwrap().node.animation().id,
        STAND_ANIM
    );
}

/// Rebuilding the sequence for a new substate drops the modifier contributions with it, so they
/// have to be replayed or a modifier would silently stop working after any command.
#[test]
fn selecting_a_substate_reinstalls_the_active_modifiers() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(MODIFIER),
        1.0,
    );

    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );

    assert_eq!(body.state.modifiers().len(), 1);
    assert_eq!(body.sequence.omega(), Vector3::new(0.0, 0.0, 0.5));
}

#[test]
fn releasing_locomotion_keeps_an_active_turn_as_one_modifier() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = BodyMotionRuntime::new(table);

    body.drive(
        table,
        MotionOrder {
            style: Some(MotionCommand(STYLE)),
            forward: Some((MotionCommand(RUN), 1.0)),
            sidestep: None,
            turn: Some((MotionCommand(DUAL_TURN), 1.0)),
        },
        0.0,
    );
    assert_eq!(body.state().substate, MotionCommand(RUN));
    assert_eq!(body.state().modifiers().len(), 1);

    body.drive(
        table,
        MotionOrder {
            style: Some(MotionCommand(STYLE)),
            forward: None,
            sidestep: None,
            turn: Some((MotionCommand(DUAL_TURN), 1.5)),
        },
        0.0,
    );

    assert_eq!(body.state().substate, MotionCommand(STAND));
    assert_eq!(
        body.state().modifiers(),
        &[ActiveMotion {
            command: MotionCommand(DUAL_TURN),
            speed_mod: 1.5,
        }]
    );
    assert_eq!(body.sequence().omega(), Vector3::new(0.0, 0.0, 0.75));
}

#[test]
fn rebuilding_a_sequence_reinstalls_each_active_modifier_once() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    for command in [MODIFIER, SECOND_MODIFIER] {
        assert_eq!(
            select_motion(
                table,
                &mut body.state,
                &mut body.sequence,
                MotionCommand(command),
                1.0,
            ),
            MotionSelectionOutcome::Selected
        );
    }

    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );

    assert_eq!(body.state.modifiers().len(), 2);
    assert_eq!(body.sequence.omega(), Vector3::new(0.25, 0.0, 0.5));
}

#[test]
fn stopping_completely_clears_modifiers_and_the_substate() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(MODIFIER),
        1.0,
    );

    stop_completely(table, &mut body.state, &mut body.sequence);

    assert!(body.state.modifiers().is_empty());
    assert_eq!(body.state.substate, MotionCommand(STAND));
    assert_eq!(body.sequence.omega(), Vector3::zero());
}

/// The core of the plan: a tick's authored contribution is the ordered composition of the frames it
/// departed, not a sampled velocity.
#[test]
fn a_tick_composes_exactly_the_frames_it_departed() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    body.sequence.clear_animations();
    body.sequence.clear_physics();
    let walk = table.cycle(STYLE, WALK).expect("walk cycle");
    body.sequence
        .append(SequenceNode::install(&walk.clips[0], 1.0));

    // Four frames at 4 fps: a quarter second departs exactly one frame.
    let tick = body.sequence.advance(0.25);

    assert_eq!(tick.offset.translation, Vector3::new(0.0, 1.0, 0.0));
    assert_eq!(body.sequence.frame_number(), 1.0);
    assert!(tick.hooks.is_empty());
}

#[test]
fn crossing_a_clip_boundary_carries_leftover_time_into_the_next_clip() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    body.sequence.clear_animations();
    body.sequence.clear_physics();
    let walk = table.cycle(STYLE, WALK).expect("walk cycle");
    body.sequence
        .append(SequenceNode::install(&walk.clips[0], 1.0));

    // 4 fps over 1.25 s is five frames of travel across a four-frame clip: the clip completes and
    // the remaining quarter second advances the wrapped cursor by one more frame.
    let tick = body.sequence.advance(1.25);

    assert_eq!(
        body.sequence.frame_number(),
        1.0,
        "leftover time advanced the wrapped cursor rather than being discarded"
    );
    assert_eq!(tick.offset.translation, Vector3::new(0.0, 5.0, 0.0));
}

/// A cycle with explicit velocity and no clips still moves; that is how 1,064 archive cycles work.
#[test]
fn explicit_velocity_contributes_without_any_clips() {
    let mut sequence = MotionSequenceRuntime::new();
    sequence.set_physics(Vector3::new(2.0, 0.0, 0.0), Vector3::zero());

    let tick = sequence.advance(0.5);

    assert_eq!(tick.offset.translation, Vector3::new(1.0, 0.0, 0.0));
}

/// Real content authors an exactly-zero framerate 11,182 times, which holds the pose.
#[test]
fn a_zero_framerate_holds_the_frame() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);
    body.sequence.clear_animations();
    body.sequence.clear_physics();
    let walk = table.cycle(STYLE, WALK).expect("walk cycle");
    body.sequence
        .append(SequenceNode::install(&walk.clips[0], 0.0));

    let tick = body.sequence.advance(1.0);

    assert_eq!(body.sequence.frame_number(), 0.0);
    assert_eq!(tick.offset.translation, Vector3::zero());
}

/// Hooks are frame-indexed and direction-gated, so a backward-only hook must not fire while the
/// clip plays forwards.
#[test]
fn hooks_fire_on_departure_and_respect_their_authored_direction() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut sequence = MotionSequenceRuntime::new();
    let hooked = table.cycle(STYLE, HOOKED).expect("hooked cycle");
    sequence.append(SequenceNode::install(&hooked.clips[0], 1.0));

    // Departing frames 0 and 1 at 4 fps fires only the forward hook on frame 1.
    let tick = sequence.advance(0.5);

    assert_eq!(tick.hooks.len(), 1);
    assert_eq!(tick.hooks[0].animation_id, HOOK_ANIM);
    assert_eq!(tick.hooks[0].hook.frame, 1);
    assert_eq!(tick.hooks[0].hook.direction, MotionHookDirection::Forward);

    // Departing frame 2 forwards must not fire its backward-only hook.
    let tick = sequence.advance(0.25);
    assert!(tick.hooks.is_empty());
}

#[test]
fn completing_a_clip_fires_its_terminal_frame_hook() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut sequence = MotionSequenceRuntime::new();
    let hooked = table.cycle(STYLE, HOOKED).expect("hooked cycle");
    sequence.append(SequenceNode::install(&hooked.clips[0], 1.0));

    let tick = sequence.advance(1.0);

    assert_eq!(
        tick.hooks
            .iter()
            .map(|fired| fired.hook.frame)
            .collect::<Vec<_>>(),
        vec![1, 3]
    );
}

/// Installing a sequence after the cursor has been running starts at the new clip's own entry
/// frame rather than replaying the time that already elapsed.
#[test]
fn late_installation_starts_at_the_clips_entry_frame() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut sequence = MotionSequenceRuntime::new();

    // Ticks before anything is installed contribute nothing and leave no cursor debt.
    let idle = sequence.advance(5.0);
    assert_eq!(idle.offset, RigidTransform::identity());

    let walk = table.cycle(STYLE, WALK).expect("walk cycle");
    sequence.append(SequenceNode::install(&walk.clips[0], 1.0));

    assert_eq!(sequence.frame_number(), 0.0);
}

/// Pausing is the absence of elapsed time, not a mode: a zero-length tick contributes nothing and
/// leaves the cursor exactly where it was, so resuming continues rather than restarts.
#[test]
fn a_zero_length_tick_pauses_without_losing_the_cursor() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut sequence = MotionSequenceRuntime::new();
    let walk = table.cycle(STYLE, WALK).expect("walk cycle");
    sequence.append(SequenceNode::install(&walk.clips[0], 1.0));
    sequence.advance(0.25);
    let paused_at = sequence.frame_number();

    let paused = sequence.advance(0.0);

    assert_eq!(paused.offset, RigidTransform::identity());
    assert!(paused.hooks.is_empty());
    assert_eq!(sequence.frame_number(), paused_at);

    let resumed = sequence.advance(0.25);
    assert_eq!(resumed.offset.translation, Vector3::new(0.0, 1.0, 0.0));
}

/// Resolution is a pure function of contract, state, and elapsed time. Two bodies stepped the same
/// way must agree exactly, with no shared cache or ordering between them to make them differ.
#[test]
fn identical_inputs_produce_identical_ticks() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");

    let step = |steps: &[f32]| {
        let mut body = standing(table);
        select_motion(
            table,
            &mut body.state,
            &mut body.sequence,
            MotionCommand(RUN),
            1.5,
        );
        steps
            .iter()
            .map(|quantum| body.sequence.advance(*quantum))
            .collect::<Vec<_>>()
    };

    let quanta = [0.1, 0.25, 0.4, 0.05, 1.0];
    assert_eq!(step(&quanta), step(&quanta));
}

/// Explicit motion-data velocity is a per-tick contribution scaled by the speed the motion was
/// selected at, not retained momentum: it appears in the tick's offset and nowhere else.
#[test]
fn a_selected_speed_scales_the_explicit_velocity_it_installs() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut body = standing(table);

    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(RUN),
        2.0,
    );

    assert_eq!(body.sequence.velocity(), Vector3::new(6.0, 0.0, 0.0));
}

/// The whole point of Phase 3: a body driven by authored root motion travels the same distance the
/// deleted mean-velocity asset would have produced, without ever storing a velocity.
///
/// The fixture reproduces the standard character walk measured from real content: 36 frames of
/// 0.0388889 m along local Y at 66.9 fps.
#[test]
fn a_walk_cycle_travels_the_measured_content_walk_speed() {
    const FRAMES: usize = 36;
    const STEP: f32 = 0.038_888_9;
    const FRAMERATE: f32 = 66.9;
    // Provenance: the deleted `MotionKinematics` reduction stored exactly this for the standard
    // walk, derived from the same content. Retained as the reference value, not as that mechanism.
    const MEASURED_WALK_SPEED: f32 = 2.6017;

    let walk_anim = 0x0300_0100;
    let mut cycles = HashMap::new();
    cycles.insert(
        MotionTable::cycle_key(STYLE, WALK),
        motion(vec![clip(walk_anim, FRAMERATE)], None, None),
    );
    cycles.insert(
        MotionTable::cycle_key(STYLE, STAND),
        motion(vec![clip(STAND_ANIM, 10.0)], None, None),
    );
    let table = MotionTable {
        id: 0x0900_0001,
        default_style: STYLE,
        style_defaults: HashMap::from([(STYLE, STAND)]),
        cycles,
        modifiers: HashMap::new(),
        links: HashMap::new(),
    };
    let catalog = MotionSequenceCatalog::assemble(
        [table],
        [
            animation(walk_anim, FRAMES, STEP),
            animation(STAND_ANIM, 4, 0.0),
        ],
        [],
    )
    .expect("walk fixture should assemble");
    let table = catalog.table(0x0900_0001).expect("table");

    let mut body = standing(table);
    select_motion(
        table,
        &mut body.state,
        &mut body.sequence,
        MotionCommand(WALK),
        1.0,
    );

    // One second at a 30 Hz host tick, accumulated the way a solver would accumulate accepted
    // displacement rather than by reading any stored rate.
    let mut travelled = 0.0f32;
    for _ in 0..30 {
        travelled += body
            .sequence
            .advance(1.0 / 30.0)
            .offset
            .translation
            .length();
    }

    let error = (travelled - MEASURED_WALK_SPEED).abs() / MEASURED_WALK_SPEED;
    assert!(
        error < 0.02,
        "authored walk travelled {travelled} m/s against content's {MEASURED_WALK_SPEED} m/s"
    );
}

mod actuation {
    use super::*;
    use crate::spatial::{ContactState, PhysicalBodyActuation};
    use holtburger_common::position::WorldPosition;

    fn pose(heading_deg: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: holtburger_common::Guid(0x1234_0000),
            coords: Vector3::zero(),
            rotation: Quaternion::from_heading(heading_deg.to_radians()),
        }
    }

    fn planar(actuation: &PhysicalBodyActuation) -> Vector3 {
        match actuation {
            PhysicalBodyActuation::Grounded(grounded) => grounded.supported_planar_velocity(),
            PhysicalBodyActuation::FreeFlight { .. } => {
                panic!("authored drive builds a grounded actuation")
            }
        }
    }

    /// The authored translation is a local vector: the body's own rotation places it in the world.
    #[test]
    fn authored_translation_is_placed_by_the_bodys_own_rotation() {
        let offset = RigidTransform {
            translation: Vector3::new(0.0, 2.0, 0.0),
            rotation: Quaternion::identity(),
        };

        let actuation =
            authored_grounded_actuation(offset, pose(90.0), ContactState::Grounded, 1.0, 0.5)
                .expect("a planar authored offset builds a grounded actuation");

        // Heading 90 degrees is North, where the pose rotation is identity, so local +Y is world +Y.
        let velocity = planar(&actuation);
        assert!(velocity.x.abs() < 1e-4);
        assert!((velocity.y - 4.0).abs() < 1e-4, "2 m over half a second");
        assert_eq!(velocity.z, 0.0);
    }

    /// Object scale multiplies authored translation and nothing else, which is retail's rule.
    #[test]
    fn object_scale_multiplies_authored_translation() {
        let offset = RigidTransform {
            translation: Vector3::new(0.0, 2.0, 0.0),
            rotation: Quaternion::identity(),
        };

        let actuation =
            authored_grounded_actuation(offset, pose(90.0), ContactState::Grounded, 2.5, 1.0)
                .expect("a scaled authored offset builds a grounded actuation");

        assert!((planar(&actuation).y - 5.0).abs() < 1e-4);
    }

    /// Off walkable support the translation is gated to zero while the rotation still reaches the
    /// solver as a heading, so a falling body keeps turning.
    #[test]
    fn an_unsupported_body_contributes_no_translation_but_still_turns() {
        let quarter_turn = std::f32::consts::FRAC_PI_2;
        let offset = RigidTransform {
            translation: Vector3::new(0.0, 2.0, 0.0),
            rotation: Quaternion::from_axis_angle(Vector3::new(0.0, 0.0, 1.0), quarter_turn)
                .expect("a unit axis and finite angle build a rotation"),
        };
        let start = pose(90.0);

        let actuation =
            authored_grounded_actuation(offset, start, ContactState::Airborne, 1.0, 1.0)
                .expect("an unsupported authored offset still builds an actuation");

        assert_eq!(planar(&actuation), Vector3::zero());
        match &actuation {
            PhysicalBodyActuation::Grounded(grounded) => {
                let heading = grounded
                    .control_heading()
                    .expect("authored rotation reaches the solver as a heading");
                assert!(
                    (heading - start.rotation.to_heading()).abs() > 1e-3,
                    "the authored rotation survives the support gate"
                );
            }
            PhysicalBodyActuation::FreeFlight { .. } => unreachable!(),
        }
    }
}

mod playing_clip {
    use super::*;
    use crate::motion::{MotionClipCompletion, MotionRuntimeRegistry, set_default_state};

    fn possessed(
        catalog: &MotionSequenceCatalog,
    ) -> (MotionRuntimeRegistry, holtburger_common::Guid) {
        let table = catalog.table(0x0900_0001).expect("table");
        let guid = holtburger_common::Guid(0xf000_0001);
        let mut registry = MotionRuntimeRegistry::new();
        registry.drive(table, guid, MotionOrder::default(), 0.0);
        (registry, guid)
    }

    /// The projection carries the clip the host is on, with the window already resolved — so the
    /// frontend never has to know that `-1` means "to the end".
    #[test]
    fn the_projection_names_the_clip_with_its_resolved_window() {
        let catalog = catalog();
        let (registry, guid) = possessed(&catalog);

        let clip = registry
            .playing_clip(guid)
            .expect("a standing body plays its idle");

        assert_eq!(clip.animation_id, STAND_ANIM);
        assert_eq!(clip.low_frame, 0);
        assert_eq!(clip.high_frame, 3);
        assert_eq!(clip.framerate, 10.0);
        assert_eq!(clip.completion, MotionClipCompletion::Loop);
    }

    /// A clip change reaches the frontend only as a new projection, never as something it chose.
    #[test]
    fn commanding_a_new_motion_changes_which_clip_the_projection_names() {
        let catalog = catalog();
        let table = catalog.table(0x0900_0001).expect("table");
        let (mut registry, guid) = possessed(&catalog);
        let idle = registry.playing_clip(guid).expect("idle").animation_id;

        registry.drive(
            table,
            guid,
            MotionOrder {
                style: Some(MotionCommand(STYLE)),
                forward: Some((MotionCommand(WALK), 1.0)),
                sidestep: None,
                turn: None,
            },
            1.0 / 30.0,
        );

        let clip = registry
            .playing_clip(guid)
            .expect("a walking body plays a clip");
        assert_ne!(clip.animation_id, idle);
        assert_eq!(clip.animation_id, LINK_ANIM, "the transition plays first");
        assert_eq!(clip.completion, MotionClipCompletion::Hold);

        registry.drive(
            table,
            guid,
            MotionOrder {
                style: Some(MotionCommand(STYLE)),
                forward: Some((MotionCommand(WALK), 1.0)),
                sidestep: None,
                turn: None,
            },
            1.1,
        );
        let cycle = registry.playing_clip(guid).expect("walk cycle");
        assert_eq!(cycle.animation_id, WALK_ANIM);
        assert_eq!(cycle.completion, MotionClipCompletion::Loop);
    }

    /// The projection deliberately carries no frame number: host and frontend advance at the same
    /// rate, so a phase offset never accumulates and there is nothing to re-anchor.
    #[test]
    fn advancing_the_host_does_not_change_the_projected_clip_while_it_keeps_playing() {
        let catalog = catalog();
        let table = catalog.table(0x0900_0001).expect("table");
        let (mut registry, guid) = possessed(&catalog);
        let before = registry.playing_clip(guid).expect("idle");

        registry.drive(table, guid, MotionOrder::default(), 0.05);

        assert_eq!(registry.playing_clip(guid), Some(before));
        assert!(
            registry
                .get(guid)
                .expect("playback")
                .sequence()
                .frame_number()
                > 0.0,
            "the host cursor still advanced; it is simply not projected"
        );
    }

    /// A body with no clip installed does not animate, which is different from one whose clip is
    /// unknown. Saying so with `None` keeps a frontend from inventing a pose.
    #[test]
    fn a_body_with_no_clips_projects_no_cursor() {
        let catalog = MotionSequenceCatalog::default();
        let mut registry = MotionRuntimeRegistry::new();
        let guid = holtburger_common::Guid(0xf000_0002);
        let _ = (&catalog, &mut registry, guid, set_default_state);

        assert!(registry.playing_clip(guid).is_none());
    }

    /// Standard non-combat sidestep is a dual-class command whose authored row resolves as a
    /// cycle. Re-applying an order must not mistake that cycle for stale forward locomotion and
    /// restart it every host tick.
    #[test]
    fn a_sustained_sidestep_cycle_advances_at_its_authored_rate() {
        const SIDE: u32 = 0x6500_000F;
        const FRAMES: usize = 10;
        const STEP: f32 = 0.1;
        const FRAMERATE: f32 = 12.0;
        const EXPECTED_METRES_PER_SECOND: f32 = 1.2;

        let table = MotionTable {
            id: 0x0900_0002,
            default_style: STYLE,
            style_defaults: HashMap::from([(STYLE, STAND)]),
            cycles: HashMap::from([
                (
                    MotionTable::cycle_key(STYLE, STAND),
                    motion(vec![clip(STAND_ANIM, 10.0)], None, None),
                ),
                (
                    MotionTable::cycle_key(STYLE, SIDE),
                    motion(vec![clip(SIDESTEP_ANIM, FRAMERATE)], None, None),
                ),
            ]),
            modifiers: HashMap::new(),
            links: HashMap::new(),
        };
        let catalog = MotionSequenceCatalog::assemble(
            [table],
            [
                animation(STAND_ANIM, 4, 0.0),
                animation_with_step(SIDESTEP_ANIM, FRAMES, Vector3::new(STEP, 0.0, 0.0)),
            ],
            [],
        )
        .expect("sidestep fixture should assemble");
        let table = catalog.table(0x0900_0002).expect("table");
        let guid = holtburger_common::Guid(0xf000_0003);
        let order = MotionOrder {
            style: Some(MotionCommand(STYLE)),
            forward: None,
            sidestep: Some((MotionCommand(SIDE), 1.0)),
            turn: None,
        };
        let mut registry = MotionRuntimeRegistry::new();
        let mut travelled = 0.0;

        // Measure long enough that the clip's one-frame entry anchor is insignificant. That anchor
        // is sequence semantics, whereas a selector restart would lose nearly all displacement.
        for _ in 0..300 {
            travelled += registry
                .drive(table, guid, order, 1.0 / 30.0)
                .offset
                .translation
                .length();
        }

        let measured_rate = travelled / 10.0;
        assert!(
            (measured_rate - EXPECTED_METRES_PER_SECOND).abs() / EXPECTED_METRES_PER_SECOND < 0.01,
            "sustained sidestep measured {measured_rate}m/s instead of {EXPECTED_METRES_PER_SECOND}m/s"
        );
    }
}

/// A closure built from cycles alone would miss most transitions: 1,174 animations across the
/// archive are reachable only through links.
#[test]
fn the_reachable_set_spans_cycles_modifiers_and_links() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");

    let reachable: Vec<u32> = table.reachable_animation_ids().collect();

    assert!(reachable.contains(&STAND_ANIM), "cycles are reachable");
    assert!(reachable.contains(&WALK_ANIM), "cycles are reachable");
    assert!(
        reachable.contains(&LINK_ANIM),
        "link transitions are reachable, and are reachable no other way"
    );
    assert!(
        reachable.windows(2).all(|pair| pair[0] < pair[1]),
        "the set is deduplicated and ordered, so staging is deterministic"
    );
}

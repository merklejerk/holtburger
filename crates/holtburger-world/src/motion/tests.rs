use super::registry::RETAIL_RUN_FORWARD_BASE_SPEED_MPS;
use super::*;
#[path = "tests/death_lifecycle.rs"]
mod death_lifecycle;
use crate::entity::{
    EntityMotionAction, EntityMotionActionSource, EntityMotionAdmission, EntityMotionSnapshot,
    OrderedMotionScalar,
};
use crate::spatial::ContactState;
use holtburger_common::properties::WorldObjectPropertyAccessorsMut;
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
    catalog_with_defaults(combat_default, 10.0)
}

/// Builds the shared table fixture with independently selectable resting motion facts.
fn catalog_with_defaults(combat_default: u32, stand_framerate: f32) -> MotionSequenceCatalog {
    catalog_with_action_animation(
        combat_default,
        stand_framerate,
        animation(ACTION_ANIM, 4, 0.25),
    )
}

fn catalog_with_action_animation(
    combat_default: u32,
    stand_framerate: f32,
    action_animation: Animation,
) -> MotionSequenceCatalog {
    let mut cycles = HashMap::new();
    cycles.insert(
        MotionTable::cycle_key(STYLE, STAND),
        motion(vec![clip(STAND_ANIM, stand_framerate)], None, None),
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
            action_animation,
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

/// Whole-frame advancement retains the authored endpoint.
#[test]
fn a_whole_frame_reaches_its_authored_endpoint() {
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

/// Low-rate content must request movement between hook departures, including explicit velocity.
#[test]
fn fractional_frames_supply_continuous_motion_without_early_hooks() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).expect("table");
    let mut sequence = MotionSequenceRuntime::new();
    let hooked = table.cycle(STYLE, HOOKED).expect("hooked cycle");
    sequence.append(SequenceNode::install(&hooked.clips[0], 1.0));
    sequence.set_physics(Vector3::new(2.0, 0.0, 0.0), Vector3::zero());
    let mut hooks = Vec::new();
    for index in 0..16 {
        let tick = sequence.advance(1.0 / 32.0);
        assert!((tick.offset.translation.x - 2.0 / 32.0).abs() < 1e-6);
        if index < 15 {
            assert!(tick.hooks.is_empty());
        }
        hooks.extend(tick.hooks);
    }
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks[0].hook.frame, 1);

    let mut walk = MotionSequenceRuntime::new();
    walk.append(SequenceNode::install(
        &table.cycle(STYLE, WALK).expect("walk").clips[0],
        1.0,
    ));
    for _ in 0..16 {
        let tick = walk.advance(1.0 / 32.0);
        assert!((tick.offset.translation.y - 4.0 / 32.0).abs() < 1e-6);
    }
}

/// Splitting a turning frame must preserve its endpoint, including clip wraps and reverse travel.
#[test]
fn fractional_turning_frames_preserve_composition_and_hook_order() {
    let mut turning = hook_animation();
    for (index, frame) in turning.pos_frames.iter_mut().enumerate() {
        frame.origin = Vector3::new(index as f32 * 0.25, 1.0, 0.0);
        frame.orientation = Quaternion::from_heading((90.0 + index as f32 * 12.0).to_radians());
    }
    let table = MotionTable {
        id: 0x0900_0001,
        default_style: STYLE,
        style_defaults: HashMap::from([(STYLE, HOOKED)]),
        cycles: HashMap::from([(
            MotionTable::cycle_key(STYLE, HOOKED),
            motion(vec![clip(HOOK_ANIM, 4.0)], None, None),
        )]),
        modifiers: HashMap::new(),
        links: HashMap::new(),
    };
    let catalog = MotionSequenceCatalog::assemble([table], [turning], []).expect("turning fixture");
    let clip = &catalog
        .table(0x0900_0001)
        .expect("table")
        .cycle(STYLE, HOOKED)
        .expect("cycle")
        .clips[0];
    for speed in [1.0, -1.0] {
        let mut whole = MotionSequenceRuntime::new();
        whole.append(SequenceNode::install(clip, speed));
        whole.set_physics(Vector3::new(0.5, 0.0, 0.0), Vector3::new(0.0, 0.0, 0.3));
        let mut split = whole.clone();
        let expected = whole.advance(1.25);
        let mut accumulated = RigidTransform::identity();
        let mut hooks = Vec::new();
        for _ in 0..40 {
            let tick = split.advance(1.0 / 32.0);
            accumulated = accumulated.combine(&tick.offset);
            hooks.extend(tick.hooks);
        }
        assert!((accumulated.translation - expected.offset.translation).length() < 1e-4);
        let axis = Vector3::new(1.0, 0.0, 0.0);
        assert!(
            (accumulated.rotation.rotate_vector(axis)
                - expected.offset.rotation.rotate_vector(axis))
            .length()
                < 1e-4
        );
        assert_eq!(hooks, expected.hooks);
    }
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

/// Independent straight-line rate oracle: ACE MotionTable.add_motion scales frame rate and
/// explicit velocity by command speed; Sequence.apply_physics integrates the latter over time;
/// PhysicsObj.UpdatePositionInternal scales their sum once. Uniform root frames make retail's
/// boundary substitution immaterial. Fractional movement is our intentional continuous sampling.
#[test]
fn ordinary_motion_rates_match_reference_across_speed_scale_and_tick_size() {
    const ROOT_STEP: f32 = 0.125;
    const FRAME_RATE: f32 = 16.0;
    const EXPLICIT_SPEED: f32 = 0.75;
    let table = MotionTable {
        id: 0x0900_0001,
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
            (
                MotionTable::cycle_key(STYLE, RUN),
                motion(
                    vec![clip(RUN_ANIM, FRAME_RATE)],
                    Some(Vector3::new(EXPLICIT_SPEED, 0.0, 0.0)),
                    None,
                ),
            ),
        ]),
        modifiers: HashMap::new(),
        links: HashMap::new(),
    };
    let catalog = MotionSequenceCatalog::assemble(
        [table],
        [
            animation(STAND_ANIM, 8, 0.0),
            animation(WALK_ANIM, 8, ROOT_STEP),
            animation(RUN_ANIM, 8, ROOT_STEP),
        ],
        [],
    )
    .expect("uniform rate fixture");
    let table = catalog.table(0x0900_0001).expect("table");
    for scale in [1.0, 1.2] {
        for ticks_per_second in [30, 60, 144] {
            let mut body = standing(table);
            // Exercise both re-rating an existing cycle and replacing it, including a full stop.
            for (command, rate) in [
                (WALK, 0.5),
                (WALK, 1.0),
                (RUN, 2.0),
                (RUN, 0.75),
                (STAND, 1.0),
                (WALK, 1.5),
            ] {
                select_motion(
                    table,
                    &mut body.state,
                    &mut body.sequence,
                    MotionCommand(command),
                    rate,
                );
                let mut travelled = Vector3::zero();
                for _ in 0..ticks_per_second {
                    let tick = body.sequence.advance(1.0 / ticks_per_second as f32);
                    travelled = travelled
                        + crate::gate_authored_offset(tick.offset, ContactState::Grounded, scale)
                            .translation;
                }
                let expected = Vector3::new(
                    if command == RUN { EXPLICIT_SPEED } else { 0.0 },
                    if command == STAND {
                        0.0
                    } else {
                        ROOT_STEP * FRAME_RATE
                    },
                    0.0,
                ) * (rate * scale);
                assert!(
                    (travelled - expected).length() < 0.0001,
                    "command={command:#x}, rate={rate}, scale={scale}, ticks={ticks_per_second}: {travelled:?} != {expected:?}"
                );
            }
        }
    }
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
            PhysicalBodyActuation::FixedPosition { .. }
            | PhysicalBodyActuation::FreeFlight { .. } => {
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
            PhysicalBodyActuation::FixedPosition { .. }
            | PhysicalBodyActuation::FreeFlight { .. } => unreachable!(),
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

    #[test]
    fn stationary_playback_projects_its_exact_settled_frame() {
        let catalog = catalog_with_defaults(STAND, 0.0);
        let (registry, guid) = possessed(&catalog);

        assert_eq!(
            registry.motion_presentation(guid),
            Some(MotionPresentation::Settled(SettledMotionPose {
                animation_id: STAND_ANIM,
                frame: 0,
            }))
        );
    }

    #[test]
    fn stopping_an_active_clip_projects_the_frame_its_cursor_reached() {
        let catalog = catalog();
        let table = catalog.table(0x0900_0001).expect("table");
        let (mut registry, guid) = possessed(&catalog);
        registry.drive(table, guid, MotionOrder::default(), 0.25);
        let reached_frame = registry
            .get(guid)
            .expect("playback")
            .sequence()
            .current_frame();

        registry.drive(
            table,
            guid,
            MotionOrder {
                style: Some(MotionCommand(STYLE)),
                forward: Some((MotionCommand(STAND), 0.0)),
                sidestep: None,
                turn: None,
            },
            1.0 / 30.0,
        );

        assert_eq!(
            registry.motion_presentation(guid),
            Some(MotionPresentation::Settled(SettledMotionPose {
                animation_id: STAND_ANIM,
                frame: reached_frame,
            }))
        );
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
        let authored_tick = registry.get(guid).unwrap().tick().clone();
        let observed = observed_locomotion_order(
            table,
            MotionCommand(STYLE),
            crate::spatial::AcceptedBodyMotion {
                velocity: Vector3::new(OBSERVED_WALK_SPEED_MPS * 2.0, 0.0, 0.0),
                omega: Vector3::zero(),
            },
            Quaternion::identity(),
            CharacterMotionPresentation::Grounded,
            1.0,
        )
        .unwrap();
        assert_eq!(observed.sidestep, Some((MotionCommand::SIDESTEP, 2.0)));
        assert!(registry.present_locomotion(table, guid, observed, 1.0));
        assert_eq!(
            registry.playing_clip(guid).unwrap().animation_id,
            SIDESTEP_ANIM
        );
        assert_eq!(
            registry.playing_clip(guid).unwrap().framerate,
            FRAMERATE * 2.0
        );
        assert_eq!(registry.get(guid).unwrap().tick(), &authored_tick);
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

#[test]
fn observed_locomotion_cannot_replace_actions_or_change_authored_ticks() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut nominal = BodyMotionRuntime::new(table);
    let mut observed = nominal.clone();
    let walking = MotionOrder {
        forward: Some((MotionCommand(WALK), 1.0)),
        ..MotionOrder::default()
    };
    assert!(observed.present_locomotion(table, walking, 1.5));
    assert_eq!(observed.playing_clip().unwrap().animation_id, WALK_ANIM);
    assert_eq!(observed.tick(), nominal.tick());
    assert_eq!(observed.state().substate, nominal.state().substate);
    assert_eq!(
        observed.sequence().frame_number(),
        nominal.sequence().frame_number()
    );

    nominal.enqueue_action(action(1));
    observed.enqueue_action(action(1));
    let mut completed = false;
    for quantum in [0.25, 0.25, 0.75] {
        let expected = nominal
            .drive(table, MotionOrder::default(), quantum)
            .clone();
        let actual = observed
            .drive(table, MotionOrder::default(), quantum)
            .clone();
        assert_eq!(actual, expected);
        assert!(observed.present_locomotion(table, walking, quantum));
        assert_eq!(observed.tick(), &expected);
        assert_eq!(observed.active_action(), nominal.active_action());
        if observed.active_action().is_some() {
            assert_eq!(observed.playing_clip().unwrap().animation_id, ACTION_ANIM);
        } else {
            completed |= actual.action_completed;
            assert_eq!(observed.playing_clip().unwrap().animation_id, WALK_ANIM);
        }
    }
    assert!(
        completed,
        "fixture did not cross the action return boundary"
    );
    assert_eq!(nominal.playing_clip().unwrap().animation_id, STAND_ANIM);
    // Not every explicit animation is a queued action: a steady special pose also wins.
    let explicit = MotionOrder {
        forward: Some((MotionCommand(HOOKED), 1.0)),
        ..MotionOrder::default()
    };
    nominal.drive(table, explicit, 0.25);
    observed.drive(table, explicit, 0.25);
    assert!(observed.active_action().is_none());
    assert!(observed.present_locomotion(table, walking, 0.25));
    assert_eq!(
        observed.motion_presentation(),
        nominal.motion_presentation()
    );
    assert_eq!(observed.tick(), nominal.tick());
    // Dispatch flags can differ while selecting the same idle cycle; that still permits walking.
    let ready = MotionOrder {
        forward: Some((MotionCommand::READY, 1.0)),
        ..MotionOrder::default()
    };
    nominal.drive(table, ready, 0.0);
    observed.drive(table, ready, 0.0);
    assert!(observed.present_locomotion(table, walking, 0.0));
    assert_eq!(observed.playing_clip().unwrap().animation_id, WALK_ANIM);
    assert_eq!(observed.tick(), nominal.tick());
}

#[test]
fn missing_falling_content_keeps_resolved_locomotion_presentation() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut runtime = BodyMotionRuntime::new(table);
    let running = MotionOrder {
        forward: Some((MotionCommand::RUN_FORWARD, 1.0)),
        ..MotionOrder::default()
    };
    runtime.drive(table, running, 1.0);
    assert_eq!(runtime.state().substate, MotionCommand::RUN_FORWARD);
    assert!(runtime.present_locomotion(table, MotionOrder::default(), 0.0));
    assert_eq!(runtime.playing_clip().unwrap().animation_id, STAND_ANIM);
    let unsupported = running.with_character_presentation(CharacterMotionPresentation::Falling);
    runtime.drive(table, unsupported, 0.0);
    assert!(
        table
            .cycle(runtime.state().style.raw(), MotionCommand::FALLING.raw())
            .is_none()
    );
    assert_eq!(runtime.state().substate, MotionCommand::RUN_FORWARD);
    assert_eq!(runtime.playing_clip().unwrap().animation_id, STAND_ANIM);
}

#[test]
fn visual_cursor_shares_hooked_clip_timing_without_authoring_a_tick() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let mut body = standing(table);
    assert!(
        select_motion(
            table,
            &mut body.state,
            &mut body.sequence,
            MotionCommand(HOOKED),
            1.0
        )
        .is_modelled()
    );
    let mut visual = body.sequence.clone();
    let mut fired = 0;
    for quantum in [0.125, 0.375, 0.75, -0.25] {
        let tick = body.sequence.advance(quantum);
        fired += tick.hooks.len();
        visual.advance_presentation(quantum);
        assert_eq!(visual.frame_number(), body.sequence.frame_number());
        assert_eq!(animation_ids(&visual), animation_ids(&body.sequence));
        assert_eq!(
            visual.current_clip().map(|clip| clip.node.animation().id),
            body.sequence
                .current_clip()
                .map(|clip| clip.node.animation().id)
        );
    }
    assert!(fired > 0, "fixture did not exercise authored hooks");
}

#[test]
fn observed_motion_selects_available_gaits_in_body_space() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let orientation = Quaternion::from_axis_angle(Vector3::new(0.0, 0.0, 1.0), 0.7).unwrap();
    for (local, scale, command, rate) in [
        (
            Vector3::new(0.0, OBSERVED_WALK_SPEED_MPS, 0.0),
            1.0,
            MotionCommand::WALK_FORWARD,
            1.0,
        ),
        (
            Vector3::new(0.0, OBSERVED_RUN_SPEED_MPS * 2.0, 0.0),
            1.0,
            MotionCommand::RUN_FORWARD,
            2.0,
        ),
        (
            Vector3::new(0.0, -OBSERVED_WALK_SPEED_MPS, 0.0),
            1.0,
            MotionCommand::WALK_FORWARD,
            -1.0,
        ),
        (
            Vector3::new(OBSERVED_WALK_SPEED_MPS, 0.0, 0.0),
            1.0,
            MotionCommand::WALK_FORWARD,
            1.0,
        ),
        (
            Vector3::new(0.0, OBSERVED_WALK_SPEED_MPS * 2.0, 0.0),
            2.0,
            MotionCommand::WALK_FORWARD,
            1.0,
        ),
    ] {
        let motion = crate::spatial::AcceptedBodyMotion {
            velocity: orientation.rotate_vector(local),
            omega: Vector3::zero(),
        };
        let order = observed_locomotion_order(
            table,
            MotionCommand(STYLE),
            motion,
            orientation,
            CharacterMotionPresentation::Grounded,
            scale,
        )
        .unwrap();
        let (selected, speed) = order.forward.unwrap();
        assert_eq!(selected, command);
        assert!((speed - rate).abs() < 0.0001);
        assert!(order.sidestep.is_none());
        let mut runtime = BodyMotionRuntime::new(table);
        assert!(runtime.present_locomotion(table, order, 0.0));
    }
}

#[test]
fn observed_motion_preserves_support_and_uses_only_visible_turn_cycles() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let motion = crate::spatial::AcceptedBodyMotion {
        velocity: Vector3::zero(),
        omega: Vector3::new(0.0, 0.0, -OBSERVED_TURN_RATE_RADIANS),
    };
    let standing = observed_locomotion_order(
        table,
        MotionCommand(STYLE),
        motion,
        Quaternion::identity(),
        CharacterMotionPresentation::Grounded,
        1.0,
    )
    .unwrap();
    assert_eq!(standing.turn, Some((MotionCommand::TURN_RIGHT, 1.0)));
    let mut runtime = BodyMotionRuntime::new(table);
    assert!(runtime.present_locomotion(table, standing, 0.0));
    let moving = crate::spatial::AcceptedBodyMotion {
        velocity: Vector3::new(0.0, OBSERVED_WALK_SPEED_MPS, 0.0),
        ..motion
    };
    let walking = observed_locomotion_order(
        table,
        MotionCommand(STYLE),
        moving,
        Quaternion::identity(),
        CharacterMotionPresentation::Grounded,
        1.0,
    )
    .unwrap();
    assert_eq!(walking.forward, Some((MotionCommand::WALK_FORWARD, 1.0)));
    assert!(walking.turn.is_none());
    for presentation in [
        CharacterMotionPresentation::Ready,
        CharacterMotionPresentation::Falling,
        CharacterMotionPresentation::StanceDefault,
    ] {
        // Ready shares the fixture's default cycle key; missing Falling chooses the default.
        let order = observed_locomotion_order(
            table,
            MotionCommand(STYLE),
            moving,
            Quaternion::identity(),
            presentation,
            1.0,
        )
        .unwrap();
        assert_eq!(
            order.forward,
            match presentation {
                CharacterMotionPresentation::Ready => Some((MotionCommand::READY, 1.0)),
                _ => None,
            }
        );
        assert!(order.sidestep.is_none());
        assert!(order.turn.is_none());
        assert!(runtime.present_locomotion(table, order, 0.0));
    }
    let unavailable = observed_locomotion_order(
        table,
        MotionCommand(COMBAT_STYLE),
        moving,
        Quaternion::identity(),
        CharacterMotionPresentation::Grounded,
        1.0,
    )
    .unwrap();
    assert!(unavailable.forward.is_none());
    let settling = crate::spatial::AcceptedBodyMotion {
        velocity: Vector3::new(0.0, OBSERVED_LINEAR_IDLE_SPEED_MPS * 0.5, 0.0),
        omega: Vector3::new(0.0, 0.0, OBSERVED_ANGULAR_IDLE_RATE_RADIANS * 0.5),
    };
    let idle = observed_locomotion_order(
        table,
        MotionCommand(STYLE),
        settling,
        Quaternion::identity(),
        CharacterMotionPresentation::Grounded,
        1.0,
    )
    .unwrap();
    assert!(idle.forward.is_none() && idle.sidestep.is_none() && idle.turn.is_none());
}

#[test]
fn retiring_observations_preserves_authored_cursor_actions_and_ticks() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let retained = holtburger_common::Guid(1);
    let retired = holtburger_common::Guid(2);
    let mut registry = MotionRuntimeRegistry::new();
    let walking = MotionOrder {
        forward: Some((MotionCommand(WALK), 1.0)),
        ..MotionOrder::default()
    };
    for guid in [retained, retired] {
        registry.drive(table, guid, MotionOrder::default(), 0.0);
        assert!(registry.present_locomotion(table, guid, walking, 1.5));
        registry.enqueue_action(table, guid, action(1));
        registry.drive(table, guid, MotionOrder::default(), 0.25);
    }
    let before = registry.get(retired).unwrap().clone();
    registry.retain_locomotion_presentation(|guid| guid == retained);
    let after = registry.get(retired).unwrap();
    assert_eq!(after.tick(), before.tick());
    assert_eq!(
        after.sequence().frame_number(),
        before.sequence().frame_number()
    );
    assert_eq!(after.active_action(), before.active_action());
    assert_eq!(after.action_count(), before.action_count());
    assert_eq!(
        registry.playing_clip(retired).unwrap().animation_id,
        ACTION_ANIM
    );
    let expected = registry
        .drive(table, retained, MotionOrder::default(), 1.0)
        .clone();
    let actual = registry
        .drive(table, retired, MotionOrder::default(), 1.0)
        .clone();
    assert_eq!(actual, expected);
    assert!(actual.action_completed);
    assert_eq!(
        registry.playing_clip(retained).unwrap().animation_id,
        WALK_ANIM
    );
    assert_eq!(
        registry.playing_clip(retired).unwrap().animation_id,
        STAND_ANIM
    );
    assert_eq!(registry.len(), 2);
}

#[test]
fn world_locomotion_sources_preserve_physics_and_action_priority() {
    let mut world = crate::WorldState::synthetic();
    world.set_motion_sequences(catalog());
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = holtburger_common::Guid(1);
    let body_id = crate::SpatialBodyId::Entity(guid);
    let pose = holtburger_common::position::WorldPosition {
        rotation: Quaternion::from_axis_angle(
            Vector3::new(0.0, 0.0, 1.0),
            std::f32::consts::FRAC_PI_2,
        )
        .unwrap(),
        ..Default::default()
    };
    // Authority still faces forward; observed travel must use the published physical facing.
    let mut entity = crate::entity::Entity::new(
        guid,
        "Walker".to_owned(),
        holtburger_common::position::WorldPosition::default(),
    );
    entity.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::MotionTable,
        holtburger_common::Guid(table.id),
    );
    world.entities.insert(entity);
    world.scene.apply_authoritative_body_effect(
        body_id,
        crate::AuthoritativePoseEffect::Initialize { pose },
        crate::AuthoritativeBodyVectors {
            velocity: Vector3::zero(),
            acceleration: Vector3::zero(),
            omega: Vector3::zero(),
        },
        std::time::Instant::now(),
    );
    world
        .motion_runtimes
        .drive(table, guid, MotionOrder::default(), 0.0);
    let observed = crate::spatial::AcceptedBodyMotion {
        velocity: pose
            .rotation
            .rotate_vector(Vector3::new(0.0, OBSERVED_WALK_SPEED_MPS, 0.0)),
        omega: Vector3::zero(),
    };
    world
        .present_character_locomotion(
            body_id,
            LocomotionPresentationSource::Observed(observed),
            CharacterMotionPresentation::Grounded,
            std::time::Duration::from_secs_f32(1.5),
        )
        .unwrap();
    assert_eq!(
        world
            .motion_runtimes
            .playing_clip(guid)
            .unwrap()
            .animation_id,
        WALK_ANIM
    );
    // Zero physical travel under an active command must keep cycling for many loops,
    // without adding motion to the body or advancing the authored root/hook cursor.
    let commanded = LocomotionPresentationSource::Command(MotionOrder {
        style: Some(MotionCommand(STYLE)),
        forward: Some((MotionCommand(RUN), 1.0)),
        ..MotionOrder::default()
    });
    let before = world.scene.body(body_id).unwrap().clone();
    let authored_before = world.motion_runtimes.get(guid).unwrap().tick().clone();
    for _ in 0..40 {
        world
            .present_character_locomotion(
                body_id,
                commanded,
                CharacterMotionPresentation::Grounded,
                std::time::Duration::from_millis(125),
            )
            .unwrap();
        let clip = world.motion_runtimes.playing_clip(guid).unwrap();
        assert_eq!(clip.animation_id, RUN_ANIM);
        assert!(clip.framerate > 0.0);
        assert_eq!(clip.completion, MotionClipCompletion::Loop);
    }
    assert_eq!(world.scene.body(body_id).unwrap().pose, before.pose);
    assert_eq!(world.scene.body(body_id).unwrap().retained, before.retained);
    assert_eq!(
        world.motion_runtimes.get(guid).unwrap().tick(),
        &authored_before
    );
    // Charge/falling override commanded running, including the existing missing-cycle
    // stance fallback. Releasing intent with zero accepted motion also presents idle.
    for presentation in [
        CharacterMotionPresentation::Ready,
        CharacterMotionPresentation::Falling,
    ] {
        world
            .present_character_locomotion(
                body_id,
                commanded,
                presentation,
                std::time::Duration::from_millis(125),
            )
            .unwrap();
        assert_eq!(
            world
                .motion_runtimes
                .playing_clip(guid)
                .unwrap()
                .animation_id,
            STAND_ANIM
        );
    }
    world
        .present_character_locomotion(
            body_id,
            LocomotionPresentationSource::Observed(crate::spatial::AcceptedBodyMotion::default()),
            CharacterMotionPresentation::Grounded,
            std::time::Duration::from_millis(125),
        )
        .unwrap();
    assert_eq!(
        world
            .motion_runtimes
            .playing_clip(guid)
            .unwrap()
            .animation_id,
        STAND_ANIM
    );
    world.motion_runtimes.enqueue_action(table, guid, action(1));
    let authored = world
        .motion_runtimes
        .drive(table, guid, MotionOrder::default(), 0.25)
        .clone();
    world
        .present_character_locomotion(
            body_id,
            commanded,
            CharacterMotionPresentation::Ready,
            std::time::Duration::from_secs_f32(0.25),
        )
        .unwrap();
    assert_eq!(
        world
            .motion_runtimes
            .playing_clip(guid)
            .unwrap()
            .animation_id,
        ACTION_ANIM
    );
    assert_eq!(world.motion_runtimes.get(guid).unwrap().tick(), &authored);
}

#[test]
fn remote_source_heading_follows_authority_and_commands_not_body_return() {
    use crate::motion::RemoteMotionInput;
    use crate::spatial::{AuthoritativePoseEffect, MOBILE_CONTACT_TICK_SECONDS};
    use holtburger_common::position::WorldPosition;
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = holtburger_common::Guid(1);
    let mut runtime = MotionRuntimeRegistry::new();
    let mut pose = WorldPosition {
        landblock_id: holtburger_common::Guid(0xda55_ffff),
        coords: Vector3::zero(),
        rotation: Quaternion::identity(),
    };
    let snapshot = EntityMotionSnapshot::default();
    runtime.drive_remote(
        table,
        guid,
        RemoteMotionInput {
            frame_policy: crate::motion::RemoteFramePolicy::Command,
            snapshot,
            pose,
            contact: ContactState::Grounded,
            target: None,
            omega: Vector3::zero(),
        },
        MOBILE_CONTACT_TICK_SECONDS,
    );
    let source = runtime
        .get(guid)
        .unwrap()
        .remote_motion_sample()
        .unwrap()
        .rotation;
    pose.rotation =
        Quaternion::from_axis_angle(Vector3::new(0.0, 0.0, 1.0), std::f32::consts::PI).unwrap();
    for _ in 0..30 {
        runtime.drive_remote(
            table,
            guid,
            RemoteMotionInput {
                frame_policy: crate::motion::RemoteFramePolicy::Command,
                snapshot,
                pose,
                contact: ContactState::Grounded,
                target: None,
                omega: Vector3::zero(),
            },
            MOBILE_CONTACT_TICK_SECONDS,
        );
        let sample = runtime.get(guid).unwrap().remote_motion_sample().unwrap();
        assert_eq!(sample.rotation, source);
    }
    runtime.apply_remote_pose_effect(
        guid,
        AuthoritativePoseEffect::Interpolate {
            pose,
            keep_heading: false,
            adjusted_max_speed_mps: None,
        },
    );
    let authority = pose.rotation;
    let omega = Vector3::new(0.0, 0.0, 0.5);
    for tick in 0..30 {
        if tick == 15 {
            runtime.apply_remote_pose_effect(
                guid,
                AuthoritativePoseEffect::Interpolate {
                    pose,
                    keep_heading: true,
                    adjusted_max_speed_mps: None,
                },
            );
        }
        runtime.drive_remote(
            table,
            guid,
            RemoteMotionInput {
                frame_policy: crate::motion::RemoteFramePolicy::Command,
                snapshot,
                pose,
                contact: ContactState::Grounded,
                target: None,
                omega,
            },
            MOBILE_CONTACT_TICK_SECONDS,
        );
        let sample = runtime.get(guid).unwrap().remote_motion_sample().unwrap();
        let expected = crate::spatial::integrate_angular_velocity(
            authority,
            omega,
            tick as f32 * MOBILE_CONTACT_TICK_SECONDS,
        );
        assert!(
            (sample.rotation.rotate_vector(Vector3::new(0.0, 1.0, 0.0))
                - expected.rotate_vector(Vector3::new(0.0, 1.0, 0.0)))
            .length()
                < 0.0001
        );
    }
    // Local control relinquishes remote autonomy through its own explicit entry point.
    runtime.drive(
        table,
        guid,
        MotionOrder::default(),
        MOBILE_CONTACT_TICK_SECONDS,
    );
    assert!(runtime.get(guid).unwrap().remote_motion_sample().is_none());
}

#[test]
fn remote_action_interval_keeps_root_motion_after_completion() {
    use crate::motion::RemoteMotionInput;
    use crate::spatial::MOBILE_CONTACT_TICK_SECONDS;
    use holtburger_common::position::WorldPosition;
    let mut action_animation = animation(ACTION_ANIM, 4, 0.25);
    action_animation.part_frames[1].hooks.push(AnimationHook {
        hook_type: 6,
        direction: 1,
        payload: AnimationHookPayload::Ethereal(EtherealHookPayload { ethereal: true }),
    });
    let catalog = catalog_with_action_animation(STAND, 10.0, action_animation);
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = holtburger_common::Guid(1);
    let pose = WorldPosition {
        landblock_id: holtburger_common::Guid(0xda55_ffff),
        coords: Vector3::zero(),
        rotation: Quaternion::identity(),
    };
    let mut registry = MotionRuntimeRegistry::new();
    registry.enqueue_action(table, guid, action(1));
    registry.admit_sticky_target(
        table,
        guid,
        Some(holtburger_common::Guid(2)),
        std::time::Instant::now(),
    );
    let mut completed = false;
    let mut fired_hooks = 0;
    for _ in 0..120 {
        let tick = registry
            .drive_remote(
                table,
                guid,
                RemoteMotionInput {
                    frame_policy: crate::motion::RemoteFramePolicy::Command,
                    snapshot: EntityMotionSnapshot::default(),
                    pose,
                    contact: ContactState::Grounded,
                    target: None,
                    omega: Vector3::zero(),
                },
                MOBILE_CONTACT_TICK_SECONDS,
            )
            .clone();
        fired_hooks += tick.hooks.len();
        let sample = registry.get(guid).unwrap().remote_motion_sample().unwrap();
        assert_eq!(
            registry.get(guid).unwrap().sticky_target(),
            (!completed).then_some(holtburger_common::Guid(2))
        );
        if tick.action_completed {
            assert!(
                tick.offset.translation.length() > 0.0,
                "completion fixture must include action travel in its final interval"
            );
            assert_eq!(sample.offset, Some(tick.offset));
            completed = true;
        }
        registry.present_locomotion(
            table,
            guid,
            MotionOrder {
                forward: Some((MotionCommand::WALK_FORWARD, 1.0)),
                ..MotionOrder::default()
            },
            MOBILE_CONTACT_TICK_SECONDS,
        );
        assert_eq!(
            registry.get(guid).unwrap().remote_motion_sample(),
            Some(sample)
        );
    }
    assert!(completed);
    assert_eq!(
        fired_hooks, 1,
        "sticky action and observed presentation must not replay hooks"
    );
}

#[test]
fn zero_time_selection_preserves_sticky_interval_until_explicit_cancellation() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = holtburger_common::Guid(1);
    let target = holtburger_common::Guid(2);
    let mut registry = MotionRuntimeRegistry::new();
    registry.admit_sticky_target(table, guid, Some(target), std::time::Instant::now());
    registry.drive(
        table,
        guid,
        MotionOrder::default(),
        crate::spatial::MOBILE_CONTACT_TICK_SECONDS,
    );
    assert_eq!(registry.get(guid).unwrap().sticky_target(), Some(target));
    registry.drive(table, guid, MotionOrder::default(), 0.0);
    assert_eq!(registry.get(guid).unwrap().sticky_target(), Some(target));
    registry.cancel_sticky_target(guid);
    assert_eq!(registry.get(guid).unwrap().sticky_target(), None);
}

#[test]
fn sticky_command_heading_survives_cancellation_and_ordinary_playback() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = holtburger_common::Guid(1);
    let mut registry = MotionRuntimeRegistry::new();
    let input = || RemoteMotionInput {
        frame_policy: RemoteFramePolicy::Command,
        snapshot: EntityMotionSnapshot::default(),
        pose: holtburger_common::position::WorldPosition {
            landblock_id: holtburger_common::Guid(0xda55_0100),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        },
        contact: ContactState::Grounded,
        target: None,
        omega: Vector3::zero(),
    };
    registry.drive_remote(
        table,
        guid,
        input(),
        crate::spatial::MOBILE_CONTACT_TICK_SECONDS,
    );
    registry.admit_sticky_target(
        table,
        guid,
        Some(holtburger_common::Guid(2)),
        std::time::Instant::now(),
    );
    let heading = 1.2;
    registry.retain_sticky_heading(guid, heading);
    registry.cancel_sticky_target(guid);
    registry.drive_remote(
        table,
        guid,
        input(),
        crate::spatial::MOBILE_CONTACT_TICK_SECONDS,
    );
    assert_eq!(
        registry
            .get(guid)
            .unwrap()
            .remote_motion_sample()
            .unwrap()
            .rotation,
        Quaternion::from_heading(heading)
    );
}

/// Recovery resets source continuation and publishes a snap without restarting authored actions.
#[test]
fn recovered_body_publication_preserves_action_and_playback_phase() {
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = holtburger_common::Guid(0x5000_0001);
    let mut world = crate::WorldState::synthetic();
    let pose = holtburger_common::position::WorldPosition {
        landblock_id: holtburger_common::Guid(0x1234_ffff),
        coords: Vector3::new(10.0, 20.0, 0.0),
        rotation: Quaternion::identity(),
    };
    let id = crate::SpatialBodyId::Entity(guid);
    world
        .scene
        .register_body(crate::SpatialBody::new(id, pose, std::time::Instant::now()));
    world.motion_runtimes.enqueue_action(table, guid, action(1));
    world.motion_runtimes.drive(
        table,
        guid,
        MotionOrder {
            style: Some(MotionCommand(STYLE)),
            ..MotionOrder::default()
        },
        0.05,
    );
    let before = world.motion_runtimes.get(guid).unwrap();
    let active = before.active_action();
    assert!(active.is_some());
    let frame = before.sequence().frame_number();
    let clip = before.playing_clip();
    let events = world.apply_recovered_body(id).unwrap();
    let after = world.motion_runtimes.get(guid).unwrap();
    assert_eq!(after.active_action(), active);
    assert_eq!(after.sequence().frame_number(), frame);
    assert_eq!(after.playing_clip(), clip);
    assert!(
        matches!(events.as_slice(), [crate::WorldEvent::RuntimeBodyAdvanced { body_id, kind: crate::RuntimeBodyAdvanceKind::CorrectionSnap }] if *body_id == id)
    );
}

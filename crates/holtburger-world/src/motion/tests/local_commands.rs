use super::*;
use crate::entity::{EntityMotionAdmission, OrderedMotionScalar};
use holtburger_common::Guid;

const BOW: MotionCommand = MotionCommand(0x4300_00ec);
const BOW_ANIM: u32 = 0x0300_0020;

fn local_catalog() -> MotionSequenceCatalog {
    let data = |id| motion(vec![clip(id, 4.0)], None, None);
    MotionSequenceCatalog::assemble(
        [MotionTable {
            id: TABLE,
            default_style: STYLE,
            style_defaults: HashMap::from([(STYLE, STAND)]),
            cycles: HashMap::from([
                (MotionTable::cycle_key(STYLE, STAND), data(STAND_ANIM)),
                (MotionTable::cycle_key(STYLE, BOW.raw()), data(BOW_ANIM)),
                (MotionTable::cycle_key(STYLE, WALK), data(WALK_ANIM)),
            ]),
            modifiers: HashMap::new(),
            links: HashMap::from([
                (
                    MotionTable::cycle_key(STYLE, STAND),
                    HashMap::from([(ACTION, data(ACTION_ANIM))]),
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
        command,
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

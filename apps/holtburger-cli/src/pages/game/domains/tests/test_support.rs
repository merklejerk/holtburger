use super::*;
use holtburger_core::client::movement_types::PlayerDriveIntent;

pub(super) fn apply_queued_ui_action(state: &mut GameState, action: AppUiAction) -> UpdateResult {
    let mut result = state
        .handle_action(action.into())
        .expect("UI action should produce an update result");

    while !result.actions.is_empty() {
        let actions = std::mem::take(&mut result.actions);
        for queued_action in actions {
            if let Some(next_result) = state.handle_action(queued_action) {
                result.merge(next_result);
            }
        }
    }

    result
}

pub(super) fn is_weapon_swap_active(state: &GameState) -> bool {
    state.runtime.weapon_swap.is_active()
}

pub(super) fn has_active_approach(state: &GameState) -> bool {
    matches!(
        state.runtime.navigation.navigation_mode(),
        Some(NavigationMode::Approach { .. })
    )
}

pub(super) fn is_run_movement_command(command: &ClientCommand) -> bool {
    matches!(
        command,
        ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(MotionState {
            locomotion: Some(Locomotion::Forward),
            ..
        })) | ClientCommand::DriveSelf(PlayerDriveIntent::ManualPulse {
            state: MotionState {
                locomotion: Some(Locomotion::Forward),
                ..
            },
            ..
        })
    )
}

pub(super) fn is_turn_movement_command(command: &ClientCommand) -> bool {
    matches!(
        command,
        ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(MotionState {
            locomotion: None,
            turning: Some(Turn::Left | Turn::Right),
            ..
        }))
    )
}

pub(super) fn is_navigation_movement_command(command: &ClientCommand) -> bool {
    is_run_movement_command(command) || is_turn_movement_command(command)
}

pub(super) fn is_navigation_drive_command(command: &ClientCommand) -> bool {
    matches!(
        command,
        ClientCommand::DriveSelf(PlayerDriveIntent::Autonomous(_))
            | ClientCommand::DriveSelf(PlayerDriveIntent::ArriveAtPose { .. })
            | ClientCommand::DriveSelf(PlayerDriveIntent::Stop)
    )
}

pub(super) fn has_autonomous_navigation_command(result: &UpdateResult) -> bool {
    result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::DriveSelf(PlayerDriveIntent::Autonomous(_))
        )
    })
}

pub(super) fn has_stop_navigation_command(result: &UpdateResult) -> bool {
    result
        .commands
        .iter()
        .any(|command| matches!(command, ClientCommand::DriveSelf(PlayerDriveIntent::Stop)))
}

pub(super) fn has_arrival_navigation_command(result: &UpdateResult) -> bool {
    result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::DriveSelf(PlayerDriveIntent::ArriveAtPose { .. })
        )
    })
}

pub(super) fn runtime_body_view(
    body_id: SpatialBodyId,
    authoritative_pose: WorldPosition,
    runtime_pose: WorldPosition,
) -> RuntimeSpatialBodyView {
    RuntimeSpatialBodyView {
        body_id,
        authoritative_pose: Some(authoritative_pose),
        runtime_pose,
        velocity: Vector3::zero(),
        omega: Vector3::zero(),
        motion_state: None,
        contact: holtburger_world::ContactState::Grounded,
        sample_mode: SpatialSampleMode::SimulatingMotionState,
    }
}

pub(super) fn seed_navigation_motion_model(state: &mut GameState) {
    state.data.self_movement_kinematics = Some(SelfMovementKinematics {
        source: PlayerMotionTableSource::DirectProperty {
            motion_table_id: 0x0900_0020,
        },
        motion_table_id: 0x0900_0020,
        stance: 0x8000_003D,
        base_walk_forward_velocity: Vector3::new(1.0, 0.0, 0.0),
        base_run_forward_velocity: Vector3::new(2.0, 0.0, 0.0),
        base_turn_left_omega: Vector3::new(0.0, 0.0, -1.5),
        base_turn_right_omega: Vector3::new(0.0, 0.0, 1.5),
    });
    state.data.skills.insert(
        SkillType::Run,
        Skill {
            skill_type: SkillType::Run,
            ranks: 0,
            init: 300,
            spent_xp: 0,
            next_rank_xp: None,
            base: 300,
            current: 300,
            training: TrainingLevel::Trained,
            trained_cost: 0,
            specialized_cost: 0,
        },
    );
}

pub(super) fn vendor_item_named(guid: Guid, wcid: u32, name: &str) -> CoreVendorItem {
    let mut properties = WorldObjectProperties::default();
    properties
        .strings
        .insert(PropertyString::Name, name.to_string());

    CoreVendorItem {
        guid,
        wcid,
        vendor_supply: None,
        properties,
        ..CoreVendorItem::default()
    }
}

pub(super) fn context_buffer_contains(buffer: &[Line<'static>], needle: &str) -> bool {
    buffer.iter().any(|line| line.to_string().contains(needle))
}

pub(super) fn creature_entity(guid: Guid, name: &str, position: WorldPosition) -> Entity {
    let mut entity = Entity::new(guid, name.to_string(), position);
    entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    entity.creature_profile = Some(CreatureProfile {
        flags: CreatureProfileFlags::empty(),
        health: 1,
        health_max: 1,
        attributes: None,
        buffs: None,
    });
    entity
}

pub(super) fn inventory_item_entity(guid: Guid, name: &str, container_id: Guid) -> Entity {
    let mut entity = Entity::new(guid, name.to_string(), WorldPosition::default());
    entity.set_iid_prop(PropertyInstanceId::Container, container_id);
    entity
}

pub(super) fn stacked_inventory_item_entity(
    guid: Guid,
    name: &str,
    container_id: Guid,
    stack_size: u32,
) -> Entity {
    let mut entity = inventory_item_entity(guid, name, container_id);
    entity.set_int_prop(PropertyInt::StackSize, stack_size as i32);
    entity
}

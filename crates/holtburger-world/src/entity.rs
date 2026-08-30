use crate::attachment::PhysicsAttachment;
use crate::book::BookData;
use crate::entity_appearance::EntityAppearance;
use crate::entity_physics::{EffectiveEntityPhysicsState, resolve_effective_entity_physics_state};
use crate::hydration::WorldObjectPropertiesHydrationExt;
use crate::identify::{self, IdentifyTarget};
use crate::motion::MotionCommand;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    HasProperties, HasPropertiesMut, ObjectDescriptionFlag, PhysicsState, PropertyInstanceId,
    PropertyInt, PropertyString, PropertyUpdate, WeenieHeaderFlag, WeenieHeaderFlag2,
    WorldObjectProperties, WorldObjectPropertyAccessorsMut,
};
use holtburger_common::sequence::is_newer_u16;
use holtburger_common::{Guid, Vector3};
use holtburger_protocol::messages::MovementType;
use holtburger_protocol::messages::movement::messages::motion::{
    MoveToObject, MoveToParameters, MoveToPosition, MovementInvalid, Origin, TurnToHeading,
    TurnToObject, TurnToParameters,
};
use holtburger_protocol::messages::movement::{
    InterpretedMotionCommand, MotionStance, MovementEventData, MovementTypeData,
};
use holtburger_protocol::messages::object::events::IdentifyObjectResponseEventData;
use holtburger_protocol::messages::object::messages::description::ObjectDescriptionData;
use holtburger_protocol::messages::object::types::{
    ArmorLevels, ArmorProfile, CreatureProfile, HookProfile, WeaponProfile,
};
use holtburger_protocol::traits::ProtocolUnpack;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EntityMotionSnapshot {
    pub current_style: Option<MotionStance>,
    pub forward_command: Option<InterpretedMotionCommand>,
    pub sidestep_command: Option<InterpretedMotionCommand>,
    pub turn_command: Option<InterpretedMotionCommand>,
    pub forward_speed: Option<OrderedMotionScalar>,
    pub sidestep_speed: Option<OrderedMotionScalar>,
    pub turn_speed: Option<OrderedMotionScalar>,
    pub directive: Option<EntityMotionDirective>,
}

/// Retained network authority for one entity's steady-state movement.
///
/// `Uninitialized` means no movement state has ever been admitted for this object generation.
/// `Initialized` may contain an idle snapshot; an explicit stop must never collapse back to
/// `Uninitialized`, because the motion runtime needs that idle order to retire a prior cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EntityNetworkMotion {
    #[default]
    Uninitialized,
    Initialized(EntityMotionSnapshot),
}

impl EntityNetworkMotion {
    pub const fn snapshot(self) -> Option<EntityMotionSnapshot> {
        match self {
            Self::Uninitialized => None,
            Self::Initialized(snapshot) => Some(snapshot),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct OrderedMotionScalar(u32);

impl OrderedMotionScalar {
    pub fn from_f32(value: f32) -> Option<Self> {
        value.is_finite().then_some(Self(value.to_bits()))
    }

    pub const fn to_f32(self) -> f32 {
        f32::from_bits(self.0)
    }
}

/// One exact finite wire position retained for server-directed motion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrderedMotionPosition {
    /// Cell containing the authored target.
    pub cell_id: Guid,
    /// Authored X coordinate retained by IEEE-754 bits.
    pub x: OrderedMotionScalar,
    /// Authored Y coordinate retained by IEEE-754 bits.
    pub y: OrderedMotionScalar,
    /// Authored Z coordinate retained by IEEE-754 bits.
    pub z: OrderedMotionScalar,
}

impl OrderedMotionPosition {
    fn from_origin(origin: &Origin) -> Option<Self> {
        Some(Self {
            cell_id: origin.cell_id,
            x: OrderedMotionScalar::from_f32(origin.position.x)?,
            y: OrderedMotionScalar::from_f32(origin.position.y)?,
            z: OrderedMotionScalar::from_f32(origin.position.z)?,
        })
    }

    /// Reconstructs the world position without inventing a target orientation.
    pub fn world_position(self) -> WorldPosition {
        WorldPosition {
            landblock_id: self.cell_id,
            coords: Vector3::new(self.x.to_f32(), self.y.to_f32(), self.z.to_f32()),
            ..WorldPosition::default()
        }
    }
}

/// Interdependent retail parameters governing one MoveTo command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityMoveToParameters {
    /// Lossless retail movement-parameter flags, including unknown bits.
    pub flags: u32,
    /// Desired approach distance.
    pub distance_to_object: OrderedMotionScalar,
    /// Minimum separation used by away/backwards movement.
    pub min_distance: OrderedMotionScalar,
    /// Maximum travel before the command fails.
    pub fail_distance: OrderedMotionScalar,
    /// Authored motion speed multiplier.
    pub speed: OrderedMotionScalar,
    /// Remaining-distance threshold controlling walk versus run.
    pub walk_run_threshold: OrderedMotionScalar,
    /// Final heading in retail degrees.
    pub desired_heading_degrees: OrderedMotionScalar,
}

impl EntityMoveToParameters {
    fn from_wire(params: &MoveToParameters) -> Option<Self> {
        Some(Self {
            flags: params.movement_parameters,
            distance_to_object: OrderedMotionScalar::from_f32(params.distance_to_object)?,
            min_distance: OrderedMotionScalar::from_f32(params.min_distance)?,
            fail_distance: OrderedMotionScalar::from_f32(params.fail_distance)?,
            speed: OrderedMotionScalar::from_f32(params.speed)?,
            walk_run_threshold: OrderedMotionScalar::from_f32(params.walk_run_threshold)?,
            desired_heading_degrees: OrderedMotionScalar::from_f32(params.desired_heading)?,
        })
    }
}

/// Interdependent retail parameters governing one TurnTo command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityTurnToParameters {
    /// Lossless retail movement-parameter flags, including unknown bits.
    pub flags: u32,
    /// Authored turn speed multiplier.
    pub speed: OrderedMotionScalar,
    /// Absolute or object-relative desired heading in retail degrees.
    pub desired_heading_degrees: OrderedMotionScalar,
}

/// Outer movement-event identity controlling one directive's lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityMotionAdmission {
    /// Object-generation sequence that admitted the command.
    pub object_instance_sequence: u16,
    /// Movement epoch that distinguishes repeated byte-identical directives.
    pub movement_sequence: u16,
    /// Server-control epoch used by non-autonomous admission.
    pub server_control_sequence: u16,
    /// Whether the server classified the event as autonomous motion.
    pub is_autonomous: bool,
}

/// Wire path that produced one transient authored action edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityMotionActionSource {
    /// Retail command-list item with its own wrapping 15-bit sequence.
    CommandList,
    /// ACE action-class forward command keyed by the fresh outer movement event.
    ForwardCommand,
}

/// One admitted transient action, separate from retained steady motion channels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityMotionAction {
    /// Expanded action-class motion-table command.
    pub command: MotionCommand,
    /// Exact finite authored speed multiplier.
    pub speed: OrderedMotionScalar,
    /// Action stamp: command-list sequence or outer movement sequence for ACE forward actions.
    pub action_sequence: u16,
    /// Autonomous classification carried by the producing wire fact.
    pub is_autonomous: bool,
    /// Fresh outer event identity that admitted this edge.
    pub admission: EntityMotionAdmission,
    /// Wire path used to distinguish command-list freshness from ACE forward admission.
    pub source: EntityMotionActionSource,
}

impl EntityMotionAction {
    /// Builds the exact command-list edge predicted by the local client before its autonomous echo.
    pub(crate) fn from_local_command_list(
        command: InterpretedMotionCommand,
        speed: f32,
        action_sequence: u16,
        admission: EntityMotionAdmission,
    ) -> Result<Self, EntityMotionActionRejection> {
        reduce_motion_action(
            command,
            speed,
            action_sequence,
            true,
            admission,
            EntityMotionActionSource::CommandList,
        )
    }
}

/// Fresh action-shaped wire fact that could not enter the runtime queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityMotionActionRejection {
    /// The interpreted index has no retail command expansion.
    UnknownCommand {
        command: InterpretedMotionCommand,
        source: EntityMotionActionSource,
    },
    /// The expanded command is not action-class and cannot enter the transient queue.
    NotAnAction {
        command: MotionCommand,
        source: EntityMotionActionSource,
    },
    /// The action's authored speed was non-finite.
    NonFiniteSpeed {
        command: InterpretedMotionCommand,
        source: EntityMotionActionSource,
    },
}

fn reduce_motion_action(
    command: InterpretedMotionCommand,
    speed: f32,
    action_sequence: u16,
    is_autonomous: bool,
    admission: EntityMotionAdmission,
    source: EntityMotionActionSource,
) -> Result<EntityMotionAction, EntityMotionActionRejection> {
    let speed = OrderedMotionScalar::from_f32(speed)
        .ok_or(EntityMotionActionRejection::NonFiniteSpeed { command, source })?;
    let command = MotionCommand::from_interpreted(command)
        .ok_or(EntityMotionActionRejection::UnknownCommand { command, source })?;
    if !command.is_action() {
        return Err(EntityMotionActionRejection::NotAnAction { command, source });
    }
    Ok(EntityMotionAction {
        command,
        speed,
        action_sequence,
        is_autonomous,
        admission,
        source,
    })
}

fn is_newer_u15(candidate: u16, current: u16) -> bool {
    let difference = candidate.wrapping_sub(current) & 0x7FFF;
    difference != 0 && difference < 0x4000
}

impl EntityMotionAdmission {
    fn from_movement_event(data: &MovementEventData) -> Self {
        Self {
            object_instance_sequence: data.object_instance_sequence,
            movement_sequence: data.movement_sequence,
            server_control_sequence: data.server_control_sequence,
            is_autonomous: data.is_autonomous,
        }
    }
}

impl EntityTurnToParameters {
    fn from_wire(params: &TurnToParameters) -> Option<Self> {
        Some(Self {
            flags: params.movement_parameters,
            speed: OrderedMotionScalar::from_f32(params.speed)?,
            desired_heading_degrees: OrderedMotionScalar::from_f32(params.desired_heading)?,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityMotionDirective {
    /// Server-authored travel toward a world position.
    MoveToPosition {
        /// Outer event identity controlling restart and replacement.
        admission: EntityMotionAdmission,
        /// Fixed target received on the wire.
        target: OrderedMotionPosition,
        /// Complete movement policy received with the target.
        params: EntityMoveToParameters,
        /// Actor-specific Run rate used when retail applies the Run hold key.
        run_rate: OrderedMotionScalar,
    },
    /// Server-authored travel toward another object.
    MoveToObject {
        /// Outer event identity controlling restart and replacement.
        admission: EntityMotionAdmission,
        /// Object whose current authoritative pose should be sampled each tick.
        target: Guid,
        /// Admission-time target position used when retail cannot resolve the object.
        fallback_target: OrderedMotionPosition,
        /// Complete movement policy received with the target.
        params: EntityMoveToParameters,
        /// Actor-specific Run rate used when retail applies the Run hold key.
        run_rate: OrderedMotionScalar,
    },
    /// Absolute heading-only command.
    TurnToHeading {
        /// Outer event identity controlling restart and replacement.
        admission: EntityMotionAdmission,
        /// Complete turn policy received on the wire.
        params: EntityTurnToParameters,
    },
    /// Object-relative heading command with retail's absolute fallback.
    TurnToObject {
        /// Outer event identity controlling restart and replacement.
        admission: EntityMotionAdmission,
        /// Object whose current authoritative bearing should be sampled each tick.
        target: Guid,
        /// Absolute heading used when the target is unavailable, in retail degrees.
        fallback_heading_degrees: OrderedMotionScalar,
        /// Complete turn policy received on the wire.
        params: EntityTurnToParameters,
    },
}

impl EntityMotionDirective {
    /// Reduces one wire movement payload into a complete finite server directive.
    pub fn from_movement_event(data: &MovementEventData) -> Option<Self> {
        match &data.data {
            MovementTypeData::MoveToPosition(motion) => Some(Self::MoveToPosition {
                admission: EntityMotionAdmission::from_movement_event(data),
                target: OrderedMotionPosition::from_origin(&motion.origin)?,
                params: EntityMoveToParameters::from_wire(&motion.params)?,
                run_rate: OrderedMotionScalar::from_f32(motion.run_rate)?,
            }),
            MovementTypeData::MoveToObject(motion) => Some(Self::MoveToObject {
                admission: EntityMotionAdmission::from_movement_event(data),
                target: motion.target,
                fallback_target: OrderedMotionPosition::from_origin(&motion.origin)?,
                params: EntityMoveToParameters::from_wire(&motion.params)?,
                run_rate: OrderedMotionScalar::from_f32(motion.run_rate)?,
            }),
            MovementTypeData::TurnToHeading(turn) => Some(Self::TurnToHeading {
                admission: EntityMotionAdmission::from_movement_event(data),
                params: EntityTurnToParameters::from_wire(&turn.params)?,
            }),
            MovementTypeData::TurnToObject(turn) => Some(Self::TurnToObject {
                admission: EntityMotionAdmission::from_movement_event(data),
                target: turn.target,
                fallback_heading_degrees: OrderedMotionScalar::from_f32(turn.desired_heading)?,
                params: EntityTurnToParameters::from_wire(&turn.params)?,
            }),
            MovementTypeData::Invalid(_) => None,
        }
    }

    /// Object identity sampled by object-target directives.
    pub const fn target_guid(self) -> Option<Guid> {
        match self {
            Self::MoveToObject { target, .. } | Self::TurnToObject { target, .. } => Some(target),
            Self::MoveToPosition { .. } | Self::TurnToHeading { .. } => None,
        }
    }
}

impl EntityMotionSnapshot {
    pub fn motion_command(self) -> Option<InterpretedMotionCommand> {
        self.forward_command
            .or(self.sidestep_command)
            .or(self.turn_command)
    }

    /// Whether retail preserves authored heading while pose interpolation owns translation.
    pub const fn is_moving_to(self) -> bool {
        matches!(
            self.directive,
            Some(
                EntityMotionDirective::MoveToPosition { .. }
                    | EntityMotionDirective::MoveToObject { .. }
            )
        )
    }

    /// Reduces the steady-state portion of one retail movement payload.
    ///
    /// Retail initializes omitted interpreted fields to their concrete defaults before replacing
    /// the prior interpreted movement state (`InterpretedMotionState::UnPack`,
    /// `acclient.c:320348-320453`). In particular, an omitted style becomes NonCombat, an omitted
    /// forward command becomes Ready, and omitted sidestep/turn channels stop. Ready is represented
    /// here by the absence of authored forward locomotion so the motion table selects its default.
    pub fn from_movement_event(
        data: &MovementEventData,
        previous: Option<EntityMotionSnapshot>,
    ) -> Self {
        let mut snapshot = if matches!(data.data, MovementTypeData::Invalid(_)) {
            // UnPack constructs a complete replacement interpreted state. Its default stance is
            // NonCombat; the outer style is applied first but then overwritten by this state.
            Self {
                current_style: Some(MotionStance::NonCombat),
                ..Self::default()
            }
        } else {
            // MoveTo/TurnTo do not replace the interpreted movement state. They may change the
            // outer style, and otherwise retain the state to which movement later returns.
            let mut retained = previous.unwrap_or_default();
            if let Some(style) = MotionStance::from_interpreted(data.current_style) {
                retained.current_style = Some(style);
            }
            retained.directive = None;
            retained
        };

        if let MovementTypeData::Invalid(invalid) = &data.data {
            snapshot.current_style = invalid
                .state
                .current_style
                .and_then(MotionStance::from_interpreted)
                .or(Some(MotionStance::NonCombat));
            snapshot.forward_command = invalid.state.forward_command;
            snapshot.sidestep_command = invalid.state.sidestep_command;
            snapshot.turn_command = invalid.state.turn_command;
            snapshot.forward_speed = invalid
                .state
                .forward_speed
                .and_then(OrderedMotionScalar::from_f32);
            snapshot.sidestep_speed = invalid
                .state
                .sidestep_speed
                .and_then(OrderedMotionScalar::from_f32);
            snapshot.turn_speed = invalid
                .state
                .turn_speed
                .and_then(OrderedMotionScalar::from_f32);
            if snapshot
                .forward_command
                .and_then(MotionCommand::from_interpreted)
                .is_some_and(MotionCommand::is_action)
            {
                snapshot.forward_command = None;
                snapshot.forward_speed = None;
            }
        } else {
            snapshot.directive = EntityMotionDirective::from_movement_event(data);
        }

        snapshot.forward_speed = snapshot.forward_command.and(snapshot.forward_speed);
        snapshot.sidestep_speed = snapshot.sidestep_command.and(snapshot.sidestep_speed);
        snapshot.turn_speed = snapshot.turn_command.and(snapshot.turn_speed);
        snapshot
    }

    pub(crate) fn from_object_description(data: &ObjectDescriptionData) -> Option<Self> {
        let movement_data = data.movement_data.as_deref()?;
        let mut offset = 0;
        let movement_type_raw = u8::unpack(movement_data, &mut offset)?;
        let movement_type = MovementType::from_repr(movement_type_raw)?;
        let motion_flags = u8::unpack(movement_data, &mut offset)?;
        let current_style = u16::unpack(movement_data, &mut offset)?;

        let payload = match movement_type {
            MovementType::MoveToObject => {
                MovementTypeData::MoveToObject(MoveToObject::unpack(movement_data, &mut offset)?)
            }
            MovementType::MoveToPosition => MovementTypeData::MoveToPosition(
                MoveToPosition::unpack(movement_data, &mut offset)?,
            ),
            MovementType::TurnToObject => {
                MovementTypeData::TurnToObject(TurnToObject::unpack(movement_data, &mut offset)?)
            }
            MovementType::TurnToHeading => {
                MovementTypeData::TurnToHeading(TurnToHeading::unpack(movement_data, &mut offset)?)
            }
            MovementType::Invalid
            | MovementType::RawCommand
            | MovementType::InterpretedCommand
            | MovementType::StopRawCommand
            | MovementType::StopInterpretedCommand
            | MovementType::StopCompletely => MovementTypeData::Invalid(
                MovementInvalid::unpack_ext(movement_data, &mut offset, motion_flags)?,
            ),
        };

        Some(Self::from_movement_event(
            &MovementEventData {
                guid: data.public_weenie_desc.guid,
                object_instance_sequence: data.sequences[OBJECT_INSTANCE_SEQUENCE_INDEX],
                movement_sequence: 0,
                server_control_sequence: data.sequences[OBJECT_SERVER_CONTROL_SEQUENCE_INDEX],
                is_autonomous: data.autonomous_movement.unwrap_or(false),
                movement_type,
                motion_flags,
                current_style,
                data: payload,
            },
            None,
        ))
    }

    pub fn indicates_death_motion(self) -> bool {
        self.motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Entity, EntityMotionActionRejection, EntityMotionActionSource, EntityMotionDirective,
        EntityMotionSnapshot, EntityMovementAdmission, MotionStance, MovementEventData,
        MovementTypeData,
    };
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_protocol::messages::movement::messages::motion::{
        MoveToObject, MoveToParameters, Origin, TurnToHeading, TurnToObject, TurnToParameters,
    };
    use holtburger_protocol::messages::{
        InterpretedMotionCommand, InterpretedMotionState, MotionItem, MovementInvalid,
        MovementStateFlags, MovementType,
    };

    #[test]
    fn omitted_interpreted_style_uses_retail_noncombat_default() {
        let snapshot = EntityMotionSnapshot::from_movement_event(
            &MovementEventData {
                guid: Guid(0x60000001),
                object_instance_sequence: 1,
                movement_sequence: 2,
                server_control_sequence: 3,
                is_autonomous: true,
                movement_type: MovementType::Invalid,
                motion_flags: 0,
                current_style: 0,
                data: MovementTypeData::Invalid(Default::default()),
            },
            None,
        );

        assert_eq!(snapshot.current_style, Some(MotionStance::NonCombat));
        assert_eq!(snapshot.forward_command, None);
        assert_eq!(snapshot.sidestep_command, None);
        assert_eq!(snapshot.turn_command, None);
    }

    #[test]
    fn turn_to_heading_with_non_finite_directive_preserves_other_snapshot_fields() {
        let snapshot = EntityMotionSnapshot::from_movement_event(
            &MovementEventData {
                guid: Guid(0x60000001),
                object_instance_sequence: 1,
                movement_sequence: 2,
                server_control_sequence: 3,
                is_autonomous: false,
                movement_type: MovementType::TurnToHeading,
                motion_flags: 0,
                current_style: MotionStance::NonCombat.interpreted(),
                data: MovementTypeData::TurnToHeading(TurnToHeading {
                    params: TurnToParameters {
                        movement_parameters: 0,
                        speed: 1.5,
                        desired_heading: f32::NAN,
                    },
                }),
            },
            None,
        );

        assert_eq!(snapshot.current_style, Some(MotionStance::NonCombat));
        assert_eq!(snapshot.directive, None);
    }

    #[test]
    fn turn_to_object_with_non_finite_speed_preserves_other_snapshot_fields() {
        let snapshot = EntityMotionSnapshot::from_movement_event(
            &MovementEventData {
                guid: Guid(0x60000001),
                object_instance_sequence: 1,
                movement_sequence: 2,
                server_control_sequence: 3,
                is_autonomous: false,
                movement_type: MovementType::TurnToObject,
                motion_flags: 0,
                current_style: MotionStance::NonCombat.interpreted(),
                data: MovementTypeData::TurnToObject(TurnToObject {
                    target: Guid(0x70000001),
                    desired_heading: 0.25,
                    params: TurnToParameters {
                        movement_parameters: 0,
                        speed: f32::NAN,
                        desired_heading: 0.25,
                    },
                }),
            },
            None,
        );

        assert_eq!(snapshot.current_style, Some(MotionStance::NonCombat));
        assert_eq!(snapshot.directive, None);
    }

    #[test]
    fn move_to_object_retains_every_wire_parameter_and_outer_admission_identity() {
        let data = MovementEventData {
            guid: Guid(0x6000_0001),
            object_instance_sequence: 11,
            movement_sequence: 12,
            server_control_sequence: 13,
            is_autonomous: true,
            movement_type: MovementType::MoveToObject,
            motion_flags: 0,
            current_style: MotionStance::NonCombat.interpreted(),
            data: MovementTypeData::MoveToObject(MoveToObject {
                target: Guid(0x7000_0001),
                origin: Origin {
                    cell_id: Guid(0x1234_0001),
                    position: holtburger_common::Vector3::new(1.25, 2.5, 3.75),
                },
                params: MoveToParameters {
                    movement_parameters: 0x10203,
                    distance_to_object: 0.5,
                    min_distance: 1.5,
                    fail_distance: 42.0,
                    speed: 1.25,
                    walk_run_threshold: 8.0,
                    desired_heading: 270.0,
                },
                run_rate: 1.75,
            }),
        };

        let first = EntityMotionDirective::from_movement_event(&data)
            .expect("finite MoveToObject should retain a directive");
        let mut successor = data.clone();
        successor.movement_sequence += 1;
        let second = EntityMotionDirective::from_movement_event(&successor)
            .expect("fresh identical MoveToObject should retain a directive");

        assert_ne!(
            first, second,
            "outer admission identity must restart the lifecycle"
        );
        let EntityMotionDirective::MoveToObject {
            admission,
            target,
            fallback_target,
            params,
            run_rate,
        } = first
        else {
            panic!("MoveToObject wire payload changed directive kind");
        };
        assert_eq!(admission.object_instance_sequence, 11);
        assert_eq!(admission.movement_sequence, 12);
        assert_eq!(admission.server_control_sequence, 13);
        assert!(admission.is_autonomous);
        assert_eq!(target, Guid(0x7000_0001));
        assert_eq!(fallback_target.cell_id, Guid(0x1234_0001));
        assert_eq!(
            fallback_target.world_position().coords,
            holtburger_common::Vector3::new(1.25, 2.5, 3.75)
        );
        assert_eq!(params.flags, 0x10203);
        assert_eq!(params.distance_to_object.to_f32(), 0.5);
        assert_eq!(params.min_distance.to_f32(), 1.5);
        assert_eq!(params.fail_distance.to_f32(), 42.0);
        assert_eq!(params.speed.to_f32(), 1.25);
        assert_eq!(params.walk_run_threshold.to_f32(), 8.0);
        assert_eq!(params.desired_heading_degrees.to_f32(), 270.0);
        assert_eq!(run_rate.to_f32(), 1.75);
    }

    fn movement_event(
        guid: Guid,
        instance: u16,
        movement: u16,
        server_control: u16,
        forward: Option<InterpretedMotionCommand>,
    ) -> MovementEventData {
        MovementEventData {
            guid,
            object_instance_sequence: instance,
            movement_sequence: movement,
            server_control_sequence: server_control,
            is_autonomous: true,
            movement_type: MovementType::Invalid,
            motion_flags: 0,
            current_style: 0,
            data: MovementTypeData::Invalid(MovementInvalid {
                state: InterpretedMotionState {
                    flags: forward.map_or(MovementStateFlags::empty(), |_| {
                        MovementStateFlags::FORWARD_COMMAND
                    }),
                    forward_command: forward,
                    ..Default::default()
                },
                sticky_object: None,
            }),
        }
    }

    fn action_event(
        guid: Guid,
        movement: u16,
        outer_autonomous: bool,
        commands: Vec<MotionItem>,
    ) -> MovementEventData {
        MovementEventData {
            guid,
            object_instance_sequence: 7,
            movement_sequence: movement,
            server_control_sequence: 0,
            is_autonomous: outer_autonomous,
            movement_type: MovementType::Invalid,
            motion_flags: 0,
            current_style: 0,
            data: MovementTypeData::Invalid(MovementInvalid {
                state: InterpretedMotionState {
                    commands,
                    ..Default::default()
                },
                sticky_object: None,
            }),
        }
    }

    #[test]
    fn command_list_actions_use_wrapping_u15_freshness_without_replaying_duplicates() {
        let guid = Guid(0x6000_0001);
        let mut entity = Entity::new(guid, "Remote".to_owned(), WorldPosition::default());
        entity.sequences[8] = 7;
        entity.server_action_sequence = 0x7FFE;

        let admission = entity.admit_remote_movement(&action_event(
            guid,
            1,
            false,
            vec![MotionItem::new(74, 1, false, 1.25)],
        ));
        let EntityMovementAdmission::Applied {
            actions,
            next_action_sequence,
            ..
        } = admission
        else {
            panic!("fresh wrapped command-list action should be admitted");
        };
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].command.raw(), 0x1000_004A);
        assert_eq!(actions[0].speed.to_f32(), 1.25);
        assert_eq!(actions[0].action_sequence, 1);
        assert_eq!(actions[0].source, EntityMotionActionSource::CommandList);
        assert_eq!(next_action_sequence, 1);

        let EntityMovementAdmission::Applied { actions, .. } = entity.admit_remote_movement(
            &action_event(guid, 2, false, vec![MotionItem::new(74, 1, false, 1.25)]),
        ) else {
            panic!("fresh outer event should still update retained motion");
        };
        assert!(actions.is_empty(), "duplicate action stamp must not replay");
    }

    #[test]
    fn locally_echoing_autonomous_action_does_not_consume_its_action_stamp() {
        let guid = Guid(0x6000_0001);
        let mut entity = Entity::new(guid, "Local".to_owned(), WorldPosition::default());
        entity.sequences[8] = 7;

        let EntityMovementAdmission::Applied {
            actions,
            next_action_sequence,
            ..
        } = entity.admit_movement_with_action_policy(
            &action_event(guid, 1, true, vec![MotionItem::new(74, 5, true, 1.0)]),
            false,
        )
        else {
            panic!("fresh movement should be admitted");
        };
        assert!(actions.is_empty());
        assert_eq!(next_action_sequence, 0);

        let EntityMovementAdmission::Applied { actions, .. } = entity.admit_remote_movement(
            &action_event(guid, 2, true, vec![MotionItem::new(74, 5, true, 1.0)]),
        ) else {
            panic!("remote autonomous action should be admitted");
        };
        assert_eq!(actions.len(), 1);
        assert!(actions[0].is_autonomous);
    }

    #[test]
    fn mixed_local_action_list_filters_only_autonomous_items_and_preserves_fifo_order() {
        let guid = Guid(0x6000_0001);
        let mut entity = Entity::new(guid, "Local".to_owned(), WorldPosition::default());
        entity.sequences[8] = 7;

        let EntityMovementAdmission::Applied {
            actions,
            next_action_sequence,
            ..
        } = entity.admit_movement_with_action_policy(
            &action_event(
                guid,
                1,
                true,
                vec![
                    MotionItem::new(74, 1, true, 1.0),
                    MotionItem::new(74, 2, false, 1.25),
                    MotionItem::new(74, 3, true, 1.0),
                    MotionItem::new(74, 4, false, 1.5),
                ],
            ),
            false,
        )
        else {
            panic!("fresh mixed command list should be admitted");
        };
        assert_eq!(
            actions
                .iter()
                .map(|action| (action.action_sequence, action.speed.to_f32()))
                .collect::<Vec<_>>(),
            vec![(2, 1.25), (4, 1.5)],
        );
        assert_eq!(next_action_sequence, 4);
    }

    #[test]
    fn action_class_forward_command_is_an_edge_and_not_retained_steady_motion() {
        let guid = Guid(0x6000_0001);
        let mut entity = Entity::new(guid, "Remote".to_owned(), WorldPosition::default());
        entity.sequences[8] = 7;

        for movement in [1, 2] {
            let mut event =
                movement_event(guid, 7, movement, 0, Some(InterpretedMotionCommand(74)));
            event.is_autonomous = false;
            let EntityMovementAdmission::Applied {
                snapshot, actions, ..
            } = entity.admit_remote_movement(&event)
            else {
                panic!("fresh ACE forward action should be admitted");
            };
            assert_eq!(snapshot.forward_command, None);
            assert_eq!(actions.len(), 1);
            assert_eq!(actions[0].source, EntityMotionActionSource::ForwardCommand);
            assert_eq!(actions[0].speed.to_f32(), 1.0);
            assert_eq!(actions[0].action_sequence, movement);
        }
    }

    #[test]
    fn malformed_fresh_action_items_advance_the_stamp_and_report_one_reason_each() {
        let guid = Guid(0x6000_0001);
        let mut entity = Entity::new(guid, "Remote".to_owned(), WorldPosition::default());
        entity.sequences[8] = 7;

        let EntityMovementAdmission::Applied {
            actions,
            rejected_actions,
            next_action_sequence,
            ..
        } = entity.admit_remote_movement(&action_event(
            guid,
            1,
            false,
            vec![
                MotionItem::new(u16::MAX, 1, false, 1.0),
                MotionItem::new(InterpretedMotionCommand::RUN_FORWARD, 2, false, 1.0),
                MotionItem::new(74, 3, false, f32::NAN),
            ],
        ))
        else {
            panic!("fresh outer event should be admitted");
        };
        assert!(actions.is_empty());
        assert_eq!(next_action_sequence, 3);
        assert!(matches!(
            rejected_actions.as_slice(),
            [
                EntityMotionActionRejection::UnknownCommand { .. },
                EntityMotionActionRejection::NotAnAction { .. },
                EntityMotionActionRejection::NonFiniteSpeed { .. },
            ]
        ));
    }

    #[test]
    fn remote_movement_admission_handles_wrapping_run_stop_and_rejects_replay() {
        let guid = Guid(0x6000_0001);
        let mut entity = Entity::new(guid, "Remote".to_owned(), WorldPosition::default());
        entity.sequences[8] = 7;
        entity.sequences[1] = u16::MAX - 1;
        entity.sequences[5] = 10;

        assert!(matches!(
            entity.admit_remote_movement(&movement_event(
                guid,
                7,
                u16::MAX,
                10,
                Some(InterpretedMotionCommand::RUN_FORWARD),
            )),
            EntityMovementAdmission::Applied {
                motion_changed: true,
                ..
            }
        ));
        assert_eq!(
            entity.motion_command(),
            Some(InterpretedMotionCommand::RUN_FORWARD)
        );

        assert!(matches!(
            entity.admit_remote_movement(&movement_event(guid, 7, 0, 10, None)),
            EntityMovementAdmission::Applied {
                motion_changed: true,
                ..
            }
        ));
        let idle = entity
            .network_motion
            .snapshot()
            .expect("a stop is initialized idle authority");
        assert_eq!(idle.current_style, Some(MotionStance::NonCombat));
        assert_eq!(idle.motion_command(), None);

        assert_eq!(
            entity.admit_remote_movement(&movement_event(guid, 7, 0, 10, None)),
            EntityMovementAdmission::Rejected,
            "duplicate delivery is not a fresh motion epoch"
        );

        assert_eq!(
            entity.admit_remote_movement(&movement_event(
                guid,
                7,
                u16::MAX,
                10,
                Some(InterpretedMotionCommand::RUN_FORWARD),
            )),
            EntityMovementAdmission::Rejected
        );
        assert_eq!(entity.network_motion.snapshot(), Some(idle));
    }

    #[test]
    fn wrong_instance_and_stale_server_control_cannot_replace_motion_authority() {
        let guid = Guid(0x6000_0001);
        let mut entity = Entity::new(guid, "Remote".to_owned(), WorldPosition::default());
        entity.sequences[8] = 7;
        entity.sequences[5] = 10;

        assert_eq!(
            entity.admit_remote_movement(&movement_event(
                guid,
                6,
                1,
                10,
                Some(InterpretedMotionCommand::RUN_FORWARD),
            )),
            EntityMovementAdmission::Rejected
        );
        assert_eq!(entity.movement_sequence(), 0);

        assert_eq!(
            entity.admit_remote_movement(&movement_event(
                guid,
                7,
                1,
                9,
                Some(InterpretedMotionCommand::RUN_FORWARD),
            )),
            EntityMovementAdmission::MovementSequenceAdvanced
        );
        assert_eq!(entity.movement_sequence(), 1);
        assert_eq!(entity.server_control_sequence(), 10);
        assert_eq!(entity.network_motion.snapshot(), None);
    }

    #[test]
    fn successor_replaces_all_interpreted_channels_and_same_order_does_not_restart() {
        let guid = Guid(0x6000_0001);
        let mut entity = Entity::new(guid, "Remote".to_owned(), WorldPosition::default());
        entity.sequences[8] = 7;
        let with_all_channels = MovementEventData {
            guid,
            object_instance_sequence: 7,
            movement_sequence: 1,
            server_control_sequence: 0,
            is_autonomous: true,
            movement_type: MovementType::Invalid,
            motion_flags: 0,
            current_style: MotionStance::SwordCombat.interpreted(),
            data: MovementTypeData::Invalid(MovementInvalid {
                state: InterpretedMotionState {
                    flags: MovementStateFlags::CURRENT_STYLE
                        | MovementStateFlags::FORWARD_COMMAND
                        | MovementStateFlags::FORWARD_SPEED
                        | MovementStateFlags::SIDE_STEP_COMMAND
                        | MovementStateFlags::SIDE_STEP_SPEED
                        | MovementStateFlags::TURN_COMMAND
                        | MovementStateFlags::TURN_SPEED,
                    current_style: Some(MotionStance::SwordCombat.interpreted()),
                    forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
                    forward_speed: Some(2.0),
                    sidestep_command: Some(InterpretedMotionCommand::SIDESTEP_RIGHT),
                    sidestep_speed: Some(3.0),
                    turn_command: Some(InterpretedMotionCommand::TURN_LEFT),
                    turn_speed: Some(0.5),
                    ..Default::default()
                },
                sticky_object: None,
            }),
        };
        assert!(matches!(
            entity.admit_remote_movement(&with_all_channels),
            EntityMovementAdmission::Applied {
                motion_changed: true,
                ..
            }
        ));

        let forward_only = MovementEventData {
            movement_sequence: 2,
            data: MovementTypeData::Invalid(MovementInvalid {
                state: InterpretedMotionState {
                    flags: MovementStateFlags::CURRENT_STYLE
                        | MovementStateFlags::FORWARD_COMMAND
                        | MovementStateFlags::FORWARD_SPEED,
                    current_style: Some(MotionStance::SwordCombat.interpreted()),
                    forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
                    forward_speed: Some(2.0),
                    ..Default::default()
                },
                sticky_object: None,
            }),
            ..with_all_channels.clone()
        };
        assert!(matches!(
            entity.admit_remote_movement(&forward_only),
            EntityMovementAdmission::Applied {
                motion_changed: true,
                ..
            }
        ));
        let successor = entity.network_motion.snapshot().unwrap();
        assert_eq!(successor.current_style, Some(MotionStance::SwordCombat));
        assert_eq!(successor.sidestep_command, None);
        assert_eq!(successor.sidestep_speed, None);
        assert_eq!(successor.turn_command, None);
        assert_eq!(successor.turn_speed, None);

        let same_order = MovementEventData {
            movement_sequence: 3,
            ..forward_only
        };
        assert!(matches!(
            entity.admit_remote_movement(&same_order),
            EntityMovementAdmission::Applied {
                motion_changed: false,
                ..
            }
        ));
    }

    #[test]
    fn replacement_generation_rejects_the_predecessors_motion_epoch() {
        let guid = Guid(0x6000_0001);
        let mut replacement = Entity::new(guid, "Replacement".to_owned(), WorldPosition::default());
        replacement.sequences[8] = 8;

        assert_eq!(
            replacement.admit_remote_movement(&movement_event(
                guid,
                7,
                1,
                0,
                Some(InterpretedMotionCommand::RUN_FORWARD),
            )),
            EntityMovementAdmission::Rejected
        );
        assert_eq!(replacement.network_motion.snapshot(), None);

        assert!(matches!(
            replacement.admit_remote_movement(&movement_event(
                guid,
                8,
                1,
                0,
                Some(InterpretedMotionCommand::RUN_FORWARD),
            )),
            EntityMovementAdmission::Applied {
                motion_changed: true,
                ..
            }
        ));
    }
}

#[derive(Debug, Clone)]
pub struct Entity {
    pub guid: Guid,
    pub wcid: Option<u32>,
    pub position: WorldPosition,

    pub velocity: Vector3,
    pub acceleration: Vector3,
    pub omega: Vector3,
    pub gfx_id: Option<u32>,
    pub icon_id: Option<u32>,
    pub flags: ObjectDescriptionFlag,
    pub weenie_flags: WeenieHeaderFlag,
    pub weenie_flags2: WeenieHeaderFlag2,
    /// Complete semantic physics state and its once-derived runtime decisions.
    pub physics: EffectiveEntityPhysicsState,
    /// Lossless ordered visual substitutions normalized from the producer's source format.
    pub appearance: EntityAppearance,
    /// Set while another object owns this entity's position. See [`PhysicsAttachment`].
    pub attachment: Option<PhysicsAttachment>,
    pub autonomous_movement: bool,
    /// Retained steady-state movement supplied by this entity's current network generation.
    pub network_motion: EntityNetworkMotion,
    /// Latest admitted command-list action stamp in retail's wrapping 15-bit domain.
    server_action_sequence: u16,
    pub health_fraction: Option<f32>,

    pub sequences: [u16; 9],

    pub properties: WorldObjectProperties,

    pub armor_profile: Option<ArmorProfile>,
    pub creature_profile: Option<CreatureProfile>,
    pub weapon_profile: Option<WeaponProfile>,
    pub hook_profile: Option<HookProfile>,
    pub armor_levels: Option<ArmorLevels>,
    pub spell_book: Vec<u32>,
    pub book: Option<BookData>,

    pub armor_highlight: Option<u16>,
    pub armor_color: Option<u16>,
    pub weapon_highlight: Option<u16>,
    pub weapon_color: Option<u16>,
    pub resist_highlight: Option<u16>,
    pub resist_color: Option<u16>,
}

const OBJECT_POSITION_SEQUENCE_INDEX: usize = 0;
const OBJECT_MOVEMENT_SEQUENCE_INDEX: usize = 1;
const OBJECT_VECTOR_SEQUENCE_INDEX: usize = 3;
const OBJECT_TELEPORT_SEQUENCE_INDEX: usize = 4;
const OBJECT_SERVER_CONTROL_SEQUENCE_INDEX: usize = 5;
const OBJECT_FORCE_POSITION_SEQUENCE_INDEX: usize = 6;
const OBJECT_INSTANCE_SEQUENCE_INDEX: usize = 8;

/// Result of applying retail's movement timestamp admission to one existing entity generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EntityMovementAdmission {
    Rejected,
    /// Retail advances the movement timestamp before rejecting an older server-control epoch.
    MovementSequenceAdvanced,
    Applied {
        snapshot: EntityMotionSnapshot,
        motion_changed: bool,
        actions: Vec<EntityMotionAction>,
        rejected_actions: Vec<EntityMotionActionRejection>,
        next_action_sequence: u16,
    },
}

impl HasProperties for Entity {
    fn properties(&self) -> &WorldObjectProperties {
        &self.properties
    }
}

impl HasPropertiesMut for Entity {
    fn properties_mut(&mut self) -> &mut WorldObjectProperties {
        &mut self.properties
    }
}

impl Entity {
    /// Current server instance sequence used as the client composition's realization generation.
    pub const fn instance_sequence(&self) -> u16 {
        self.sequences[OBJECT_INSTANCE_SEQUENCE_INDEX]
    }

    /// Current remote-object movement timestamp.
    pub const fn movement_sequence(&self) -> u16 {
        self.sequences[OBJECT_MOVEMENT_SEQUENCE_INDEX]
    }

    /// Current server-control timestamp shared by movement and correction packets.
    pub const fn server_control_sequence(&self) -> u16 {
        self.sequences[OBJECT_SERVER_CONTROL_SEQUENCE_INDEX]
    }

    pub fn motion_command(&self) -> Option<InterpretedMotionCommand> {
        self.network_motion
            .snapshot()
            .and_then(EntityMotionSnapshot::motion_command)
    }

    /// Admits and reduces one remote movement packet using retail's timestamp ordering.
    ///
    /// The current object instance must match exactly. Movement uses wrapping strictly-newer
    /// ordering; once fresh, retail advances that timestamp even if the packet's server-control
    /// epoch is older. Equal server-control timestamps are valid (`CPhysics::SetObjectMovement`,
    /// `acclient.c:299898-299943`; instance gate at `acclient.c:375663-375698`).
    #[cfg(test)]
    pub(crate) fn admit_remote_movement(
        &mut self,
        data: &MovementEventData,
    ) -> EntityMovementAdmission {
        self.admit_movement_with_action_policy(data, true)
    }

    /// Admits movement while choosing whether locally echoed autonomous actions re-enter playback.
    pub(crate) fn admit_movement_with_action_policy(
        &mut self,
        data: &MovementEventData,
        accept_autonomous_actions: bool,
    ) -> EntityMovementAdmission {
        let admission = self.reduce_remote_movement(data, accept_autonomous_actions);
        self.commit_movement_admission(data, &admission);
        admission
    }

    /// Reduces a self packet whose player-authority adapter already admitted its outer timestamp.
    pub(crate) fn apply_locally_admitted_movement(
        &mut self,
        data: &MovementEventData,
    ) -> EntityMovementAdmission {
        self.sequences[OBJECT_INSTANCE_SEQUENCE_INDEX] = data.object_instance_sequence;
        let admission = self.reduce_admitted_movement(data, false);
        self.commit_movement_admission(data, &admission);
        admission
    }

    fn commit_movement_admission(
        &mut self,
        data: &MovementEventData,
        admission: &EntityMovementAdmission,
    ) {
        match admission {
            EntityMovementAdmission::Rejected => {}
            EntityMovementAdmission::MovementSequenceAdvanced => {
                self.sequences[OBJECT_MOVEMENT_SEQUENCE_INDEX] = data.movement_sequence;
            }
            EntityMovementAdmission::Applied {
                snapshot,
                next_action_sequence,
                ..
            } => {
                self.sequences[OBJECT_MOVEMENT_SEQUENCE_INDEX] = data.movement_sequence;
                self.sequences[OBJECT_SERVER_CONTROL_SEQUENCE_INDEX] = data.server_control_sequence;
                self.network_motion = EntityNetworkMotion::Initialized(*snapshot);
                self.server_action_sequence = *next_action_sequence;
            }
        }
    }

    /// Pure successor reduction used by [`Self::admit_remote_movement`].
    fn reduce_remote_movement(
        &self,
        data: &MovementEventData,
        accept_autonomous_actions: bool,
    ) -> EntityMovementAdmission {
        if data.guid != self.guid
            || data.object_instance_sequence != self.instance_sequence()
            || !is_newer_u16(data.movement_sequence, self.movement_sequence())
        {
            return EntityMovementAdmission::Rejected;
        }

        if is_newer_u16(self.server_control_sequence(), data.server_control_sequence) {
            return EntityMovementAdmission::MovementSequenceAdvanced;
        }

        self.reduce_admitted_movement(data, accept_autonomous_actions)
    }

    fn reduce_admitted_movement(
        &self,
        data: &MovementEventData,
        accept_autonomous_actions: bool,
    ) -> EntityMovementAdmission {
        let snapshot =
            EntityMotionSnapshot::from_movement_event(data, self.network_motion.snapshot());
        let successor = EntityNetworkMotion::Initialized(snapshot);
        let motion_changed = self.network_motion != successor;
        let (actions, rejected_actions, next_action_sequence) =
            self.reduce_motion_actions(data, accept_autonomous_actions);
        EntityMovementAdmission::Applied {
            snapshot,
            motion_changed,
            actions,
            rejected_actions,
            next_action_sequence,
        }
    }

    fn reduce_motion_actions(
        &self,
        data: &MovementEventData,
        accept_autonomous_actions: bool,
    ) -> (
        Vec<EntityMotionAction>,
        Vec<EntityMotionActionRejection>,
        u16,
    ) {
        let admission = EntityMotionAdmission::from_movement_event(data);
        let mut accepted = Vec::new();
        let mut rejected = Vec::new();
        let mut action_sequence = self.server_action_sequence;
        let MovementTypeData::Invalid(invalid) = &data.data else {
            return (accepted, rejected, action_sequence);
        };

        for item in &invalid.state.commands {
            let sequence = item.sequence();
            if !is_newer_u15(sequence, action_sequence)
                || item.is_autonomous() && !accept_autonomous_actions
            {
                continue;
            }
            action_sequence = sequence;
            match reduce_motion_action(
                item.command,
                item.speed,
                sequence,
                item.is_autonomous(),
                admission,
                EntityMotionActionSource::CommandList,
            ) {
                Ok(action) => accepted.push(action),
                Err(rejection) => rejected.push(rejection),
            }
        }

        if let Some(command) = invalid.state.forward_command
            && MotionCommand::from_interpreted(command).is_some_and(MotionCommand::is_action)
            && (!data.is_autonomous || accept_autonomous_actions)
        {
            // InterpretedMotionState initializes an omitted speed to 1.0
            // (`acclient.c:319578-319598`).
            let speed = invalid.state.forward_speed.unwrap_or(1.0);
            match reduce_motion_action(
                command,
                speed,
                data.movement_sequence & 0x7FFF,
                data.is_autonomous,
                admission,
                EntityMotionActionSource::ForwardCommand,
            ) {
                Ok(action) => accepted.push(action),
                Err(rejection) => rejected.push(rejection),
            }
        }

        (accepted, rejected, action_sequence)
    }

    /// Current remote-object position timestamp.
    pub const fn position_sequence(&self) -> u16 {
        self.sequences[OBJECT_POSITION_SEQUENCE_INDEX]
    }

    /// Current remote-object teleport timestamp.
    pub const fn teleport_sequence(&self) -> u16 {
        self.sequences[OBJECT_TELEPORT_SEQUENCE_INDEX]
    }

    /// Current remote-object vector timestamp.
    pub const fn vector_sequence(&self) -> u16 {
        self.sequences[OBJECT_VECTOR_SEQUENCE_INDEX]
    }

    /// Admits a remote vector only in the current object instance and at a fresh timestamp.
    ///
    /// Retail performs these two checks before `SmartBox::DoVectorUpdate` mutates velocity
    /// (`acclient.c:138277-138326`).
    pub fn admit_remote_vector_sequences(
        &mut self,
        instance_sequence: u16,
        vector_sequence: u16,
    ) -> bool {
        if instance_sequence != self.instance_sequence()
            || !is_newer_u16(vector_sequence, self.vector_sequence())
        {
            return false;
        }
        self.sequences[OBJECT_VECTOR_SEQUENCE_INDEX] = vector_sequence;
        true
    }

    /// Advances only the remote position timestamp after retail admits a non-contact sample.
    pub fn apply_remote_position_sequence_only(&mut self, position_sequence: u16) {
        self.sequences[OBJECT_POSITION_SEQUENCE_INDEX] = position_sequence;
    }

    /// Commits one admitted remote position sample after world policy classifies its runtime effect.
    pub fn apply_remote_position_sample(
        &mut self,
        position: WorldPosition,
        instance_sequence: u16,
        position_sequence: u16,
        teleport_sequence: u16,
    ) {
        self.position = position;
        self.sequences[OBJECT_INSTANCE_SEQUENCE_INDEX] = instance_sequence;
        self.sequences[OBJECT_POSITION_SEQUENCE_INDEX] = position_sequence;
        self.sequences[OBJECT_TELEPORT_SEQUENCE_INDEX] = teleport_sequence;
    }

    fn should_accept_autonomous_position_sequences(
        &self,
        teleport_sequence: u16,
        force_position_sequence: u16,
    ) -> bool {
        let current_teleport_sequence = self.sequences[OBJECT_TELEPORT_SEQUENCE_INDEX];
        let current_force_position_sequence = self.sequences[OBJECT_FORCE_POSITION_SEQUENCE_INDEX];

        if is_newer_u16(current_teleport_sequence, teleport_sequence) {
            return false;
        }

        if teleport_sequence == current_teleport_sequence
            && is_newer_u16(current_force_position_sequence, force_position_sequence)
        {
            return false;
        }

        true
    }

    /// Applies the quarantined server-to-client autonomous-position path as a discontinuity.
    pub fn apply_server_autonomous_position_update(
        &mut self,
        position: WorldPosition,
        instance_sequence: u16,
        teleport_sequence: u16,
        force_position_sequence: u16,
        server_control_sequence: u16,
    ) -> bool {
        if !self
            .should_accept_autonomous_position_sequences(teleport_sequence, force_position_sequence)
        {
            return false;
        }

        self.position = position;
        self.sequences[OBJECT_INSTANCE_SEQUENCE_INDEX] = instance_sequence;
        self.sequences[OBJECT_TELEPORT_SEQUENCE_INDEX] = teleport_sequence;
        self.sequences[OBJECT_FORCE_POSITION_SEQUENCE_INDEX] = force_position_sequence;
        self.sequences[OBJECT_SERVER_CONTROL_SEQUENCE_INDEX] = server_control_sequence;
        true
    }

    pub fn set_property(&mut self, update: PropertyUpdate) {
        self.properties.apply(update);
    }

    pub fn apply_identify_response(&mut self, data: &IdentifyObjectResponseEventData) -> bool {
        identify::apply_identify_response(
            IdentifyTarget {
                properties: &mut self.properties,
                armor_profile: &mut self.armor_profile,
                creature_profile: &mut self.creature_profile,
                weapon_profile: &mut self.weapon_profile,
                hook_profile: &mut self.hook_profile,
                armor_levels: &mut self.armor_levels,
                spell_book: &mut self.spell_book,
                armor_highlight: &mut self.armor_highlight,
                armor_color: &mut self.armor_color,
                weapon_highlight: &mut self.weapon_highlight,
                weapon_color: &mut self.weapon_color,
                resist_highlight: &mut self.resist_highlight,
                resist_color: &mut self.resist_color,
            },
            data,
        )
    }

    pub fn set_container_id(&mut self, val: Option<Guid>) {
        self.set_iid_prop(PropertyInstanceId::Container, val.unwrap_or(Guid::NULL))
    }

    pub fn set_wielder_id(&mut self, val: Option<Guid>) {
        self.set_iid_prop(PropertyInstanceId::Wielder, val.unwrap_or(Guid::NULL))
    }

    pub fn apply_description(&mut self, data: &ObjectDescriptionData) {
        self.wcid = Some(data.public_weenie_desc.wcid);
        self.flags = data.public_weenie_desc.obj_desc_flags;
        self.weenie_flags = data.public_weenie_desc.weenie_flags;
        self.weenie_flags2 = data.public_weenie_desc.weenie_flags2;

        self.properties.ints.0.insert(
            PropertyInt::ItemType,
            data.public_weenie_desc.item_type as i32,
        );

        self.physics = resolve_effective_entity_physics_state(data.physics_state);
        self.appearance = EntityAppearance::from(&data.model_data);
        // The wire carries placement in the ANIMFRAME slot, defaulting to 0 when the flag is
        // absent, exactly as `PhysicsDesc` initializes `animframe_id` (`acclient.c:318475`).
        self.attachment = data.parent.and_then(|parent| {
            PhysicsAttachment::from_wire(
                parent.id,
                parent.location_id,
                data.animation_frame.unwrap_or(0),
            )
            .inspect_err(|error| {
                log::warn!(
                    "Entity {:?} description names an unusable attachment: {error}",
                    self.guid
                )
            })
            .ok()
        });

        if let Some(v) = data.velocity {
            self.velocity = v;
        }
        if let Some(a) = data.acceleration {
            self.acceleration = a;
        }
        if let Some(o) = data.omega {
            self.omega = o;
        }

        self.icon_id = Some(data.public_weenie_desc.icon_id);
        self.sequences = data.sequences;

        if let Some(val) = data.autonomous_movement {
            self.autonomous_movement = val;
        }

        self.network_motion = EntityMotionSnapshot::from_object_description(data).map_or(
            EntityNetworkMotion::Uninitialized,
            EntityNetworkMotion::Initialized,
        );

        // Hydrate properties from the description (using common mapping logic)
        self.properties.hydrate_from_odd(data);
    }

    pub fn new(guid: Guid, name: String, position: WorldPosition) -> Self {
        let mut properties = WorldObjectProperties::default();
        properties.strings.insert(PropertyString::Name, name);

        Self {
            guid,
            wcid: None,
            position,
            velocity: Vector3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            acceleration: Vector3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            omega: Vector3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            gfx_id: None,
            icon_id: None,
            flags: ObjectDescriptionFlag::empty(),
            weenie_flags: WeenieHeaderFlag::empty(),
            weenie_flags2: WeenieHeaderFlag2::empty(),

            physics: resolve_effective_entity_physics_state(PhysicsState::NONE),
            appearance: EntityAppearance::default(),
            attachment: None,
            autonomous_movement: false,
            network_motion: EntityNetworkMotion::Uninitialized,
            server_action_sequence: 0,
            health_fraction: None,
            sequences: [0; 9],
            properties,
            armor_profile: None,
            creature_profile: None,
            weapon_profile: None,
            hook_profile: None,
            armor_levels: None,
            spell_book: Vec::new(),
            book: None,
            armor_highlight: None,
            armor_color: None,
            weapon_highlight: None,
            weapon_color: None,
            resist_highlight: None,
            resist_color: None,
        }
    }
}

pub struct EntityManager {
    pub entities: HashMap<Guid, Entity>,
}

impl Default for EntityManager {
    fn default() -> Self {
        Self::new()
    }
}

impl EntityManager {
    pub fn new() -> Self {
        Self {
            entities: HashMap::new(),
        }
    }

    pub fn insert(&mut self, entity: Entity) {
        self.entities.insert(entity.guid, entity);
    }

    pub fn contains(&self, guid: impl Into<Guid>) -> bool {
        self.entities.contains_key(&guid.into())
    }

    pub fn get(&self, guid: impl Into<Guid>) -> Option<&Entity> {
        self.entities.get(&guid.into())
    }

    pub fn get_filtered<F>(&self, guid: impl Into<Guid>, predicate: F) -> Option<&Entity>
    where
        F: FnOnce(&Entity) -> bool,
    {
        let entity = self.get(guid)?;
        predicate(entity).then_some(entity)
    }

    pub fn get_mut(&mut self, guid: impl Into<Guid>) -> Option<&mut Entity> {
        self.entities.get_mut(&guid.into())
    }

    pub fn iter(&self) -> impl Iterator<Item = &Entity> {
        self.entities.values()
    }

    pub fn iter_filtered<'a, F>(&'a self, mut predicate: F) -> impl Iterator<Item = &'a Entity> + 'a
    where
        F: FnMut(&Entity) -> bool + 'a,
    {
        self.entities
            .values()
            .filter(move |entity| predicate(entity))
    }

    pub fn remove(&mut self, guid: impl Into<Guid>) -> Option<Entity> {
        self.entities.remove(&guid.into())
    }
}

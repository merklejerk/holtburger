use crate::book::BookData;
use crate::hydration::WorldObjectPropertiesHydrationExt;
use crate::identify::{self, IdentifyTarget};
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
    MoveToObject, MoveToPosition, MovementInvalid, TurnToHeading, TurnToObject,
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
    pub forward_speed: Option<OrderedMotionSpeed>,
    pub sidestep_speed: Option<OrderedMotionSpeed>,
    pub turn_speed: Option<OrderedMotionSpeed>,
    pub directive: Option<EntityMotionDirective>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct OrderedMotionSpeed(u32);

impl OrderedMotionSpeed {
    pub fn from_f32(value: f32) -> Option<Self> {
        value.is_finite().then_some(Self(value.to_bits()))
    }

    pub const fn to_f32(self) -> f32 {
        f32::from_bits(self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityMotionDirective {
    TurnToHeading {
        desired_heading: OrderedMotionSpeed,
        speed: OrderedMotionSpeed,
    },
    TurnToObject {
        target: Guid,
        desired_heading: Option<OrderedMotionSpeed>,
        speed: OrderedMotionSpeed,
    },
}

impl EntityMotionSnapshot {
    pub fn motion_command(self) -> Option<InterpretedMotionCommand> {
        self.forward_command
            .or(self.sidestep_command)
            .or(self.turn_command)
    }

    pub fn from_movement_event(data: &MovementEventData) -> Option<Self> {
        let mut snapshot = Self {
            current_style: MotionStance::from_interpreted(data.current_style),
            ..Self::default()
        };

        if let MovementTypeData::Invalid(invalid) = &data.data {
            if let Some(style) = invalid
                .state
                .current_style
                .and_then(MotionStance::from_interpreted)
            {
                snapshot.current_style = Some(style);
            }
            snapshot.forward_command = invalid.state.forward_command;
            snapshot.sidestep_command = invalid.state.sidestep_command;
            snapshot.turn_command = invalid.state.turn_command;
            snapshot.forward_speed = invalid
                .state
                .forward_speed
                .and_then(OrderedMotionSpeed::from_f32);
            snapshot.sidestep_speed = invalid
                .state
                .sidestep_speed
                .and_then(OrderedMotionSpeed::from_f32);
            snapshot.turn_speed = invalid
                .state
                .turn_speed
                .and_then(OrderedMotionSpeed::from_f32);
        } else if let MovementTypeData::TurnToHeading(turn) = &data.data {
            let desired_heading = OrderedMotionSpeed::from_f32(turn.params.desired_heading);
            let speed = OrderedMotionSpeed::from_f32(turn.params.speed);

            if let (Some(desired_heading), Some(speed)) = (desired_heading, speed) {
                snapshot.directive = Some(EntityMotionDirective::TurnToHeading {
                    desired_heading,
                    speed,
                });
            }
        } else if let MovementTypeData::TurnToObject(turn) = &data.data
            && let Some(speed) = OrderedMotionSpeed::from_f32(turn.params.speed)
        {
            snapshot.directive = Some(EntityMotionDirective::TurnToObject {
                target: turn.target,
                desired_heading: OrderedMotionSpeed::from_f32(turn.desired_heading),
                speed,
            });
        }

        let has_data = snapshot.current_style.is_some()
            || snapshot.forward_command.is_some()
            || snapshot.sidestep_command.is_some()
            || snapshot.turn_command.is_some()
            || snapshot.forward_speed.is_some()
            || snapshot.sidestep_speed.is_some()
            || snapshot.turn_speed.is_some()
            || snapshot.directive.is_some();

        has_data.then_some(snapshot)
    }

    pub fn from_object_description(data: &ObjectDescriptionData) -> Option<Self> {
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

        Self::from_movement_event(&MovementEventData {
            guid: data.public_weenie_desc.guid,
            object_instance_sequence: data.sequences[OBJECT_INSTANCE_SEQUENCE_INDEX],
            movement_sequence: 0,
            server_control_sequence: data.sequences[OBJECT_SERVER_CONTROL_SEQUENCE_INDEX],
            is_autonomous: data.autonomous_movement.unwrap_or(false),
            movement_type,
            motion_flags,
            current_style,
            data: payload,
        })
    }

    pub fn indicates_death_motion(self) -> bool {
        self.motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
    }
}

#[cfg(test)]
mod tests {
    use super::{EntityMotionSnapshot, MotionStance, MovementEventData, MovementTypeData};
    use holtburger_common::Guid;
    use holtburger_protocol::messages::MovementType;
    use holtburger_protocol::messages::movement::messages::motion::{
        TurnToHeading, TurnToObject, TurnToParameters,
    };

    #[test]
    fn turn_to_heading_with_non_finite_directive_preserves_other_snapshot_fields() {
        let snapshot = EntityMotionSnapshot::from_movement_event(&MovementEventData {
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
        })
        .expect("expected current style to keep snapshot populated");

        assert_eq!(snapshot.current_style, Some(MotionStance::NonCombat));
        assert_eq!(snapshot.directive, None);
    }

    #[test]
    fn turn_to_object_with_non_finite_speed_preserves_other_snapshot_fields() {
        let snapshot = EntityMotionSnapshot::from_movement_event(&MovementEventData {
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
        })
        .expect("expected current style to keep snapshot populated");

        assert_eq!(snapshot.current_style, Some(MotionStance::NonCombat));
        assert_eq!(snapshot.directive, None);
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
    pub physics_state: PhysicsState,
    pub physics_parent_id: Option<Guid>,
    pub autonomous_movement: bool,
    pub motion_snapshot: Option<EntityMotionSnapshot>,
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
const OBJECT_TELEPORT_SEQUENCE_INDEX: usize = 4;
const OBJECT_SERVER_CONTROL_SEQUENCE_INDEX: usize = 5;
const OBJECT_FORCE_POSITION_SEQUENCE_INDEX: usize = 6;
const OBJECT_INSTANCE_SEQUENCE_INDEX: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityPositionSyncOutcome {
    Rejected,
    Moved,
    Reset { sequence: u16 },
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
    pub fn motion_command(&self) -> Option<InterpretedMotionCommand> {
        self.motion_snapshot
            .and_then(EntityMotionSnapshot::motion_command)
    }

    pub fn should_accept_server_position_sequences(
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

    pub fn apply_server_position_update(
        &mut self,
        position: WorldPosition,
        instance_sequence: u16,
        position_sequence: Option<u16>,
        teleport_sequence: u16,
        force_position_sequence: u16,
        server_control_sequence: Option<u16>,
    ) -> EntityPositionSyncOutcome {
        if !self.should_accept_server_position_sequences(teleport_sequence, force_position_sequence)
        {
            return EntityPositionSyncOutcome::Rejected;
        }

        let old_teleport_sequence = self.sequences[OBJECT_TELEPORT_SEQUENCE_INDEX];
        let old_force_position_sequence = self.sequences[OBJECT_FORCE_POSITION_SEQUENCE_INDEX];

        self.position = position;
        self.sequences[OBJECT_INSTANCE_SEQUENCE_INDEX] = instance_sequence;
        if let Some(position_sequence) = position_sequence {
            self.sequences[OBJECT_POSITION_SEQUENCE_INDEX] = position_sequence;
        }
        self.sequences[OBJECT_TELEPORT_SEQUENCE_INDEX] = teleport_sequence;
        self.sequences[OBJECT_FORCE_POSITION_SEQUENCE_INDEX] = force_position_sequence;
        if let Some(server_control_sequence) = server_control_sequence {
            self.sequences[OBJECT_SERVER_CONTROL_SEQUENCE_INDEX] = server_control_sequence;
        }

        let reset_required = position_sequence.is_none()
            || is_newer_u16(teleport_sequence, old_teleport_sequence)
            || is_newer_u16(force_position_sequence, old_force_position_sequence);

        if reset_required {
            EntityPositionSyncOutcome::Reset {
                sequence: force_position_sequence,
            }
        } else {
            EntityPositionSyncOutcome::Moved
        }
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

        self.physics_state = data.physics_state;
        self.physics_parent_id = data.parent_id;

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

        self.motion_snapshot = EntityMotionSnapshot::from_object_description(data);

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

            physics_state: PhysicsState::NONE,
            physics_parent_id: None,
            autonomous_movement: false,
            motion_snapshot: None,
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

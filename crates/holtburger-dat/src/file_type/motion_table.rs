use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};
use holtburger_common::Vector3;
use std::collections::HashMap;

const MOTION_KEY_MASK: u32 = 0x000F_FFFF;

#[derive(Debug, Clone, PartialEq)]
pub struct MotionTable {
    pub id: u32,
    pub default_style: u32,
    pub style_defaults: HashMap<u32, u32>,
    pub cycles: HashMap<u32, MotionData>,
    pub modifiers: HashMap<u32, MotionData>,
    pub links: HashMap<u32, HashMap<u32, MotionData>>,
}

impl MotionTable {
    pub const WALK_FORWARD_COMMAND: u32 = 0x4500_0005;
    pub const RUN_FORWARD_COMMAND: u32 = 0x4400_0007;
    pub const TURN_RIGHT_COMMAND: u32 = 0x6500_000D;
    pub const TURN_LEFT_COMMAND: u32 = 0x6500_000E;

    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let default_style = u32::read_le(reader)?;
        let style_defaults = parse_u32_map(reader)?;
        let cycles = parse_motion_data_map(reader)?;
        let modifiers = parse_motion_data_map(reader)?;
        let links = parse_nested_motion_data_map(reader)?;

        Ok(Self {
            id,
            default_style,
            style_defaults,
            cycles,
            modifiers,
            links,
        })
    }

    pub fn motion_data_for_cycle(&self, stance: u32, command: u32) -> Option<&MotionData> {
        self.cycles.get(&cycle_key(stance, command))
    }

    pub fn movement_profile_for_stance(&self, stance: u32) -> MotionTableMovementProfile {
        MotionTableMovementProfile {
            motion_table_id: self.id,
            stance,
            walk_forward: self
                .motion_data_for_cycle(stance, Self::WALK_FORWARD_COMMAND)
                .map(MotionCommandKinematics::from_motion_data),
            run_forward: self
                .motion_data_for_cycle(stance, Self::RUN_FORWARD_COMMAND)
                .map(MotionCommandKinematics::from_motion_data),
            turn_left: self
                .motion_data_for_cycle(stance, Self::TURN_LEFT_COMMAND)
                .map(MotionCommandKinematics::from_motion_data),
            turn_right: self
                .motion_data_for_cycle(stance, Self::TURN_RIGHT_COMMAND)
                .map(MotionCommandKinematics::from_motion_data),
        }
    }

    pub fn default_movement_profile(&self) -> MotionTableMovementProfile {
        self.movement_profile_for_stance(self.default_style)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MotionTableMovementProfile {
    pub motion_table_id: u32,
    pub stance: u32,
    pub walk_forward: Option<MotionCommandKinematics>,
    pub run_forward: Option<MotionCommandKinematics>,
    pub turn_left: Option<MotionCommandKinematics>,
    pub turn_right: Option<MotionCommandKinematics>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotionCommandKinematics {
    pub velocity: Option<Vector3>,
    pub omega: Option<Vector3>,
}

impl MotionCommandKinematics {
    fn from_motion_data(data: &MotionData) -> Self {
        Self {
            velocity: data.velocity,
            omega: data.omega,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MotionData {
    pub bitfield: u8,
    pub flags: MotionDataFlags,
    pub anims: Vec<AnimData>,
    pub velocity: Option<Vector3>,
    pub omega: Option<Vector3>,
}

impl MotionData {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let num_anims = u8::read(reader)? as usize;
        let bitfield = u8::read(reader)?;
        let flags = MotionDataFlags::from_bits_truncate(u8::read(reader)?);
        crate::utils::align_boundary(reader, 4)?;

        let mut anims = Vec::with_capacity(num_anims);
        for _ in 0..num_anims {
            anims.push(AnimData::read(reader)?);
        }

        let velocity = flags
            .contains(MotionDataFlags::HAS_VELOCITY)
            .then(|| Vector3::read_le(reader))
            .transpose()?;
        let omega = flags
            .contains(MotionDataFlags::HAS_OMEGA)
            .then(|| Vector3::read_le(reader))
            .transpose()?;

        Ok(Self {
            bitfield,
            flags,
            anims,
            velocity,
            omega,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnimData {
    pub anim_id: u32,
    pub low_frame: i32,
    pub high_frame: i32,
    pub framerate: f32,
}

impl AnimData {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            anim_id: u32::read_le(reader)?,
            low_frame: i32::read_le(reader)?,
            high_frame: i32::read_le(reader)?,
            framerate: f32::read_le(reader)?,
        })
    }
}

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct MotionDataFlags: u8 {
        const HAS_VELOCITY = 0x01;
        const HAS_OMEGA = 0x02;
    }
}

fn cycle_key(stance: u32, command: u32) -> u32 {
    ((stance & 0xFFFF) << 16) | (command & MOTION_KEY_MASK)
}

fn parse_u32_map<R: Read + Seek>(reader: &mut R) -> BinResult<HashMap<u32, u32>> {
    let count = u32::read_le(reader)? as usize;
    let mut values = HashMap::with_capacity(count);
    for _ in 0..count {
        values.insert(u32::read_le(reader)?, u32::read_le(reader)?);
    }
    Ok(values)
}

fn parse_motion_data_map<R: Read + Seek>(reader: &mut R) -> BinResult<HashMap<u32, MotionData>> {
    let count = u32::read_le(reader)? as usize;
    let mut values = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = u32::read_le(reader)?;
        values.insert(key, MotionData::read(reader)?);
    }
    Ok(values)
}

fn parse_nested_motion_data_map<R: Read + Seek>(
    reader: &mut R,
) -> BinResult<HashMap<u32, HashMap<u32, MotionData>>> {
    let count = u32::read_le(reader)? as usize;
    let mut values = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = u32::read_le(reader)?;
        values.insert(key, parse_motion_data_map(reader)?);
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn push_motion_data(
        bytes: &mut Vec<u8>,
        flags: u8,
        velocity: Option<Vector3>,
        omega: Option<Vector3>,
    ) {
        bytes.push(0); // num_anims
        bytes.push(0); // bitfield
        bytes.push(flags);
        bytes.push(0); // align to 4-byte boundary

        if let Some(velocity) = velocity {
            bytes.extend_from_slice(&velocity.x.to_le_bytes());
            bytes.extend_from_slice(&velocity.y.to_le_bytes());
            bytes.extend_from_slice(&velocity.z.to_le_bytes());
        }

        if let Some(omega) = omega {
            bytes.extend_from_slice(&omega.x.to_le_bytes());
            bytes.extend_from_slice(&omega.y.to_le_bytes());
            bytes.extend_from_slice(&omega.z.to_le_bytes());
        }
    }

    #[test]
    fn parses_motion_table_and_extracts_default_profile() {
        let default_stance = 0x8000_003D;
        let walk_key = cycle_key(default_stance, MotionTable::WALK_FORWARD_COMMAND);
        let run_key = cycle_key(default_stance, MotionTable::RUN_FORWARD_COMMAND);
        let turn_left_key = cycle_key(default_stance, MotionTable::TURN_LEFT_COMMAND);
        let turn_right_key = cycle_key(default_stance, MotionTable::TURN_RIGHT_COMMAND);

        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x0900_0001u32.to_le_bytes());
        bytes.extend_from_slice(&default_stance.to_le_bytes());

        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&default_stance.to_le_bytes());
        bytes.extend_from_slice(&MotionTable::WALK_FORWARD_COMMAND.to_le_bytes());

        bytes.extend_from_slice(&4u32.to_le_bytes());

        bytes.extend_from_slice(&walk_key.to_le_bytes());
        push_motion_data(
            &mut bytes,
            MotionDataFlags::HAS_VELOCITY.bits(),
            Some(Vector3::new(1.0, 0.0, 0.0)),
            None,
        );

        bytes.extend_from_slice(&run_key.to_le_bytes());
        push_motion_data(
            &mut bytes,
            MotionDataFlags::HAS_VELOCITY.bits(),
            Some(Vector3::new(2.5, 0.0, 0.0)),
            None,
        );

        bytes.extend_from_slice(&turn_left_key.to_le_bytes());
        push_motion_data(
            &mut bytes,
            MotionDataFlags::HAS_OMEGA.bits(),
            None,
            Some(Vector3::new(0.0, 0.0, -1.5)),
        );

        bytes.extend_from_slice(&turn_right_key.to_le_bytes());
        push_motion_data(
            &mut bytes,
            MotionDataFlags::HAS_OMEGA.bits(),
            None,
            Some(Vector3::new(0.0, 0.0, 1.5)),
        );

        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());

        let table = MotionTable::read(&mut Cursor::new(bytes)).expect("motion table should parse");
        let profile = table.default_movement_profile();

        assert_eq!(table.default_style, default_stance);
        assert_eq!(
            table.style_defaults.get(&default_stance),
            Some(&MotionTable::WALK_FORWARD_COMMAND)
        );
        assert_eq!(profile.motion_table_id, 0x0900_0001);
        assert_eq!(profile.stance, default_stance);
        assert_eq!(
            profile.walk_forward.and_then(|entry| entry.velocity),
            Some(Vector3::new(1.0, 0.0, 0.0))
        );
        assert_eq!(
            profile.run_forward.and_then(|entry| entry.velocity),
            Some(Vector3::new(2.5, 0.0, 0.0))
        );
        assert_eq!(
            profile.turn_left.and_then(|entry| entry.omega),
            Some(Vector3::new(0.0, 0.0, -1.5))
        );
        assert_eq!(
            profile.turn_right.and_then(|entry| entry.omega),
            Some(Vector3::new(0.0, 0.0, 1.5))
        );
    }
}

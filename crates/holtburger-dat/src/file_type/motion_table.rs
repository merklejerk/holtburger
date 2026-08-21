use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};
use holtburger_common::Vector3;
use std::collections::HashMap;

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
    /// Bits of a motion command that participate in a table key.
    ///
    /// Retail composes `motion & 0xFFFFFF | (style << 16)` (`acclient.c:324297-324305`), so the
    /// style and the command deliberately overlap in bits 16-23.
    pub const MOTION_KEY_MASK: u32 = 0x00FF_FFFF;

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

    /// Key a style and command hash to, matching retail's own composition.
    pub fn cycle_key(style: u32, command: u32) -> u32 {
        (style << 16) | (command & Self::MOTION_KEY_MASK)
    }

    pub fn motion_data_for_cycle(&self, stance: u32, command: u32) -> Option<&MotionData> {
        self.cycles.get(&Self::cycle_key(stance, command))
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
    fn parses_motion_table_and_keys_cycles_the_way_retail_does() {
        let default_stance: u32 = 0x8000_003D;
        let walk_key = MotionTable::cycle_key(default_stance, MotionTable::WALK_FORWARD_COMMAND);
        let run_key = MotionTable::cycle_key(default_stance, MotionTable::RUN_FORWARD_COMMAND);
        let turn_left_key = MotionTable::cycle_key(default_stance, MotionTable::TURN_LEFT_COMMAND);
        let turn_right_key =
            MotionTable::cycle_key(default_stance, MotionTable::TURN_RIGHT_COMMAND);

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

        assert_eq!(table.default_style, default_stance);
        assert_eq!(
            table.style_defaults.get(&default_stance),
            Some(&MotionTable::WALK_FORWARD_COMMAND)
        );
        assert_eq!(
            table
                .motion_data_for_cycle(default_stance, MotionTable::WALK_FORWARD_COMMAND)
                .and_then(|data| data.velocity),
            Some(Vector3::new(1.0, 0.0, 0.0))
        );
        assert_eq!(
            table
                .motion_data_for_cycle(default_stance, MotionTable::RUN_FORWARD_COMMAND)
                .and_then(|data| data.velocity),
            Some(Vector3::new(2.5, 0.0, 0.0))
        );
        assert_eq!(
            table
                .motion_data_for_cycle(default_stance, MotionTable::TURN_LEFT_COMMAND)
                .and_then(|data| data.omega),
            Some(Vector3::new(0.0, 0.0, -1.5))
        );
        assert_eq!(
            table
                .motion_data_for_cycle(default_stance, MotionTable::TURN_RIGHT_COMMAND)
                .and_then(|data| data.omega),
            Some(Vector3::new(0.0, 0.0, 1.5))
        );
    }

    /// Retail composes `motion & 0xFFFFFF | (style << 16)` (`acclient.c:324297-324305`), so the
    /// style and the command overlap in bits 16-23 by design.
    #[test]
    fn cycle_key_matches_retail_composition() {
        assert_eq!(
            MotionTable::cycle_key(0x8000_003D, MotionTable::WALK_FORWARD_COMMAND),
            (0x8000_003Du32 << 16) | 0x0000_0005
        );
        assert_eq!(
            MotionTable::cycle_key(0x0000_0003, 0x0012_3456),
            0x0003_0000 | 0x0012_3456
        );
    }
}

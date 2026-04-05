use crate::file_type::MotionCommandKinematics;
use crate::{HOLTBURGER_CORE_NAMESPACE, ResourceKey, StaticResourceKey};
use binrw::{
    BinRead, BinResult, BinWrite,
    io::{Read, Seek, Write},
};
use holtburger_common::Vector3;
use std::collections::HashMap;

const MOTION_KEY_MASK: u32 = 0x000F_FFFF;
const KINEMATICS_HAS_VELOCITY: u8 = 0x01;
const KINEMATICS_HAS_OMEGA: u8 = 0x02;

#[derive(Debug, Clone, PartialEq)]
pub struct MotionKinematics {
    pub id: u32,
    pub version: u32,
    pub setup_model_defaults: HashMap<u32, u32>,
    pub motion_tables: HashMap<u32, MotionKinematicsTable>,
}

impl MotionKinematics {
    pub const FILE_ID: u32 = 0x4D4F_544B;
    pub const VERSION: u32 = 1;

    pub fn new() -> Self {
        Self {
            id: Self::FILE_ID,
            version: Self::VERSION,
            setup_model_defaults: HashMap::new(),
            motion_tables: HashMap::new(),
        }
    }

    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let version = u32::read_le(reader)?;
        let setup_model_defaults = read_u32_map(reader)?;

        let table_count = u32::read_le(reader)? as usize;
        let mut motion_tables = HashMap::with_capacity(table_count);
        for _ in 0..table_count {
            let table = MotionKinematicsTable::read(reader)?;
            motion_tables.insert(table.motion_table_id, table);
        }

        Ok(Self {
            id,
            version,
            setup_model_defaults,
            motion_tables,
        })
    }

    pub fn write<W: Write + Seek>(&self, writer: &mut W) -> BinResult<()> {
        self.id.write_le(writer)?;
        self.version.write_le(writer)?;
        write_u32_map(writer, &self.setup_model_defaults)?;

        (self.motion_tables.len() as u32).write_le(writer)?;
        let mut table_ids: Vec<_> = self.motion_tables.keys().copied().collect();
        table_ids.sort_unstable();
        for table_id in table_ids {
            self.motion_tables
                .get(&table_id)
                .expect("sorted table ids should exist")
                .write(writer)?;
        }

        Ok(())
    }

    pub fn motion_table(&self, motion_table_id: u32) -> Option<&MotionKinematicsTable> {
        self.motion_tables.get(&motion_table_id)
    }

    pub fn default_motion_table_for_setup(&self, setup_model_id: u32) -> Option<u32> {
        self.setup_model_defaults.get(&setup_model_id).copied()
    }

    pub fn default_style_for_motion_table(&self, motion_table_id: u32) -> Option<u32> {
        self.motion_table(motion_table_id)
            .map(|table| table.default_style)
    }

    pub fn cycle_kinematics(
        &self,
        motion_table_id: u32,
        stance: u32,
        command: u32,
    ) -> Option<&MotionCommandKinematics> {
        self.motion_table(motion_table_id)
            .and_then(|table| table.cycle_kinematics(stance, command))
    }
}

impl Default for MotionKinematics {
    fn default() -> Self {
        Self::new()
    }
}

impl BinRead for MotionKinematics {
    type Args<'a> = ();

    fn read_options<R: Read + Seek>(
        reader: &mut R,
        _endian: binrw::Endian,
        _args: Self::Args<'_>,
    ) -> BinResult<Self> {
        Self::read(reader)
    }
}

impl StaticResourceKey for MotionKinematics {
    const RESOURCE_KEY: ResourceKey<'static> =
        ResourceKey::new(HOLTBURGER_CORE_NAMESPACE, Self::FILE_ID);
}

#[derive(Debug, Clone, PartialEq)]
pub struct MotionKinematicsTable {
    pub motion_table_id: u32,
    pub default_style: u32,
    pub cycle_kinematics_by_key: HashMap<u32, MotionCommandKinematics>,
}

impl MotionKinematicsTable {
    pub fn new(motion_table_id: u32, default_style: u32) -> Self {
        Self {
            motion_table_id,
            default_style,
            cycle_kinematics_by_key: HashMap::new(),
        }
    }

    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let motion_table_id = u32::read_le(reader)?;
        let default_style = u32::read_le(reader)?;
        let entry_count = u32::read_le(reader)? as usize;
        let mut cycle_kinematics_by_key = HashMap::with_capacity(entry_count);

        for _ in 0..entry_count {
            let key = u32::read_le(reader)?;
            let kinematics = read_kinematics(reader)?;
            cycle_kinematics_by_key.insert(key, kinematics);
        }

        Ok(Self {
            motion_table_id,
            default_style,
            cycle_kinematics_by_key,
        })
    }

    pub fn write<W: Write + Seek>(&self, writer: &mut W) -> BinResult<()> {
        self.motion_table_id.write_le(writer)?;
        self.default_style.write_le(writer)?;
        (self.cycle_kinematics_by_key.len() as u32).write_le(writer)?;

        let mut cycle_keys: Vec<_> = self.cycle_kinematics_by_key.keys().copied().collect();
        cycle_keys.sort_unstable();
        for key in cycle_keys {
            key.write_le(writer)?;
            write_kinematics(
                writer,
                self.cycle_kinematics_by_key
                    .get(&key)
                    .expect("sorted cycle key should exist"),
            )?;
        }

        Ok(())
    }

    pub fn insert_cycle_kinematics(
        &mut self,
        stance: u32,
        command: u32,
        kinematics: MotionCommandKinematics,
    ) {
        self.cycle_kinematics_by_key
            .insert(cycle_key(stance, command), kinematics);
    }

    pub fn cycle_kinematics(&self, stance: u32, command: u32) -> Option<&MotionCommandKinematics> {
        self.cycle_kinematics_by_key
            .get(&cycle_key(stance, command))
    }

    pub fn iter_cycle_kinematics(&self) -> impl Iterator<Item = (u32, &MotionCommandKinematics)> {
        self.cycle_kinematics_by_key
            .iter()
            .map(|(key, kinematics)| (*key, kinematics))
    }
}

fn cycle_key(stance: u32, command: u32) -> u32 {
    ((stance & 0xFFFF) << 16) | (command & MOTION_KEY_MASK)
}

fn read_u32_map<R: Read + Seek>(reader: &mut R) -> BinResult<HashMap<u32, u32>> {
    let count = u32::read_le(reader)? as usize;
    let mut values = HashMap::with_capacity(count);
    for _ in 0..count {
        values.insert(u32::read_le(reader)?, u32::read_le(reader)?);
    }
    Ok(values)
}

fn write_u32_map<W: Write + Seek>(writer: &mut W, values: &HashMap<u32, u32>) -> BinResult<()> {
    (values.len() as u32).write_le(writer)?;
    let mut keys: Vec<_> = values.keys().copied().collect();
    keys.sort_unstable();
    for key in keys {
        key.write_le(writer)?;
        values
            .get(&key)
            .expect("sorted setup default key should exist")
            .write_le(writer)?;
    }
    Ok(())
}

fn read_kinematics<R: Read + Seek>(reader: &mut R) -> BinResult<MotionCommandKinematics> {
    let flags = u8::read(reader)?;
    let velocity = if (flags & KINEMATICS_HAS_VELOCITY) != 0 {
        Some(Vector3::read_le(reader)?)
    } else {
        None
    };
    let omega = if (flags & KINEMATICS_HAS_OMEGA) != 0 {
        Some(Vector3::read_le(reader)?)
    } else {
        None
    };

    Ok(MotionCommandKinematics { velocity, omega })
}

fn write_kinematics<W: Write + Seek>(
    writer: &mut W,
    kinematics: &MotionCommandKinematics,
) -> BinResult<()> {
    let mut flags = 0u8;
    if kinematics.velocity.is_some() {
        flags |= KINEMATICS_HAS_VELOCITY;
    }
    if kinematics.omega.is_some() {
        flags |= KINEMATICS_HAS_OMEGA;
    }

    flags.write_le(writer)?;
    if let Some(velocity) = kinematics.velocity {
        velocity.write_le(writer)?;
    }
    if let Some(omega) = kinematics.omega {
        omega.write_le(writer)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn motion_kinematics_round_trips_and_preserves_lookup_semantics() {
        let mut asset = MotionKinematics::new();
        asset.setup_model_defaults.insert(0x0200_0011, 0x0900_0011);
        asset.setup_model_defaults.insert(0x0200_0012, 0x0900_0012);

        let mut table = MotionKinematicsTable::new(0x0900_0011, 0x8000_0003);
        table.insert_cycle_kinematics(
            0x8000_0003,
            0x4500_0005,
            MotionCommandKinematics {
                velocity: Some(Vector3::new(1.0, 0.0, 0.0)),
                omega: None,
            },
        );
        table.insert_cycle_kinematics(
            0x8000_0003,
            0x6500_000D,
            MotionCommandKinematics {
                velocity: None,
                omega: Some(Vector3::new(0.0, 0.0, 1.5)),
            },
        );
        asset.motion_tables.insert(table.motion_table_id, table);

        let mut bytes = Cursor::new(Vec::new());
        asset
            .write(&mut bytes)
            .expect("motion kinematics asset should write");
        bytes.set_position(0);

        let decoded =
            MotionKinematics::read(&mut bytes).expect("motion kinematics asset should read");

        assert_eq!(decoded.id, MotionKinematics::FILE_ID);
        assert_eq!(decoded.version, MotionKinematics::VERSION);
        assert_eq!(
            decoded.default_motion_table_for_setup(0x0200_0011),
            Some(0x0900_0011)
        );
        assert_eq!(
            decoded.default_style_for_motion_table(0x0900_0011),
            Some(0x8000_0003)
        );
        assert_eq!(
            decoded
                .cycle_kinematics(0x0900_0011, 0x8000_0003, 0x4500_0005)
                .and_then(|entry| entry.velocity),
            Some(Vector3::new(1.0, 0.0, 0.0))
        );
        assert_eq!(
            decoded
                .cycle_kinematics(0x0900_0011, 0x8000_0003, 0x6500_000D)
                .and_then(|entry| entry.omega),
            Some(Vector3::new(0.0, 0.0, 1.5))
        );
        assert_eq!(
            decoded.cycle_kinematics(0x0900_0011, 0x8000_0003, 0x4400_0007),
            None
        );
    }

    #[test]
    fn motion_kinematics_static_resource_key_uses_core_namespace() {
        assert_eq!(
            MotionKinematics::RESOURCE_KEY.namespace,
            HOLTBURGER_CORE_NAMESPACE
        );
        assert_eq!(
            MotionKinematics::RESOURCE_KEY.file_id,
            MotionKinematics::FILE_ID
        );
    }
}

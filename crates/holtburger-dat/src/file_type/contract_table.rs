//! Retail contract definitions from portal record 0x0E00001D.

use crate::graphics::Frame;
use crate::utils::{align_boundary, read_pstring};
use crate::{EOR_PORTAL_NAMESPACE, ResourceKey, StaticResourceKey};
use binrw::{BinRead, BinResult};
use std::collections::BTreeMap;
use std::io::{Read, Seek};

/// Full authored destination, including interior cell and orientation.
#[derive(Debug, Clone, PartialEq, BinRead)]
#[br(little)]
pub struct ContractPosition {
    /// Authored cell identity; zero means no destination was supplied.
    pub cell_id: u32,
    /// Authored placement within the cell/landblock.
    pub frame: Frame,
}

/// Lossless static definition; runtime interpretation belongs to content/world.
#[derive(Debug, Clone, PartialEq, BinRead)]
#[br(little)]
pub struct ContractDefinition {
    /// Authored definition version; retail reads it without a version branch.
    pub version: u32,
    /// Stable identifier shared with server trackers.
    pub id: u32,
    /// Authored contract name.
    #[br(parse_with = aligned_string)]
    pub name: String,
    /// Authored quest description.
    #[br(parse_with = aligned_string)]
    pub description: String,
    /// Authored counter format, when supplied.
    #[br(parse_with = aligned_string)]
    pub progress_description: String,
    /// Starting contact name.
    #[br(parse_with = aligned_string)]
    pub start_npc: String,
    /// Ending contact name.
    #[br(parse_with = aligned_string)]
    pub end_npc: String,
    /// Quest flag monitored for stamping.
    #[br(parse_with = aligned_string)]
    pub stamped_flag: String,
    /// Quest flag monitored for starting.
    #[br(parse_with = aligned_string)]
    pub started_flag: String,
    /// Quest flag monitored for completion.
    #[br(parse_with = aligned_string)]
    pub finished_flag: String,
    /// Quest flag supplying the progress counter.
    #[br(parse_with = aligned_string)]
    pub progress_flag: String,
    /// Quest flag supplying a deadline.
    #[br(parse_with = aligned_string)]
    pub timer_flag: String,
    /// Quest flag supplying repeat availability.
    #[br(parse_with = aligned_string)]
    pub repeat_flag: String,
    /// Starting contact destination.
    pub start_position: ContractPosition,
    /// Ending contact destination.
    pub end_position: ContractPosition,
    /// Quest-area destination.
    pub area_position: ContractPosition,
}

/// Hash table of static contracts keyed by contract ID.
#[derive(Debug, Clone, PartialEq, BinRead)]
#[br(little)]
pub struct ContractTable {
    /// Portal record identity.
    #[br(assert(id == Self::FILE_ID, "unexpected contract table record ID"))]
    pub id: u32,
    /// Complete definitions, preserving identity despite duplicate names.
    #[br(parse_with = read_contracts)]
    pub contracts: BTreeMap<u32, ContractDefinition>,
}

impl ContractTable {
    /// Canonical portal resource identity.
    pub const FILE_ID: u32 = 0x0E00_001D;
}

impl StaticResourceKey for ContractTable {
    const RESOURCE_KEY: ResourceKey<'static> =
        ResourceKey::new(EOR_PORTAL_NAMESPACE, Self::FILE_ID);
}

fn aligned_string<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<String> {
    let value = read_pstring(reader, 2)?;
    align_boundary(reader, 4)?;
    Ok(value)
}

fn read_contracts<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<BTreeMap<u32, ContractDefinition>> {
    let count = u16::read_le(reader)?;
    let _buckets = u16::read_le(reader)?;
    let mut contracts = BTreeMap::new();
    for _ in 0..count {
        let pos = reader.stream_position()?;
        let key = u32::read_le(reader)?;
        let definition = ContractDefinition::read_le(reader)?;
        if key != definition.id {
            return Err(binrw::Error::AssertFail {
                pos,
                message: "contract table key differs from definition ID".into(),
            });
        }
        if contracts.insert(key, definition).is_some() {
            return Err(binrw::Error::AssertFail {
                pos,
                message: "duplicate contract table ID".into(),
            });
        }
    }
    Ok(contracts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn fixture(ids: &[(u32, u32)]) -> Vec<u8> {
        let mut bytes = ContractTable::FILE_ID.to_le_bytes().to_vec();
        bytes.extend_from_slice(&(ids.len() as u16).to_le_bytes());
        bytes.extend_from_slice(&32u16.to_le_bytes());
        for &(key, id) in ids {
            bytes.extend_from_slice(&key.to_le_bytes());
            bytes.extend_from_slice(&7u32.to_le_bytes());
            bytes.extend_from_slice(&id.to_le_bytes());
            for value in [
                "Same name",
                "Find the target.",
                "%d/20 Tuskers",
                "Fred",
                "Bob",
                "stamp",
                "start",
                "done",
                "count",
                "timer",
                "repeat",
            ] {
                bytes.extend_from_slice(&(value.len() as u16).to_le_bytes());
                bytes.extend_from_slice(value.as_bytes());
                while !bytes.len().is_multiple_of(4) {
                    bytes.push(0);
                }
            }
            for cell in [0xDA550001u32, 0xDA550100, 0] {
                bytes.extend_from_slice(&cell.to_le_bytes());
                for value in [1.0f32, 2.0, 3.0, 1.0, 0.0, 0.0, 0.0] {
                    bytes.extend_from_slice(&value.to_le_bytes());
                }
            }
        }
        bytes
    }

    #[test]
    fn definitions_preserve_duplicate_names_versions_strings_and_positions() {
        let bytes = fixture(&[(1, 1), (2, 2)]);
        let mut cursor = Cursor::new(&bytes);
        let table = ContractTable::read_le(&mut cursor).unwrap();
        assert_eq!(cursor.position(), bytes.len() as u64);
        assert_eq!(table.contracts.len(), 2);
        let definition = &table.contracts[&1];
        assert_eq!(definition.version, 7);
        assert_eq!(definition.progress_description, "%d/20 Tuskers");
        assert_eq!(definition.start_position.cell_id, 0xDA550001);
        assert_eq!(definition.end_position.cell_id, 0xDA550100);
        assert_eq!(definition.area_position.cell_id, 0);
        for end in 0..bytes.len() {
            assert!(ContractTable::read_le(&mut Cursor::new(&bytes[..end])).is_err());
        }
    }

    #[test]
    fn rejects_inconsistent_identity_and_accepts_empty_table() {
        assert!(ContractTable::read_le(&mut Cursor::new(fixture(&[(1, 2)]))).is_err());
        assert!(ContractTable::read_le(&mut Cursor::new(fixture(&[(1, 1), (1, 1)]))).is_err());
        assert!(
            ContractTable::read_le(&mut Cursor::new(fixture(&[])))
                .unwrap()
                .contracts
                .is_empty()
        );
    }
}

use crate::Result;
use binrw::{BinRead, binread, io::Cursor};
use holtburger_common::{Quaternion, Vector3};
use std::collections::HashMap;

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct Frame {
    pub origin: Vector3,
    pub orientation: Quaternion,
}

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct Stab {
    pub id: u32,
    pub frame: Frame,
}

#[binread]
#[derive(Debug, Clone)]
#[br(little)]
pub struct BuildInfo {
    pub model_id: u32,
    pub frame: Frame,
    pub num_leaves: u32,
    #[br(temp)]
    pub num_portals: u32,
    #[br(count = num_portals)]
    pub portals: Vec<PortalInternal>,
}

#[binread]
#[derive(Debug, Clone)]
#[br(little)]
pub struct PortalInternal {
    pub flags: u16,
    pub other_cell_id: u16,
    pub other_portal_id: u16,
    #[br(temp)]
    pub num_stabs: u16,
    #[br(count = num_stabs)]
    pub stab_list: Vec<u16>,
    #[br(pad_after = (4 - ((8 + num_stabs as u64 * 2) % 4)) % 4)]
    pub _align: (),
}

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct CellLandblock {
    pub id: u32,
    pub has_objects: u32, // 1 if true
    #[br(count = 81)]
    pub terrain: Vec<u16>,
    #[br(count = 81)]
    pub height: Vec<u8>,
    #[br(pad_after = (4 - (8 + 81*2 + 81) % 4))]
    pub _align: (),
}

impl CellLandblock {
    pub fn unpack(data: &[u8]) -> Result<Self> {
        let mut cursor = Cursor::new(data);
        let lb = Self::read(&mut cursor)?;
        Ok(lb)
    }

    /// Returns the authored region height-table index at the given vertex.
    ///
    /// `CellLandblock` does not contain enough information to resolve this index to a world-space
    /// height. Callers must use the active `RegionDesc::land_defs.land_height_table`.
    pub fn height_index(&self, x: usize, y: usize) -> Option<u8> {
        self.height.get(x.checked_mul(9)?.checked_add(y)?).copied()
    }
}

#[binread]
#[derive(Debug, Clone)]
#[br(little)]
pub struct LandblockInfo {
    pub id: u32,
    pub num_cells: u32,
    #[br(temp)]
    pub num_objects: u32,
    #[br(count = num_objects)]
    pub objects: Vec<Stab>,
    #[br(temp)]
    pub num_buildings: u16,
    pub pack_mask: u16,
    #[br(count = num_buildings)]
    pub buildings: Vec<BuildInfo>,
    #[br(if(pack_mask & 1 != 0))]
    pub restriction_tables: Option<RestrictionTable>,
}

impl LandblockInfo {
    pub fn unpack(data: &[u8]) -> Result<Self> {
        let mut cursor = Cursor::new(data);
        let info = Self::read(&mut cursor)?;
        Ok(info)
    }
}

#[binread]
#[derive(Debug, Clone)]
#[br(little)]
pub struct RestrictionTable {
    #[br(temp)]
    pub count: u16,
    #[br(temp)]
    pub _bucket_size: u16,
    #[br(count = count)]
    #[br(map = |v: Vec<(u32, u32)>| v.into_iter().collect())]
    pub tables: HashMap<u32, u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn landblock_info_building_portal_count_is_uint32() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x0102fffefu32.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());

        bytes.extend_from_slice(&0x0200_0001u32.to_le_bytes());
        append_identity_frame(&mut bytes);
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());

        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0x0123u16.to_le_bytes());
        bytes.extend_from_slice(&0x0004u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&0x0124u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());

        let info = LandblockInfo::unpack(&bytes).expect("landblock info should decode");

        assert_eq!(info.buildings.len(), 1);
        assert_eq!(info.buildings[0].portals.len(), 1);
        assert_eq!(info.buildings[0].portals[0].stab_list, vec![0x0124]);
    }

    fn append_identity_frame(bytes: &mut Vec<u8>) {
        for value in [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
    }
}

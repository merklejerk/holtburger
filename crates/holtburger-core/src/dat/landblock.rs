use anyhow::Result;
use binrw::{BinRead, binread, io::Cursor};
use glam::{Quat, Vec3};
use std::collections::HashMap;

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct Frame {
    #[br(map = |v: [f32; 3]| Vec3::from_array(v))]
    pub origin: Vec3,
    #[br(map = |q: [f32; 4]| Quat::from_xyzw(q[1], q[2], q[3], q[0]))] // AC storage: W, X, Y, Z
    pub orientation: Quat,
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
    pub num_portals: u16,
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

    /// Returns height at (x, y) vertex in landblock [0, 8]
    pub fn get_height(&self, x: usize, y: usize) -> f32 {
        if x > 8 || y > 8 {
            return 0.0;
        }
        let idx = x * 9 + y;
        self.height[idx] as f32 * 2.0
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

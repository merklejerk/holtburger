use crate::dat::graphics::{CVertexArray, Polygon};
use crate::dat::physics::{BspNode, BspType};
use crate::world::physics_types::Vector3;
use crate::world::properties::GfxObjFlags;
use binrw::{
    BinRead,
    io::{Read, Seek},
};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct GfxObj {
    pub id: u32,
    pub flags: GfxObjFlags,
    pub surfaces: Vec<u32>,
    pub vertex_array: CVertexArray,
    pub physics_polygons: HashMap<u16, Polygon>,
    pub physics_bsp: Option<BspNode>,
    pub sort_center: Vector3,
    pub polygons: HashMap<u16, Polygon>,
    pub drawing_bsp: Option<BspNode>,
    pub did_degrade: Option<u32>,
}

impl GfxObj {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<Self> {
        let id = u32::read_le(reader)?;
        let flags_bits = u32::read_le(reader)?;
        let flags = GfxObjFlags::from_bits_retain(flags_bits);

        // surfaces (SmartArray in ACE)
        let num_surfaces = u32::read_le(reader)?;
        let mut surfaces = Vec::with_capacity(num_surfaces as usize);
        for _ in 0..num_surfaces {
            surfaces.push(u32::read_le(reader)?);
        }

        let vertex_array = CVertexArray::read_le(reader)?;

        let mut physics_polygons = HashMap::new();
        let mut physics_bsp = None;

        if flags.intersects(GfxObjFlags::HAS_PHYSICS) {
            // HasPhysics
            let num_phys_polys = u32::read_le(reader)?;
            for _ in 0..num_phys_polys {
                let pid = u16::read_le(reader)?;
                let poly = Polygon::read_le(reader)?;
                physics_polygons.insert(pid, poly);
            }
            physics_bsp = Some(BspNode::read(reader, BspType::Physics)?);
        }

        let sort_center = Vector3::read_le(reader)?;

        let mut polygons = HashMap::new();
        let mut drawing_bsp = None;

        if flags.intersects(GfxObjFlags::HAS_DRAWING) {
            // HasDrawing
            let num_drawing_polys = u32::read_le(reader)?;
            for _ in 0..num_drawing_polys {
                let pid = u16::read_le(reader)?;
                let poly = Polygon::read_le(reader)?;
                polygons.insert(pid, poly);
            }
            drawing_bsp = Some(BspNode::read(reader, BspType::Drawing)?);
        }

        let mut did_degrade = None;
        if flags.intersects(GfxObjFlags::HAS_DID_DEGRADE) {
            // HasDIDDegrade
            did_degrade = Some(u32::read_le(reader)?);
        }

        Ok(GfxObj {
            id,
            flags,
            surfaces,
            vertex_array,
            physics_polygons,
            physics_bsp,
            sort_center,
            polygons,
            drawing_bsp,
            did_degrade,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_gfx_obj_unpack_minimal() {
        let mut data = Vec::new();
        data.extend_from_slice(&(0x01000001u32).to_le_bytes()); // ID
        data.extend_from_slice(&(0u32).to_le_bytes()); // Flags (No Physics, No Drawing)
        data.extend_from_slice(&(0u32).to_le_bytes()); // Num Surfaces
        data.extend_from_slice(&(1i32).to_le_bytes()); // VertexArray Type
        data.extend_from_slice(&(0u32).to_le_bytes()); // Num Vertices
        data.extend_from_slice(&(0.0f32).to_le_bytes()); // Sort Center X
        data.extend_from_slice(&(0.0f32).to_le_bytes()); // Sort Center Y
        data.extend_from_slice(&(0.0f32).to_le_bytes()); // Sort Center Z

        let mut cursor = Cursor::new(data);
        let obj = GfxObj::unpack(&mut cursor).unwrap();

        assert_eq!(obj.id, 0x01000001);
        assert_eq!(obj.surfaces.len(), 0);
        assert!(obj.physics_bsp.is_none());
    }
}

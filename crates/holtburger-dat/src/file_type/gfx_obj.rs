use crate::graphics::{CVertexArray, Polygon};
use crate::physics::{BspNode, BspType};
use crate::utils::{read_compressed_u32, read_smart_vec, write_compressed_u32};
use binrw::{
    BinRead, BinWrite,
    io::{Read, Seek, Write},
};
use holtburger_common::Vector3;
use holtburger_common::properties::GfxObjFlags;
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

        let surfaces = read_smart_vec(reader, u32::read_le)?;

        let vertex_array = CVertexArray::read_le(reader)?;

        let mut physics_polygons = HashMap::new();
        let mut physics_bsp = None;

        if flags.intersects(GfxObjFlags::HAS_PHYSICS) {
            let num_phys_polys = read_compressed_u32(reader)?;
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
            let num_drawing_polys = read_compressed_u32(reader)?;
            for _ in 0..num_drawing_polys {
                let pid = u16::read_le(reader)?;
                let poly = Polygon::read_le(reader)?;
                polygons.insert(pid, poly);
            }
            drawing_bsp = Some(BspNode::read(reader, BspType::Drawing)?);
        }

        let mut did_degrade = None;
        if flags.intersects(GfxObjFlags::HAS_DID_DEGRADE) {
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

    pub fn pack<W: Write + Seek>(&self, writer: &mut W) -> binrw::BinResult<()> {
        let mut flags = self.flags;

        // Ensure flags are consistent with presence of BSPs
        if self.physics_bsp.is_none() {
            flags.remove(GfxObjFlags::HAS_PHYSICS);
        } else {
            flags.insert(GfxObjFlags::HAS_PHYSICS);
        }

        if self.drawing_bsp.is_none() {
            flags.remove(GfxObjFlags::HAS_DRAWING);
        } else {
            flags.insert(GfxObjFlags::HAS_DRAWING);
        }

        if self.did_degrade.is_none() {
            flags.remove(GfxObjFlags::HAS_DID_DEGRADE);
        } else {
            flags.insert(GfxObjFlags::HAS_DID_DEGRADE);
        }

        self.id.write_le(writer)?;
        flags.bits().write_le(writer)?;

        write_compressed_u32(writer, self.surfaces.len() as u32)?;
        for &surf in &self.surfaces {
            surf.write_le(writer)?;
        }

        self.vertex_array.write_le(writer)?;

        if flags.intersects(GfxObjFlags::HAS_PHYSICS) {
            write_compressed_u32(writer, self.physics_polygons.len() as u32)?;
            let mut keys: Vec<_> = self.physics_polygons.keys().collect();
            keys.sort();
            for &pid in keys {
                pid.write_le(writer)?;
                self.physics_polygons.get(&pid).unwrap().write_le(writer)?;
            }
            if let Some(bsp) = &self.physics_bsp {
                bsp.write(writer, BspType::Physics)?;
            }
        }

        self.sort_center.write_le(writer)?;

        if flags.intersects(GfxObjFlags::HAS_DRAWING) {
            write_compressed_u32(writer, self.polygons.len() as u32)?;
            let mut keys: Vec<_> = self.polygons.keys().collect();
            keys.sort();
            for &pid in keys {
                pid.write_le(writer)?;
                self.polygons.get(&pid).unwrap().write_le(writer)?;
            }
            if let Some(bsp) = &self.drawing_bsp {
                bsp.write(writer, BspType::Drawing)?;
            }
        }

        if flags.intersects(GfxObjFlags::HAS_DID_DEGRADE)
            && let Some(did) = self.did_degrade
        {
            did.write_le(writer)?;
        }

        Ok(())
    }

    /// Prune visual data from this GfxObj, keeping only physics and metadata.
    pub fn prune(&mut self) {
        // 1. Collect vertices used by physics
        let mut physics_vertex_ids = std::collections::HashSet::new();
        for poly in self.physics_polygons.values() {
            for &vid in &poly.vertex_ids {
                if vid >= 0 {
                    physics_vertex_ids.insert(vid as u16);
                }
            }
        }

        // 2. Prune the vertex array
        self.vertex_array.prune(&physics_vertex_ids);

        // 3. Remove drawing data
        self.flags.remove(GfxObjFlags::HAS_DRAWING);
        self.polygons.clear();
        self.drawing_bsp = None;
        // Keep did_degrade for now as it's a small ID
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_gfx_obj_roundtrip() {
        let mut data = Vec::new();
        let mut writer = Cursor::new(&mut data);

        (0x01000001u32).write_le(&mut writer).unwrap(); // ID
        (0u32).write_le(&mut writer).unwrap(); // Flags
        write_compressed_u32(&mut writer, 0).unwrap(); // Num Surfaces
        (1i32).write_le(&mut writer).unwrap(); // VertexArray Type
        (0u32).write_le(&mut writer).unwrap(); // Num Vertices
        (1.0f32).write_le(&mut writer).unwrap(); // Sort Center X
        (2.0f32).write_le(&mut writer).unwrap(); // Sort Center Y
        (3.0f32).write_le(&mut writer).unwrap(); // Sort Center Z

        let mut cursor = Cursor::new(data.clone());
        let obj = GfxObj::unpack(&mut cursor).unwrap();

        let mut out = Vec::new();
        let mut writer = Cursor::new(&mut out);
        obj.pack(&mut writer).unwrap();

        assert_eq!(data, out);
    }

    #[test]
    fn test_gfx_obj_prune() {
        use holtburger_common::properties::GfxObjFlags;

        let mut obj = GfxObj {
            id: 1,
            flags: GfxObjFlags::HAS_DRAWING | GfxObjFlags::HAS_PHYSICS,
            surfaces: vec![],
            vertex_array: CVertexArray {
                vertex_type: 1,
                vertices: HashMap::new(),
            },
            physics_polygons: HashMap::new(),
            physics_bsp: None,
            sort_center: Vector3::zero(),
            polygons: HashMap::from([(
                1,
                Polygon {
                    num_pts: 3,
                    stippling: 0,
                    sides_type: 1,
                    pos_surface: 0,
                    neg_surface: 0,
                    vertex_ids: vec![0, 1, 2],
                    pos_uv_indices: vec![0, 0, 0],
                    neg_uv_indices: vec![0, 0, 0],
                },
            )]),
            drawing_bsp: None, // Simplified for test
            did_degrade: None,
        };

        assert!(obj.flags.contains(GfxObjFlags::HAS_DRAWING));
        assert_eq!(obj.polygons.len(), 1);

        obj.prune();

        assert!(!obj.flags.contains(GfxObjFlags::HAS_DRAWING));
        assert!(obj.flags.contains(GfxObjFlags::HAS_PHYSICS));
        assert_eq!(obj.polygons.len(), 0);
    }
}

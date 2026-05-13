use binrw::{
    BinRead, BinWrite,
    io::{Read, Seek, Write},
};
use holtburger_common::{Quaternion, Vector3};
use std::collections::HashMap;

#[derive(BinRead, BinWrite, Debug, Clone, Default, PartialEq)]
#[br(little)]
#[bw(little)]
pub struct Frame {
    pub origin: Vector3,
    pub orientation: Quaternion,
}

#[derive(BinRead, BinWrite, Debug, Clone)]
#[br(little)]
#[bw(little)]
pub struct SWVertex {
    pub num_uvs: u16,
    pub origin: Vector3,
    pub normal: Vector3,
    #[br(count = num_uvs)]
    pub uvs: Vec<Vec2Duv>,
}

#[derive(BinRead, BinWrite, Debug, Clone, Copy)]
#[br(little)]
#[bw(little)]
pub struct Vec2Duv {
    pub u: f32,
    pub v: f32,
}

#[derive(Debug, Clone)]
pub struct CVertexArray {
    pub vertex_type: i32,
    pub vertices: HashMap<u16, SWVertex>,
}

impl CVertexArray {
    pub fn new() -> Self {
        Self {
            vertex_type: 1,
            vertices: HashMap::new(),
        }
    }
}

impl Default for CVertexArray {
    fn default() -> Self {
        Self::new()
    }
}

impl CVertexArray {
    /// Prune vertex data, keeping only origin points for physics.
    pub fn prune(&mut self, kept_ids: &std::collections::HashSet<u16>) {
        // 1. Remove vertices not used by physics
        self.vertices.retain(|id, _| kept_ids.contains(id));

        // 2. Strip visual bloat from remaining vertices
        for vertex in self.vertices.values_mut() {
            vertex.num_uvs = 0;
            vertex.uvs = Vec::new();
            vertex.normal = Vector3::zero();
        }
    }
}

impl BinRead for CVertexArray {
    type Args<'a> = ();

    fn read_options<R: Read + Seek>(
        reader: &mut R,
        _endian: binrw::Endian,
        _args: Self::Args<'_>,
    ) -> binrw::BinResult<Self> {
        let vertex_type = i32::read_le(reader)?;
        let num_vertices = u32::read_le(reader)?;
        let mut vertices = HashMap::new();

        if vertex_type == 1 {
            for _ in 0..num_vertices {
                let id = u16::read_le(reader)?;
                let vertex = SWVertex::read_le(reader)?;
                vertices.insert(id, vertex);
            }
        }

        Ok(CVertexArray {
            vertex_type,
            vertices,
        })
    }
}

impl BinWrite for CVertexArray {
    type Args<'a> = ();

    fn write_options<W: Write + Seek>(
        &self,
        writer: &mut W,
        _endian: binrw::Endian,
        _args: Self::Args<'_>,
    ) -> binrw::BinResult<()> {
        self.vertex_type.write_le(writer)?;
        (self.vertices.len() as u32).write_le(writer)?;

        if self.vertex_type == 1 {
            // Sort keys for deterministic output
            let mut keys: Vec<_> = self.vertices.keys().collect();
            keys.sort();
            for &id in keys {
                id.write_le(writer)?;
                self.vertices.get(&id).unwrap().write_le(writer)?;
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct Polygon {
    pub num_pts: u8,
    pub stippling: u8,
    pub sides_type: i32,
    pub pos_surface: i16,
    pub neg_surface: i16,
    pub vertex_ids: Vec<u16>,
    pub pos_uv_indices: Vec<u8>,
    pub neg_uv_indices: Vec<u8>,
}

const STIPPLING_NO_POS: u8 = 0x04;
const STIPPLING_NO_NEG: u8 = 0x08;
const CULL_MODE_NONE: i32 = 1;
const CULL_MODE_CLOCKWISE: i32 = 2;

impl BinRead for Polygon {
    type Args<'a> = ();

    fn read_options<R: Read + Seek>(
        reader: &mut R,
        _endian: binrw::Endian,
        _args: Self::Args<'_>,
    ) -> binrw::BinResult<Self> {
        let num_pts = u8::read(reader)?;
        let stippling = u8::read(reader)?;
        let sides_type = i32::read_le(reader)?;
        let pos_surface = i16::read_le(reader)?;
        let neg_surface = i16::read_le(reader)?;

        let mut vertex_ids = Vec::with_capacity(num_pts as usize);
        for _ in 0..num_pts {
            vertex_ids.push(u16::read_le(reader)?);
        }

        let mut pos_uv_indices = Vec::new();
        if (stippling & STIPPLING_NO_POS) == 0 {
            for _ in 0..num_pts {
                pos_uv_indices.push(u8::read(reader)?);
            }
        }

        let mut neg_uv_indices = Vec::new();
        if sides_type == CULL_MODE_CLOCKWISE && (stippling & STIPPLING_NO_NEG) == 0 {
            for _ in 0..num_pts {
                neg_uv_indices.push(u8::read(reader)?);
            }
        }
        let neg_surface = if sides_type == CULL_MODE_NONE {
            pos_surface
        } else {
            neg_surface
        };
        if sides_type == CULL_MODE_NONE {
            neg_uv_indices = pos_uv_indices.clone();
        }

        Ok(Polygon {
            num_pts,
            stippling,
            sides_type,
            pos_surface,
            neg_surface,
            vertex_ids,
            pos_uv_indices,
            neg_uv_indices,
        })
    }
}

impl BinWrite for Polygon {
    type Args<'a> = ();

    fn write_options<W: Write + Seek>(
        &self,
        writer: &mut W,
        _endian: binrw::Endian,
        _args: Self::Args<'_>,
    ) -> binrw::BinResult<()> {
        self.num_pts.write(writer)?;
        self.stippling.write(writer)?;
        self.sides_type.write_le(writer)?;
        self.pos_surface.write_le(writer)?;
        self.neg_surface.write_le(writer)?;

        for &id in &self.vertex_ids {
            id.write_le(writer)?;
        }

        if (self.stippling & STIPPLING_NO_POS) == 0 {
            for &idx in &self.pos_uv_indices {
                idx.write(writer)?;
            }
        }

        if self.sides_type == CULL_MODE_CLOCKWISE && (self.stippling & STIPPLING_NO_NEG) == 0 {
            for &idx in &self.neg_uv_indices {
                idx.write(writer)?;
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use binrw::{BinRead, BinWrite};
    use std::io::{Cursor, Seek};

    #[test]
    fn polygon_reads_no_pos_and_clockwise_neg_uvs_with_retail_stippling_bits() {
        let bytes = [
            3,    // num_pts
            0x04, // NoPos
            2, 0, 0, 0, // Clockwise
            7, 0, // pos_surface
            9, 0, // neg_surface
            0, 0, 1, 0, 2, 0, // vertex ids
            5, 6, 7, // neg UV indices
        ];
        let mut cursor = Cursor::new(bytes);

        let polygon = Polygon::read_le(&mut cursor).expect("polygon should decode");

        assert_eq!(polygon.vertex_ids, vec![0, 1, 2]);
        assert_eq!(polygon.pos_uv_indices, Vec::<u8>::new());
        assert_eq!(polygon.neg_uv_indices, vec![5, 6, 7]);
        assert_eq!(cursor.stream_position().unwrap(), bytes.len() as u64);
    }

    #[test]
    fn polygon_aliases_negative_surface_and_uvs_for_unculled_polygons() {
        let bytes = [
            3, // num_pts
            0, // stippling
            1, 0, 0, 0, // None
            7, 0, // pos_surface
            9, 0, // neg_surface in source, ignored for CullMode.None
            0, 0, 1, 0, 2, 0, // vertex ids
            5, 6, 7, // pos UV indices
        ];
        let mut cursor = Cursor::new(bytes);

        let polygon = Polygon::read_le(&mut cursor).expect("polygon should decode");

        assert_eq!(polygon.pos_surface, 7);
        assert_eq!(polygon.neg_surface, 7);
        assert_eq!(polygon.pos_uv_indices, vec![5, 6, 7]);
        assert_eq!(polygon.neg_uv_indices, vec![5, 6, 7]);
        assert_eq!(cursor.stream_position().unwrap(), bytes.len() as u64);
    }

    #[test]
    fn polygon_writes_using_retail_stippling_and_cull_mode_rules() {
        let polygon = Polygon {
            num_pts: 3,
            stippling: STIPPLING_NO_POS,
            sides_type: CULL_MODE_CLOCKWISE,
            pos_surface: 7,
            neg_surface: 9,
            vertex_ids: vec![0, 1, 2],
            pos_uv_indices: vec![99, 98, 97],
            neg_uv_indices: vec![5, 6, 7],
        };
        let mut cursor = Cursor::new(Vec::new());

        polygon
            .write_le(&mut cursor)
            .expect("polygon should encode");

        assert_eq!(
            cursor.into_inner(),
            vec![3, 0x04, 2, 0, 0, 0, 7, 0, 9, 0, 0, 0, 1, 0, 2, 0, 5, 6, 7,],
        );
    }
}

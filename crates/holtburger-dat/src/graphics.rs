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
    pub vertex_ids: Vec<i16>,
    pub pos_uv_indices: Vec<u8>,
    pub neg_uv_indices: Vec<u8>,
}

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
            vertex_ids.push(i16::read_le(reader)?);
        }

        let mut pos_uv_indices = Vec::new();
        if (stippling & 0x01) == 0 {
            for _ in 0..num_pts {
                pos_uv_indices.push(u8::read(reader)?);
            }
        }

        let mut neg_uv_indices = Vec::new();
        if sides_type == 1 && (stippling & 0x02) == 0 {
            for _ in 0..num_pts {
                neg_uv_indices.push(u8::read(reader)?);
            }
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

        if (self.stippling & 0x01) == 0 {
            for &idx in &self.pos_uv_indices {
                idx.write(writer)?;
            }
        }

        if self.sides_type == 1 && (self.stippling & 0x02) == 0 {
            for &idx in &self.neg_uv_indices {
                idx.write(writer)?;
            }
        }

        Ok(())
    }
}

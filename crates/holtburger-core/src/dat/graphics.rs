use crate::world::physics_types::Vector3;
use binrw::{
    BinRead,
    io::{Read, Seek},
};
use std::collections::HashMap;

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SWVertex {
    pub num_uvs: u16,
    pub origin: Vector3,
    pub normal: Vector3,
    #[br(count = num_uvs)]
    pub uvs: Vec<Vec2Duv>,
}

#[derive(BinRead, Debug, Clone, Copy)]
#[br(little)]
pub struct Vec2Duv {
    pub u: f32,
    pub v: f32,
}

#[derive(Debug, Clone)]
pub struct CVertexArray {
    pub vertex_type: i32,
    pub vertices: HashMap<u16, SWVertex>,
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
        } else {
            // Not implemented or unknown type
        }

        Ok(CVertexArray {
            vertex_type,
            vertices,
        })
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
            // StipplingType.NoPos usually 0x01
            for _ in 0..num_pts {
                pos_uv_indices.push(u8::read(reader)?);
            }
        }

        let mut neg_uv_indices = Vec::new();
        if sides_type == 1 && (stippling & 0x02) == 0 {
            // CullMode.Clockwise, NoNeg check
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

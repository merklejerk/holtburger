use crate::graphics::{CVertexArray, Polygon};
use crate::physics::{BspNode, BspType};
use crate::utils::align_boundary;
use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone)]
pub struct Environment {
    pub id: u32,
    pub cells: BTreeMap<u32, CellStruct>,
}

#[derive(Debug, Clone)]
pub struct CellStruct {
    pub id: u32,
    pub vertex_array: CVertexArray,
    pub polygons: HashMap<u16, Polygon>,
    pub portals: Vec<u16>,
    pub cell_bsp: BspNode,
    pub physics_polygons: HashMap<u16, Polygon>,
    pub physics_bsp: BspNode,
    pub drawing_bsp: Option<BspNode>,
}

impl Environment {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let cell_count = u32::read_le(reader)?;
        let mut cells = BTreeMap::new();

        for _ in 0..cell_count {
            let cell_structure_id = u32::read_le(reader)?;
            let cell = CellStruct::unpack_with_id(reader, cell_structure_id)?;
            cells.insert(cell_structure_id, cell);
        }

        Ok(Environment { id, cells })
    }
}

impl CellStruct {
    fn unpack_with_id<R: Read + Seek>(reader: &mut R, id: u32) -> BinResult<Self> {
        let polygon_count = u32::read_le(reader)?;
        let physics_polygon_count = u32::read_le(reader)?;
        let portal_count = u32::read_le(reader)?;

        let vertex_array = CVertexArray::read_le(reader)?;
        let polygons = read_polygon_map(reader, polygon_count)?;

        let mut portals = Vec::with_capacity(portal_count as usize);
        for _ in 0..portal_count {
            portals.push(u16::read_le(reader)?);
        }
        align_boundary(reader, 4)?;

        let cell_bsp = BspNode::read(reader, BspType::Cell)?;
        let physics_polygons = read_polygon_map(reader, physics_polygon_count)?;
        let physics_bsp = BspNode::read(reader, BspType::Physics)?;

        let has_drawing_bsp = u32::read_le(reader)? != 0;
        let drawing_bsp = if has_drawing_bsp {
            Some(BspNode::read(reader, BspType::Drawing)?)
        } else {
            None
        };
        align_boundary(reader, 4)?;

        Ok(CellStruct {
            id,
            vertex_array,
            polygons,
            portals,
            cell_bsp,
            physics_polygons,
            physics_bsp,
            drawing_bsp,
        })
    }
}

fn read_polygon_map<R: Read + Seek>(
    reader: &mut R,
    polygon_count: u32,
) -> BinResult<HashMap<u16, Polygon>> {
    let mut polygons = HashMap::new();

    for _ in 0..polygon_count {
        let polygon_id = u16::read_le(reader)?;
        let polygon = Polygon::read_le(reader)?;
        polygons.insert(polygon_id, polygon);
    }

    Ok(polygons)
}

#[cfg(test)]
mod tests {
    use super::*;
    use binrw::BinWrite;
    use std::io::{Cursor, Seek, Write};
    #[test]
    fn environment_decodes_empty_cell_structure_body() {
        let cell_structure_id = 0x12u32;
        let mut bytes = Vec::new();
        let mut writer = Cursor::new(&mut bytes);

        0x0D00_0001u32.write_le(&mut writer).unwrap();
        1u32.write_le(&mut writer).unwrap();
        cell_structure_id.write_le(&mut writer).unwrap();

        0u32.write_le(&mut writer).unwrap();
        0u32.write_le(&mut writer).unwrap();
        0u32.write_le(&mut writer).unwrap();
        1i32.write_le(&mut writer).unwrap();
        0u32.write_le(&mut writer).unwrap();

        writer.write_all(b"FAEL").unwrap();
        0i32.write_le(&mut writer).unwrap();

        writer.write_all(b"FAEL").unwrap();
        0i32.write_le(&mut writer).unwrap();
        0i32.write_le(&mut writer).unwrap();
        0f32.write_le(&mut writer).unwrap();
        0f32.write_le(&mut writer).unwrap();
        0f32.write_le(&mut writer).unwrap();
        0f32.write_le(&mut writer).unwrap();
        0u32.write_le(&mut writer).unwrap();

        0u32.write_le(&mut writer).unwrap();

        let mut reader = Cursor::new(bytes);
        let environment = Environment::unpack(&mut reader).unwrap();

        assert_eq!(environment.id, 0x0D00_0001);
        assert_eq!(environment.cells.len(), 1);
        assert_eq!(
            environment.cells.get(&cell_structure_id).unwrap().id,
            cell_structure_id
        );
        assert_eq!(
            reader.stream_position().unwrap(),
            reader.get_ref().len() as u64
        );
    }
}

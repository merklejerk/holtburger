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
    use crate::{
        DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaReader, file_type::EnvCell,
    };
    use binrw::BinWrite;
    use std::io::{Cursor, Seek, Write};
    use std::path::PathBuf;

    fn repo_assets_hba_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dats/assets.hba")
    }

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

    #[test]
    fn environment_parses_repo_fixture_selected_by_env_cell_when_present() {
        let source_path = repo_assets_hba_path();
        if !source_path.is_file() {
            eprintln!(
                "skipping environment fixture test; missing repo-local {}",
                source_path.display()
            );
            return;
        }

        let archive = HbaReader::open(&source_path)
            .expect("repo assets.hba should be a valid HBA v2 fixture");
        let Some((env_cell_id, env_cell, environment)) = find_env_cell_environment_pair(&archive)
        else {
            panic!(
                "repo assets.hba should contain at least one EnvCell with a resolvable Environment"
            );
        };

        let selected_cell_structure_id = u32::from(env_cell.cell_structure);
        let selected_cell_structure = environment
            .cells
            .get(&selected_cell_structure_id)
            .unwrap_or_else(|| {
                panic!(
                    "Environment 0x{:08X} should contain EnvCell 0x{env_cell_id:08X}'s selected CellStruct 0x{selected_cell_structure_id:04X}",
                    environment.id,
                )
            });

        assert_eq!(
            environment.id,
            0x0D00_0000 | u32::from(env_cell.environment_id)
        );
        assert!(!environment.cells.is_empty());
        assert!(
            !selected_cell_structure.polygons.is_empty(),
            "selected CellStruct 0x{selected_cell_structure_id:04X} should expose drawing polygons"
        );
        assert!(
            !selected_cell_structure.vertex_array.vertices.is_empty(),
            "selected CellStruct 0x{selected_cell_structure_id:04X} should expose reusable vertex data"
        );
    }

    fn find_env_cell_environment_pair(archive: &HbaReader) -> Option<(u32, EnvCell, Environment)> {
        for entry in archive
            .entries()
            .collect::<crate::Result<Vec<_>>>()
            .expect("repo assets.hba entries should be readable")
        {
            if entry
                .namespace_id()
                .expect("listed HBA entry should have a valid namespace")
                .as_str()
                != EOR_CELL_NAMESPACE
            {
                continue;
            }
            if DatFileType::from_id(entry.file_id) != DatFileType::IndoorCell {
                continue;
            }

            let env_cell_bytes = archive
                .get_file_in_namespace(EOR_CELL_NAMESPACE, entry.file_id)
                .expect("listed HBA cell entry should be readable");
            let env_cell = EnvCell::unpack(&mut Cursor::new(env_cell_bytes))
                .expect("repo indoor cell fixture should decode as EnvCell");
            if env_cell.environment_id == 0 {
                continue;
            }

            let environment_id = 0x0D00_0000 | u32::from(env_cell.environment_id);
            let Ok(environment_bytes) =
                archive.get_file_in_namespace(EOR_PORTAL_NAMESPACE, environment_id)
            else {
                continue;
            };
            let environment = Environment::unpack(&mut Cursor::new(environment_bytes))
                .expect("repo Environment referenced by an EnvCell should decode");
            if environment
                .cells
                .contains_key(&u32::from(env_cell.cell_structure))
            {
                return Some((entry.file_id, env_cell, environment));
            }
        }

        None
    }
}

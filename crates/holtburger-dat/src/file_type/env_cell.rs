use crate::graphics::Frame;
use binrw::{
    BinRead, BinResult, BinWrite,
    io::{Read, Seek, Write},
};

#[derive(Debug, Clone, BinRead, BinWrite)]
#[br(little)]
#[bw(little)]
pub struct CellPortal {
    pub flags: u16,
    pub other_cell_id: u16,
    pub other_portal_id: u16,
}

#[derive(Debug, Clone, BinRead, BinWrite)]
#[br(little)]
#[bw(little)]
pub struct Stab {
    pub stab_id: u32,
    pub position: Frame,
}

#[derive(Debug, Clone)]
pub struct EnvCell {
    pub id: u32,
    pub flags: u32,
    pub cell_id: u32,
    pub surfaces: Vec<u16>,
    pub environment_id: u16,
    pub cell_structure: u16,
    pub position: Frame,
    pub portals: Vec<CellPortal>,
    pub visible_cells: Vec<u16>,
    pub static_objects: Vec<Stab>,
    pub restriction_obj: Option<u32>,
}

impl EnvCell {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let flags = u32::read_le(reader)?;
        let cell_id = u32::read_le(reader)?;

        let num_surfaces = u8::read(reader)?;
        let num_portals = u8::read(reader)?;
        let num_visible_cells = u16::read_le(reader)?;

        let mut surfaces = Vec::with_capacity(num_surfaces as usize);
        for _ in 0..num_surfaces {
            surfaces.push(u16::read_le(reader)?);
        }

        let environment_id = u16::read_le(reader)?;
        let cell_structure = u16::read_le(reader)?;

        let position = Frame::read_le(reader)?;

        let mut portals = Vec::with_capacity(num_portals as usize);
        for _ in 0..num_portals {
            portals.push(CellPortal::read_le(reader)?);
        }

        let mut visible_cells = Vec::with_capacity(num_visible_cells as usize);
        for _ in 0..num_visible_cells {
            visible_cells.push(u16::read_le(reader)?);
        }

        let mut static_objects = Vec::new();
        if (flags & 0x01) != 0 {
            // HasStaticObjs
            let num_objs = u32::read_le(reader)?;
            for _ in 0..num_objs {
                static_objects.push(Stab::read_le(reader)?);
            }
        }

        let mut restriction_obj = None;
        if (flags & 0x02) != 0 {
            // HasRestrictionObj
            restriction_obj = Some(u32::read_le(reader)?);
        }

        Ok(EnvCell {
            id,
            flags,
            cell_id,
            surfaces,
            environment_id,
            cell_structure,
            position,
            portals,
            visible_cells,
            static_objects,
            restriction_obj,
        })
    }

    pub fn pack<W: Write + Seek>(&self, writer: &mut W) -> BinResult<()> {
        self.id.write_le(writer)?;
        self.flags.write_le(writer)?;
        self.cell_id.write_le(writer)?;

        let num_surfaces = u8::try_from(self.surfaces.len()).map_err(|e| binrw::Error::Custom {
            pos: writer.stream_position().unwrap_or(0),
            err: Box::new(e),
        })?;
        num_surfaces.write_le(writer)?;

        let num_portals = u8::try_from(self.portals.len()).map_err(|e| binrw::Error::Custom {
            pos: writer.stream_position().unwrap_or(0),
            err: Box::new(e),
        })?;
        num_portals.write_le(writer)?;

        let num_visible_cells =
            u16::try_from(self.visible_cells.len()).map_err(|e| binrw::Error::Custom {
                pos: writer.stream_position().unwrap_or(0),
                err: Box::new(e),
            })?;
        num_visible_cells.write_le(writer)?;

        for &surf in &self.surfaces {
            surf.write_le(writer)?;
        }

        self.environment_id.write_le(writer)?;
        self.cell_structure.write_le(writer)?;

        self.position.write_le(writer)?;

        for portal in &self.portals {
            portal.write_le(writer)?;
        }

        for &vis in &self.visible_cells {
            vis.write_le(writer)?;
        }

        if (self.flags & 0x01) != 0 {
            (self.static_objects.len() as u32).write_le(writer)?;
            for obj in &self.static_objects {
                obj.write_le(writer)?;
            }
        }

        if let Some(res) = self.restriction_obj.filter(|_| (self.flags & 0x02) != 0) {
            res.write_le(writer)?;
        }

        Ok(())
    }

    pub fn prune(&mut self) {
        // Surfaces are visual mappings, we can nuke them for lite archives.
        self.surfaces.clear();
        // Static objects are usually decorations, but some might be relevant?
        // For now let's keep them as they are "Stabs" which might be interaction targets.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_env_cell_prune() {
        let mut cell = EnvCell {
            id: 0x01000001,
            flags: 0,
            cell_id: 0x01000001,
            surfaces: vec![1, 2, 3],
            environment_id: 0x0D01,
            cell_structure: 1,
            position: Frame::default(),
            portals: vec![],
            visible_cells: vec![],
            static_objects: vec![],
            restriction_obj: None,
        };

        assert_eq!(cell.surfaces.len(), 3);
        cell.prune();
        assert_eq!(cell.surfaces.len(), 0);

        let mut data = Vec::new();
        let mut writer = Cursor::new(&mut data);
        cell.pack(&mut writer).unwrap();

        let mut reader = Cursor::new(data);
        let unpacked = EnvCell::unpack(&mut reader).unwrap();
        assert_eq!(unpacked.surfaces.len(), 0);
        assert_eq!(unpacked.environment_id, 0x0D01);
    }
}

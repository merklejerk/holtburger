//! Typed 0x11 `GfxObjDegradeInfo` decoding.
//!
//! Retail uses this for distance LOD, but it also carries the **orientation mode** each band draws
//! with (`CPhysicsPart::calc_draw_frame`, acclient.c:319260-319290), which is how a particle mesh
//! declares itself a camera-facing sprite. Layout from ACE `GfxObjDegradeInfo` + `GfxObjInfo`.

use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};

/// How a band orients its mesh at draw time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DegradeOrientation {
    /// Mode 1: keep the authored frame, including any `GR`/`LR` spin.
    Authored,
    /// Mode 2: re-head the draw frame at the viewer. A true camera-facing sprite.
    ViewerFacing,
    /// Modes 3/4/5: viewer alignment locked about x, y, or z.
    AxisLocked(u8),
    /// Any other value; reported rather than assumed.
    Unknown(u32),
}

impl DegradeOrientation {
    fn from_mode(mode: u32) -> Self {
        match mode {
            1 => Self::Authored,
            2 => Self::ViewerFacing,
            3..=5 => Self::AxisLocked(mode as u8),
            other => Self::Unknown(other),
        }
    }
}

/// One authored distance band.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DegradeBand {
    /// Replacement GfxObj drawn in this band.
    pub gfx_obj_id: u32,
    pub orientation: DegradeOrientation,
    pub min_distance: f32,
    pub ideal_distance: f32,
    pub max_distance: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GfxObjDegradeInfo {
    pub id: u32,
    /// Bands in authored order; the first is the nearest.
    pub bands: Vec<DegradeBand>,
}

impl GfxObjDegradeInfo {
    /// Orientation the mesh uses at ordinary viewing distance.
    ///
    /// RETAIL DIVERGENCE: the **first** band, rather than a distance lookup. Retail's LOD system is not
    /// adopted here, so there is no band selection to run; the near band is the authored appearance
    /// and the far bands exist only to degrade it.
    pub fn near_orientation(&self) -> Option<DegradeOrientation> {
        self.bands.first().map(|band| band.orientation)
    }

    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let count = u32::read_le(reader)?;
        let mut bands = Vec::with_capacity(count as usize);
        for _ in 0..count {
            bands.push(DegradeBand {
                gfx_obj_id: u32::read_le(reader)?,
                orientation: DegradeOrientation::from_mode(u32::read_le(reader)?),
                min_distance: f32::read_le(reader)?,
                ideal_distance: f32::read_le(reader)?,
                max_distance: f32::read_le(reader)?,
            });
        }
        Ok(Self { id, bands })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn encode(id: u32, modes: &[u32]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.extend_from_slice(&(modes.len() as u32).to_le_bytes());
        for (index, mode) in modes.iter().enumerate() {
            bytes.extend_from_slice(&(0x0100_0000u32 + index as u32).to_le_bytes());
            bytes.extend_from_slice(&mode.to_le_bytes());
            bytes.extend_from_slice(&0.0f32.to_le_bytes());
            bytes.extend_from_slice(&64.0f32.to_le_bytes());
            bytes.extend_from_slice(&128.0f32.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn reads_bands_and_classifies_orientation() {
        // The shape 5 of 7 measured particle meshes author: viewer-facing near, authored far.
        let info = GfxObjDegradeInfo::read(&mut Cursor::new(encode(0x1100_00FF, &[2, 1])))
            .expect("should parse");

        assert_eq!(info.bands.len(), 2);
        assert_eq!(info.bands[0].orientation, DegradeOrientation::ViewerFacing);
        assert_eq!(info.bands[1].orientation, DegradeOrientation::Authored);
    }

    #[test]
    fn near_orientation_takes_the_first_band_not_a_distance_lookup() {
        let info = GfxObjDegradeInfo::read(&mut Cursor::new(encode(0x1100_0001, &[5, 1, 1])))
            .expect("should parse");
        assert_eq!(
            info.near_orientation(),
            Some(DegradeOrientation::AxisLocked(5))
        );
    }

    #[test]
    fn reports_an_unknown_mode_rather_than_assuming_one() {
        let info = GfxObjDegradeInfo::read(&mut Cursor::new(encode(0x1100_0002, &[99])))
            .expect("should parse");
        assert_eq!(
            info.near_orientation(),
            Some(DegradeOrientation::Unknown(99))
        );
    }
}

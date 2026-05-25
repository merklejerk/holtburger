use std::io::{Read, Seek};

use binrw::{BinRead, BinResult};

use crate::utils::align_boundary;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Palette {
    pub id: u32,
    pub colors_argb: Vec<u32>,
}

impl Palette {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let color_count = u32::read_le(reader)? as usize;
        let mut colors_argb = Vec::with_capacity(color_count);
        for _ in 0..color_count {
            colors_argb.push(u32::read_le(reader)?);
        }

        Ok(Self { id, colors_argb })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormatId {
    Unknown,
    R8G8B8,
    A8R8G8B8,
    X8R8G8B8,
    R5G6B5,
    A4R4G4B4,
    A8,
    P8,
    Index16,
    CustomLandscapeR8G8B8,
    CustomLandscapeAlpha,
    CustomRawJpeg,
    Dxt1,
    Dxt3,
    Dxt5,
    Other(u32),
}

impl PixelFormatId {
    pub fn from_raw(value: u32) -> Self {
        match value {
            0x00 => Self::Unknown,
            0x14 => Self::R8G8B8,
            0x15 => Self::A8R8G8B8,
            0x16 => Self::X8R8G8B8,
            0x17 => Self::R5G6B5,
            0x1A => Self::A4R4G4B4,
            0x1C => Self::A8,
            0x29 => Self::P8,
            0x65 => Self::Index16,
            0xF3 => Self::CustomLandscapeR8G8B8,
            0xF4 => Self::CustomLandscapeAlpha,
            0x1F4 => Self::CustomRawJpeg,
            0x3154_5844 => Self::Dxt1,
            0x3354_5844 => Self::Dxt3,
            0x3554_5844 => Self::Dxt5,
            value => Self::Other(value),
        }
    }

    pub fn raw(self) -> u32 {
        match self {
            Self::Unknown => 0x00,
            Self::R8G8B8 => 0x14,
            Self::A8R8G8B8 => 0x15,
            Self::X8R8G8B8 => 0x16,
            Self::R5G6B5 => 0x17,
            Self::A4R4G4B4 => 0x1A,
            Self::A8 => 0x1C,
            Self::P8 => 0x29,
            Self::Index16 => 0x65,
            Self::CustomLandscapeR8G8B8 => 0xF3,
            Self::CustomLandscapeAlpha => 0xF4,
            Self::CustomRawJpeg => 0x1F4,
            Self::Dxt1 => 0x3154_5844,
            Self::Dxt3 => 0x3354_5844,
            Self::Dxt5 => 0x3554_5844,
            Self::Other(value) => value,
        }
    }

    pub fn is_indexed(self) -> bool {
        matches!(self, Self::P8 | Self::Index16)
    }

    pub fn bytes_per_pixel(self) -> Option<u8> {
        match self {
            Self::R8G8B8 | Self::CustomLandscapeR8G8B8 => Some(3),
            Self::A8R8G8B8 | Self::X8R8G8B8 => Some(4),
            Self::R5G6B5 | Self::A4R4G4B4 | Self::Index16 => Some(2),
            Self::A8 | Self::P8 | Self::CustomLandscapeAlpha => Some(1),
            _ => None,
        }
    }

    pub fn block_compressed_bytes_per_4x4_block(self) -> Option<u8> {
        match self {
            Self::Dxt1 => Some(8),
            Self::Dxt3 | Self::Dxt5 => Some(16),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderSurface {
    pub id: u32,
    pub unknown: i32,
    pub width: u32,
    pub height: u32,
    pub format: PixelFormatId,
    pub format_raw: u32,
    pub source_data: Vec<u8>,
    pub default_palette_id: Option<u32>,
}

impl RenderSurface {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let unknown = i32::read_le(reader)?;
        let width = u32::read_le(reader)?;
        let height = u32::read_le(reader)?;
        let format_raw = u32::read_le(reader)?;
        let data_len = u32::read_le(reader)? as usize;
        let mut source_data = vec![0; data_len];
        reader.read_exact(&mut source_data)?;

        let format = PixelFormatId::from_raw(format_raw);
        let default_palette_id = if format.is_indexed() {
            Some(u32::read_le(reader)?)
        } else {
            None
        };

        Ok(Self {
            id,
            unknown,
            width,
            height,
            format,
            format_raw,
            source_data,
            default_palette_id,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderTexture {
    pub id: u32,
    pub unknown: i32,
    pub texture_type: u8,
    pub render_surface_ids: Vec<u32>,
}

impl RenderTexture {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let unknown = i32::read_le(reader)?;
        let texture_type = u8::read(reader)?;
        let surface_count = u32::read_le(reader)? as usize;
        let mut render_surface_ids = Vec::with_capacity(surface_count);
        for _ in 0..surface_count {
            render_surface_ids.push(u32::read_le(reader)?);
        }

        Ok(Self {
            id,
            unknown,
            texture_type,
            render_surface_ids,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SurfaceType(u32);

impl SurfaceType {
    pub const BASE1_SOLID: Self = Self(0x1);
    pub const BASE1_IMAGE: Self = Self(0x2);
    pub const BASE1_CLIP_MAP: Self = Self(0x4);
    pub const TRANSLUCENT: Self = Self(0x10);
    pub const DIFFUSE: Self = Self(0x20);
    pub const LUMINOUS: Self = Self(0x40);
    pub const ALPHA: Self = Self(0x100);
    pub const INV_ALPHA: Self = Self(0x200);
    pub const ADDITIVE: Self = Self(0x10000);
    pub const DETAIL: Self = Self(0x20000);
    pub const GOURAUD: Self = Self(0x1000_0000);
    pub const STIPPLED: Self = Self(0x4000_0000);
    pub const PERSPECTIVE: Self = Self(0x8000_0000);

    pub fn from_bits(bits: u32) -> Self {
        Self(bits)
    }

    pub fn bits(self) -> u32 {
        self.0
    }

    pub fn contains(self, flag: Self) -> bool {
        (self.0 & flag.0) == flag.0
    }

    pub fn uses_texture(self) -> bool {
        self.contains(Self::BASE1_IMAGE) || self.contains(Self::BASE1_CLIP_MAP)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum CSurfaceSource {
    SolidColor(u32),
    Texture {
        orig_texture_id: u32,
        orig_palette_id: u32,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct CSurface {
    pub surface_type: SurfaceType,
    pub source: CSurfaceSource,
    pub translucency: f32,
    pub luminosity: f32,
    pub diffuse: f32,
}

impl CSurface {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let surface_type = SurfaceType::from_bits(u32::read_le(reader)?);
        let source = if surface_type.uses_texture() {
            CSurfaceSource::Texture {
                orig_texture_id: u32::read_le(reader)?,
                orig_palette_id: u32::read_le(reader)?,
            }
        } else {
            CSurfaceSource::SolidColor(u32::read_le(reader)?)
        };

        Ok(Self {
            surface_type,
            source,
            translucency: f32::read_le(reader)?,
            luminosity: f32::read_le(reader)?,
            diffuse: f32::read_le(reader)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ObjDesc {
    pub palette_id: Option<u32>,
    pub sub_palettes: Vec<SubPalette>,
    pub texture_changes: Vec<TextureMapChange>,
    pub anim_part_changes: Vec<AnimationPartChange>,
}

impl ObjDesc {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        align_boundary(reader, 4)?;

        let marker = u8::read(reader)?;
        if marker != 0x11 {
            return Err(binrw::Error::AssertFail {
                pos: reader.stream_position().unwrap_or(0).saturating_sub(1),
                message: format!("ObjDesc marker must be 0x11, got 0x{marker:02X}"),
            });
        }

        let num_palettes = u8::read(reader)?;
        let num_texture_map_changes = u8::read(reader)?;
        let num_anim_part_changes = u8::read(reader)?;

        let palette_id = if num_palettes > 0 {
            Some(read_known_type_data_id(reader, 0x0400_0000)?)
        } else {
            None
        };

        let mut sub_palettes = Vec::with_capacity(usize::from(num_palettes));
        for _ in 0..num_palettes {
            sub_palettes.push(SubPalette::read(reader)?);
        }

        let mut texture_changes = Vec::with_capacity(usize::from(num_texture_map_changes));
        for _ in 0..num_texture_map_changes {
            add_texture_change_retail(&mut texture_changes, TextureMapChange::read(reader)?);
        }

        let mut anim_part_changes = Vec::with_capacity(usize::from(num_anim_part_changes));
        for _ in 0..num_anim_part_changes {
            add_anim_part_change_retail(&mut anim_part_changes, AnimationPartChange::read(reader)?);
        }

        align_boundary(reader, 4)?;

        Ok(Self {
            palette_id,
            sub_palettes,
            texture_changes,
            anim_part_changes,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SubPalette {
    pub sub_id: u32,
    pub offset: u32,
    pub num_colors: u32,
}

impl SubPalette {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let sub_id = read_known_type_data_id(reader, 0x0400_0000)?;
        let offset = u32::from(u8::read(reader)?) * 8;
        let num_colors = match u8::read(reader)? {
            0 => 256,
            value => u32::from(value),
        } * 8;

        Ok(Self {
            sub_id,
            offset,
            num_colors,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TextureMapChange {
    pub part_index: u8,
    pub old_texture: u32,
    pub new_texture: u32,
}

impl TextureMapChange {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            part_index: u8::read(reader)?,
            old_texture: read_known_type_data_id(reader, 0x0500_0000)?,
            new_texture: read_known_type_data_id(reader, 0x0500_0000)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AnimationPartChange {
    pub part_index: u8,
    pub part_id: u32,
}

impl AnimationPartChange {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            part_index: u8::read(reader)?,
            part_id: read_known_type_data_id(reader, 0x0100_0000)?,
        })
    }
}

fn add_texture_change_retail(changes: &mut Vec<TextureMapChange>, new_change: TextureMapChange) {
    if let Some(index) = changes.iter().position(|change| {
        change.part_index == new_change.part_index && change.old_texture == new_change.old_texture
    }) {
        changes.remove(index);
    }

    if changes.len() < 255 {
        changes.push(new_change);
    }
}

fn add_anim_part_change_retail(
    changes: &mut Vec<AnimationPartChange>,
    new_change: AnimationPartChange,
) {
    if let Some(index) = changes
        .iter()
        .position(|change| change.part_index == new_change.part_index)
    {
        changes.remove(index);
    }

    if changes.len() < 255 {
        changes.push(new_change);
    }
}

fn read_known_type_data_id<R: Read + Seek>(reader: &mut R, known_type: u32) -> BinResult<u32> {
    let value = u16::read_le(reader)?;
    if (value & 0x8000) != 0 {
        let lower = u16::read_le(reader)?;
        let higher = u32::from(value & 0x3FFF) << 16;
        return Ok(known_type + (higher | u32::from(lower)));
    }

    Ok(known_type + u32::from(value))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn parses_palette_argb_table() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x0400_0001u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0xFF11_2233u32.to_le_bytes());
        bytes.extend_from_slice(&0x8044_5566u32.to_le_bytes());

        let palette = Palette::unpack(&mut Cursor::new(bytes)).expect("palette should parse");

        assert_eq!(palette.id, 0x0400_0001);
        assert_eq!(palette.colors_argb, vec![0xFF11_2233, 0x8044_5566]);
    }

    #[test]
    fn parses_direct_color_render_surface() {
        let mut bytes = render_surface_header(0x0600_0001, 2, 2, PixelFormatId::A8R8G8B8.raw(), 4);
        bytes.extend_from_slice(&[1, 2, 3, 4]);

        let surface =
            RenderSurface::unpack(&mut Cursor::new(bytes)).expect("render surface should parse");

        assert_eq!(surface.id, 0x0600_0001);
        assert_eq!(surface.width, 2);
        assert_eq!(surface.height, 2);
        assert_eq!(surface.format, PixelFormatId::A8R8G8B8);
        assert_eq!(surface.default_palette_id, None);
        assert_eq!(surface.source_data, vec![1, 2, 3, 4]);
    }

    #[test]
    fn parses_indexed_render_surface_with_default_palette() {
        let mut bytes = render_surface_header(0x0600_0002, 4, 1, PixelFormatId::P8.raw(), 4);
        bytes.extend_from_slice(&[0, 1, 2, 3]);
        bytes.extend_from_slice(&0x0400_0010u32.to_le_bytes());

        let surface =
            RenderSurface::unpack(&mut Cursor::new(bytes)).expect("render surface should parse");

        assert_eq!(surface.format, PixelFormatId::P8);
        assert_eq!(surface.default_palette_id, Some(0x0400_0010));
    }

    #[test]
    fn parses_render_texture_mip_chain() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x0500_0001u32.to_le_bytes());
        bytes.extend_from_slice(&123i32.to_le_bytes());
        bytes.push(1);
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0x0600_0001u32.to_le_bytes());
        bytes.extend_from_slice(&0x0600_0002u32.to_le_bytes());

        let texture =
            RenderTexture::unpack(&mut Cursor::new(bytes)).expect("render texture should parse");

        assert_eq!(texture.id, 0x0500_0001);
        assert_eq!(texture.unknown, 123);
        assert_eq!(texture.texture_type, 1);
        assert_eq!(texture.render_surface_ids, vec![0x0600_0001, 0x0600_0002]);
    }

    #[test]
    fn parses_solid_csurface() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&SurfaceType::BASE1_SOLID.bits().to_le_bytes());
        bytes.extend_from_slice(&0xFFAA_5500u32.to_le_bytes());
        bytes.extend_from_slice(&0.25f32.to_le_bytes());
        bytes.extend_from_slice(&0.5f32.to_le_bytes());
        bytes.extend_from_slice(&0.75f32.to_le_bytes());

        let surface = CSurface::unpack(&mut Cursor::new(bytes)).expect("CSurface should parse");

        assert_eq!(surface.source, CSurfaceSource::SolidColor(0xFFAA_5500));
        assert_eq!(surface.translucency, 0.25);
        assert_eq!(surface.luminosity, 0.5);
        assert_eq!(surface.diffuse, 0.75);
    }

    #[test]
    fn parses_textured_csurface_without_palette() {
        let surface = parse_textured_csurface(0);

        assert_eq!(
            surface.source,
            CSurfaceSource::Texture {
                orig_texture_id: 0x0500_0001,
                orig_palette_id: 0
            }
        );
    }

    #[test]
    fn parses_textured_csurface_with_palette() {
        let surface = parse_textured_csurface(0x0400_0001);

        assert_eq!(
            surface.source,
            CSurfaceSource::Texture {
                orig_texture_id: 0x0500_0001,
                orig_palette_id: 0x0400_0001
            }
        );
    }

    #[test]
    fn obj_desc_rejects_invalid_marker() {
        let bytes = vec![0x10, 0, 0, 0];

        let error = ObjDesc::unpack(&mut Cursor::new(bytes)).expect_err("marker should reject");

        assert!(error.to_string().contains("ObjDesc marker"));
    }

    #[test]
    fn obj_desc_applies_retail_texture_change_dedup() {
        let mut bytes = vec![0x11, 0, 3, 0];
        push_texture_change(&mut bytes, 2, 0x0500_0001, 0x0500_0002);
        push_texture_change(&mut bytes, 2, 0x0500_0001, 0x0500_0003);
        push_texture_change(&mut bytes, 2, 0x0500_0004, 0x0500_0005);
        pad_4(&mut bytes);

        let obj_desc = ObjDesc::unpack(&mut Cursor::new(bytes)).expect("ObjDesc should parse");

        assert_eq!(
            obj_desc.texture_changes,
            vec![
                TextureMapChange {
                    part_index: 2,
                    old_texture: 0x0500_0001,
                    new_texture: 0x0500_0003,
                },
                TextureMapChange {
                    part_index: 2,
                    old_texture: 0x0500_0004,
                    new_texture: 0x0500_0005,
                },
            ]
        );
    }

    #[test]
    fn pixel_format_metadata_covers_initial_renderer_formats() {
        assert_eq!(PixelFormatId::A8R8G8B8.bytes_per_pixel(), Some(4));
        assert_eq!(PixelFormatId::R8G8B8.bytes_per_pixel(), Some(3));
        assert_eq!(PixelFormatId::R5G6B5.bytes_per_pixel(), Some(2));
        assert_eq!(PixelFormatId::A4R4G4B4.bytes_per_pixel(), Some(2));
        assert_eq!(PixelFormatId::P8.bytes_per_pixel(), Some(1));
        assert_eq!(PixelFormatId::Index16.bytes_per_pixel(), Some(2));
        assert_eq!(PixelFormatId::A8.bytes_per_pixel(), Some(1));
        assert_eq!(
            PixelFormatId::Dxt1.block_compressed_bytes_per_4x4_block(),
            Some(8)
        );
        assert_eq!(
            PixelFormatId::Dxt3.block_compressed_bytes_per_4x4_block(),
            Some(16)
        );
        assert_eq!(
            PixelFormatId::Dxt5.block_compressed_bytes_per_4x4_block(),
            Some(16)
        );
    }

    fn render_surface_header(
        id: u32,
        width: u32,
        height: u32,
        format: u32,
        source_len: u32,
    ) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.extend_from_slice(&0i32.to_le_bytes());
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.extend_from_slice(&format.to_le_bytes());
        bytes.extend_from_slice(&source_len.to_le_bytes());
        bytes
    }

    fn parse_textured_csurface(orig_palette_id: u32) -> CSurface {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&SurfaceType::BASE1_IMAGE.bits().to_le_bytes());
        bytes.extend_from_slice(&0x0500_0001u32.to_le_bytes());
        bytes.extend_from_slice(&orig_palette_id.to_le_bytes());
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&1.0f32.to_le_bytes());

        CSurface::unpack(&mut Cursor::new(bytes)).expect("CSurface should parse")
    }

    fn push_texture_change(
        bytes: &mut Vec<u8>,
        part_index: u8,
        old_texture: u32,
        new_texture: u32,
    ) {
        bytes.push(part_index);
        push_known_type_data_id(bytes, old_texture, 0x0500_0000);
        push_known_type_data_id(bytes, new_texture, 0x0500_0000);
    }

    fn push_known_type_data_id(bytes: &mut Vec<u8>, data_id: u32, known_type: u32) {
        let relative = data_id
            .checked_sub(known_type)
            .expect("test data id should match known type");
        if relative < 0x8000 {
            bytes.extend_from_slice(&(relative as u16).to_le_bytes());
        } else {
            let high = 0x8000 | ((relative >> 16) as u16 & 0x3FFF);
            bytes.extend_from_slice(&high.to_le_bytes());
            bytes.extend_from_slice(&(relative as u16).to_le_bytes());
        }
    }

    fn pad_4(bytes: &mut Vec<u8>) {
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
    }
}

use std::collections::BTreeMap;
use std::fmt;
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaletteSet {
    pub id: u32,
    pub palette_ids: Vec<u32>,
}

impl PaletteSet {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let palette_ids = read_u32_list_i32_len(reader)?;

        Ok(Self { id, palette_ids })
    }

    pub fn palette_id_for_shade(&self, shade: f64) -> Option<u32> {
        if self.palette_ids.is_empty() || !(0.0..=1.0).contains(&shade) {
            return None;
        }

        let index = (((self.palette_ids.len() as f64) - 0.000001) * shade) as usize;
        self.palette_ids.get(index).copied()
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
pub struct SurfaceTexture {
    pub id: u32,
    pub unknown: i32,
    pub texture_type: u8,
    pub render_surface_ids: Vec<u32>,
}

impl SurfaceTexture {
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
    pub fn empty() -> Self {
        Self {
            palette_id: None,
            sub_palettes: Vec::new(),
            texture_changes: Vec::new(),
            anim_part_changes: Vec::new(),
        }
    }

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClothingTable {
    pub id: u32,
    pub clothing_bases: BTreeMap<u32, ClothingBase>,
    pub palette_templates: BTreeMap<u32, CloPaletteTemplate>,
}

impl ClothingTable {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let clothing_bases = read_packed_hash_table(reader, ClothingBase::read)?;
        let palette_templates = read_packed_hash_table(reader, CloPaletteTemplate::read)?;

        Ok(Self {
            id,
            clothing_bases,
            palette_templates,
        })
    }

    /// Coverage this clothing paints on one setup, used to order worn layers.
    ///
    /// Mirrors ACE's `ClothingTable.GetVisualPriority`: each covered body part contributes its
    /// coverage bit, and a setup this clothing does not dress yields `None`. Parts outside the
    /// human body map (mounts, banners) contribute nothing, exactly as ACE's default arm does.
    pub fn visual_coverage(&self, setup_model_id: u32) -> Option<ClothingCoverage> {
        let base = self.clothing_bases.get(&setup_model_id)?;
        let mut coverage = ClothingCoverage::empty();
        for effect in &base.object_effects {
            coverage |= match effect.part_num {
                0 => ClothingCoverage::OUTERWEAR_ABDOMEN,
                1 | 5 => ClothingCoverage::OUTERWEAR_UPPER_LEGS,
                2 | 6 => ClothingCoverage::OUTERWEAR_LOWER_LEGS,
                3 | 4 | 7 | 8 => ClothingCoverage::FEET,
                9 => ClothingCoverage::OUTERWEAR_CHEST,
                10 | 13 => ClothingCoverage::OUTERWEAR_UPPER_ARMS,
                11 | 14 => ClothingCoverage::OUTERWEAR_LOWER_ARMS,
                12 | 15 => ClothingCoverage::HANDS,
                16 => ClothingCoverage::HEAD,
                _ => ClothingCoverage::empty(),
            };
        }
        Some(coverage)
    }

    pub fn build_obj_desc<F>(
        &self,
        setup_model_id: u32,
        palette_template_key: u32,
        shade: f64,
        mut palette_set_resolver: F,
    ) -> Result<ObjDesc, ClothingBuildObjDescError>
    where
        F: FnMut(u32, f64) -> Result<u32, ClothingBuildObjDescError>,
    {
        let mut obj_desc = ObjDesc::empty();
        let clothing_base_id = resolve_clothing_base_setup_id(setup_model_id);
        let clothing_base = self.clothing_bases.get(&clothing_base_id).ok_or(
            ClothingBuildObjDescError::MissingClothingBase {
                setup_model_id,
                resolved_setup_model_id: clothing_base_id,
            },
        )?;

        apply_part_and_texture_changes(clothing_base, &mut obj_desc)?;

        if palette_template_key == 0 {
            return Ok(obj_desc);
        }

        let palette_template = self.palette_templates.get(&palette_template_key).ok_or(
            ClothingBuildObjDescError::MissingPaletteTemplate {
                palette_template_key,
            },
        )?;

        for subpal_effect in &palette_template.subpal_effects {
            let selected_palette_id = palette_set_resolver(subpal_effect.palette_set_id, shade)?;
            for range in &subpal_effect.ranges {
                add_sub_palette_retail(
                    &mut obj_desc.sub_palettes,
                    SubPalette {
                        sub_id: selected_palette_id,
                        offset: range.offset,
                        num_colors: range.num_colors,
                    },
                );
            }
        }

        Ok(obj_desc)
    }
}

bitflags::bitflags! {
    /// Body coverage a clothing table paints, mirroring ACE's `CoverageMask` outerwear bits.
    ///
    /// Only the bits `GetVisualPriority` can produce are modelled; underwear and unknown bits
    /// exist in ACE's enum but are never derived from clothing-base coverage.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
    pub struct ClothingCoverage: u32 {
        const OUTERWEAR_UPPER_LEGS = 0x0000_0100;
        const OUTERWEAR_LOWER_LEGS = 0x0000_0200;
        const OUTERWEAR_CHEST = 0x0000_0400;
        const OUTERWEAR_ABDOMEN = 0x0000_0800;
        const OUTERWEAR_UPPER_ARMS = 0x0000_1000;
        const OUTERWEAR_LOWER_ARMS = 0x0000_2000;
        const HEAD = 0x0000_4000;
        const HANDS = 0x0000_8000;
        const FEET = 0x0001_0000;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClothingBase {
    pub object_effects: Vec<CloObjectEffect>,
}

impl ClothingBase {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            object_effects: read_packable_vec(reader, CloObjectEffect::read)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloObjectEffect {
    pub part_num: u32,
    pub object_id: u32,
    pub texture_effects: Vec<CloTextureEffect>,
}

impl CloObjectEffect {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            part_num: u32::read_le(reader)?,
            object_id: u32::read_le(reader)?,
            texture_effects: read_packable_vec(reader, CloTextureEffect::read)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloTextureEffect {
    pub old_texture: u32,
    pub new_texture: u32,
}

impl CloTextureEffect {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            old_texture: u32::read_le(reader)?,
            new_texture: u32::read_le(reader)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloPaletteTemplate {
    pub icon_id: u32,
    pub subpal_effects: Vec<CloSubpalEffect>,
}

impl CloPaletteTemplate {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            icon_id: u32::read_le(reader)?,
            subpal_effects: read_packable_vec(reader, CloSubpalEffect::read)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloSubpalEffect {
    pub ranges: Vec<CloSubpaletteRange>,
    pub palette_set_id: u32,
}

impl CloSubpalEffect {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            ranges: read_packable_vec(reader, CloSubpaletteRange::read)?,
            palette_set_id: u32::read_le(reader)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloSubpaletteRange {
    pub offset: u32,
    pub num_colors: u32,
}

impl CloSubpaletteRange {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            offset: u32::read_le(reader)?,
            num_colors: u32::read_le(reader)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ClothingBuildObjDescError {
    MissingClothingBase {
        setup_model_id: u32,
        resolved_setup_model_id: u32,
    },
    MissingPaletteTemplate {
        palette_template_key: u32,
    },
    MissingPaletteSet {
        palette_set_id: u32,
    },
    InvalidPaletteSet {
        palette_set_id: u32,
        message: String,
    },
    InvalidPaletteShade {
        palette_set_id: u32,
        shade: f64,
    },
    PartIndexOutOfRange {
        part_num: u32,
    },
    InvalidTextureEffect {
        part_num: u32,
        old_texture: u32,
        new_texture: u32,
    },
}

impl fmt::Display for ClothingBuildObjDescError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingClothingBase {
                setup_model_id,
                resolved_setup_model_id,
            } => write!(
                formatter,
                "missing ClothingBase for setup 0x{setup_model_id:08X} resolved to 0x{resolved_setup_model_id:08X}"
            ),
            Self::MissingPaletteTemplate {
                palette_template_key,
            } => write!(
                formatter,
                "missing clothing palette template {palette_template_key}"
            ),
            Self::MissingPaletteSet { palette_set_id } => {
                write!(formatter, "missing PaletteSet 0x{palette_set_id:08X}")
            }
            Self::InvalidPaletteSet {
                palette_set_id,
                message,
            } => write!(
                formatter,
                "invalid PaletteSet 0x{palette_set_id:08X}: {message}"
            ),
            Self::InvalidPaletteShade {
                palette_set_id,
                shade,
            } => write!(
                formatter,
                "PaletteSet 0x{palette_set_id:08X} cannot select shade {shade}"
            ),
            Self::PartIndexOutOfRange { part_num } => {
                write!(
                    formatter,
                    "clothing part index {part_num} exceeds ObjDesc byte range"
                )
            }
            Self::InvalidTextureEffect {
                part_num,
                old_texture,
                new_texture,
            } => write!(
                formatter,
                "clothing part {part_num} has invalid texture effect 0x{old_texture:08X} -> 0x{new_texture:08X}"
            ),
        }
    }
}

impl std::error::Error for ClothingBuildObjDescError {}

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

fn add_sub_palette_retail(sub_palettes: &mut Vec<SubPalette>, new_sub_palette: SubPalette) {
    if sub_palettes
        .iter()
        .any(|existing| sub_palette_supercedes(existing, &new_sub_palette))
    {
        return;
    }

    sub_palettes.retain(|existing| !sub_palette_replaces(&new_sub_palette, existing));

    if sub_palettes.len() < 255 {
        sub_palettes.push(new_sub_palette);
    }
}

fn sub_palette_replaces(new_sub_palette: &SubPalette, existing: &SubPalette) -> bool {
    (new_sub_palette.offset == existing.offset && new_sub_palette.num_colors == existing.num_colors)
        || (new_sub_palette.offset == 0 && new_sub_palette.num_colors == 2048)
}

fn sub_palette_supercedes(existing: &SubPalette, new_sub_palette: &SubPalette) -> bool {
    existing.offset == 0
        && existing.num_colors == 2048
        && (new_sub_palette.offset != 0 || new_sub_palette.num_colors != 2048)
}

fn apply_part_and_texture_changes(
    clothing_base: &ClothingBase,
    obj_desc: &mut ObjDesc,
) -> Result<(), ClothingBuildObjDescError> {
    for object_effect in &clothing_base.object_effects {
        let part_index = u8::try_from(object_effect.part_num).map_err(|_| {
            ClothingBuildObjDescError::PartIndexOutOfRange {
                part_num: object_effect.part_num,
            }
        })?;
        add_anim_part_change_retail(
            &mut obj_desc.anim_part_changes,
            AnimationPartChange {
                part_index,
                part_id: object_effect.object_id,
            },
        );
        for texture_effect in &object_effect.texture_effects {
            if texture_effect.old_texture == 0 || texture_effect.new_texture == 0 {
                return Err(ClothingBuildObjDescError::InvalidTextureEffect {
                    part_num: object_effect.part_num,
                    old_texture: texture_effect.old_texture,
                    new_texture: texture_effect.new_texture,
                });
            }
            add_texture_change_retail(
                &mut obj_desc.texture_changes,
                TextureMapChange {
                    part_index,
                    old_texture: texture_effect.old_texture,
                    new_texture: texture_effect.new_texture,
                },
            );
        }
    }

    Ok(())
}

fn resolve_clothing_base_setup_id(setup_model_id: u32) -> u32 {
    match setup_model_id {
        0x0200_196F | 0x0200_1972 | 0x0200_1A5F | 0x0200_1A6F => 0x0200_196F,
        0x0200_1970 | 0x0200_1A5E | 0x0200_1A6E => 0x0200_1970,
        0x0200_196E | 0x0200_1971 | 0x0200_1A5D | 0x0200_1A70 => 0x0200_196E,
        0x0200_196D | 0x0200_1A5C | 0x0200_1A71 => 0x0200_196D,
        0x0200_1A0F | 0x0200_1A9C | 0x0200_1A9E | 0x0200_1A9D | 0x0200_1A96 => 0x0200_1A0E,
        0x0200_1A0D | 0x0200_1AA0 | 0x0200_1A9F | 0x0200_1AA1 | 0x0200_1AA2 => 0x0200_1A0C,
        0x0200_1AA3 => 0x0200_0001,
        0x0200_1AA4 => 0x0200_004E,
        _ => setup_model_id,
    }
}

fn read_packed_hash_table<R, T, F>(reader: &mut R, mut read_value: F) -> BinResult<BTreeMap<u32, T>>
where
    R: Read + Seek,
    F: FnMut(&mut R) -> BinResult<T>,
{
    let entry_count = u16::read_le(reader)? as usize;
    let _bucket_count = u16::read_le(reader)?;
    let mut entries = BTreeMap::new();

    for _ in 0..entry_count {
        let key = u32::read_le(reader)?;
        let value = read_value(reader)?;
        if entries.insert(key, value).is_some() {
            return Err(binrw::Error::AssertFail {
                pos: reader.stream_position().unwrap_or(0),
                message: format!("packed hash table contains duplicate key 0x{key:08X}"),
            });
        }
    }

    Ok(entries)
}

fn read_packable_vec<R, T, F>(reader: &mut R, mut read_value: F) -> BinResult<Vec<T>>
where
    R: Read + Seek,
    F: FnMut(&mut R) -> BinResult<T>,
{
    let entry_count = u32::read_le(reader)? as usize;
    let mut values = Vec::with_capacity(entry_count);
    for _ in 0..entry_count {
        values.push(read_value(reader)?);
    }
    Ok(values)
}

fn read_u32_list_i32_len<R: Read + Seek>(reader: &mut R) -> BinResult<Vec<u32>> {
    let entry_count = i32::read_le(reader)?;
    if entry_count < 0 {
        return Err(binrw::Error::AssertFail {
            pos: reader.stream_position().unwrap_or(0).saturating_sub(4),
            message: format!("list length must be non-negative, got {entry_count}"),
        });
    }

    let mut values = Vec::with_capacity(entry_count as usize);
    for _ in 0..entry_count {
        values.push(u32::read_le(reader)?);
    }
    Ok(values)
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
    fn palette_set_selects_shade_with_retail_epsilon() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x0F00_0001u32.to_le_bytes());
        bytes.extend_from_slice(&3i32.to_le_bytes());
        bytes.extend_from_slice(&0x0400_0001u32.to_le_bytes());
        bytes.extend_from_slice(&0x0400_0002u32.to_le_bytes());
        bytes.extend_from_slice(&0x0400_0003u32.to_le_bytes());

        let palette_set =
            PaletteSet::unpack(&mut Cursor::new(bytes)).expect("palette set should parse");

        assert_eq!(palette_set.palette_id_for_shade(0.0), Some(0x0400_0001));
        assert_eq!(palette_set.palette_id_for_shade(0.5), Some(0x0400_0002));
        assert_eq!(palette_set.palette_id_for_shade(1.0), Some(0x0400_0003));
        assert_eq!(palette_set.palette_id_for_shade(-0.1), None);
    }

    #[test]
    fn clothing_table_builds_obj_desc_from_part_texture_and_palette_effects() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x1000_0001u32.to_le_bytes());
        push_packed_hash_header(&mut bytes, 1);
        bytes.extend_from_slice(&0x0200_0030u32.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0x0100_0032u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0x0500_0030u32.to_le_bytes());
        bytes.extend_from_slice(&0x0500_0031u32.to_le_bytes());
        bytes.extend_from_slice(&0x0500_0030u32.to_le_bytes());
        bytes.extend_from_slice(&0x0500_0032u32.to_le_bytes());
        push_packed_hash_header(&mut bytes, 1);
        bytes.extend_from_slice(&7u32.to_le_bytes());
        bytes.extend_from_slice(&0x0600_1000u32.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&0x0F00_0001u32.to_le_bytes());

        let clothing_table =
            ClothingTable::unpack(&mut Cursor::new(bytes)).expect("clothing table should parse");
        let obj_desc = clothing_table
            .build_obj_desc(0x0200_0030, 7, 0.5, |palette_set_id, shade| {
                assert_eq!(palette_set_id, 0x0F00_0001);
                assert_eq!(shade, 0.5);
                Ok(0x0400_0002)
            })
            .expect("clothing table should build ObjDesc");

        assert_eq!(
            obj_desc.anim_part_changes,
            vec![AnimationPartChange {
                part_index: 2,
                part_id: 0x0100_0032
            }]
        );
        assert_eq!(
            obj_desc.texture_changes,
            vec![TextureMapChange {
                part_index: 2,
                old_texture: 0x0500_0030,
                new_texture: 0x0500_0032
            }]
        );
        assert_eq!(
            obj_desc.sub_palettes,
            vec![
                SubPalette {
                    sub_id: 0x0400_0002,
                    offset: 0,
                    num_colors: 16
                },
                SubPalette {
                    sub_id: 0x0400_0002,
                    offset: 16,
                    num_colors: 16
                }
            ]
        );
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
    fn parses_surface_texture_source_level_list() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x0500_0001u32.to_le_bytes());
        bytes.extend_from_slice(&123i32.to_le_bytes());
        bytes.push(1);
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0x0600_0001u32.to_le_bytes());
        bytes.extend_from_slice(&0x0600_0002u32.to_le_bytes());

        let texture =
            SurfaceTexture::unpack(&mut Cursor::new(bytes)).expect("surface texture should parse");

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

    fn push_packed_hash_header(bytes: &mut Vec<u8>, count: u16) {
        bytes.extend_from_slice(&count.to_le_bytes());
        bytes.extend_from_slice(&count.to_le_bytes());
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

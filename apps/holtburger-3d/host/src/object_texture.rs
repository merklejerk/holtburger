//! App-local object texture normalization.
//!
//! Renderer roles and palette layout remain app-local; pure source conversion is shared.

use anyhow::{Context, Result};
use holtburger_content::render_surface_pixels::{decode_direct_color, require_uncompressed_length};
use holtburger_dat::file_type::{Palette, PixelFormatId, RenderSurface};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ObjectTexturePurpose {
    DirectColor,
    Index8,
    Index16,
    Detail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PreparedObjectTextureFormat {
    Rgba8,
    R8,
    Rg8,
}

impl PreparedObjectTextureFormat {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Rgba8 => "rgba8",
            Self::R8 => "r8",
            Self::Rg8 => "rg8",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PreparedObjectTexture {
    pub(crate) format: PreparedObjectTextureFormat,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) pixels: Vec<u8>,
}

/// Convert one selected source level into the exact presentation encoding for its object role.
pub(crate) fn prepare_object_surface(
    surface: &RenderSurface,
    purpose: ObjectTexturePurpose,
) -> Result<PreparedObjectTexture> {
    let (format, pixels) = match purpose {
        ObjectTexturePurpose::DirectColor | ObjectTexturePurpose::Detail => (
            PreparedObjectTextureFormat::Rgba8,
            decode_direct_color(surface)?,
        ),
        ObjectTexturePurpose::Index8 => {
            require_uncompressed_length(surface, PixelFormatId::P8)?;
            (PreparedObjectTextureFormat::R8, surface.source_data.clone())
        }
        ObjectTexturePurpose::Index16 => {
            require_uncompressed_length(surface, PixelFormatId::Index16)?;
            (
                PreparedObjectTextureFormat::Rg8,
                surface.source_data.clone(),
            )
        }
    };
    Ok(PreparedObjectTexture {
        format,
        width: surface.width,
        height: surface.height,
        pixels,
    })
}

/// Normalize one authored palette as a square RGBA lookup texture.
///
/// All indexed roles share the full authored palette; index8 sampling naturally remains below 256.
/// Padding preserves a regular two-dimensional lookup without changing authored entries.
pub(crate) fn prepare_object_palette(palette: &Palette) -> Result<PreparedObjectTexture> {
    let color_count = palette.colors_argb.len().max(1);
    let (width, height) = square_dimensions_for_color_count(color_count)?;
    let texture_color_count = usize::try_from(width)
        .expect("palette width fits usize")
        .checked_mul(usize::try_from(height).expect("palette height fits usize"))
        .context("palette square pixel count fits usize")?;
    let pixel_byte_count = texture_color_count
        .checked_mul(4)
        .context("palette rgba byte count fits usize")?;
    let mut pixels = Vec::with_capacity(pixel_byte_count);
    for color in palette.colors_argb.iter().copied().take(color_count) {
        pixels.extend_from_slice(&argb_to_rgba(color));
    }
    pixels.resize(pixel_byte_count, 0);
    Ok(PreparedObjectTexture {
        format: PreparedObjectTextureFormat::Rgba8,
        width,
        height,
        pixels,
    })
}

/// Return the smallest square whose texels can hold every authored palette entry.
fn square_dimensions_for_color_count(color_count: usize) -> Result<(u32, u32)> {
    let color_count = u32::try_from(color_count).context("palette color count fits u32")?;
    let mut side = 1_u32;
    while side.saturating_mul(side) < color_count {
        side = side
            .checked_add(1)
            .context("palette square side fits u32")?;
    }
    Ok((side, side))
}

fn argb_to_rgba(color: u32) -> [u8; 4] {
    [
        ((color >> 16) & 0xff) as u8,
        ((color >> 8) & 0xff) as u8,
        (color & 0xff) as u8,
        ((color >> 24) & 0xff) as u8,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn surface(format: PixelFormatId, bytes: Vec<u8>) -> RenderSurface {
        RenderSurface {
            id: 0x0600_0001,
            unknown: 0,
            width: 4,
            height: 4,
            format,
            format_raw: format.raw(),
            source_data: bytes,
            default_palette_id: None,
        }
    }

    #[test]
    fn decodes_dxt1_channel_order_and_transparency() {
        let mut bytes = Vec::new();
        bytes.extend(0x001f_u16.to_le_bytes());
        bytes.extend(0xf800_u16.to_le_bytes());
        bytes.extend(3_u32.to_le_bytes());
        let prepared = prepare_object_surface(
            &surface(PixelFormatId::Dxt1, bytes),
            ObjectTexturePurpose::DirectColor,
        )
        .expect("DXT1 should decode");
        assert_eq!(prepared.format, PreparedObjectTextureFormat::Rgba8);
        assert_eq!(&prepared.pixels[..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn preserves_index16_bytes_as_rg8() {
        let prepared = prepare_object_surface(
            &surface(PixelFormatId::Index16, [1_u8, 2].repeat(16)),
            ObjectTexturePurpose::Index16,
        )
        .expect("index16 should prepare");
        assert_eq!(prepared.format, PreparedObjectTextureFormat::Rg8);
        assert_eq!(prepared.pixels.len(), 32);
    }

    #[test]
    fn produces_a_square_palette_in_rgba_order() {
        let prepared = prepare_object_palette(&Palette {
            id: 0x0400_0001,
            colors_argb: vec![0x7f11_2233],
        })
        .expect("palette should prepare");
        assert_eq!((prepared.width, prepared.height), (1, 1));
        assert_eq!(prepared.pixels, vec![0x11, 0x22, 0x33, 0x7f]);
    }

    #[test]
    fn preserves_the_complete_authored_palette_with_square_padding() {
        let prepared = prepare_object_palette(&Palette {
            id: 0x0400_0001,
            colors_argb: vec![0xff00_0000; 2_048],
        })
        .expect("palette should prepare");
        assert_eq!((prepared.width, prepared.height), (46, 46));
        assert_eq!(prepared.pixels.len(), 46 * 46 * 4);
        assert_eq!(&prepared.pixels[(2_048 * 4)..(2_049 * 4)], &[0, 0, 0, 0]);
    }
}

//! App-local object texture normalization.
//!
//! This deliberately lives beside the 3D host instead of `holtburger-content`: the output
//! channels are an explorer renderer presentation decision, while DAT decoding remains shared.

use anyhow::{Context, Result, bail};
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

fn decode_direct_color(surface: &RenderSurface) -> Result<Vec<u8>> {
    match surface.format {
        PixelFormatId::Dxt1 | PixelFormatId::Dxt3 | PixelFormatId::Dxt5 => {
            decode_dxt_rgba8(surface)
        }
        PixelFormatId::R8G8B8 | PixelFormatId::CustomLandscapeR8G8B8 => {
            require_uncompressed_length(surface, surface.format)?;
            Ok(surface
                .source_data
                .chunks_exact(3)
                .flat_map(|pixel| [pixel[2], pixel[1], pixel[0], 255])
                .collect())
        }
        PixelFormatId::A8R8G8B8 => {
            require_uncompressed_length(surface, surface.format)?;
            Ok(surface
                .source_data
                .chunks_exact(4)
                .flat_map(|pixel| [pixel[2], pixel[1], pixel[0], pixel[3]])
                .collect())
        }
        PixelFormatId::X8R8G8B8 => {
            require_uncompressed_length(surface, surface.format)?;
            Ok(surface
                .source_data
                .chunks_exact(4)
                .flat_map(|pixel| [pixel[2], pixel[1], pixel[0], 255])
                .collect())
        }
        PixelFormatId::R5G6B5 => {
            require_uncompressed_length(surface, surface.format)?;
            Ok(surface
                .source_data
                .chunks_exact(2)
                .flat_map(|pixel| {
                    let value = u16::from_le_bytes([pixel[0], pixel[1]]);
                    [
                        expand_5((value >> 11) & 0x1f),
                        expand_6((value >> 5) & 0x3f),
                        expand_5(value & 0x1f),
                        255,
                    ]
                })
                .collect())
        }
        PixelFormatId::A4R4G4B4 => {
            require_uncompressed_length(surface, surface.format)?;
            Ok(surface
                .source_data
                .chunks_exact(2)
                .flat_map(|pixel| {
                    let value = u16::from_le_bytes([pixel[0], pixel[1]]);
                    [
                        expand_4((value >> 8) & 0x0f),
                        expand_4((value >> 4) & 0x0f),
                        expand_4(value & 0x0f),
                        expand_4((value >> 12) & 0x0f),
                    ]
                })
                .collect())
        }
        PixelFormatId::A8 | PixelFormatId::CustomLandscapeAlpha => {
            require_uncompressed_length(surface, surface.format)?;
            Ok(surface
                .source_data
                .iter()
                .flat_map(|alpha| [*alpha, *alpha, *alpha, *alpha])
                .collect())
        }
        _ => bail!(
            "RenderSurface 0x{:08X} {:?} cannot provide object direct-color pixels",
            surface.id,
            surface.format
        ),
    }
}

fn require_uncompressed_length(
    surface: &RenderSurface,
    expected_format: PixelFormatId,
) -> Result<()> {
    if surface.format != expected_format {
        bail!(
            "RenderSurface 0x{:08X} is {:?}, not required {:?}",
            surface.id,
            surface.format,
            expected_format
        );
    }
    let bytes_per_pixel = surface.format.bytes_per_pixel().ok_or_else(|| {
        anyhow::anyhow!(
            "RenderSurface 0x{:08X} has no uncompressed byte width",
            surface.id
        )
    })?;
    let expected = usize::try_from(surface.width)?
        .checked_mul(usize::try_from(surface.height)?)
        .and_then(|pixels| pixels.checked_mul(usize::from(bytes_per_pixel)))
        .context("RenderSurface dimensions overflow")?;
    if surface.source_data.len() != expected {
        bail!(
            "RenderSurface 0x{:08X} {:?} expected {expected} bytes, got {}",
            surface.id,
            surface.format,
            surface.source_data.len()
        );
    }
    Ok(())
}

fn decode_dxt_rgba8(surface: &RenderSurface) -> Result<Vec<u8>> {
    let bytes_per_block = usize::from(
        surface
            .format
            .block_compressed_bytes_per_4x4_block()
            .context("not a DXT format")?,
    );
    let blocks_x = usize::try_from(surface.width.div_ceil(4))?;
    let blocks_y = usize::try_from(surface.height.div_ceil(4))?;
    let expected = blocks_x
        .checked_mul(blocks_y)
        .and_then(|blocks| blocks.checked_mul(bytes_per_block))
        .context("DXT source dimensions overflow")?;
    if surface.source_data.len() != expected {
        bail!(
            "RenderSurface 0x{:08X} expected {expected} compressed bytes, got {}",
            surface.id,
            surface.source_data.len()
        );
    }
    let width = usize::try_from(surface.width)?;
    let height = usize::try_from(surface.height)?;
    let mut pixels = vec![0; width * height * 4];
    for block_y in 0..blocks_y {
        for block_x in 0..blocks_x {
            let offset = (block_y * blocks_x + block_x) * bytes_per_block;
            let block = decode_dxt_block(
                &surface.source_data[offset..offset + bytes_per_block],
                surface.format,
            )?;
            for local_y in 0..4 {
                for local_x in 0..4 {
                    let x = block_x * 4 + local_x;
                    let y = block_y * 4 + local_y;
                    if x >= width || y >= height {
                        continue;
                    }
                    let pixel_offset = (y * width + x) * 4;
                    pixels[pixel_offset..pixel_offset + 4]
                        .copy_from_slice(&block[local_y * 4 + local_x]);
                }
            }
        }
    }
    Ok(pixels)
}

fn decode_dxt_block(block: &[u8], format: PixelFormatId) -> Result<[[u8; 4]; 16]> {
    let (alpha, color_offset) = match format {
        // DXT1's three-color mode encodes transparent selector 3 in the color palette itself.
        PixelFormatId::Dxt1 => (None, 0),
        PixelFormatId::Dxt3 => (Some(decode_dxt3_alpha(&block[..8])), 8),
        PixelFormatId::Dxt5 => (Some(decode_dxt5_alpha(&block[..8])), 8),
        _ => bail!("unsupported DXT format {format:?}"),
    };
    let color0 = u16::from_le_bytes([block[color_offset], block[color_offset + 1]]);
    let color1 = u16::from_le_bytes([block[color_offset + 2], block[color_offset + 3]]);
    let palette = dxt_palette(color0, color1, format);
    let selectors = u32::from_le_bytes([
        block[color_offset + 4],
        block[color_offset + 5],
        block[color_offset + 6],
        block[color_offset + 7],
    ]);
    let mut result = [[0; 4]; 16];
    for (index, pixel) in result.iter_mut().enumerate() {
        *pixel =
            palette[usize::try_from((selectors >> (index * 2)) & 3).expect("selector fits usize")];
        if let Some(alpha) = alpha {
            pixel[3] = alpha[index];
        }
    }
    Ok(result)
}

fn dxt_palette(color0: u16, color1: u16, format: PixelFormatId) -> [[u8; 4]; 4] {
    let first = rgb565(color0);
    let second = rgb565(color1);
    if format != PixelFormatId::Dxt1 || color0 > color1 {
        [
            first,
            second,
            interpolate(first, second, 2, 1, 3),
            interpolate(first, second, 1, 2, 3),
        ]
    } else {
        [
            first,
            second,
            interpolate(first, second, 1, 1, 2),
            [0, 0, 0, 0],
        ]
    }
}

fn decode_dxt3_alpha(block: &[u8]) -> [u8; 16] {
    let mut alpha = [0; 16];
    for (index, value) in alpha.iter_mut().enumerate() {
        let nibble = if index.is_multiple_of(2) {
            block[index / 2] & 0x0f
        } else {
            block[index / 2] >> 4
        };
        *value = nibble * 17;
    }
    alpha
}

fn decode_dxt5_alpha(block: &[u8]) -> [u8; 16] {
    let first = block[0];
    let second = block[1];
    let palette = if first > second {
        [
            first,
            second,
            lerp(first, second, 6, 1, 7),
            lerp(first, second, 5, 2, 7),
            lerp(first, second, 4, 3, 7),
            lerp(first, second, 3, 4, 7),
            lerp(first, second, 2, 5, 7),
            lerp(first, second, 1, 6, 7),
        ]
    } else {
        [
            first,
            second,
            lerp(first, second, 4, 1, 5),
            lerp(first, second, 3, 2, 5),
            lerp(first, second, 2, 3, 5),
            lerp(first, second, 1, 4, 5),
            0,
            255,
        ]
    };
    let bits = block[2..8]
        .iter()
        .enumerate()
        .fold(0_u64, |bits, (index, byte)| {
            bits | (u64::from(*byte) << (index * 8))
        });
    let mut alpha = [0; 16];
    for (index, value) in alpha.iter_mut().enumerate() {
        *value = palette[usize::try_from((bits >> (index * 3)) & 7).expect("selector fits usize")];
    }
    alpha
}

fn rgb565(value: u16) -> [u8; 4] {
    [
        expand_5((value >> 11) & 0x1f),
        expand_6((value >> 5) & 0x3f),
        expand_5(value & 0x1f),
        255,
    ]
}

fn interpolate(
    left: [u8; 4],
    right: [u8; 4],
    left_weight: u32,
    right_weight: u32,
    divisor: u32,
) -> [u8; 4] {
    [
        lerp(left[0], right[0], left_weight, right_weight, divisor),
        lerp(left[1], right[1], left_weight, right_weight, divisor),
        lerp(left[2], right[2], left_weight, right_weight, divisor),
        255,
    ]
}

fn lerp(left: u8, right: u8, left_weight: u32, right_weight: u32, divisor: u32) -> u8 {
    u8::try_from(
        (u32::from(left) * left_weight + u32::from(right) * right_weight + divisor / 2) / divisor,
    )
    .expect("interpolated color fits u8")
}

fn expand_4(value: u16) -> u8 {
    ((value << 4) | value) as u8
}
fn expand_5(value: u16) -> u8 {
    ((value << 3) | (value >> 2)) as u8
}
fn expand_6(value: u16) -> u8 {
    ((value << 2) | (value >> 4)) as u8
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

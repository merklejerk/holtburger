//! Pure direct-color normalization shared by scene textures and UI artwork.

use anyhow::{Context, Result, bail};
use holtburger_dat::file_type::{PixelFormatId, RenderSurface};

/// Distinguishes unsupported art from damaged supported encodings at content boundaries.
#[derive(Debug, thiserror::Error)]
#[error("RenderSurface {id:#010x} {format:?} cannot provide direct-color pixels")]
pub struct UnsupportedDirectColorFormat {
    /// Source resource identity for diagnostics.
    pub id: u32,
    /// Authored encoding that the direct-color decoder cannot normalize.
    pub format: PixelFormatId,
}

/// Decode authored direct-color channels to tightly packed RGBA8; no renderer role policy.
pub fn decode_direct_color(surface: &RenderSurface) -> Result<Vec<u8>> {
    match surface.format {
        PixelFormatId::Dxt1 | PixelFormatId::Dxt3 | PixelFormatId::Dxt5 => {
            decode_dxt_rgba8(surface)
        }
        PixelFormatId::R8G8B8 | PixelFormatId::CustomLandscapeR8G8B8 => {
            require_uncompressed_length(surface, surface.format)?;
            Ok(surface
                .source_data
                .as_chunks::<3>()
                .0
                .iter()
                .flat_map(|pixel| [pixel[2], pixel[1], pixel[0], 255])
                .collect())
        }
        PixelFormatId::A8R8G8B8 => {
            require_uncompressed_length(surface, surface.format)?;
            Ok(surface
                .source_data
                .as_chunks::<4>()
                .0
                .iter()
                .flat_map(|pixel| [pixel[2], pixel[1], pixel[0], pixel[3]])
                .collect())
        }
        PixelFormatId::X8R8G8B8 => {
            require_uncompressed_length(surface, surface.format)?;
            Ok(surface
                .source_data
                .as_chunks::<4>()
                .0
                .iter()
                .flat_map(|pixel| [pixel[2], pixel[1], pixel[0], 255])
                .collect())
        }
        PixelFormatId::R5G6B5 => {
            require_uncompressed_length(surface, surface.format)?;
            Ok(surface
                .source_data
                .as_chunks::<2>()
                .0
                .iter()
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
                .as_chunks::<2>()
                .0
                .iter()
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
        _ => Err(UnsupportedDirectColorFormat {
            id: surface.id,
            format: surface.format,
        }
        .into()),
    }
}

/// Validate the exact authored format and uncompressed byte extent before conversion.
pub fn require_uncompressed_length(
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

#[cfg(test)]
mod tests {
    use super::*;

    fn source(format: PixelFormatId, source_data: Vec<u8>) -> RenderSurface {
        RenderSurface {
            id: 0x06000001,
            unknown: 0,
            width: 1,
            height: 1,
            format,
            format_raw: format.raw(),
            source_data,
            default_palette_id: None,
        }
    }

    #[test]
    fn normalizes_rgb_bgra_and_packed_color_with_authored_alpha() {
        for (format, bytes, expected) in [
            (
                PixelFormatId::R8G8B8,
                vec![10, 20, 30],
                vec![30, 20, 10, 255],
            ),
            (
                PixelFormatId::A8R8G8B8,
                vec![10, 20, 30, 40],
                vec![30, 20, 10, 40],
            ),
            (
                PixelFormatId::X8R8G8B8,
                vec![10, 20, 30, 40],
                vec![30, 20, 10, 255],
            ),
            (PixelFormatId::R5G6B5, vec![0, 248], vec![255, 0, 0, 255]),
            (
                PixelFormatId::A4R4G4B4,
                vec![0x23, 0x41],
                vec![17, 34, 51, 68],
            ),
        ] {
            assert_eq!(
                decode_direct_color(&source(format, bytes)).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn rejects_truncated_or_extra_color_bytes_and_indexed_inputs() {
        for bytes in [vec![1, 2], vec![1, 2, 3, 4]] {
            assert!(
                decode_direct_color(&source(PixelFormatId::R8G8B8, bytes))
                    .unwrap_err()
                    .to_string()
                    .contains("expected 3 bytes")
            );
        }
        assert!(
            decode_direct_color(&source(PixelFormatId::Index16, vec![0, 0]))
                .unwrap_err()
                .to_string()
                .contains("cannot provide direct-color pixels")
        );
    }
}

//! Terrain diffuse means shared by texture transport and the static world map.

use anyhow::{Context, Result};

/// Compute one normalized RGB mean from complete RGBA8 level-zero pixels.
pub(crate) fn mean_rgb_rgba8(width: u32, height: u32, pixels: &[u8]) -> Result<[f32; 3]> {
    let texel_count = usize::try_from(u64::from(width) * u64::from(height))?;
    let expected_byte_length = texel_count
        .checked_mul(4)
        .context("terrain-color RGBA8 byte length overflowed")?;
    if texel_count == 0 || pixels.len() != expected_byte_length {
        anyhow::bail!("terrain-color mean requires complete non-empty RGBA8 pixels");
    }
    mean_rgb_from_rgba8_texels(
        texel_count,
        pixels
            .as_chunks::<4>()
            .0
            .iter()
            .map(|texel| [texel[0], texel[1], texel[2], texel[3]]),
    )
}

pub(crate) fn mean_rgb_from_rgba8_texels(
    expected_texel_count: usize,
    texels: impl IntoIterator<Item = [u8; 4]>,
) -> Result<[f32; 3]> {
    let mut sums = [0_u64; 3];
    let mut texel_count = 0_usize;
    for texel in texels {
        sums[0] += u64::from(texel[0]);
        sums[1] += u64::from(texel[1]);
        sums[2] += u64::from(texel[2]);
        texel_count += 1;
    }
    if texel_count == 0 || texel_count != expected_texel_count {
        anyhow::bail!("terrain-color mean received an incompatible texel count");
    }
    let normalization = 1.0_f64 / (texel_count as f64 * f64::from(u8::MAX));
    Ok(sums.map(|sum| (sum as f64 * normalization) as f32))
}

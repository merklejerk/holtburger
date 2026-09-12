//! Deterministic, native-size retail icon composition. No content I/O or ownership.

use anyhow::{Result, ensure};
use holtburger_content::ui_assets::UiImage;

/// Retail inventory artwork is composed at this native extent; CSS owns display scaling.
pub const ICON_SIZE: usize = 32;
/// Complete tightly packed RGBA8 output size.
pub const ICON_BYTES: usize = ICON_SIZE * ICON_SIZE * 4;

/// Fully resolved layers in their authored roles.
pub struct IconLayers<'a> {
    /// Working foreground before effects substitution.
    pub base: &'a UiImage,
    /// Type-selected backing, whose alpha survives the final three-channel blend.
    pub background: &'a UiImage,
    /// Same-coordinate replacements for exactly opaque white foreground pixels.
    pub effects: &'a UiImage,
    /// Optional layer blended into the foreground before effects processing.
    pub overlay: Option<&'a UiImage>,
    /// Optional layer blended over the backing before the foreground.
    pub underlay: Option<&'a UiImage>,
}

/// Follow IconData::RenderIcons (acclient.c:418927), preserving alpha semantics per step.
pub fn compose(layers: IconLayers<'_>) -> Result<Vec<u8>> {
    let mut work = canvas(layers.base)?;
    if let Some(overlay) = layers.overlay {
        blend(&mut work, &canvas(overlay)?, true);
    }
    let effects = canvas(layers.effects)?;
    for (pixel, effect) in work
        .as_chunks_mut::<4>()
        .0
        .iter_mut()
        .zip(effects.as_chunks::<4>().0)
    {
        if *pixel == [255, 255, 255, 255] {
            pixel.copy_from_slice(effect);
        }
    }
    let mut output = canvas(layers.background)?;
    if let Some(underlay) = layers.underlay {
        blend(&mut output, &canvas(underlay)?, false);
    }
    blend(&mut output, &work, false);
    Ok(output)
}

/// Preserve authored RGBA while clipping/padding a standalone graphic to native icon size.
pub(super) fn canvas(image: &UiImage) -> Result<Vec<u8>> {
    let width = usize::try_from(image.width)?;
    let height = usize::try_from(image.height)?;
    ensure!(width > 0 && height > 0, "empty icon source extent");
    ensure!(
        width.checked_mul(height).and_then(|n| n.checked_mul(4)) == Some(image.pixels.len()),
        "invalid icon RGBA byte extent"
    );
    // RETAIL DIVERGENCE: explicitly initialize unwritten pixels. acclient.c:123362
    // and :653158 do not establish allocator initialization; leaving them undefined
    // would make undersized art nondeterministic. ACE template census found four
    // undersized base DIDs (32x24, 29x32, two 28x32). This is a chosen deterministic
    // padding policy, not a claim that retail guarantees the same unwritten pixels.
    let mut output = vec![0; ICON_BYTES];
    let clipped_width = width.min(ICON_SIZE);
    for y in 0..height.min(ICON_SIZE) {
        // BlitAndColor (acclient.c:122050) clips at the origin; it does not rescale.
        output[y * ICON_SIZE * 4..(y * ICON_SIZE + clipped_width) * 4]
            .copy_from_slice(&image.pixels[y * width * 4..(y * width + clipped_width) * 4]);
    }
    Ok(output)
}

fn blend(destination: &mut [u8], source: &[u8], four_channels: bool) {
    // RETAIL QUIRK: preserve scalar integer rounding (acclient.c:600744, :612696).
    // Replacing it with ordinary source-over changes authored edge pixels: census
    // of 273 partial-alpha 32x32 surfaces found 14,604 differing pixels, max delta 2.
    // The SSE partial/partial variant (:612546) is not claimed to be pixel-identical.
    for (d, s) in destination
        .as_chunks_mut::<4>()
        .0
        .iter_mut()
        .zip(source.as_chunks::<4>().0)
    {
        let alpha = i32::from(s[3]);
        if alpha == 0 {
            continue;
        }
        if four_channels && (alpha == 255 || d[3] == 0) {
            d.copy_from_slice(s);
            continue;
        }
        if alpha == 255 {
            d[..3].copy_from_slice(&s[..3]);
            continue;
        }
        let q = alpha + 1;
        if !four_channels || d[3] == 255 {
            for channel in 0..3 {
                let old = i32::from(d[channel]);
                d[channel] = (old - old * q / 256 + i32::from(s[channel]) * q / 256) as u8;
            }
        } else {
            let n = q - q * (i32::from(d[3]) + 1) / 256 + i32::from(d[3]) + 1;
            for channel in 0..3 {
                let old = i32::from(d[channel]);
                d[channel] = (old - q * (old - i32::from(s[channel])) / n) as u8;
            }
            d[3] = (n - 1) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn image(pixel: [u8; 4]) -> UiImage {
        UiImage {
            width: 1,
            height: 1,
            pixels: pixel.to_vec(),
        }
    }

    #[test]
    fn overlay_precedes_exact_white_effects_and_work_covers_underlay() {
        let base = image([1, 2, 3, 255]);
        let overlay = image([255, 255, 255, 255]);
        let effect = image([17, 33, 65, 255]);
        let background = image([1, 2, 3, 255]);
        let underlay = image([70, 80, 90, 255]);
        let mut layers = IconLayers {
            base: &base,
            background: &background,
            effects: &effect,
            overlay: Some(&overlay),
            underlay: Some(&underlay),
        };
        assert_eq!(&compose(layers).unwrap()[..4], &[17, 33, 65, 255]);
        let non_white = image([254, 255, 255, 255]);
        layers = IconLayers {
            base: &non_white,
            background: &background,
            effects: &effect,
            overlay: None,
            underlay: Some(&underlay),
        };
        assert_eq!(&compose(layers).unwrap()[..4], &[254, 255, 255, 255]);
    }

    #[test]
    fn preserves_scalar_alpha_arithmetic() {
        let mut partial = [100, 150, 200, 100];
        blend(&mut partial, &[200, 50, 100, 128], true);
        assert_eq!(partial, [171, 79, 129, 179]);
        let mut opaque = [26, 110, 121, 255];
        blend(&mut opaque, &[11, 70, 10, 253], false);
        assert_eq!(opaque, [11, 70, 10, 255]);
        let mut transparent = [0; 4];
        blend(&mut transparent, &[20, 30, 40, 128], true);
        assert_eq!(transparent, [20, 30, 40, 128]);
        blend(&mut transparent, &[1, 2, 3, 0], true);
        assert_eq!(transparent, [20, 30, 40, 128]);
        blend(&mut transparent, &[1, 2, 3, 255], false);
        assert_eq!(transparent, [1, 2, 3, 128]);
    }

    #[test]
    fn clips_large_sources_and_pads_small_sources_without_scaling() {
        let small = canvas(&image([1, 2, 3, 4])).unwrap();
        assert_eq!(&small[..4], &[1, 2, 3, 4]);
        assert!(small[4..].iter().all(|byte| *byte == 0));
        let large = UiImage {
            width: 33,
            height: 33,
            pixels: [5, 6, 7, 8].repeat(33 * 33),
        };
        assert_eq!(
            canvas(&large).unwrap(),
            [5, 6, 7, 8].repeat(ICON_SIZE * ICON_SIZE)
        );
        assert!(
            canvas(&UiImage {
                width: 1,
                height: 1,
                pixels: vec![0; 3]
            })
            .is_err()
        );
    }
}

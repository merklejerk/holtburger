use anyhow::{Result, bail};
use holtburger_dat::file_type::{PixelFormatId, RenderSurface};

/// Pixel channel encoding required by a client-agnostic texture consumer.
///
/// This describes the emitted bytes, rather than the source DAT `PixelFormatId`. Callers choose
/// the encoding from their semantic use (for example terrain color versus terrain blend mask).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TexturePixelFormat {
    Rgba8,
    R8,
}

/// One normalized level-zero render surface ready for frontend-specific upload or packing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedSurfaceTexturePixels {
    /// The requested `SurfaceTexture` resource that selected this concrete source level.
    pub surface_texture_id: u32,
    /// The first available `RenderSurface` declared by the source `SurfaceTexture`.
    pub render_surface_id: u32,
    /// Pixel encoding of `pixels`.
    pub format: TexturePixelFormat,
    /// Authored source width in pixels.
    pub width: u32,
    /// Authored source height in pixels.
    pub height: u32,
    /// Tightly packed pixels in `format` channel order.
    pub pixels: Vec<u8>,
}

/// Normalizes one decoded DAT render surface into the requested channel encoding.
///
/// Terrain currently proves `A8R8G8B8` color/detail surfaces and `CustomLandscapeAlpha` masks.
/// The conversion deliberately rejects other source formats until their semantic use is proven.
pub(crate) fn decode_render_surface_pixels(
    render_surface: &RenderSurface,
    output_format: TexturePixelFormat,
) -> Result<Vec<u8>> {
    validate_source_length(render_surface)?;
    match (output_format, render_surface.format) {
        (TexturePixelFormat::Rgba8, PixelFormatId::A8R8G8B8) => {
            let mut pixels = Vec::with_capacity(render_surface.source_data.len());
            for source in render_surface.source_data.chunks_exact(4) {
                // DAT stores direct 32-bit colors in little-endian BGRA byte order.
                pixels.extend_from_slice(&[source[2], source[1], source[0], source[3]]);
            }
            Ok(pixels)
        }
        (TexturePixelFormat::R8, PixelFormatId::CustomLandscapeAlpha)
        | (TexturePixelFormat::R8, PixelFormatId::A8) => Ok(render_surface.source_data.clone()),
        (TexturePixelFormat::Rgba8, format) => bail!(
            "RenderSurface 0x{:08X} format {:?} cannot provide RGBA8 pixels",
            render_surface.id,
            format
        ),
        (TexturePixelFormat::R8, format) => bail!(
            "RenderSurface 0x{:08X} format {:?} cannot provide R8 pixels",
            render_surface.id,
            format
        ),
    }
}

fn validate_source_length(render_surface: &RenderSurface) -> Result<()> {
    let bytes_per_pixel = render_surface.format.bytes_per_pixel().ok_or_else(|| {
        anyhow::anyhow!(
            "RenderSurface 0x{:08X} format {:?} has no uncompressed pixel width",
            render_surface.id,
            render_surface.format
        )
    })?;
    let pixel_count = usize::try_from(render_surface.width)?
        .checked_mul(usize::try_from(render_surface.height)?)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "RenderSurface 0x{:08X} dimensions overflow",
                render_surface.id
            )
        })?;
    let expected_length = pixel_count
        .checked_mul(usize::from(bytes_per_pixel))
        .ok_or_else(|| {
            anyhow::anyhow!(
                "RenderSurface 0x{:08X} byte length overflows",
                render_surface.id
            )
        })?;
    if render_surface.source_data.len() != expected_length {
        bail!(
            "RenderSurface 0x{:08X} {:?} expected {expected_length} source bytes, got {}",
            render_surface.id,
            render_surface.format,
            render_surface.source_data.len()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn surface(format: PixelFormatId, source_data: Vec<u8>) -> RenderSurface {
        RenderSurface {
            id: 0x0600_1234,
            unknown: 0,
            width: 2,
            height: 1,
            format,
            format_raw: format.raw(),
            source_data,
            default_palette_id: None,
        }
    }

    #[test]
    fn normalizes_direct_bgra_to_rgba() {
        let pixels = decode_render_surface_pixels(
            &surface(
                PixelFormatId::A8R8G8B8,
                vec![0x10, 0x20, 0x30, 0x40, 1, 2, 3, 4],
            ),
            TexturePixelFormat::Rgba8,
        )
        .expect("direct color should normalize");

        assert_eq!(pixels, vec![0x30, 0x20, 0x10, 0x40, 3, 2, 1, 4]);
    }

    #[test]
    fn preserves_landscape_alpha_as_r8() {
        let pixels = decode_render_surface_pixels(
            &surface(PixelFormatId::CustomLandscapeAlpha, vec![7, 9]),
            TexturePixelFormat::R8,
        )
        .expect("landscape alpha should normalize");

        assert_eq!(pixels, vec![7, 9]);
    }

    #[test]
    fn rejects_semantically_incompatible_source_format() {
        let error = decode_render_surface_pixels(
            &surface(PixelFormatId::CustomLandscapeAlpha, vec![7, 9]),
            TexturePixelFormat::Rgba8,
        )
        .expect_err("alpha source must not masquerade as color");

        assert!(error.to_string().contains("cannot provide RGBA8"));
    }
}

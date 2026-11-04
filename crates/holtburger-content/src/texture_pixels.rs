use crate::render_surface_pixels::{decode_direct_color, require_uncompressed_length};
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
    require_uncompressed_length(render_surface, render_surface.format)?;
    match (output_format, render_surface.format) {
        (TexturePixelFormat::Rgba8, PixelFormatId::A8R8G8B8) => decode_direct_color(render_surface),
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

//! Texture-pixel and palette-composite response builders.

use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_content::TexturePixelFormat;
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, SurfaceTexturePixelsRequest,
};
use holtburger_dat::file_type::{Palette, PaletteRange};
use serde::{Deserialize, Serialize};

use super::{
    BINARY_ENVELOPE_HEADER_LEN, BinarySectionManifest, pad_binary_manifest, parse_typed_dat_id,
};
use crate::object_texture::{
    self, ObjectTexturePurpose, PreparedObjectTexture, prepare_object_palette,
    prepare_object_surface,
};
use crate::source_projection::dat_id;
use crate::terrain_color::mean_rgb_rgba8;

pub(super) const TEXTURE_PIXELS_BINARY_MAGIC: &[u8; 4] = b"HBTP";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTexturePixelsRequest {
    pub kind: String,
    pub purpose: String,
    /// Identity of the requested texture, echoed back so a caller can match its response.
    ///
    /// For a composited palette this is the composition's identity rather than a DAT id, because
    /// several compositions share one base palette.
    pub source_asset_id: String,
    /// Recipe for a composited palette. Present only for a palette request whose material carries
    /// an ObjDesc composition; the host never derives it from `source_asset_id`.
    #[serde(default)]
    pub palette_composite: Option<LoadPaletteCompositeRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadPaletteCompositeRequest {
    pub base_palette_id: String,
    pub ranges: Vec<LoadPaletteRangeRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadPaletteRangeRequest {
    pub replacement_palette_id: String,
    pub offset: u32,
    pub color_count: u32,
}

/// Build the canonical texture-pixel response used by the sidecar and headless browser harness.
///
/// Covers every request kind: terrain surfaces, object surfaces, and palettes both authored and
/// composited.
pub async fn load_texture_pixels_bytes(
    runtime: &ContentAssetRuntime,
    request: LoadTexturePixelsRequest,
) -> Result<Vec<u8>> {
    build_texture_pixels_response(runtime, request).await
}

pub(super) async fn build_texture_pixels_response(
    runtime: &ContentAssetRuntime,
    request: LoadTexturePixelsRequest,
) -> Result<Vec<u8>> {
    let (source_asset_id, source_record_id, prepared) = match request.kind.as_str() {
        "prepared-texture-surface" => {
            let output_format = texture_output_format(&request.purpose)?;
            let surface_texture_id = parse_surface_texture_asset_id(&request.source_asset_id)?;
            let asset = runtime
                .load(ContentAssetRequest::SurfaceTexturePixels(
                    SurfaceTexturePixelsRequest {
                        surface_texture_id,
                        output_format,
                    },
                ))
                .await
                .with_context(|| {
                    format!(
                        "Could not load {} pixels from {}",
                        request.purpose, request.source_asset_id
                    )
                })?;
            let ContentAsset::SurfaceTexturePixels(pixels) = asset else {
                unreachable!("texture pixel request must return normalized surface pixels")
            };
            let format = match pixels.format {
                TexturePixelFormat::Rgba8 => object_texture::PreparedObjectTextureFormat::Rgba8,
                TexturePixelFormat::R8 => object_texture::PreparedObjectTextureFormat::R8,
            };
            (
                surface_texture_asset_id(surface_texture_id),
                dat_id(pixels.render_surface_id),
                PreparedObjectTexture {
                    format,
                    width: pixels.width,
                    height: pixels.height,
                    pixels: pixels.pixels,
                },
            )
        }
        "prepared-object-texture" => {
            let surface_texture_id = parse_surface_texture_asset_id(&request.source_asset_id)?;
            let purpose = object_texture_purpose(&request.purpose)?;
            let surface = load_object_render_surface(runtime, surface_texture_id).await?;
            let source_record_id = dat_id(surface.id);
            let prepared = prepare_object_surface(&surface, purpose)?;
            (
                surface_texture_asset_id(surface_texture_id),
                source_record_id,
                prepared,
            )
        }
        "prepared-object-palette" => {
            if request.purpose != "object-palette" {
                anyhow::bail!("prepared-object-palette requires object-palette purpose");
            }
            match &request.palette_composite {
                None => {
                    let palette_id = parse_palette_asset_id(&request.source_asset_id)?;
                    let palette = load_palette(runtime, palette_id).await?;
                    let prepared = prepare_object_palette(&palette)?;
                    (palette_asset_id(palette_id), dat_id(palette.id), prepared)
                }
                Some(composite) => {
                    let palette = composite_palette(runtime, composite).await?;
                    let prepared = prepare_object_palette(&palette)?;
                    // The composition's identity, not the base palette's id: several compositions
                    // share one base, and the caller keyed its request on the identity.
                    (
                        request.source_asset_id.clone(),
                        dat_id(palette.id),
                        prepared,
                    )
                }
            }
        }
        _ => anyhow::bail!("unsupported texture request kind {:?}", request.kind),
    };
    let surface = TexturePixelsSurfaceFields {
        source_record_id,
        format: prepared.format.name(),
        width: prepared.width,
        height: prepared.height,
    };
    let surface = if request.purpose == "terrain-color" {
        TexturePixelsSurfaceManifest::TerrainColor {
            surface,
            mean_rgb: mean_rgb_rgba8(prepared.width, prepared.height, &prepared.pixels)?,
        }
    } else {
        TexturePixelsSurfaceManifest::Conventional(surface)
    };
    let manifest = TexturePixelsManifest {
        transport: "holtburger-texture-pixels",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        source_asset_id,
        purpose: request.purpose,
        surface,
        sections: vec![BinarySectionManifest {
            name: "pixels",
            scalar_type: "u8",
            element_count: prepared.pixels.len(),
            byte_offset: 0,
            byte_length: prepared.pixels.len(),
        }],
    };
    serialize_texture_pixels_binary(&manifest, &prepared.pixels)
}

pub(super) fn parse_surface_texture_asset_id(raw_asset_id: &str) -> Result<u32> {
    parse_typed_asset_id(raw_asset_id, "surface-texture/", 0x05)
}

fn parse_palette_asset_id(raw_asset_id: &str) -> Result<u32> {
    parse_typed_asset_id(raw_asset_id, "palette/", 0x04)
}

async fn load_palette(runtime: &ContentAssetRuntime, palette_id: u32) -> Result<Arc<Palette>> {
    let asset = runtime
        .load(ContentAssetRequest::Palette(palette_id))
        .await?;
    let ContentAsset::Palette(palette) = asset else {
        unreachable!("palette request must return a palette")
    };
    Ok(palette)
}

/// Materialize one requested palette composition.
///
/// The decision to apply it was already made while resolving the appearance; this only realizes
/// the pixels for an identity that decision produced, so a refused range here means the request
/// and the resolution disagree.
async fn composite_palette(
    runtime: &ContentAssetRuntime,
    composite: &LoadPaletteCompositeRequest,
) -> Result<Palette> {
    let base_palette_id = parse_typed_dat_id(&composite.base_palette_id, 0x04)?;
    let base = load_palette(runtime, base_palette_id).await?;
    let mut replacements = Vec::with_capacity(composite.ranges.len());
    for range in &composite.ranges {
        let palette_id = parse_typed_dat_id(&range.replacement_palette_id, 0x04)?;
        replacements.push(load_palette(runtime, palette_id).await?);
    }
    let ranges = composite
        .ranges
        .iter()
        .zip(&replacements)
        .map(|(range, replacement)| PaletteRange {
            replacement,
            offset: range.offset,
            color_count: range.color_count,
        })
        .collect::<Vec<_>>();

    base.composite(&ranges).with_context(|| {
        format!("Could not composite palette 0x{base_palette_id:08X} for a requested appearance")
    })
}

fn parse_typed_asset_id(raw_asset_id: &str, prefix: &str, expected_type: u32) -> Result<u32> {
    let raw_id = raw_asset_id
        .strip_prefix(prefix)
        .with_context(|| format!("asset id must start with {prefix:?}"))?;
    parse_typed_dat_id(raw_id, expected_type)
}

fn object_texture_purpose(raw: &str) -> Result<ObjectTexturePurpose> {
    match raw {
        "object-direct-color" => Ok(ObjectTexturePurpose::DirectColor),
        "object-index-8" => Ok(ObjectTexturePurpose::Index8),
        "object-index-16" => Ok(ObjectTexturePurpose::Index16),
        "object-detail" => Ok(ObjectTexturePurpose::Detail),
        _ => anyhow::bail!("unsupported object texture purpose {raw:?}"),
    }
}

async fn load_object_render_surface(
    runtime: &ContentAssetRuntime,
    surface_texture_id: u32,
) -> Result<Box<holtburger_dat::file_type::RenderSurface>> {
    let texture_asset = runtime
        .load(ContentAssetRequest::SurfaceTexture(surface_texture_id))
        .await
        .with_context(|| format!("Could not load SurfaceTexture 0x{surface_texture_id:08X}"))?;
    let ContentAsset::SurfaceTexture(texture) = texture_asset else {
        unreachable!("surface texture request must return a surface texture")
    };
    for render_surface_id in texture.render_surface_ids {
        if let Ok(ContentAsset::RenderSurface(surface)) = runtime
            .load(ContentAssetRequest::RenderSurface(render_surface_id))
            .await
        {
            return Ok(surface);
        }
    }
    anyhow::bail!("SurfaceTexture 0x{surface_texture_id:08X} has no available RenderSurface level")
}

pub(super) fn texture_output_format(purpose: &str) -> Result<TexturePixelFormat> {
    match purpose {
        "terrain-color" | "terrain-detail" => Ok(TexturePixelFormat::Rgba8),
        "terrain-blend-mask" | "terrain-road-mask" => Ok(TexturePixelFormat::R8),
        _ => anyhow::bail!("unsupported texture purpose {purpose:?} for terrain pixel loading"),
    }
}

fn surface_texture_asset_id(texture_id: u32) -> String {
    format!("surface-texture/0x{texture_id:08x}")
}

fn palette_asset_id(palette_id: u32) -> String {
    format!("palette/0x{palette_id:08x}")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TexturePixelsManifest {
    pub(super) transport: &'static str,
    pub(super) byte_order: &'static str,
    pub(super) section_byte_offset_base: &'static str,
    pub(super) source_asset_id: String,
    pub(super) purpose: String,
    pub(super) surface: TexturePixelsSurfaceManifest,
    pub(super) sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TexturePixelsSurfaceFields {
    pub(super) source_record_id: String,
    pub(super) format: &'static str,
    pub(super) width: u32,
    pub(super) height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub(super) enum TexturePixelsSurfaceManifest {
    /// Terrain color alone carries the required source-surface mean used by the frontend palette.
    TerrainColor {
        #[serde(flatten)]
        surface: TexturePixelsSurfaceFields,
        #[serde(rename = "meanRgb")]
        mean_rgb: [f32; 3],
    },
    /// Every unrelated texture purpose preserves the existing surface manifest shape.
    Conventional(TexturePixelsSurfaceFields),
}

pub(super) fn serialize_texture_pixels_binary(
    manifest: &TexturePixelsManifest,
    pixels: &[u8],
) -> Result<Vec<u8>> {
    let manifest_bytes = pad_binary_manifest(serde_json::to_vec(manifest)?);
    let total_length = BINARY_ENVELOPE_HEADER_LEN + manifest_bytes.len() + pixels.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(TEXTURE_PIXELS_BINARY_MAGIC);
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    bytes.extend(pixels);
    Ok(bytes)
}

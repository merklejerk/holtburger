use anyhow::{Result, bail};
use holtburger_dat::file_type::{PixelFormatId, RenderSurface};
use std::time::{Duration, Instant};

use crate::adapter::prepared_texture_dxt::{
    decode_dxt_surface_downsampled_2x, decode_dxt_surface_rgba8_bytes, downsample_rgba_2x,
    encode_dxt_surface, next_mip_dimension, validate_compressed_source,
};

const PREPARED_TEXTURE_PREFIX: &str = "prepared-texture/";
const RETAIL_MIP_LEVEL_CAP: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedTextureRequest {
    pub render_surface_id: u32,
    pub usage: PreparedTextureUsage,
    pub output_format: PreparedTextureOutputFormat,
    pub mip_policy: PreparedTextureMipPolicy,
    pub color_space: PreparedTextureColorSpace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedTextureUsage {
    Color,
    Detail,
    Mask,
    Raw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedTextureOutputFormat {
    Dxt1,
    Dxt3,
    Dxt5,
    Index16,
    R8,
    Rgba8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedTextureMipPolicy {
    None,
    Retail4,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedTextureColorSpace {
    Srgb,
    Data,
    Linear,
    Source,
}

#[derive(Debug, Clone)]
pub struct PreparedTexturePayload {
    pub request: PreparedTextureRequest,
    pub source_format: PixelFormatId,
    pub source_format_raw: u32,
    pub source_width: u32,
    pub source_height: u32,
    pub source_byte_length: usize,
    pub source_hash: String,
    pub levels: Vec<PreparedTextureMipLevel>,
    pub timing: PreparedTextureTiming,
}

#[derive(Debug, Clone)]
pub struct PreparedTextureMipLevel {
    pub level: u32,
    pub width: u32,
    pub height: u32,
    pub format: PixelFormatId,
    pub format_raw: u32,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PreparedTextureTiming {
    pub decode: Duration,
    pub downsample: Duration,
    pub encode: Duration,
    pub total: Duration,
}

pub fn parse_prepared_texture_asset_id(asset_id: &str) -> Option<PreparedTextureRequest> {
    let rest = asset_id.strip_prefix(PREPARED_TEXTURE_PREFIX)?;
    let (raw_render_surface_id, raw_query) = rest.split_once('?')?;
    let render_surface_id = parse_typed_hex_data_id(raw_render_surface_id, 0x06)
        .or_else(|| parse_typed_hex_data_id(raw_render_surface_id, 0x07))?;

    let mut usage = None;
    let mut output_format = None;
    let mut mip_policy = None;
    let mut color_space = None;
    for pair in raw_query.split('&') {
        let (key, value) = pair.split_once('=')?;
        match key {
            "usage" => usage = Some(parse_usage(value)?),
            "out" => output_format = Some(parse_output_format(value)?),
            "mips" => mip_policy = Some(parse_mip_policy(value)?),
            "cs" => color_space = Some(parse_color_space(value)?),
            _ => return None,
        }
    }

    Some(PreparedTextureRequest {
        render_surface_id,
        usage: usage?,
        output_format: output_format?,
        mip_policy: mip_policy?,
        color_space: color_space?,
    })
}

pub fn format_prepared_texture_asset_id(request: &PreparedTextureRequest) -> String {
    format!(
        "{PREPARED_TEXTURE_PREFIX}{:08x}?usage={}&out={}&mips={}&cs={}",
        request.render_surface_id,
        format_usage(request.usage),
        format_output_format(request.output_format),
        format_mip_policy(request.mip_policy),
        format_color_space(request.color_space)
    )
}

pub fn prepare_texture(
    request: PreparedTextureRequest,
    render_surface: &RenderSurface,
) -> Result<PreparedTexturePayload> {
    let total_started_at = Instant::now();
    if request.render_surface_id != render_surface.id {
        bail!(
            "prepared texture request 0x{:08X} was given RenderSurface 0x{:08X}",
            request.render_surface_id,
            render_surface.id
        );
    }
    if request.mip_policy != PreparedTextureMipPolicy::Retail4 {
        if request.mip_policy == PreparedTextureMipPolicy::None {
            return match request.output_format {
                PreparedTextureOutputFormat::Rgba8 => {
                    prepare_normalized_rgba8_texture(total_started_at, request, render_surface)
                }
                PreparedTextureOutputFormat::R8 => {
                    prepare_normalized_r8_texture(total_started_at, request, render_surface)
                }
                PreparedTextureOutputFormat::Index16 => {
                    prepare_normalized_index16_texture(total_started_at, request, render_surface)
                }
                PreparedTextureOutputFormat::Dxt1
                | PreparedTextureOutputFormat::Dxt3
                | PreparedTextureOutputFormat::Dxt5 => {
                    bail!("compressed prepared textures require mips=retail4")
                }
            };
        }
        bail!("unsupported prepared texture mip policy");
    }
    if matches!(
        request.output_format,
        PreparedTextureOutputFormat::Index16
            | PreparedTextureOutputFormat::R8
            | PreparedTextureOutputFormat::Rgba8
    ) {
        bail!("normalized prepared textures require mips=none");
    }
    let output_format = output_format_pixel_format(request.output_format);
    if render_surface.format != output_format {
        bail!(
            "prepared texture {} requested {:?} but source is {:?}",
            format_prepared_texture_asset_id(&request),
            request.output_format,
            render_surface.format
        );
    }
    validate_compressed_source(render_surface)?;

    let mut levels = Vec::new();
    levels.push(PreparedTextureMipLevel {
        level: 0,
        width: render_surface.width,
        height: render_surface.height,
        format: render_surface.format,
        format_raw: render_surface.format_raw,
        bytes: render_surface.source_data.clone(),
    });

    let mut width = render_surface.width;
    let mut height = render_surface.height;
    let mut decode_duration = Duration::ZERO;
    let mut downsample_duration = Duration::ZERO;
    let mut encode_duration = Duration::ZERO;

    if levels.len() < RETAIL_MIP_LEVEL_CAP && (width > 1 || height > 1) {
        let decode_started_at = Instant::now();
        let mut rgba = decode_dxt_surface_downsampled_2x(render_surface)?;
        decode_duration += decode_started_at.elapsed();
        width = next_mip_dimension(width);
        height = next_mip_dimension(height);
        let encode_started_at = Instant::now();
        let bytes = encode_dxt_surface(&rgba, width, height, output_format)?;
        encode_duration += encode_started_at.elapsed();
        levels.push(PreparedTextureMipLevel {
            level: u32::try_from(levels.len()).expect("mip level count fits u32"),
            width,
            height,
            format: output_format,
            format_raw: output_format.raw(),
            bytes,
        });

        while levels.len() < RETAIL_MIP_LEVEL_CAP && (width > 1 || height > 1) {
            let downsample_started_at = Instant::now();
            rgba = downsample_rgba_2x(&rgba, width, height)?;
            downsample_duration += downsample_started_at.elapsed();
            width = next_mip_dimension(width);
            height = next_mip_dimension(height);
            let encode_started_at = Instant::now();
            let bytes = encode_dxt_surface(&rgba, width, height, output_format)?;
            encode_duration += encode_started_at.elapsed();
            levels.push(PreparedTextureMipLevel {
                level: u32::try_from(levels.len()).expect("mip level count fits u32"),
                width,
                height,
                format: output_format,
                format_raw: output_format.raw(),
                bytes,
            });
        }
    }

    Ok(PreparedTexturePayload {
        request,
        source_format: render_surface.format,
        source_format_raw: render_surface.format_raw,
        source_width: render_surface.width,
        source_height: render_surface.height,
        source_byte_length: render_surface.source_data.len(),
        source_hash: fnv1a64_hex(&render_surface.source_data),
        levels,
        timing: PreparedTextureTiming {
            decode: decode_duration,
            downsample: downsample_duration,
            encode: encode_duration,
            total: total_started_at.elapsed(),
        },
    })
}

fn prepare_normalized_rgba8_texture(
    total_started_at: Instant,
    request: PreparedTextureRequest,
    render_surface: &RenderSurface,
) -> Result<PreparedTexturePayload> {
    if request.color_space != PreparedTextureColorSpace::Linear {
        bail!("rgba8 normalized prepared textures require cs=linear");
    }
    let decode_started_at = Instant::now();
    let bytes = decode_render_surface_rgba8_bytes(render_surface)?;
    let decode_duration = decode_started_at.elapsed();
    Ok(PreparedTexturePayload {
        request,
        source_format: render_surface.format,
        source_format_raw: render_surface.format_raw,
        source_width: render_surface.width,
        source_height: render_surface.height,
        source_byte_length: render_surface.source_data.len(),
        source_hash: fnv1a64_hex(&render_surface.source_data),
        levels: vec![PreparedTextureMipLevel {
            level: 0,
            width: render_surface.width,
            height: render_surface.height,
            format: PixelFormatId::A8R8G8B8,
            format_raw: PixelFormatId::A8R8G8B8.raw(),
            bytes,
        }],
        timing: PreparedTextureTiming {
            decode: decode_duration,
            downsample: Duration::ZERO,
            encode: Duration::ZERO,
            total: total_started_at.elapsed(),
        },
    })
}

fn prepare_normalized_r8_texture(
    total_started_at: Instant,
    request: PreparedTextureRequest,
    render_surface: &RenderSurface,
) -> Result<PreparedTexturePayload> {
    if request.color_space != PreparedTextureColorSpace::Data {
        bail!("r8 normalized prepared textures require cs=data");
    }
    let decode_started_at = Instant::now();
    let bytes = decode_render_surface_r8_bytes(render_surface)?;
    let decode_duration = decode_started_at.elapsed();
    Ok(PreparedTexturePayload {
        request,
        source_format: render_surface.format,
        source_format_raw: render_surface.format_raw,
        source_width: render_surface.width,
        source_height: render_surface.height,
        source_byte_length: render_surface.source_data.len(),
        source_hash: fnv1a64_hex(&render_surface.source_data),
        levels: vec![PreparedTextureMipLevel {
            level: 0,
            width: render_surface.width,
            height: render_surface.height,
            format: PixelFormatId::A8,
            format_raw: PixelFormatId::A8.raw(),
            bytes,
        }],
        timing: PreparedTextureTiming {
            decode: decode_duration,
            downsample: Duration::ZERO,
            encode: Duration::ZERO,
            total: total_started_at.elapsed(),
        },
    })
}

fn prepare_normalized_index16_texture(
    total_started_at: Instant,
    request: PreparedTextureRequest,
    render_surface: &RenderSurface,
) -> Result<PreparedTexturePayload> {
    if request.color_space != PreparedTextureColorSpace::Data {
        bail!("index16 prepared textures require cs=data");
    }
    let decode_started_at = Instant::now();
    let bytes = decode_render_surface_index16_bytes(render_surface)?;
    let decode_duration = decode_started_at.elapsed();
    Ok(PreparedTexturePayload {
        request,
        source_format: render_surface.format,
        source_format_raw: render_surface.format_raw,
        source_width: render_surface.width,
        source_height: render_surface.height,
        source_byte_length: render_surface.source_data.len(),
        source_hash: fnv1a64_hex(&render_surface.source_data),
        levels: vec![PreparedTextureMipLevel {
            level: 0,
            width: render_surface.width,
            height: render_surface.height,
            format: PixelFormatId::Index16,
            format_raw: PixelFormatId::Index16.raw(),
            bytes,
        }],
        timing: PreparedTextureTiming {
            decode: decode_duration,
            downsample: Duration::ZERO,
            encode: Duration::ZERO,
            total: total_started_at.elapsed(),
        },
    })
}

fn decode_render_surface_rgba8_bytes(render_surface: &RenderSurface) -> Result<Vec<u8>> {
    match render_surface.format {
        PixelFormatId::Dxt1 | PixelFormatId::Dxt3 | PixelFormatId::Dxt5 => {
            validate_compressed_source(render_surface)?;
            decode_dxt_surface_rgba8_bytes(render_surface)
        }
        PixelFormatId::R8G8B8 | PixelFormatId::CustomLandscapeR8G8B8 => {
            validate_uncompressed_source(render_surface)?;
            let mut bytes = Vec::with_capacity(render_surface.source_data.len() / 3 * 4);
            for pixel in render_surface.source_data.chunks_exact(3) {
                bytes.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
            }
            Ok(bytes)
        }
        PixelFormatId::A8R8G8B8 => {
            validate_uncompressed_source(render_surface)?;
            let mut bytes = Vec::with_capacity(render_surface.source_data.len());
            for pixel in render_surface.source_data.chunks_exact(4) {
                bytes.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
            }
            Ok(bytes)
        }
        PixelFormatId::X8R8G8B8 => {
            validate_uncompressed_source(render_surface)?;
            let mut bytes = Vec::with_capacity(render_surface.source_data.len());
            for pixel in render_surface.source_data.chunks_exact(4) {
                bytes.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
            }
            Ok(bytes)
        }
        PixelFormatId::R5G6B5 => {
            validate_uncompressed_source(render_surface)?;
            let mut bytes = Vec::with_capacity(render_surface.source_data.len() / 2 * 4);
            for pixel in render_surface.source_data.chunks_exact(2) {
                let value = u16::from_le_bytes([pixel[0], pixel[1]]);
                let r = expand_5_to_8((value >> 11) & 0x1f);
                let g = expand_6_to_8((value >> 5) & 0x3f);
                let b = expand_5_to_8(value & 0x1f);
                bytes.extend_from_slice(&[r, g, b, 255]);
            }
            Ok(bytes)
        }
        PixelFormatId::A4R4G4B4 => {
            validate_uncompressed_source(render_surface)?;
            let mut bytes = Vec::with_capacity(render_surface.source_data.len() / 2 * 4);
            for pixel in render_surface.source_data.chunks_exact(2) {
                let value = u16::from_le_bytes([pixel[0], pixel[1]]);
                let a = expand_4_to_8((value >> 12) & 0x0f);
                let r = expand_4_to_8((value >> 8) & 0x0f);
                let g = expand_4_to_8((value >> 4) & 0x0f);
                let b = expand_4_to_8(value & 0x0f);
                bytes.extend_from_slice(&[r, g, b, a]);
            }
            Ok(bytes)
        }
        PixelFormatId::A8 | PixelFormatId::CustomLandscapeAlpha => {
            validate_uncompressed_source(render_surface)?;
            let mut bytes = Vec::with_capacity(render_surface.source_data.len() * 4);
            for alpha in &render_surface.source_data {
                bytes.extend_from_slice(&[*alpha, *alpha, *alpha, *alpha]);
            }
            Ok(bytes)
        }
        _ => bail!(
            "render surface 0x{:08X} format {:?} cannot be normalized to rgba8",
            render_surface.id,
            render_surface.format
        ),
    }
}

fn decode_render_surface_r8_bytes(render_surface: &RenderSurface) -> Result<Vec<u8>> {
    match render_surface.format {
        PixelFormatId::A8 | PixelFormatId::CustomLandscapeAlpha | PixelFormatId::P8 => {
            validate_uncompressed_source(render_surface)?;
            Ok(render_surface.source_data.clone())
        }
        _ => bail!(
            "render surface 0x{:08X} format {:?} cannot be normalized to r8",
            render_surface.id,
            render_surface.format
        ),
    }
}

fn decode_render_surface_index16_bytes(render_surface: &RenderSurface) -> Result<Vec<u8>> {
    match render_surface.format {
        PixelFormatId::Index16 => {
            validate_uncompressed_source(render_surface)?;
            Ok(render_surface.source_data.clone())
        }
        _ => bail!(
            "render surface 0x{:08X} format {:?} cannot be normalized to index16",
            render_surface.id,
            render_surface.format
        ),
    }
}

fn validate_uncompressed_source(render_surface: &RenderSurface) -> Result<()> {
    let bytes_per_pixel = render_surface
        .format
        .bytes_per_pixel()
        .ok_or_else(|| anyhow::anyhow!("format {:?} has no byte width", render_surface.format))?;
    let expected = usize::try_from(render_surface.width)
        .expect("texture width fits usize")
        .saturating_mul(usize::try_from(render_surface.height).expect("texture height fits usize"))
        .saturating_mul(usize::from(bytes_per_pixel));
    if render_surface.source_data.len() != expected {
        bail!(
            "render surface 0x{:08X} {:?} expected {} source bytes, got {}",
            render_surface.id,
            render_surface.format,
            expected,
            render_surface.source_data.len()
        );
    }
    Ok(())
}

fn expand_4_to_8(value: u16) -> u8 {
    ((value << 4) | value) as u8
}

fn expand_5_to_8(value: u16) -> u8 {
    ((value << 3) | (value >> 2)) as u8
}

fn expand_6_to_8(value: u16) -> u8 {
    ((value << 2) | (value >> 4)) as u8
}

pub fn serialize_prepared_texture_payload(
    payload: &PreparedTexturePayload,
    path_prefix: &str,
    writer: &mut crate::adapter::binary::BinaryAssetSectionWriter,
) -> serde_json::Value {
    let mut levels = Vec::new();
    for level in &payload.levels {
        let path = format!("{path_prefix}.levels.{}.bytes", level.level);
        writer.push_u8_section(
            format!("preparedTexture.level{}.bytes", level.level),
            path,
            1,
            &level.bytes,
        );
        levels.push(serde_json::json!({
            "level": level.level,
            "width": level.width,
            "height": level.height,
            "formatRaw": level.format_raw,
            "format": format!("{:?}", level.format),
            "byteLength": level.bytes.len(),
            "bytes": [],
        }));
    }

    serde_json::json!({
        "kind": "prepared-texture",
        "residencyKind": "unknown",
        "sourceAssetKind": "prepared-texture",
        "renderSurfaceId": payload.request.render_surface_id,
        "usage": format_usage(payload.request.usage),
        "outputFormat": format_output_format(payload.request.output_format),
        "mipPolicy": format_mip_policy(payload.request.mip_policy),
        "colorSpace": format_color_space(payload.request.color_space),
        "sourceFormatRaw": payload.source_format_raw,
        "sourceFormat": format!("{:?}", payload.source_format),
        "sourceWidth": payload.source_width,
        "sourceHeight": payload.source_height,
        "sourceByteLength": payload.source_byte_length,
        "sourceHash": payload.source_hash,
        "levels": levels,
        "dependencies": {
            "renderSurfaceAssetIds": [crate::adapter::json::format_render_surface_asset_id(payload.request.render_surface_id)],
        },
        "diagnostics": {
            "generatedLevelCount": payload.levels.len(),
            "generatedByteLength": payload.levels.iter().map(|level| level.bytes.len()).sum::<usize>(),
            "decodeMs": duration_ms(payload.timing.decode),
            "downsampleMs": duration_ms(payload.timing.downsample),
            "encodeMs": duration_ms(payload.timing.encode),
            "totalMs": duration_ms(payload.timing.total),
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "prepared-texture",
            "errorCode": null,
            "detail": null
        }
    })
}

fn duration_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

fn parse_typed_hex_data_id(raw_hex: &str, expected_type: u32) -> Option<u32> {
    let hex = raw_hex
        .strip_prefix("0x")
        .or_else(|| raw_hex.strip_prefix("0X"))
        .unwrap_or(raw_hex);
    (hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(hex, 16).ok())
        .flatten()
        .filter(|id| (id >> 24) == expected_type)
}

fn parse_usage(value: &str) -> Option<PreparedTextureUsage> {
    match value {
        "color" => Some(PreparedTextureUsage::Color),
        "detail" => Some(PreparedTextureUsage::Detail),
        "mask" => Some(PreparedTextureUsage::Mask),
        "raw" => Some(PreparedTextureUsage::Raw),
        _ => None,
    }
}

fn parse_output_format(value: &str) -> Option<PreparedTextureOutputFormat> {
    match value {
        "dxt1" => Some(PreparedTextureOutputFormat::Dxt1),
        "dxt3" => Some(PreparedTextureOutputFormat::Dxt3),
        "dxt5" => Some(PreparedTextureOutputFormat::Dxt5),
        "index16" => Some(PreparedTextureOutputFormat::Index16),
        "r8" => Some(PreparedTextureOutputFormat::R8),
        "rgba8" => Some(PreparedTextureOutputFormat::Rgba8),
        _ => None,
    }
}

fn parse_mip_policy(value: &str) -> Option<PreparedTextureMipPolicy> {
    match value {
        "none" => Some(PreparedTextureMipPolicy::None),
        "retail4" => Some(PreparedTextureMipPolicy::Retail4),
        _ => None,
    }
}

fn parse_color_space(value: &str) -> Option<PreparedTextureColorSpace> {
    match value {
        "srgb" => Some(PreparedTextureColorSpace::Srgb),
        "data" => Some(PreparedTextureColorSpace::Data),
        "linear" => Some(PreparedTextureColorSpace::Linear),
        "source" => Some(PreparedTextureColorSpace::Source),
        _ => None,
    }
}

fn format_usage(value: PreparedTextureUsage) -> &'static str {
    match value {
        PreparedTextureUsage::Color => "color",
        PreparedTextureUsage::Detail => "detail",
        PreparedTextureUsage::Mask => "mask",
        PreparedTextureUsage::Raw => "raw",
    }
}

fn format_output_format(value: PreparedTextureOutputFormat) -> &'static str {
    match value {
        PreparedTextureOutputFormat::Dxt1 => "dxt1",
        PreparedTextureOutputFormat::Dxt3 => "dxt3",
        PreparedTextureOutputFormat::Dxt5 => "dxt5",
        PreparedTextureOutputFormat::Index16 => "index16",
        PreparedTextureOutputFormat::R8 => "r8",
        PreparedTextureOutputFormat::Rgba8 => "rgba8",
    }
}

fn format_mip_policy(value: PreparedTextureMipPolicy) -> &'static str {
    match value {
        PreparedTextureMipPolicy::None => "none",
        PreparedTextureMipPolicy::Retail4 => "retail4",
    }
}

fn format_color_space(value: PreparedTextureColorSpace) -> &'static str {
    match value {
        PreparedTextureColorSpace::Srgb => "srgb",
        PreparedTextureColorSpace::Data => "data",
        PreparedTextureColorSpace::Linear => "linear",
        PreparedTextureColorSpace::Source => "source",
    }
}

fn output_format_pixel_format(value: PreparedTextureOutputFormat) -> PixelFormatId {
    match value {
        PreparedTextureOutputFormat::Dxt1 => PixelFormatId::Dxt1,
        PreparedTextureOutputFormat::Dxt3 => PixelFormatId::Dxt3,
        PreparedTextureOutputFormat::Dxt5 => PixelFormatId::Dxt5,
        PreparedTextureOutputFormat::Index16 => PixelFormatId::Index16,
        PreparedTextureOutputFormat::R8 => PixelFormatId::A8,
        PreparedTextureOutputFormat::Rgba8 => PixelFormatId::A8R8G8B8,
    }
}

fn fnv1a64_hex(bytes: &[u8]) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_query_style_prepared_texture_keys() {
        let request = parse_prepared_texture_asset_id(
            "prepared-texture/06001234?usage=detail&out=dxt5&mips=retail4&cs=data",
        )
        .expect("prepared texture key should parse");
        assert_eq!(request.render_surface_id, 0x0600_1234);
        assert_eq!(request.usage, PreparedTextureUsage::Detail);
        assert_eq!(request.output_format, PreparedTextureOutputFormat::Dxt5);
        assert_eq!(request.mip_policy, PreparedTextureMipPolicy::Retail4);
        assert_eq!(request.color_space, PreparedTextureColorSpace::Data);
        assert_eq!(
            format_prepared_texture_asset_id(&request),
            "prepared-texture/06001234?usage=detail&out=dxt5&mips=retail4&cs=data"
        );
    }

    #[test]
    fn parses_atlas_ready_decompressed_texture_keys() {
        let request = parse_prepared_texture_asset_id(
            "prepared-texture/06001234?usage=raw&out=rgba8&mips=none&cs=linear",
        )
        .expect("prepared texture key should parse");
        assert_eq!(request.render_surface_id, 0x0600_1234);
        assert_eq!(request.usage, PreparedTextureUsage::Raw);
        assert_eq!(request.output_format, PreparedTextureOutputFormat::Rgba8);
        assert_eq!(request.mip_policy, PreparedTextureMipPolicy::None);
        assert_eq!(request.color_space, PreparedTextureColorSpace::Linear);
        assert_eq!(
            format_prepared_texture_asset_id(&request),
            "prepared-texture/06001234?usage=raw&out=rgba8&mips=none&cs=linear"
        );
    }

    #[test]
    fn parses_single_channel_prepared_texture_keys() {
        let request = parse_prepared_texture_asset_id(
            "prepared-texture/06001234?usage=detail&out=r8&mips=none&cs=data",
        )
        .expect("prepared texture key should parse");
        assert_eq!(request.render_surface_id, 0x0600_1234);
        assert_eq!(request.usage, PreparedTextureUsage::Detail);
        assert_eq!(request.output_format, PreparedTextureOutputFormat::R8);
        assert_eq!(request.mip_policy, PreparedTextureMipPolicy::None);
        assert_eq!(request.color_space, PreparedTextureColorSpace::Data);
        assert_eq!(
            format_prepared_texture_asset_id(&request),
            "prepared-texture/06001234?usage=detail&out=r8&mips=none&cs=data"
        );
    }

    #[test]
    fn parses_index16_prepared_texture_keys() {
        let request = parse_prepared_texture_asset_id(
            "prepared-texture/06001234?usage=raw&out=index16&mips=none&cs=data",
        )
        .expect("prepared texture key should parse");
        assert_eq!(request.render_surface_id, 0x0600_1234);
        assert_eq!(request.usage, PreparedTextureUsage::Raw);
        assert_eq!(request.output_format, PreparedTextureOutputFormat::Index16);
        assert_eq!(request.mip_policy, PreparedTextureMipPolicy::None);
        assert_eq!(request.color_space, PreparedTextureColorSpace::Data);
        assert_eq!(
            format_prepared_texture_asset_id(&request),
            "prepared-texture/06001234?usage=raw&out=index16&mips=none&cs=data"
        );
    }

    #[test]
    fn preserves_dxt_level_zero_and_generates_retail_capped_mips() {
        let source_data = vec![0xff; 32 * 32 / 2];
        let render_surface = RenderSurface {
            id: 0x0600_1234,
            unknown: 0,
            width: 32,
            height: 32,
            format: PixelFormatId::Dxt1,
            format_raw: PixelFormatId::Dxt1.raw(),
            source_data: source_data.clone(),
            default_palette_id: None,
        };
        let request = PreparedTextureRequest {
            render_surface_id: render_surface.id,
            usage: PreparedTextureUsage::Color,
            output_format: PreparedTextureOutputFormat::Dxt1,
            mip_policy: PreparedTextureMipPolicy::Retail4,
            color_space: PreparedTextureColorSpace::Srgb,
        };
        let payload = prepare_texture(request, &render_surface).expect("prepare should succeed");
        assert_eq!(payload.levels.len(), 4);
        assert_eq!(payload.levels[0].bytes, source_data);
        assert_eq!(payload.levels[1].width, 16);
        assert_eq!(payload.levels[1].height, 16);
        assert_eq!(payload.levels[1].bytes.len(), 16 * 16 / 2);
    }

    #[test]
    fn decodes_dxt_to_single_level_rgba8_atlas_payload() {
        let render_surface = RenderSurface {
            id: 0x0600_1234,
            unknown: 0,
            width: 4,
            height: 4,
            format: PixelFormatId::Dxt1,
            format_raw: PixelFormatId::Dxt1.raw(),
            source_data: vec![0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
            default_palette_id: None,
        };
        let request = PreparedTextureRequest {
            render_surface_id: render_surface.id,
            usage: PreparedTextureUsage::Raw,
            output_format: PreparedTextureOutputFormat::Rgba8,
            mip_policy: PreparedTextureMipPolicy::None,
            color_space: PreparedTextureColorSpace::Linear,
        };

        let payload = prepare_texture(request, &render_surface).expect("prepare should succeed");

        assert_eq!(payload.levels.len(), 1);
        assert_eq!(payload.levels[0].width, 4);
        assert_eq!(payload.levels[0].height, 4);
        assert_eq!(payload.levels[0].format, PixelFormatId::A8R8G8B8);
        assert_eq!(payload.levels[0].bytes.len(), 4 * 4 * 4);
        assert!(
            payload.levels[0]
                .bytes
                .chunks_exact(4)
                .all(|pixel| pixel == [255, 255, 255, 255].as_slice())
        );
        assert_eq!(payload.timing.downsample, Duration::ZERO);
        assert_eq!(payload.timing.encode, Duration::ZERO);
    }

    #[test]
    fn normalizes_direct_color_to_single_level_rgba8_payload() {
        let render_surface = RenderSurface {
            id: 0x0600_1234,
            unknown: 0,
            width: 1,
            height: 1,
            format: PixelFormatId::A8R8G8B8,
            format_raw: PixelFormatId::A8R8G8B8.raw(),
            source_data: vec![0x10, 0x20, 0x30, 0x40],
            default_palette_id: None,
        };
        let request = PreparedTextureRequest {
            render_surface_id: render_surface.id,
            usage: PreparedTextureUsage::Raw,
            output_format: PreparedTextureOutputFormat::Rgba8,
            mip_policy: PreparedTextureMipPolicy::None,
            color_space: PreparedTextureColorSpace::Linear,
        };

        let payload = prepare_texture(request, &render_surface).expect("prepare should succeed");

        assert_eq!(payload.levels.len(), 1);
        assert_eq!(payload.levels[0].format, PixelFormatId::A8R8G8B8);
        assert_eq!(payload.levels[0].bytes, vec![0x30, 0x20, 0x10, 0x40]);
    }

    #[test]
    fn normalizes_alpha_to_single_level_r8_payload() {
        let render_surface = RenderSurface {
            id: 0x0600_1234,
            unknown: 0,
            width: 2,
            height: 1,
            format: PixelFormatId::A8,
            format_raw: PixelFormatId::A8.raw(),
            source_data: vec![0x10, 0x80],
            default_palette_id: None,
        };
        let request = PreparedTextureRequest {
            render_surface_id: render_surface.id,
            usage: PreparedTextureUsage::Detail,
            output_format: PreparedTextureOutputFormat::R8,
            mip_policy: PreparedTextureMipPolicy::None,
            color_space: PreparedTextureColorSpace::Data,
        };

        let payload = prepare_texture(request, &render_surface).expect("prepare should succeed");

        assert_eq!(payload.levels.len(), 1);
        assert_eq!(payload.levels[0].format, PixelFormatId::A8);
        assert_eq!(payload.levels[0].bytes, vec![0x10, 0x80]);
    }

    #[test]
    fn preserves_p8_as_single_level_r8_payload() {
        let render_surface = RenderSurface {
            id: 0x0600_1234,
            unknown: 0,
            width: 2,
            height: 1,
            format: PixelFormatId::P8,
            format_raw: PixelFormatId::P8.raw(),
            source_data: vec![0x03, 0xfe],
            default_palette_id: Some(0x0400_0001),
        };
        let request = PreparedTextureRequest {
            render_surface_id: render_surface.id,
            usage: PreparedTextureUsage::Raw,
            output_format: PreparedTextureOutputFormat::R8,
            mip_policy: PreparedTextureMipPolicy::None,
            color_space: PreparedTextureColorSpace::Data,
        };

        let payload = prepare_texture(request, &render_surface).expect("prepare should succeed");

        assert_eq!(payload.source_format, PixelFormatId::P8);
        assert_eq!(payload.levels.len(), 1);
        assert_eq!(payload.levels[0].format, PixelFormatId::A8);
        assert_eq!(payload.levels[0].bytes, vec![0x03, 0xfe]);
    }

    #[test]
    fn preserves_index16_as_single_level_index16_payload() {
        let render_surface = RenderSurface {
            id: 0x0600_1234,
            unknown: 0,
            width: 2,
            height: 1,
            format: PixelFormatId::Index16,
            format_raw: PixelFormatId::Index16.raw(),
            source_data: vec![0x03, 0x00, 0xfe, 0x00],
            default_palette_id: Some(0x0400_0001),
        };
        let request = PreparedTextureRequest {
            render_surface_id: render_surface.id,
            usage: PreparedTextureUsage::Raw,
            output_format: PreparedTextureOutputFormat::Index16,
            mip_policy: PreparedTextureMipPolicy::None,
            color_space: PreparedTextureColorSpace::Data,
        };

        let payload = prepare_texture(request, &render_surface).expect("prepare should succeed");

        assert_eq!(payload.levels.len(), 1);
        assert_eq!(payload.levels[0].format, PixelFormatId::Index16);
        assert_eq!(payload.levels[0].bytes, vec![0x03, 0x00, 0xfe, 0x00]);
    }
}

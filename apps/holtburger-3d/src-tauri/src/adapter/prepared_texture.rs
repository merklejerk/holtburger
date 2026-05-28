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
        if request.output_format == PreparedTextureOutputFormat::Rgba8
            && request.mip_policy == PreparedTextureMipPolicy::None
        {
            return prepare_decompressed_atlas_texture(total_started_at, request, render_surface);
        }
        bail!("unsupported prepared texture mip policy");
    }
    if request.output_format == PreparedTextureOutputFormat::Rgba8 {
        bail!("rgba8 prepared textures require mips=none");
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

fn prepare_decompressed_atlas_texture(
    total_started_at: Instant,
    request: PreparedTextureRequest,
    render_surface: &RenderSurface,
) -> Result<PreparedTexturePayload> {
    if request.color_space != PreparedTextureColorSpace::Linear {
        bail!("rgba8 atlas-ready prepared textures require cs=linear");
    }
    validate_compressed_source(render_surface)?;
    let decode_started_at = Instant::now();
    let bytes = decode_dxt_surface_rgba8_bytes(render_surface)?;
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
}

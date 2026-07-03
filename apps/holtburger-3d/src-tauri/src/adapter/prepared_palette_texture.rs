use crate::adapter::binary::BinaryAssetSectionWriter;
use crate::adapter::json::format_palette_asset_id;
use anyhow::{Context, Result, bail};
use holtburger_dat::file_type::{Palette, PixelFormatId};
use std::collections::{HashMap, VecDeque};
use std::hash::Hash;

const PREPARED_PALETTE_TEXTURE_PREFIX: &str = "prepared-palette-texture/";
pub const PREPARED_PALETTE_TEXTURE_CACHE_CAPACITY: usize = 1_024;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PreparedPaletteTextureRequest {
    pub base_palette_id: u32,
    pub domain: PreparedPaletteTextureDomain,
    pub replacements: Vec<PreparedPaletteReplacement>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PreparedPaletteTextureDomain {
    Index8,
    Index16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PreparedPaletteReplacement {
    pub palette_id: u32,
    pub offset: u32,
    pub count: u32,
}

#[derive(Debug, Clone)]
pub struct PreparedPaletteTexturePayload {
    pub request: PreparedPaletteTextureRequest,
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
    pub content_hash: String,
}

#[derive(Debug)]
pub struct PreparedPaletteTextureCache {
    entries: SimpleLru<PreparedPaletteTextureRequest, PreparedPaletteTexturePayload>,
}

impl PreparedPaletteTextureCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: SimpleLru::new(capacity),
        }
    }

    pub fn get(
        &mut self,
        request: &PreparedPaletteTextureRequest,
    ) -> Option<PreparedPaletteTexturePayload> {
        self.entries.get(request)
    }

    pub fn insert(&mut self, payload: PreparedPaletteTexturePayload) {
        self.entries.insert(payload.request.clone(), payload);
    }

    pub fn get_or_insert_with(
        &mut self,
        request: &PreparedPaletteTextureRequest,
        prepare: impl FnOnce() -> Result<PreparedPaletteTexturePayload>,
    ) -> Result<PreparedPaletteTexturePayload> {
        if let Some(payload) = self.get(request) {
            return Ok(payload);
        }
        let payload = prepare()?;
        self.insert(payload.clone());
        Ok(payload)
    }
}

#[derive(Debug)]
struct SimpleLru<K, V> {
    capacity: usize,
    values: HashMap<K, V>,
    order: VecDeque<K>,
}

impl<K, V> SimpleLru<K, V>
where
    K: Clone + Eq + Hash,
    V: Clone,
{
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            values: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    fn get(&mut self, key: &K) -> Option<V> {
        let value = self.values.get(key).cloned()?;
        self.touch(key);
        Some(value)
    }

    fn insert(&mut self, key: K, value: V) {
        if self.capacity == 0 {
            return;
        }
        if self.values.insert(key.clone(), value).is_some() {
            self.touch(&key);
            return;
        }
        self.order.push_back(key.clone());
        while self.values.len() > self.capacity {
            let Some(evicted_key) = self.order.pop_front() else {
                break;
            };
            self.values.remove(&evicted_key);
        }
    }

    fn touch(&mut self, key: &K) {
        self.order.retain(|existing_key| existing_key != key);
        self.order.push_back(key.clone());
    }
}

pub fn prepare_palette_texture(
    request: PreparedPaletteTextureRequest,
    base_palette: &Palette,
    replacement_palettes: &[(PreparedPaletteReplacement, Palette)],
) -> Result<PreparedPaletteTexturePayload> {
    if request.base_palette_id != base_palette.id {
        bail!(
            "prepared palette texture request 0x{:08X} was given Palette 0x{:08X}",
            request.base_palette_id,
            base_palette.id
        );
    }

    let mut replacements = request.replacements.clone();
    normalize_replacements(&mut replacements);
    if replacements.len() != replacement_palettes.len() {
        bail!(
            "prepared palette texture {} expected {} replacement palettes, got {}",
            format_prepared_palette_texture_asset_id(&request),
            replacements.len(),
            replacement_palettes.len()
        );
    }

    let color_count = prepared_palette_color_count(request.domain, base_palette, &replacements)?;
    let (width, height) = square_dimensions_for_color_count(color_count)?;
    let mut colors_argb = vec![0; color_count];
    for (index, color) in base_palette
        .colors_argb
        .iter()
        .take(color_count)
        .enumerate()
    {
        colors_argb[index] = *color;
    }

    for (expected, (actual, palette)) in replacements.iter().zip(replacement_palettes) {
        if expected != actual {
            bail!(
                "prepared palette texture {} replacement palette order mismatch",
                format_prepared_palette_texture_asset_id(&request)
            );
        }
        if expected.palette_id != palette.id {
            bail!(
                "prepared palette texture replacement 0x{:08X} was given Palette 0x{:08X}",
                expected.palette_id,
                palette.id
            );
        }
        let offset =
            usize::try_from(expected.offset).expect("palette replacement offset fits usize");
        let count = usize::try_from(expected.count).expect("palette replacement count fits usize");
        let end = offset
            .checked_add(count)
            .ok_or_else(|| anyhow::anyhow!("palette replacement range overflows usize"))?;
        if end > palette.colors_argb.len() {
            bail!(
                "prepared palette texture {} replacement 0x{:08X}@{}+{} exceeds replacement palette color count {}",
                format_prepared_palette_texture_asset_id(&request),
                expected.palette_id,
                expected.offset,
                expected.count,
                palette.colors_argb.len()
            );
        }
        colors_argb[offset..end].copy_from_slice(&palette.colors_argb[offset..end]);
    }

    let texture_color_count = usize::try_from(width)
        .expect("palette width fits usize")
        .saturating_mul(usize::try_from(height).expect("palette height fits usize"));
    let mut pixels = Vec::with_capacity(texture_color_count * 4);
    for color in colors_argb {
        pixels.extend_from_slice(&argb_to_rgba(color));
    }
    pixels.resize(texture_color_count * 4, 0);
    let content_hash = prepared_palette_content_hash(width, height, &pixels);

    Ok(PreparedPaletteTexturePayload {
        request: PreparedPaletteTextureRequest {
            replacements,
            ..request
        },
        width,
        height,
        pixels,
        content_hash,
    })
}

pub fn parse_prepared_palette_texture_asset_id(
    asset_id: &str,
) -> Option<PreparedPaletteTextureRequest> {
    let rest = asset_id.strip_prefix(PREPARED_PALETTE_TEXTURE_PREFIX)?;
    let (raw_base_palette_id, raw_query) = rest.split_once('?')?;
    let base_palette_id = parse_typed_hex_data_id(raw_base_palette_id, 0x04)?;

    let mut domain = None;
    let mut replacements = None;
    for pair in raw_query.split('&') {
        let (key, value) = pair.split_once('=')?;
        match key {
            "domain" => domain = Some(parse_domain(value)?),
            "repl" => replacements = Some(parse_replacements(value)?),
            _ => return None,
        }
    }

    let mut request = PreparedPaletteTextureRequest {
        base_palette_id,
        domain: domain?,
        replacements: replacements.unwrap_or_default(),
    };
    normalize_replacements(&mut request.replacements);
    Some(request)
}

pub fn format_prepared_palette_texture_asset_id(request: &PreparedPaletteTextureRequest) -> String {
    let mut replacements = request.replacements.clone();
    normalize_replacements(&mut replacements);
    let replacement_query = if replacements.is_empty() {
        String::new()
    } else {
        let replacement_list = replacements
            .iter()
            .map(|replacement| {
                format!(
                    "{:08x}:{}:{}",
                    replacement.palette_id, replacement.offset, replacement.count
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        format!("&repl={replacement_list}")
    };
    format!(
        "{PREPARED_PALETTE_TEXTURE_PREFIX}{:08x}?domain={}{}",
        request.base_palette_id,
        format_domain(request.domain),
        replacement_query
    )
}

pub fn serialize_prepared_palette_texture_payload(
    payload: &PreparedPaletteTexturePayload,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    writer.push_u8_section(
        "preparedPaletteTexture.pixels",
        format!("{path_prefix}.pixels"),
        4,
        &payload.pixels,
    );

    serde_json::json!({
        "kind": "prepared-palette-texture",
        "residencyKind": "unknown",
        "sourceAssetKind": "prepared-palette-texture",
        "basePaletteId": payload.request.base_palette_id,
        "domain": format_domain(payload.request.domain),
        "width": payload.width,
        "height": payload.height,
        "formatRaw": PixelFormatId::A8R8G8B8.raw(),
        "format": "rgba8",
        "byteLength": payload.pixels.len(),
        "contentHash": payload.content_hash,
        "replacements": payload.request.replacements.iter().map(|replacement| {
            serde_json::json!({
                "paletteId": replacement.palette_id,
                "offset": replacement.offset,
                "count": replacement.count,
            })
        }).collect::<Vec<_>>(),
        "pixels": [],
        "dependencies": {
            "paletteAssetIds": palette_dependencies(&payload.request),
        },
        "diagnostics": {
            "generatedByteLength": payload.pixels.len(),
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "prepared-palette-texture",
            "errorCode": null,
            "detail": null
        }
    })
}

pub fn prepared_palette_content_hash(width: u32, height: u32, pixels: &[u8]) -> String {
    let mut bytes = Vec::with_capacity("rgba8".len() + 8 + pixels.len());
    bytes.extend_from_slice(b"rgba8");
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(pixels);
    fnv1a64_hex(&bytes)
}

fn parse_replacements(value: &str) -> Option<Vec<PreparedPaletteReplacement>> {
    if value.is_empty() {
        return Some(Vec::new());
    }
    value
        .split(',')
        .map(|raw_replacement| {
            let mut parts = raw_replacement.split(':');
            let palette_id = parse_typed_hex_data_id(parts.next()?, 0x04)?;
            let offset = parts.next()?.parse::<u32>().ok()?;
            let count = parts.next()?.parse::<u32>().ok()?;
            if parts.next().is_some() {
                return None;
            }
            Some(PreparedPaletteReplacement {
                palette_id,
                offset,
                count,
            })
        })
        .collect()
}

fn domain_color_limit(domain: PreparedPaletteTextureDomain) -> usize {
    match domain {
        PreparedPaletteTextureDomain::Index8 => 256,
        PreparedPaletteTextureDomain::Index16 => 65_536,
    }
}

fn prepared_palette_color_count(
    domain: PreparedPaletteTextureDomain,
    base_palette: &Palette,
    replacements: &[PreparedPaletteReplacement],
) -> Result<usize> {
    let domain_limit = domain_color_limit(domain);
    let base_color_count = base_palette.colors_argb.len();
    if domain == PreparedPaletteTextureDomain::Index16 && base_color_count > domain_limit {
        bail!(
            "prepared palette texture base palette 0x{:08X} has {} colors, exceeding {} color domain",
            base_palette.id,
            base_color_count,
            domain_limit
        );
    }

    // P8 index textures can only address the first 256 palette entries, even when AC stores a
    // larger shared palette asset.
    let mut color_count = base_color_count.min(domain_limit);
    for replacement in replacements {
        let offset =
            usize::try_from(replacement.offset).expect("palette replacement offset fits usize");
        let count =
            usize::try_from(replacement.count).expect("palette replacement count fits usize");
        let end = offset
            .checked_add(count)
            .ok_or_else(|| anyhow::anyhow!("palette replacement range overflows usize"))?;
        if end > domain_limit {
            bail!(
                "prepared palette texture replacement 0x{:08X}@{}+{} exceeds {} color domain",
                replacement.palette_id,
                replacement.offset,
                replacement.count,
                domain_limit
            );
        }
        color_count = color_count.max(end);
    }

    Ok(color_count.max(1))
}

fn square_dimensions_for_color_count(color_count: usize) -> Result<(u32, u32)> {
    let color_count_u32 =
        u32::try_from(color_count).context("prepared palette color count exceeds u32")?;
    let mut side = 1u32;
    while side.saturating_mul(side) < color_count_u32 {
        side = side
            .checked_add(1)
            .context("prepared palette square side exceeds u32")?;
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

fn normalize_replacements(replacements: &mut [PreparedPaletteReplacement]) {
    replacements.sort_by_key(|replacement| {
        (
            replacement.offset,
            replacement.count,
            replacement.palette_id,
        )
    });
}

fn palette_dependencies(request: &PreparedPaletteTextureRequest) -> Vec<String> {
    let mut palette_ids = Vec::with_capacity(1 + request.replacements.len());
    palette_ids.push(request.base_palette_id);
    palette_ids.extend(
        request
            .replacements
            .iter()
            .map(|replacement| replacement.palette_id),
    );
    palette_ids.sort_unstable();
    palette_ids.dedup();
    palette_ids
        .into_iter()
        .map(format_palette_asset_id)
        .collect()
}

fn parse_domain(value: &str) -> Option<PreparedPaletteTextureDomain> {
    match value {
        "index8" => Some(PreparedPaletteTextureDomain::Index8),
        "index16" => Some(PreparedPaletteTextureDomain::Index16),
        _ => None,
    }
}

fn format_domain(value: PreparedPaletteTextureDomain) -> &'static str {
    match value {
        PreparedPaletteTextureDomain::Index8 => "index8",
        PreparedPaletteTextureDomain::Index16 => "index16",
    }
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
    fn parses_and_formats_prepared_palette_texture_routes() {
        let request = parse_prepared_palette_texture_asset_id(
            "prepared-palette-texture/04000001?domain=index16&repl=04000020:64:16,04000010:16:32",
        )
        .expect("prepared palette texture key should parse");

        assert_eq!(request.base_palette_id, 0x0400_0001);
        assert_eq!(request.domain, PreparedPaletteTextureDomain::Index16);
        assert_eq!(
            request.replacements,
            vec![
                PreparedPaletteReplacement {
                    palette_id: 0x0400_0010,
                    offset: 16,
                    count: 32,
                },
                PreparedPaletteReplacement {
                    palette_id: 0x0400_0020,
                    offset: 64,
                    count: 16,
                },
            ]
        );
        assert_eq!(
            format_prepared_palette_texture_asset_id(&request),
            "prepared-palette-texture/04000001?domain=index16&repl=04000010:16:32,04000020:64:16"
        );
    }

    #[test]
    fn parses_prepared_palette_texture_routes_without_replacements() {
        let request = parse_prepared_palette_texture_asset_id(
            "prepared-palette-texture/04000001?domain=index8",
        )
        .expect("prepared palette texture key should parse");

        assert_eq!(request.base_palette_id, 0x0400_0001);
        assert_eq!(request.domain, PreparedPaletteTextureDomain::Index8);
        assert!(request.replacements.is_empty());
        assert_eq!(
            format_prepared_palette_texture_asset_id(&request),
            "prepared-palette-texture/04000001?domain=index8"
        );
    }

    #[test]
    fn rejects_non_palette_route_ids() {
        assert!(
            parse_prepared_palette_texture_asset_id(
                "prepared-palette-texture/06000001?domain=index8"
            )
            .is_none()
        );
        assert!(
            parse_prepared_palette_texture_asset_id(
                "prepared-palette-texture/04000001?domain=index8&repl=06000001:0:1"
            )
            .is_none()
        );
    }

    #[test]
    fn serializes_pixels_as_binary_section() {
        let request = PreparedPaletteTextureRequest {
            base_palette_id: 0x0400_0001,
            domain: PreparedPaletteTextureDomain::Index8,
            replacements: vec![PreparedPaletteReplacement {
                palette_id: 0x0400_0010,
                offset: 16,
                count: 32,
            }],
        };
        let pixels = vec![0x11, 0x22, 0x33, 0xff, 0x44, 0x55, 0x66, 0x80];
        let payload = PreparedPaletteTexturePayload {
            request,
            width: 2,
            height: 1,
            content_hash: prepared_palette_content_hash(2, 1, &pixels),
            pixels,
        };
        let mut writer = BinaryAssetSectionWriter::default();
        let serialized = serialize_prepared_palette_texture_payload(
            &payload,
            "responses.0.payload",
            &mut writer,
        );

        assert_eq!(serialized["kind"], "prepared-palette-texture");
        assert_eq!(serialized["pixels"], serde_json::json!([]));
        assert_eq!(serialized["byteLength"], 8);
        assert_eq!(
            serialized["dependencies"]["paletteAssetIds"],
            serde_json::json!(["palette/04000001", "palette/04000010"])
        );
        assert_eq!(writer.serialize_sections().len(), 1);
    }

    #[test]
    fn prepares_index8_dynamic_square_rgba_with_padding() {
        let request = PreparedPaletteTextureRequest {
            base_palette_id: 0x0400_0001,
            domain: PreparedPaletteTextureDomain::Index8,
            replacements: Vec::new(),
        };
        let base_palette = Palette {
            id: 0x0400_0001,
            colors_argb: vec![0xff11_2233, 0x8044_5566],
        };

        let payload = prepare_palette_texture(request, &base_palette, &[])
            .expect("prepared palette texture should compose");

        assert_eq!(payload.width, 2);
        assert_eq!(payload.height, 2);
        assert_eq!(payload.pixels.len(), 2 * 2 * 4);
        assert_eq!(
            &payload.pixels[0..8],
            &[0x11, 0x22, 0x33, 0xff, 0x44, 0x55, 0x66, 0x80]
        );
        assert_eq!(&payload.pixels[8..12], &[0, 0, 0, 0]);
        assert_eq!(
            payload.content_hash,
            prepared_palette_content_hash(payload.width, payload.height, &payload.pixels)
        );
    }

    #[test]
    fn prepares_index16_dynamic_square_rgba_with_padding() {
        let request = PreparedPaletteTextureRequest {
            base_palette_id: 0x0400_0001,
            domain: PreparedPaletteTextureDomain::Index16,
            replacements: Vec::new(),
        };
        let base_palette = Palette {
            id: 0x0400_0001,
            colors_argb: vec![0xff11_2233; 2_048],
        };

        let payload = prepare_palette_texture(request, &base_palette, &[])
            .expect("prepared palette texture should compose");

        assert_eq!(payload.width, 46);
        assert_eq!(payload.height, 46);
        assert_eq!(payload.pixels.len(), 46 * 46 * 4);
        assert_eq!(&payload.pixels[0..4], &[0x11, 0x22, 0x33, 0xff]);
        assert_eq!(&payload.pixels[(2_048 * 4)..(2_049 * 4)], &[0, 0, 0, 0]);
    }

    #[test]
    fn applies_replacements_before_hashing() {
        let request = PreparedPaletteTextureRequest {
            base_palette_id: 0x0400_0001,
            domain: PreparedPaletteTextureDomain::Index8,
            replacements: vec![PreparedPaletteReplacement {
                palette_id: 0x0400_0010,
                offset: 1,
                count: 2,
            }],
        };
        let base_palette = Palette {
            id: 0x0400_0001,
            colors_argb: vec![0xff00_0001, 0xff00_0002, 0xff00_0003],
        };
        let replacement_palette = Palette {
            id: 0x0400_0010,
            colors_argb: vec![0xff10_0001, 0xff10_0002, 0xff10_0003],
        };

        let payload = prepare_palette_texture(
            request.clone(),
            &base_palette,
            &[(request.replacements[0], replacement_palette)],
        )
        .expect("prepared palette texture should compose");

        assert_eq!(
            &payload.pixels[0..12],
            &[0, 0, 1, 0xff, 0x10, 0, 2, 0xff, 0x10, 0, 3, 0xff]
        );
    }

    #[test]
    fn rejects_replacement_ranges_outside_destination_domain() {
        let request = PreparedPaletteTextureRequest {
            base_palette_id: 0x0400_0001,
            domain: PreparedPaletteTextureDomain::Index8,
            replacements: vec![PreparedPaletteReplacement {
                palette_id: 0x0400_0010,
                offset: 255,
                count: 2,
            }],
        };
        let base_palette = Palette {
            id: 0x0400_0001,
            colors_argb: vec![0; 256],
        };
        let replacement_palette = Palette {
            id: 0x0400_0010,
            colors_argb: vec![0; 257],
        };

        let error = prepare_palette_texture(
            request.clone(),
            &base_palette,
            &[(request.replacements[0], replacement_palette)],
        )
        .expect_err("replacement outside index8 domain should fail");

        assert!(error.to_string().contains("exceeds 256 color domain"));
    }

    #[test]
    fn rejects_replacement_ranges_outside_replacement_palette() {
        let request = PreparedPaletteTextureRequest {
            base_palette_id: 0x0400_0001,
            domain: PreparedPaletteTextureDomain::Index8,
            replacements: vec![PreparedPaletteReplacement {
                palette_id: 0x0400_0010,
                offset: 2,
                count: 2,
            }],
        };
        let base_palette = Palette {
            id: 0x0400_0001,
            colors_argb: vec![0; 256],
        };
        let replacement_palette = Palette {
            id: 0x0400_0010,
            colors_argb: vec![0; 3],
        };

        let error = prepare_palette_texture(
            request.clone(),
            &base_palette,
            &[(request.replacements[0], replacement_palette)],
        )
        .expect_err("replacement outside replacement palette should fail");

        assert!(
            error
                .to_string()
                .contains("exceeds replacement palette color count 3")
        );
    }

    #[test]
    fn prepared_palette_texture_cache_reuses_recipe_payloads() {
        let request = PreparedPaletteTextureRequest {
            base_palette_id: 0x0400_0001,
            domain: PreparedPaletteTextureDomain::Index8,
            replacements: Vec::new(),
        };
        let base_palette = Palette {
            id: 0x0400_0001,
            colors_argb: vec![0xff11_2233],
        };
        let mut cache = PreparedPaletteTextureCache::new(8);
        let mut compose_count = 0;

        let first = cache
            .get_or_insert_with(&request, || {
                compose_count += 1;
                prepare_palette_texture(request.clone(), &base_palette, &[])
            })
            .expect("first prepared palette should compose");
        let second = cache
            .get_or_insert_with(&request, || {
                compose_count += 1;
                prepare_palette_texture(request.clone(), &base_palette, &[])
            })
            .expect("second prepared palette should reuse cache");

        assert_eq!(compose_count, 1);
        assert_eq!(first.content_hash, second.content_hash);
        assert_eq!(first.pixels, second.pixels);
    }
}

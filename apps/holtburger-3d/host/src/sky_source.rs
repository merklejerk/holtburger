//! Closed resource record for the active region's sky objects, celestial and weather alike.
//!
//! The sky's resource set is closed and tiny — a handful of unique DAT ids across the shipped
//! region's 20 day groups — so it is projected once at region load rather than discovered as day
//! groups roll over. Only the resource closure crosses the boundary: placement is resolved per sky
//! tick in the frontend from the region's already-serialized `SkyDesc`, so this record carries no
//! residents.

use anyhow::{Context, Result};
use holtburger_content::ActiveRegionData;
use holtburger_core::ContentAssetRuntime;
use serde::Serialize;
use serde_json::{Value, json};

use crate::{
    binary_source_record::{BinarySectionManifest, BinarySectionWriter},
    object_resource_closure::ObjectResourceClosure,
    source_projection::dat_id,
};

pub(crate) const SKY_SOURCE_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBSK";
const SKY_SOURCE_RECORD_BINARY_HEADER_LEN: usize = 12;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkySourceRecordManifest {
    pub(crate) transport: &'static str,
    pub(crate) byte_order: &'static str,
    pub(crate) section_byte_offset_base: &'static str,
    /// Maps each sky DAT id the frontend can resolve onto its prepared definition.
    pub(crate) objects: Vec<Value>,
    pub(crate) definitions: Vec<Value>,
    pub(crate) geometries: Vec<Value>,
    pub(crate) materials: Vec<Value>,
    pub(crate) texture_dependencies: Vec<Value>,
    pub(crate) sections: Vec<BinarySectionManifest>,
}

/// Every DAT id a sky draw can reach, in ascending order.
///
/// Celestial and weather objects alike: both are drawn by the sky pass, weather in its own
/// after-landscape pass gated on the weather toggle (`GameSky::Draw`, acclient.c:297381). Weather
/// resources were excluded while that pass did not exist, which left the rain sheets and the
/// script-carrying emitter Setups unresolvable in the frontend.
///
/// Both an object's `default_gfx_object_id` and any non-zero `SkyObjectReplace.gfx_object_id`
/// qualify, because retail applies a gfx replacement unconditionally — including to an object
/// currently outside its authored window (`SkyDesc::GetSky`, acclient.c:292478).
fn sky_source_ids(region: &ActiveRegionData) -> Vec<u32> {
    let Some(sky) = region.descriptor.sky_info.as_ref() else {
        return Vec::new();
    };
    let mut ids = std::collections::BTreeSet::new();
    for group in &sky.day_groups {
        for object in &group.sky_objects {
            if object.default_gfx_object_id != 0 {
                ids.insert(object.default_gfx_object_id);
            }
        }
        for time in &group.sky_times {
            for replacement in &time.sky_object_replacements {
                if replacement.gfx_object_id != 0 {
                    ids.insert(replacement.gfx_object_id);
                }
            }
        }
    }
    ids.into_iter().collect()
}

/// Build the closed sky resource record shared by the app host and headless browser harness.
pub async fn load_sky_source_bytes(runtime: &ContentAssetRuntime) -> Result<Vec<u8>> {
    let asset = runtime
        .load(holtburger_core::ContentAssetRequest::ActiveRegionData)
        .await
        .context("Could not load active-region static data")?;
    let holtburger_core::ContentAsset::ActiveRegionData(region) = asset else {
        unreachable!("active-region request must return active-region data")
    };

    let mut closure = ObjectResourceClosure::default();
    let mut objects = Vec::new();
    for source_did in sky_source_ids(&region) {
        let definition = closure.add_resident(runtime, source_did).await?;
        objects.push(json!({
            "gfxObjectId": dat_id(source_did),
            "source": definition,
        }));
    }
    closure.validate()?;

    let mut section_writer = BinarySectionWriter::default();
    closure.buffers.append_sections(&mut section_writer, "")?;
    let (sections, section_bytes) = section_writer.finish();
    let manifest = SkySourceRecordManifest {
        transport: "holtburger-sky-source-record",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        objects,
        definitions: closure.definitions,
        geometries: closure.geometries,
        materials: closure.materials.into_values().collect(),
        texture_dependencies: closure.texture_dependencies.into_values().collect(),
        sections,
    };
    serialize_sky_source_record_binary(&manifest, section_bytes)
}

fn serialize_sky_source_record_binary(
    manifest: &SkySourceRecordManifest,
    section_bytes: Vec<u8>,
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(manifest)?;
    while !(SKY_SOURCE_RECORD_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_length =
        SKY_SOURCE_RECORD_BINARY_HEADER_LEN + manifest_bytes.len() + section_bytes.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(SKY_SOURCE_RECORD_BINARY_MAGIC);
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    bytes.extend(section_bytes);
    Ok(bytes)
}

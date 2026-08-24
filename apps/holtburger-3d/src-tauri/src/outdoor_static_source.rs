//! Binary record envelope for one outdoor static layer.
//!
//! The resource closure this record carries is shared with interiors and the sky and lives in
//! [`crate::object_resource_closure`]; only the residents-and-layer framing is outdoor-static.

use anyhow::Result;
use serde::Serialize;
use serde_json::Value;

use crate::binary_source_record::BinarySectionManifest;

pub(crate) const OUTDOOR_STATIC_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBSO";
const OUTDOOR_STATIC_RECORD_BINARY_HEADER_LEN: usize = 12;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutdoorStaticSourceRecordManifest {
    pub(crate) transport: &'static str,
    pub(crate) byte_order: &'static str,
    pub(crate) section_byte_offset_base: &'static str,
    pub(crate) landblock_id: String,
    /// Typed layer identity consumed by the record decoder and batch projection.
    pub(crate) layer: &'static str,
    pub(crate) residents: Vec<Value>,
    /// Buildings layer only: per-source-DID overhead-map blocker silhouette ranges into the
    /// `mapBlockerPositions`/`mapBlockerIndices` sections. Other layers carry no map geometry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) map_blockers: Option<Vec<Value>>,
    pub(crate) definitions: Vec<Value>,
    pub(crate) geometries: Vec<Value>,
    pub(crate) materials: Vec<Value>,
    pub(crate) texture_dependencies: Vec<Value>,
    pub(crate) sections: Vec<BinarySectionManifest>,
}

pub(crate) fn serialize_outdoor_static_record_binary(
    manifest: &OutdoorStaticSourceRecordManifest,
    section_bytes: Vec<u8>,
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(manifest)?;
    while !(OUTDOOR_STATIC_RECORD_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_length =
        OUTDOOR_STATIC_RECORD_BINARY_HEADER_LEN + manifest_bytes.len() + section_bytes.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(OUTDOOR_STATIC_RECORD_BINARY_MAGIC);
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    bytes.extend(section_bytes);
    Ok(bytes)
}

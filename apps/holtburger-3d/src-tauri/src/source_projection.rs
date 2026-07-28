use serde_json::{Value, json};

use crate::polygon_geometry::RenderAabb;

/// Canonical lowercase transport identity for one DAT record.
pub(crate) fn dat_id(id: u32) -> String {
    format!("0x{id:08x}")
}

/// Lossless JSON projection of one renderer-space axis-aligned bound.
pub(crate) fn render_aabb_json(bounds: &RenderAabb) -> Value {
    json!({
        "min": [bounds.min.x, bounds.min.y, bounds.min.z],
        "max": [bounds.max.x, bounds.max.y, bounds.max.z],
    })
}

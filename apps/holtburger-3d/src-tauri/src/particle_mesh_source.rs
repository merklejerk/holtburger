//! Standalone resource closure for the meshes authored particles draw.
//!
//! A particle mesh is a bare GfxObj referenced by `hw_gfxobj_id`, not a landblock resident, so it
//! cannot ride the landblock source batch. It projects through the same
//! [`ObjectResourceClosure`] every other object path uses — `add_resident` already dispatches the
//! 0x01 family — so particle meshes reach the renderer as ordinary geometry and materials rather
//! than through a parallel pipeline.
//!
//! Several meshes are requested at once because one script closure typically names several
//! emitters, and batching them lets shared geometry and materials dedupe inside a single closure.

use anyhow::{Context, Result, ensure};
use holtburger_core::{ContentAsset, ContentAssetRequest, ContentAssetRuntime};
use holtburger_dat::file_type::DegradeOrientation;
use serde::Serialize;
use serde_json::{Value, json};

use crate::binary_source_record::{
    BinarySectionManifest, BinarySectionWriter, serialize_binary_envelope,
};
use crate::object_resource_closure::ObjectResourceClosure;
use crate::source_projection::dat_id;

pub(crate) const PARTICLE_MESH_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBPM";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParticleMeshRecordManifest {
    transport: &'static str,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    /// One entry per requested mesh, in request order.
    meshes: Vec<Value>,
    definitions: Vec<Value>,
    geometries: Vec<Value>,
    materials: Vec<Value>,
    texture_dependencies: Vec<Value>,
    sections: Vec<BinarySectionManifest>,
}

/// Orientation the mesh draws with at ordinary viewing distance.
///
/// Read from the mesh's authored 0x11 degrade info, which is where retail declares a mesh a
/// camera-facing sprite. The **near** band is used rather than a distance lookup, because retail's
/// LOD system is deliberately not adopted; the far bands exist only to degrade the near appearance.
/// A mesh with no degrade info keeps its authored frame.
async fn mesh_orientation(runtime: &ContentAssetRuntime, gfx_obj_id: u32) -> Result<&'static str> {
    let asset = runtime
        .load(ContentAssetRequest::GfxObj(gfx_obj_id))
        .await?;
    let ContentAsset::GfxObj(gfx_obj) = asset else {
        unreachable!("GfxObj request must return a GfxObj")
    };
    let Some(degrade_id) = gfx_obj.did_degrade else {
        return Ok("authored");
    };
    let asset = runtime
        .load(ContentAssetRequest::DegradeInfo(degrade_id))
        .await?;
    let ContentAsset::DegradeInfo(info) = asset else {
        unreachable!("DegradeInfo request must return degrade info")
    };
    Ok(match info.near_orientation() {
        Some(DegradeOrientation::ViewerFacing) => "viewer-facing",
        Some(DegradeOrientation::AxisLocked(_)) => "axis-locked",
        // Authored, unknown, or an empty band list all keep the authored frame.
        _ => "authored",
    })
}

/// Build the resource closure for one batch of particle meshes.
pub(crate) async fn load_particle_mesh_bytes(
    runtime: &ContentAssetRuntime,
    gfx_obj_ids: &[u32],
) -> Result<Vec<u8>> {
    ensure!(
        !gfx_obj_ids.is_empty(),
        "a particle mesh request must name at least one mesh"
    );
    let mut closure = ObjectResourceClosure::default();
    let mut meshes = Vec::with_capacity(gfx_obj_ids.len());
    for gfx_obj_id in gfx_obj_ids {
        ensure!(
            gfx_obj_id >> 24 == 0x01,
            "particle mesh 0x{gfx_obj_id:08X} is not a GfxObj"
        );
        let definition = closure
            .add_resident(runtime, *gfx_obj_id)
            .await
            .with_context(|| format!("Could not stage particle mesh 0x{gfx_obj_id:08X}"))?;
        meshes.push(json!({
            "hwGfxObjId": dat_id(*gfx_obj_id),
            "source": definition,
            "orientation": mesh_orientation(runtime, *gfx_obj_id).await?,
        }));
    }
    closure.validate()?;

    let mut section_writer = BinarySectionWriter::default();
    closure.buffers.append_sections(&mut section_writer, "")?;
    let (sections, section_bytes) = section_writer.finish();
    let manifest = ParticleMeshRecordManifest {
        transport: "holtburger-particle-mesh",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        meshes,
        definitions: closure.definitions,
        geometries: closure.geometries,
        materials: closure.materials.into_values().collect(),
        texture_dependencies: closure.texture_dependencies.into_values().collect(),
        sections,
    };
    serialize_binary_envelope(PARTICLE_MESH_RECORD_BINARY_MAGIC, &manifest, &section_bytes)
}

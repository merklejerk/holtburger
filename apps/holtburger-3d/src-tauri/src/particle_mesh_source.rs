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
use holtburger_core::ContentAssetRuntime;
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

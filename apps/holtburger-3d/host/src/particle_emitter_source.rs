//! Compact typed transport for one decoded 0x32 `ParticleEmitterInfo`.
//!
//! A flat manifest with no section data: an emitter definition is a fixed set of scalars and
//! vectors, so the binary-section machinery the animation and script lanes need would carry no
//! payload here.

use anyhow::{Result, ensure};
use holtburger_dat::file_type::{GfxObj, ParticleEmitterInfo, ParticleMotion};
use serde::Serialize;

use crate::binary_source_record::serialize_binary_envelope;
use crate::source_projection::dat_id;

pub(crate) const PARTICLE_EMITTER_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBPE";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParticleEmitterHardwareMeshManifest {
    /// Validated GfxObj identity used by mesh staging and final GPU batching.
    id: String,
    /// Origin-centered local radius containing every raw mesh vertex.
    radius: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParticleEmitterRecordManifest {
    transport: &'static str,
    byte_order: &'static str,
    emitter_info_id: String,
    /// `null` for a `ParticleType` no shipped emitter authors; consumers report rather than guess.
    motion_type: Option<u8>,
    emits_per_second: bool,
    /// Retail's per-meter predicate is unrecovered, so a consumer must refuse rather than guess.
    emits_per_meter: bool,
    /// The mesh each particle draws, or `null` when retail rejects the zero hardware DID.
    hardware_mesh: Option<ParticleEmitterHardwareMeshManifest>,
    /// Minimum interval between emissions in seconds, not a rate.
    birthrate_seconds: f64,
    max_particles: i32,
    initial_particles: i32,
    total_particles: i32,
    total_seconds: f64,
    /// Derived here so no consumer re-implements retail's persistence test.
    is_persistent: bool,
    lifespan: f64,
    lifespan_rand: f64,
    offset_dir: [f32; 3],
    min_offset: f32,
    max_offset: f32,
    a: [f32; 3],
    min_a: f32,
    max_a: f32,
    b: [f32; 3],
    min_b: f32,
    max_b: f32,
    c: [f32; 3],
    min_c: f32,
    max_c: f32,
    start_scale: f32,
    final_scale: f32,
    scale_rand: f32,
    start_trans: f32,
    final_trans: f32,
    trans_rand: f32,
    /// True when particles rigidly follow the live parent frame instead of being left behind.
    follows_parent: bool,
}

/// Serialize one decoded emitter definition into a compact typed frontend record.
pub(crate) fn serialize_particle_emitter_record_binary(
    info: &ParticleEmitterInfo,
    hardware_mesh: Option<&GfxObj>,
) -> Result<Vec<u8>> {
    ensure!(
        info.lifespan.is_finite() && info.lifespan >= 0.0,
        "ParticleEmitterInfo lifespan {} is unusable",
        info.lifespan
    );
    ensure!(
        info.max_particles >= 0 && info.initial_particles >= 0 && info.total_particles >= 0,
        "ParticleEmitterInfo particle counts must be non-negative"
    );
    let hardware_mesh = match (info.hw_gfx_obj_id, hardware_mesh) {
        (0, None) => None,
        (0, Some(_)) => anyhow::bail!(
            "ParticleEmitterInfo 0x{:08X} has a GfxObj but no hardware mesh ID",
            info.id
        ),
        (mesh_id, None) => anyhow::bail!(
            "ParticleEmitterInfo 0x{:08X} hardware mesh 0x{mesh_id:08X} was not provided",
            info.id
        ),
        (mesh_id, Some(mesh)) => {
            ensure!(
                mesh_id >> 24 == 0x01,
                "ParticleEmitterInfo 0x{:08X} hardware mesh 0x{mesh_id:08X} is not a GfxObj",
                info.id
            );
            ensure!(
                mesh.id == mesh_id,
                "ParticleEmitterInfo 0x{:08X} names hardware mesh 0x{mesh_id:08X}, but received GfxObj 0x{:08X}",
                info.id,
                mesh.id
            );
            Some(ParticleEmitterHardwareMeshManifest {
                id: dat_id(mesh_id),
                radius: particle_mesh_radius(mesh)?,
            })
        }
    };
    let manifest = ParticleEmitterRecordManifest {
        transport: "holtburger-particle-emitter",
        byte_order: "little-endian",
        emitter_info_id: dat_id(info.id),
        motion_type: match info.motion {
            ParticleMotion::Shipped(value) => Some(value),
            ParticleMotion::Unshipped(_) => None,
        },
        emits_per_second: info.trigger.per_second(),
        emits_per_meter: info.trigger.per_meter(),
        hardware_mesh,
        birthrate_seconds: info.birthrate,
        max_particles: info.max_particles,
        initial_particles: info.initial_particles,
        total_particles: info.total_particles,
        total_seconds: info.total_seconds,
        is_persistent: info.is_persistent(),
        lifespan: info.lifespan,
        lifespan_rand: info.lifespan_rand,
        offset_dir: [info.offset_dir.x, info.offset_dir.y, info.offset_dir.z],
        min_offset: info.min_offset,
        max_offset: info.max_offset,
        a: [info.a.x, info.a.y, info.a.z],
        min_a: info.min_a,
        max_a: info.max_a,
        b: [info.b.x, info.b.y, info.b.z],
        min_b: info.min_b,
        max_b: info.max_b,
        c: [info.c.x, info.c.y, info.c.z],
        min_c: info.min_c,
        max_c: info.max_c,
        start_scale: info.start_scale,
        final_scale: info.final_scale,
        scale_rand: info.scale_rand,
        start_trans: info.start_trans,
        final_trans: info.final_trans,
        trans_rand: info.trans_rand,
        follows_parent: info.is_parent_local != 0,
    };
    serialize_binary_envelope(PARTICLE_EMITTER_RECORD_BINARY_MAGIC, &manifest, &[])
}

/// Conservative origin-centered radius for one particle's immutable hardware mesh.
fn particle_mesh_radius(gfx_obj: &GfxObj) -> Result<f32> {
    ensure!(
        !gfx_obj.vertex_array.vertices.is_empty(),
        "Particle GfxObj 0x{:08X} has no vertices",
        gfx_obj.id
    );
    ensure!(
        gfx_obj.polygons.values().any(|polygon| {
            polygon.vertex_ids.len() >= 3
                && polygon
                    .vertex_ids
                    .iter()
                    .all(|vertex_id| gfx_obj.vertex_array.vertices.contains_key(vertex_id))
        }),
        "Particle GfxObj 0x{:08X} has no drawable polygon",
        gfx_obj.id
    );
    let mut maximum_squared = 0.0_f64;
    for (vertex_id, vertex) in &gfx_obj.vertex_array.vertices {
        let origin = vertex.origin;
        ensure!(
            origin.x.is_finite() && origin.y.is_finite() && origin.z.is_finite(),
            "Particle GfxObj 0x{:08X} vertex {vertex_id} has a non-finite origin",
            gfx_obj.id
        );
        let x = f64::from(origin.x);
        let y = f64::from(origin.y);
        let z = f64::from(origin.z);
        maximum_squared = maximum_squared.max(x * x + y * y + z * z);
    }
    let radius = maximum_squared.sqrt();
    ensure!(
        radius <= f64::from(f32::MAX),
        "Particle GfxObj 0x{:08X} radius {radius} exceeds f32",
        gfx_obj.id
    );
    let nearest = radius as f32;
    if f64::from(nearest) >= radius {
        return Ok(nearest);
    }
    // A nearest-value cast may round downward. Advance once so the transported radius retains the
    // containment guarantee instead of becoming an approximate measurement.
    Ok(f32::from_bits(nearest.to_bits() + 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binary_source_record::BINARY_HEADER_LENGTH;
    use holtburger_common::Vector3;
    use holtburger_common::properties::GfxObjFlags;
    use holtburger_dat::file_type::particle_emitter_info::EmitterTrigger;
    use holtburger_dat::graphics::{CVertexArray, Polygon, SWVertex};
    use std::collections::HashMap;

    fn info(motion: ParticleMotion, total_particles: i32) -> ParticleEmitterInfo {
        ParticleEmitterInfo {
            id: 0x3200_020C,
            trigger: EmitterTrigger(1),
            motion,
            gfx_obj_id: 0x0100_1234,
            hw_gfx_obj_id: 0x0100_0FF4,
            birthrate: 0.25,
            max_particles: 10,
            initial_particles: 2,
            total_particles,
            total_seconds: 0.0,
            lifespan: 4.0,
            lifespan_rand: 0.0,
            offset_dir: Vector3::new(0.0, 0.0, 1.0),
            min_offset: 0.0,
            max_offset: 1.0,
            a: Vector3::new(0.0, 0.0, 0.0),
            min_a: 1.0,
            max_a: 1.0,
            b: Vector3::new(0.0, 0.0, 0.0),
            min_b: 1.0,
            max_b: 1.0,
            c: Vector3::new(0.0, 0.0, 0.0),
            min_c: 1.0,
            max_c: 1.0,
            start_scale: 1.0,
            final_scale: 2.0,
            scale_rand: 0.0,
            start_trans: 0.0,
            final_trans: 1.0,
            trans_rand: 0.0,
            is_parent_local: 0,
        }
    }

    fn manifest(bytes: &[u8]) -> serde_json::Value {
        assert_eq!(&bytes[..4], PARTICLE_EMITTER_RECORD_BINARY_MAGIC);
        let length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        serde_json::from_slice(&bytes[BINARY_HEADER_LENGTH..BINARY_HEADER_LENGTH + length]).unwrap()
    }

    fn gfx_obj(origins: &[[f32; 3]]) -> GfxObj {
        let mut padded_origins = origins.to_vec();
        if !padded_origins.is_empty() && padded_origins.len() < 3 {
            padded_origins.resize(3, [0.0, 0.0, 0.0]);
        }
        let vertices = padded_origins
            .iter()
            .enumerate()
            .map(|(index, [x, y, z])| {
                (
                    u16::try_from(index).unwrap(),
                    SWVertex {
                        num_uvs: 0,
                        origin: Vector3::new(*x, *y, *z),
                        normal: Vector3::zero(),
                        uvs: Vec::new(),
                    },
                )
            })
            .collect::<HashMap<_, _>>();
        let polygons = (!vertices.is_empty())
            .then(|| {
                (
                    0,
                    Polygon {
                        num_pts: 3,
                        stippling: 0x0C,
                        sides_type: 1,
                        pos_surface: 0,
                        neg_surface: 0,
                        vertex_ids: vec![0, 1, 2],
                        pos_uv_indices: Vec::new(),
                        neg_uv_indices: Vec::new(),
                    },
                )
            })
            .into_iter()
            .collect();
        GfxObj {
            id: 0x0100_0FF4,
            flags: GfxObjFlags::empty(),
            surfaces: Vec::new(),
            vertex_array: CVertexArray {
                vertex_type: 1,
                vertices,
            },
            physics_polygons: HashMap::new(),
            physics_bsp: None,
            sort_center: Vector3::zero(),
            polygons,
            drawing_bsp: None,
            did_degrade: None,
        }
    }

    #[test]
    fn projects_a_persistent_emitter_with_derived_facts() {
        let mesh = gfx_obj(&[[0.0, 0.0, 2.5]]);
        let bytes = serialize_particle_emitter_record_binary(
            &info(ParticleMotion::Shipped(2), 0),
            Some(&mesh),
        )
        .unwrap();

        let manifest = manifest(&bytes);
        assert_eq!(manifest["emitterInfoId"], "0x3200020c");
        assert_eq!(manifest["motionType"], 2);
        assert_eq!(manifest["hardwareMesh"]["id"], "0x01000ff4");
        assert_eq!(manifest["hardwareMesh"]["radius"], 2.5);
        // Persistence is derived once here rather than re-tested by every consumer.
        assert_eq!(manifest["isPersistent"], true);
        assert_eq!(manifest["emitsPerSecond"], true);
        assert_eq!(manifest["emitsPerMeter"], false);
        assert_eq!(manifest["followsParent"], false);
    }

    #[test]
    fn reports_an_unshipped_motion_type_as_absent_rather_than_guessing() {
        let mesh = gfx_obj(&[[0.0, 0.0, 2.5]]);
        let bytes = serialize_particle_emitter_record_binary(
            &info(ParticleMotion::Unshipped(10), 0),
            Some(&mesh),
        )
        .unwrap();

        assert!(manifest(&bytes)["motionType"].is_null());
    }

    #[test]
    fn a_particle_budget_makes_an_emitter_finite() {
        let mesh = gfx_obj(&[[0.0, 0.0, 2.5]]);
        let bytes = serialize_particle_emitter_record_binary(
            &info(ParticleMotion::Shipped(1), 20),
            Some(&mesh),
        )
        .unwrap();

        assert_eq!(manifest(&bytes)["isPersistent"], false);
    }

    #[test]
    fn projects_the_zero_hardware_did_as_one_absent_mesh_fact() {
        let mut inert = info(ParticleMotion::Shipped(1), 0);
        inert.hw_gfx_obj_id = 0;

        let bytes = serialize_particle_emitter_record_binary(&inert, None).unwrap();

        assert!(manifest(&bytes)["hardwareMesh"].is_null());
    }

    #[test]
    fn rejects_inconsistent_hardware_mesh_facts() {
        let drawable = info(ParticleMotion::Shipped(1), 0);
        assert!(
            serialize_particle_emitter_record_binary(&drawable, None)
                .unwrap_err()
                .to_string()
                .contains("was not provided")
        );

        let mut inert = drawable;
        inert.hw_gfx_obj_id = 0;
        let mesh = gfx_obj(&[[1.0, 0.0, 0.0]]);
        assert!(
            serialize_particle_emitter_record_binary(&inert, Some(&mesh))
                .unwrap_err()
                .to_string()
                .contains("has a GfxObj but no hardware mesh ID")
        );
    }

    #[test]
    fn rejects_a_gfx_obj_that_does_not_match_the_authored_hardware_mesh() {
        let drawable = info(ParticleMotion::Shipped(1), 0);
        let mut wrong_mesh = gfx_obj(&[[1.0, 0.0, 0.0]]);
        wrong_mesh.id = 0x0100_0FF5;

        assert!(
            serialize_particle_emitter_record_binary(&drawable, Some(&wrong_mesh))
                .unwrap_err()
                .to_string()
                .contains("received GfxObj 0x01000FF5")
        );
    }

    #[test]
    fn derives_smaller_and_larger_than_unit_mesh_radii() {
        assert_eq!(
            particle_mesh_radius(&gfx_obj(&[[0.25, 0.0, 0.0]])).unwrap(),
            0.25
        );
        assert_eq!(
            particle_mesh_radius(&gfx_obj(&[[3.0, 4.0, 0.0]])).unwrap(),
            5.0
        );
    }

    #[test]
    fn rounds_an_inexact_radius_upward_to_preserve_containment() {
        let radius = particle_mesh_radius(&gfx_obj(&[[1.0, 1.0, 0.0]])).unwrap();
        let exact = 2.0_f64.sqrt();

        assert!(f64::from(radius) >= exact);
        assert!(f64::from(f32::from_bits(radius.to_bits() - 1)) < exact);
    }

    #[test]
    fn rejects_empty_and_non_finite_particle_meshes() {
        assert!(
            particle_mesh_radius(&gfx_obj(&[]))
                .unwrap_err()
                .to_string()
                .contains("has no vertices")
        );
        assert!(
            particle_mesh_radius(&gfx_obj(&[[f32::NAN, 0.0, 0.0]]))
                .unwrap_err()
                .to_string()
                .contains("non-finite origin")
        );
        let mut no_polygons = gfx_obj(&[[1.0, 0.0, 0.0]]);
        no_polygons.polygons.clear();
        assert!(
            particle_mesh_radius(&no_polygons)
                .unwrap_err()
                .to_string()
                .contains("has no drawable polygon")
        );
    }

    #[test]
    fn shared_mesh_identity_projects_the_same_radius_fact() {
        let first = info(ParticleMotion::Shipped(1), 0);
        let mut second = info(ParticleMotion::Shipped(1), 0);
        second.id = 0x3200_020D;
        let mesh = gfx_obj(&[[0.0, 0.0, 2.5]]);

        let first_manifest =
            manifest(&serialize_particle_emitter_record_binary(&first, Some(&mesh)).unwrap());
        let second_manifest =
            manifest(&serialize_particle_emitter_record_binary(&second, Some(&mesh)).unwrap());

        assert_eq!(
            first_manifest["hardwareMesh"],
            second_manifest["hardwareMesh"]
        );
    }
}

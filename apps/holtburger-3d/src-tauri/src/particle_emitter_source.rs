//! Compact typed transport for one decoded 0x32 `ParticleEmitterInfo`.
//!
//! A flat manifest with no section data: an emitter definition is a fixed set of scalars and
//! vectors, so the binary-section machinery the animation and script lanes need would carry no
//! payload here.

use anyhow::{Result, ensure};
use holtburger_dat::file_type::{ParticleEmitterInfo, ParticleMotion};
use serde::Serialize;

use crate::binary_source_record::serialize_binary_envelope;
use crate::source_projection::dat_id;

pub(crate) const PARTICLE_EMITTER_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBPE";

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
    /// The mesh each particle draws. `gfx_obj_id` is parsed by the format but never read.
    hw_gfx_obj_id: String,
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
        hw_gfx_obj_id: dat_id(info.hw_gfx_obj_id),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::binary_source_record::BINARY_HEADER_LENGTH;
    use holtburger_common::Vector3;
    use holtburger_dat::file_type::particle_emitter_info::EmitterTrigger;

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

    #[test]
    fn projects_a_persistent_emitter_with_derived_facts() {
        let bytes =
            serialize_particle_emitter_record_binary(&info(ParticleMotion::Shipped(2), 0)).unwrap();

        let manifest = manifest(&bytes);
        assert_eq!(manifest["emitterInfoId"], "0x3200020c");
        assert_eq!(manifest["motionType"], 2);
        assert_eq!(manifest["hwGfxObjId"], "0x01000ff4");
        // Persistence is derived once here rather than re-tested by every consumer.
        assert_eq!(manifest["isPersistent"], true);
        assert_eq!(manifest["emitsPerSecond"], true);
        assert_eq!(manifest["emitsPerMeter"], false);
        assert_eq!(manifest["followsParent"], false);
    }

    #[test]
    fn reports_an_unshipped_motion_type_as_absent_rather_than_guessing() {
        let bytes =
            serialize_particle_emitter_record_binary(&info(ParticleMotion::Unshipped(10), 0))
                .unwrap();

        assert!(manifest(&bytes)["motionType"].is_null());
    }

    #[test]
    fn a_particle_budget_makes_an_emitter_finite() {
        let bytes = serialize_particle_emitter_record_binary(&info(ParticleMotion::Shipped(1), 20))
            .unwrap();

        assert_eq!(manifest(&bytes)["isPersistent"], false);
    }
}

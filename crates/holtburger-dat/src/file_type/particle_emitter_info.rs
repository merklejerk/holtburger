//! Typed 0x32 `ParticleEmitterInfo` decoding.
//!
//! Stream order is proven from ACE `ACE.DatLoader/FileTypes/ParticleEmitterInfo.cs:45-93`, which is
//! authoritative here: retail's `UnPack` decompile is provably mis-based (acclient.c:312956) and
//! must not be used for field order. Fields are sequential and unaligned, matching ACE's
//! `BinaryReader`.
//!
//! `sorting_sphere` is deliberately absent — it is not in the file. Retail derives it in `InitEnd`
//! as `radius = max(max_offset, max_a * lifespan)` (acclient.c:312431-312445), which under-bounds
//! the parabolic motion types; our runtime computes an exact envelope instead, so storing retail's
//! guess would only invite someone to use it.

use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};
use holtburger_common::Vector3;

/// How an emitter decides when to release the next particle.
///
/// A bitmask, not an enum: `&1` is per-second, `&2` is per-meter (acclient.c:312447-312476).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EmitterTrigger(pub i32);

impl EmitterTrigger {
    /// Emits on a time interval; `birthrate` is a **minimum interval**, not a rate.
    pub fn per_second(self) -> bool {
        self.0 & 1 != 0
    }

    /// Emits on distance travelled. The retail predicate is unrecovered (IDA-flagged undefined
    /// operands, acclient.c:312468), so a consumer must report rather than guess.
    pub fn per_meter(self) -> bool {
        self.0 & 2 != 0
    }
}

/// Closed-form motion law selecting how a particle's position evolves in elapsed time.
///
/// Every variant is `position = f(t, spawn constants, parent frame)` with no integration state
/// (formulas pinned at acclient.c:317446-317664). Values 0 and 10 are documented but author nothing
/// in shipped content, so they decode as `Unshipped` rather than being implemented.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParticleMotion {
    Shipped(u8),
    /// A `ParticleType` value no shipped emitter authors.
    Unshipped(i32),
}

impl ParticleMotion {
    /// Motion type values observed in the retail archive (2026-08-06 census over all 2,051 records).
    const SHIPPED: [i32; 11] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12];

    fn from_raw(raw: i32) -> Self {
        if Self::SHIPPED.contains(&raw) {
            Self::Shipped(raw as u8)
        } else {
            Self::Unshipped(raw)
        }
    }
}

/// One authored particle emitter definition.
#[derive(Debug, Clone, PartialEq)]
pub struct ParticleEmitterInfo {
    pub id: u32,
    pub trigger: EmitterTrigger,
    pub motion: ParticleMotion,
    /// Parsed for losslessness; the particle path never reads it — `hw_gfxobj_id` is the mesh.
    pub gfx_obj_id: u32,
    /// The mesh each particle draws.
    pub hw_gfx_obj_id: u32,
    /// Minimum interval between emissions in seconds; at most one particle emits per tick.
    pub birthrate: f64,
    pub max_particles: i32,
    pub initial_particles: i32,
    pub total_particles: i32,
    pub total_seconds: f64,
    pub lifespan: f64,
    pub lifespan_rand: f64,
    /// Direction the random spawn offset is projected perpendicular to.
    pub offset_dir: Vector3,
    pub min_offset: f32,
    pub max_offset: f32,
    pub a: Vector3,
    pub min_a: f32,
    pub max_a: f32,
    pub b: Vector3,
    pub min_b: f32,
    pub max_b: f32,
    pub c: Vector3,
    pub min_c: f32,
    pub max_c: f32,
    pub start_scale: f32,
    pub final_scale: f32,
    pub scale_rand: f32,
    pub start_trans: f32,
    pub final_trans: f32,
    pub trans_rand: f32,
    /// Nonzero re-reads the live parent frame each tick; zero leaves particles behind at their
    /// spawn-time snapshot (acclient.c:318262-318273).
    pub is_parent_local: i32,
}

impl ParticleEmitterInfo {
    /// An emitter with no particle budget and no duration never stops on its own.
    ///
    /// Retail's persistence test, verbatim (acclient.c:317417-317444).
    pub fn is_persistent(&self) -> bool {
        self.total_particles == 0 && self.total_seconds == 0.0
    }

    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        // ACE reads and discards this dword; no consumer has ever been identified for it.
        let _unknown = u32::read_le(reader)?;
        let info = Self {
            id,
            trigger: EmitterTrigger(i32::read_le(reader)?),
            motion: ParticleMotion::from_raw(i32::read_le(reader)?),
            gfx_obj_id: u32::read_le(reader)?,
            hw_gfx_obj_id: u32::read_le(reader)?,
            birthrate: f64::read_le(reader)?,
            max_particles: i32::read_le(reader)?,
            initial_particles: i32::read_le(reader)?,
            total_particles: i32::read_le(reader)?,
            total_seconds: f64::read_le(reader)?,
            lifespan: f64::read_le(reader)?,
            lifespan_rand: f64::read_le(reader)?,
            offset_dir: read_vector3(reader)?,
            min_offset: f32::read_le(reader)?,
            max_offset: f32::read_le(reader)?,
            a: read_vector3(reader)?,
            min_a: f32::read_le(reader)?,
            max_a: f32::read_le(reader)?,
            b: read_vector3(reader)?,
            min_b: f32::read_le(reader)?,
            max_b: f32::read_le(reader)?,
            c: read_vector3(reader)?,
            min_c: f32::read_le(reader)?,
            max_c: f32::read_le(reader)?,
            start_scale: f32::read_le(reader)?,
            final_scale: f32::read_le(reader)?,
            scale_rand: f32::read_le(reader)?,
            start_trans: f32::read_le(reader)?,
            final_trans: f32::read_le(reader)?,
            trans_rand: f32::read_le(reader)?,
            is_parent_local: i32::read_le(reader)?,
        };
        if !info.lifespan.is_finite() || info.lifespan < 0.0 {
            return Err(binrw::Error::Custom {
                pos: reader.stream_position()?,
                err: Box::new(format!(
                    "ParticleEmitterInfo 0x{id:08X} has unusable lifespan {}",
                    info.lifespan
                )),
            });
        }
        if info.birthrate < 0.0 || !info.birthrate.is_finite() {
            return Err(binrw::Error::Custom {
                pos: reader.stream_position()?,
                err: Box::new(format!(
                    "ParticleEmitterInfo 0x{id:08X} has unusable birthrate {}",
                    info.birthrate
                )),
            });
        }
        Ok(info)
    }
}

fn read_vector3<R: Read + Seek>(reader: &mut R) -> BinResult<Vector3> {
    Ok(Vector3 {
        x: f32::read_le(reader)?,
        y: f32::read_le(reader)?,
        z: f32::read_le(reader)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Build a record at the exact byte offsets the archive uses, so the reader is proven in place.
    fn encode(id: u32, motion: i32, total_particles: i32, total_seconds: f64) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes()); // unknown
        bytes.extend_from_slice(&1i32.to_le_bytes()); // emitter type: per-second
        bytes.extend_from_slice(&motion.to_le_bytes());
        bytes.extend_from_slice(&0x0100_1234u32.to_le_bytes()); // gfx_obj
        bytes.extend_from_slice(&0x0100_5678u32.to_le_bytes()); // hw_gfx_obj
        bytes.extend_from_slice(&0.25f64.to_le_bytes()); // birthrate
        bytes.extend_from_slice(&10i32.to_le_bytes()); // max
        bytes.extend_from_slice(&2i32.to_le_bytes()); // initial
        bytes.extend_from_slice(&total_particles.to_le_bytes());
        bytes.extend_from_slice(&total_seconds.to_le_bytes());
        bytes.extend_from_slice(&4.0f64.to_le_bytes()); // lifespan
        bytes.extend_from_slice(&0.0f64.to_le_bytes()); // lifespan_rand
        // offset_dir, min/max offset, then A/B/C blocks, scales, translucencies, is_parent_local.
        for value in [0.0f32, 0.0, 1.0, 0.0, 1.0] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for _ in 0..3 {
            for value in [0.0f32, 0.0, 0.0, 1.0, 1.0] {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        for value in [1.0f32, 2.0, 0.0, 0.0, 1.0, 0.0] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes.extend_from_slice(&1i32.to_le_bytes()); // is_parent_local
        bytes
    }

    #[test]
    fn reads_the_full_record_at_its_proven_offsets() {
        let bytes = encode(0x3200_020C, 2, 0, 0.0);
        // 176 bytes exactly; a layout slip would shift every field after the first double.
        assert_eq!(bytes.len(), 176);

        let info = ParticleEmitterInfo::read(&mut Cursor::new(bytes)).expect("should parse");

        assert_eq!(info.id, 0x3200_020C);
        assert_eq!(info.motion, ParticleMotion::Shipped(2));
        assert!(info.trigger.per_second());
        assert!(!info.trigger.per_meter());
        assert_eq!(info.hw_gfx_obj_id, 0x0100_5678);
        assert_eq!(info.birthrate, 0.25);
        assert_eq!(info.lifespan, 4.0);
        assert_eq!(info.start_scale, 1.0);
        assert_eq!(info.final_scale, 2.0);
        assert_eq!(info.is_parent_local, 1);
    }

    #[test]
    fn classifies_persistence_by_retails_own_test() {
        let persistent =
            ParticleEmitterInfo::read(&mut Cursor::new(encode(0x3200_0001, 1, 0, 0.0))).unwrap();
        assert!(persistent.is_persistent());

        let budgeted =
            ParticleEmitterInfo::read(&mut Cursor::new(encode(0x3200_0002, 1, 20, 0.0))).unwrap();
        assert!(!budgeted.is_persistent());

        let timed =
            ParticleEmitterInfo::read(&mut Cursor::new(encode(0x3200_0003, 1, 0, 5.0))).unwrap();
        assert!(!timed.is_persistent());
    }

    #[test]
    fn reports_a_motion_type_no_shipped_emitter_authors() {
        // Types 0 and 10 are documented but absent from all 2,051 archive records.
        let info =
            ParticleEmitterInfo::read(&mut Cursor::new(encode(0x3200_0004, 10, 0, 0.0))).unwrap();
        assert_eq!(info.motion, ParticleMotion::Unshipped(10));
    }

    #[test]
    fn rejects_an_unusable_lifespan() {
        let mut bytes = encode(0x3200_0005, 1, 0, 0.0);
        bytes[52..60].copy_from_slice(&(-1.0f64).to_le_bytes());
        let error = ParticleEmitterInfo::read(&mut Cursor::new(bytes))
            .expect_err("a negative lifespan should not decode");
        assert!(error.to_string().contains("unusable lifespan"));
    }
}

//! Typed 0x33 `PhysicsScript` decoding.
//!
//! A physics script is a flat timeline of `(start_time, AnimationHook)` records sharing the
//! animation hook vocabulary. The layout is proven against ACE
//! `ACE.DatLoader/FileTypes/PhysicsScript.cs` and retail `PhysicsScript::UnPack`
//! (acclient.c:322940-323160).
//!
//! Two retail behaviors are deliberately *not* reproduced here:
//!
//! - Retail sorts records with a `qsort` comparator that never returns 0 and is not a strict weak
//!   ordering, so equal-time order is implementation-defined even in retail. We sort stably on the
//!   authored index, which retail cannot contradict and which makes our execution reproducible.
//! - Retail computes `length` during unpack. We derive it from the sorted records instead, so the
//!   value cannot disagree with its own timeline.

use crate::file_type::setup_model::AnimationHook;
use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};

/// One timed hook dispatch within a physics script.
#[derive(Debug, Clone)]
pub struct PhysicsScriptRecord {
    /// Offset in seconds from the script's activation, as authored.
    pub start_time: f64,
    /// Authored position in the file, retained as the stable tiebreak for equal start times.
    pub authored_order: usize,
    pub hook: AnimationHook,
}

/// A decoded physics script with its records in deterministic execution order.
#[derive(Debug, Clone)]
pub struct PhysicsScript {
    pub id: u32,
    /// Records sorted by `start_time`, ties broken by `authored_order`.
    pub records: Vec<PhysicsScriptRecord>,
}

impl PhysicsScript {
    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let record_count = u32::read_le(reader)?;

        let mut records = Vec::with_capacity(record_count as usize);
        for authored_order in 0..record_count as usize {
            let start_time = f64::read_le(reader)?;
            if !start_time.is_finite() || start_time < 0.0 {
                return Err(binrw::Error::Custom {
                    pos: reader.stream_position()?,
                    err: Box::new(format!(
                        "PhysicsScript 0x{id:08X} record {authored_order} has unusable start time {start_time}"
                    )),
                });
            }
            records.push(PhysicsScriptRecord {
                start_time,
                authored_order,
                hook: AnimationHook::read(reader)?,
            });
        }
        // `total_cmp` keeps the comparison total without an unwrap; non-finite times are already
        // rejected above, so it degenerates to the ordinary numeric order.
        records.sort_by(|left, right| {
            left.start_time
                .total_cmp(&right.start_time)
                .then(left.authored_order.cmp(&right.authored_order))
        });

        Ok(Self { id, records })
    }

    /// Authored length in seconds: the last record's time.
    ///
    /// Retail concatenates a queued script at `previous.start + previous.length`, so a self-calling
    /// script repeats at exactly this interval with no drift (`AddScriptInternal`,
    /// acclient.c:316331-316355). An empty script has length 0, which is retail's runaway case.
    pub fn length_seconds(&self) -> f64 {
        self.records
            .last()
            .map(|record| record.start_time)
            .unwrap_or(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_type::setup_model::AnimationHookPayload;
    use std::io::Cursor;

    /// Encode a script the way the archive does, so the reader is exercised end to end.
    fn encode(id: u32, records: &[(f64, u32, &[u8])]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.extend_from_slice(&(records.len() as u32).to_le_bytes());
        for (start_time, hook_type, payload) in records {
            bytes.extend_from_slice(&start_time.to_le_bytes());
            bytes.extend_from_slice(&hook_type.to_le_bytes());
            bytes.extend_from_slice(&(-2i32).to_le_bytes());
            bytes.extend_from_slice(payload);
        }
        bytes
    }

    #[test]
    fn reads_records_and_derives_length() {
        // Modeled on 0x33000863: a sound at t=0 and a self-call at t=2 with a random pause bound.
        let bytes = encode(
            0x3300_0863,
            &[
                (
                    0.0,
                    21,
                    &[
                        0x07, 0x02, 0x00, 0x0A, 0x00, 0x00, 0x80, 0x3F, 0x00, 0x00, 0x00, 0x00,
                        0x9A, 0x99, 0x99, 0x3E,
                    ],
                ),
                (2.0, 19, &[0x63, 0x08, 0x00, 0x33, 0x00, 0x00, 0x80, 0x3F]),
            ],
        );

        let script = PhysicsScript::read(&mut Cursor::new(bytes)).expect("script should parse");

        assert_eq!(script.id, 0x3300_0863);
        assert_eq!(script.length_seconds(), 2.0);
        let AnimationHookPayload::SoundTweaked(sound) = &script.records[0].hook.payload else {
            panic!("first record should decode as SoundTweaked");
        };
        assert_eq!(sound.sound_id, 0x0A00_0207);
        // Retail rolls against the first float; ACE names it Priority. Ours must be the former.
        assert_eq!(sound.probability, 1.0);
        assert_eq!(sound.unused, 0.0);
        assert_eq!(sound.volume, 0.3f32);
        let AnimationHookPayload::CallPes(call) = &script.records[1].hook.payload else {
            panic!("second record should decode as CallPES");
        };
        assert_eq!(call.script_id, 0x3300_0863);
        assert_eq!(call.pause_seconds, 1.0);
    }

    #[test]
    fn sorts_by_time_with_a_stable_authored_tiebreak() {
        // Authored out of order with two records sharing t=0, as 0x330003EC does.
        let particle = |z: [u8; 4]| {
            let mut payload = vec![0xA5, 0x02, 0x00, 0x32, 0x00, 0x00, 0x00, 0x00];
            payload.extend_from_slice(&0.0f32.to_le_bytes());
            payload.extend_from_slice(&0.0f32.to_le_bytes());
            payload.extend_from_slice(&z);
            payload.extend_from_slice(&1.0f32.to_le_bytes());
            payload.extend_from_slice(&[0u8; 12]);
            payload.extend_from_slice(&0u32.to_le_bytes());
            payload
        };
        let first = particle(10.0f32.to_le_bytes());
        let second = particle(6.0f32.to_le_bytes());
        let bytes = encode(
            0x3300_03EC,
            &[(5.0, 13, &first), (0.0, 13, &first), (0.0, 13, &second)],
        );

        let script = PhysicsScript::read(&mut Cursor::new(bytes)).expect("script should parse");

        let order: Vec<_> = script
            .records
            .iter()
            .map(|record| (record.start_time, record.authored_order))
            .collect();
        assert_eq!(order, vec![(0.0, 1), (0.0, 2), (5.0, 0)]);
    }

    #[test]
    fn rejects_a_negative_record_time() {
        let bytes = encode(0x3300_0001, &[(-1.0, 0, &[])]);
        let error = PhysicsScript::read(&mut Cursor::new(bytes))
            .expect_err("a negative start time should not decode");
        assert!(error.to_string().contains("unusable start time"));
    }

    #[test]
    fn an_empty_script_has_zero_length() {
        let bytes = encode(0x3300_0002, &[]);
        let script = PhysicsScript::read(&mut Cursor::new(bytes)).expect("script should parse");
        assert_eq!(script.length_seconds(), 0.0);
        assert!(script.records.is_empty());
    }
}

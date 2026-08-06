//! Typed 0x20 `SoundTable` decoding.
//!
//! A sound table maps a retail `SoundType` key to the candidate sounds an object may play for that
//! event. Layout proven from ACE `ACE.DatLoader/FileTypes/SoundTable.cs` plus its packed-hash-table
//! reader (`UnpackableExtensions.cs:122-135`): a `u16` entry count, a `u16` bucket size we ignore,
//! then `key, value` pairs.
//!
//! Selection semantics are retail's, and one of them is a genuine shipped bug — see
//! [`SoundTableEntry::select`].

use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};
use std::collections::BTreeMap;

/// One candidate sound for a key, with its authored playback parameters.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SoundCandidate {
    /// 0x0A `Wave` DID.
    pub sound_id: u32,
    /// Used only for voice stealing among retail's 16 global voices.
    pub priority: f32,
    /// Play chance in [0, 1], rolled after this candidate is selected.
    pub probability: f32,
    /// Linear gain applied before distance attenuation.
    pub volume: f32,
}

/// Every candidate authored for one `SoundType` key.
#[derive(Debug, Clone, PartialEq)]
pub struct SoundTableEntry {
    pub candidates: Vec<SoundCandidate>,
}

impl SoundTableEntry {
    /// Choose a candidate for a uniform roll in [0, 1), reproducing retail's selection.
    ///
    /// **Retail never selects the last candidate.** The index is `floor((n − 1) × roll)`
    /// (acclient.c:366752-366756), so with three candidates a roll approaching 1 still yields index
    /// 1. This is a shipped bug, not a design, but authored content was balanced against it and the
    /// last entry of every multi-candidate list is effectively dead. Reproduced deliberately;
    /// "fixing" it would make sounds audible that no player has ever heard.
    pub fn select(&self, roll: f32) -> Option<SoundCandidate> {
        if self.candidates.len() <= 1 {
            return self.candidates.first().copied();
        }
        let index = (((self.candidates.len() - 1) as f32) * roll.clamp(0.0, 1.0)) as usize;
        self.candidates.get(index).copied()
    }
}

/// A decoded sound table, keyed by `SoundType`.
#[derive(Debug, Clone, PartialEq)]
pub struct SoundTable {
    pub id: u32,
    /// Ordered so iteration and diagnostics are reproducible.
    pub entries: BTreeMap<u32, SoundTableEntry>,
}

impl SoundTable {
    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        // ACE names this `Unknown` and notes it is identical in every shipped file; no consumer has
        // ever been identified for it.
        let _unknown = u32::read_le(reader)?;

        // A leading list of hash-bucket records, sized like any ACE list.
        let hash_count = u32::read_le(reader)?;
        for _ in 0..hash_count {
            let _sound_id = u32::read_le(reader)?;
            let _priority = f32::read_le(reader)?;
            let _probability = f32::read_le(reader)?;
            let _volume = f32::read_le(reader)?;
        }

        let entry_count = u16::read_le(reader)?;
        // Bucket size is a detail of retail's hash implementation and carries no decoding meaning.
        let _bucket_size = u16::read_le(reader)?;

        let mut entries = BTreeMap::new();
        for _ in 0..entry_count {
            let key = u32::read_le(reader)?;
            let candidate_count = u32::read_le(reader)?;
            let mut candidates = Vec::with_capacity(candidate_count as usize);
            for _ in 0..candidate_count {
                candidates.push(SoundCandidate {
                    sound_id: u32::read_le(reader)?,
                    priority: f32::read_le(reader)?,
                    probability: f32::read_le(reader)?,
                    volume: f32::read_le(reader)?,
                });
            }
            let _entry_unknown = u32::read_le(reader)?;
            entries.insert(key, SoundTableEntry { candidates });
        }
        Ok(Self { id, entries })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn candidate(bytes: &mut Vec<u8>, sound_id: u32) {
        bytes.extend_from_slice(&sound_id.to_le_bytes());
        bytes.extend_from_slice(&0.5f32.to_le_bytes());
        bytes.extend_from_slice(&1.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.75f32.to_le_bytes());
    }

    fn encode(id: u32, entries: &[(u32, &[u32])]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes()); // empty leading hash list
        bytes.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        bytes.extend_from_slice(&8u16.to_le_bytes()); // bucket size, ignored
        for (key, sounds) in entries {
            bytes.extend_from_slice(&key.to_le_bytes());
            bytes.extend_from_slice(&(sounds.len() as u32).to_le_bytes());
            for sound_id in *sounds {
                candidate(&mut bytes, *sound_id);
            }
            bytes.extend_from_slice(&0u32.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn reads_keyed_candidates_with_their_parameters() {
        let bytes = encode(0x2000_0001, &[(4, &[0x0A00_0207, 0x0A00_0341])]);

        let table = SoundTable::read(&mut Cursor::new(bytes)).expect("should parse");

        assert_eq!(table.id, 0x2000_0001);
        let entry = table.entries.get(&4).expect("key 4 should decode");
        assert_eq!(entry.candidates.len(), 2);
        assert_eq!(entry.candidates[0].sound_id, 0x0A00_0207);
        assert_eq!(entry.candidates[0].volume, 0.75);
    }

    #[test]
    fn a_single_candidate_is_always_selected() {
        let entry = SoundTableEntry {
            candidates: vec![SoundCandidate {
                priority: 0.0,
                probability: 1.0,
                sound_id: 7,
                volume: 1.0,
            }],
        };
        assert_eq!(entry.select(0.0).unwrap().sound_id, 7);
        assert_eq!(entry.select(0.999).unwrap().sound_id, 7);
    }

    #[test]
    fn reproduces_retails_never_select_the_last_candidate_bug() {
        let make = |sound_id| SoundCandidate {
            priority: 0.0,
            probability: 1.0,
            sound_id,
            volume: 1.0,
        };
        let entry = SoundTableEntry {
            candidates: vec![make(1), make(2), make(3)],
        };

        // floor(2 * roll) never reaches index 2, so sound 3 is unreachable by design-accident.
        assert_eq!(entry.select(0.0).unwrap().sound_id, 1);
        assert_eq!(entry.select(0.5).unwrap().sound_id, 2);
        assert_eq!(entry.select(0.999).unwrap().sound_id, 2);
        assert!(
            !(0..1000)
                .map(|step| entry.select(step as f32 / 1000.0).unwrap().sound_id)
                .any(|sound_id| sound_id == 3)
        );
    }

    #[test]
    fn an_empty_table_decodes_without_entries() {
        let table =
            SoundTable::read(&mut Cursor::new(encode(0x2000_0002, &[]))).expect("should parse");
        assert!(table.entries.is_empty());
    }
}

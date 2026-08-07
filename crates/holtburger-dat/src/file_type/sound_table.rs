//! Typed 0x20 `SoundTable` decoding.
//!
//! A sound table maps a retail `SoundType` key to the candidate sounds an object may play for that
//! event. Layout proven from ACE `ACE.DatLoader/FileTypes/SoundTable.cs` plus its packed-hash-table
//! reader (`UnpackableExtensions.cs:122-135`): a `u16` entry count, a `u16` bucket size we ignore,
//! then `key, value` pairs.
//!
//! Selection deliberately diverges from retail, which has a shipped off-by-one that strands the
//! last candidate of every list — see [`SoundTableEntry::select`].

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
    /// Choose a candidate for a uniform roll in [0, 1).
    ///
    /// **RETAIL DIVERGENCE: retail can never select the last candidate.** Retail
    /// computes `floor((n - 1) * roll)` (acclient.c:366752-366756) where `roll` comes from
    /// `Random::RollDice(0.0, 1.0)`, and `Random::rand` clamps its result to `0.99999988`
    /// (acclient.c:101613-101615). One is therefore unreachable, `(n - 1) * roll` never reaches
    /// `n - 1`, and the final candidate of every multi-candidate list is dead.
    ///
    /// Treated as an off-by-one rather than a design. The `-1` is the inclusive-bound convention of
    /// the *integer* `RollDice` overload applied to a float scale that does not need it, and
    /// retail's own bounds check on the next line admits `v5 < num_stdatas`, permitting an index the
    /// expression cannot produce — the guard was written for `n * roll`.
    ///
    /// Not reproducing it is safe: an archive census found 4,183 of 4,184 keys author exactly one
    /// candidate, so the divergence reaches a single entry in the whole game, where one of two
    /// sounds becomes reachable rather than dead.
    pub fn select(&self, roll: f32) -> Option<SoundCandidate> {
        if self.candidates.len() <= 1 {
            return self.candidates.first().copied();
        }
        let index = ((self.candidates.len() as f32) * roll.clamp(0.0, 1.0)) as usize;
        self.candidates
            .get(index.min(self.candidates.len() - 1))
            .copied()
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
    fn reaches_every_candidate_including_the_one_retail_cannot() {
        let make = |sound_id| SoundCandidate {
            priority: 0.0,
            probability: 1.0,
            sound_id,
            volume: 1.0,
        };
        let entry = SoundTableEntry {
            candidates: vec![make(1), make(2), make(3)],
        };

        // Retail's `floor((n - 1) * roll)` caps at index 1 and strands sound 3; `floor(n * roll)`
        // divides the roll into equal thirds.
        assert_eq!(entry.select(0.0).unwrap().sound_id, 1);
        assert_eq!(entry.select(0.5).unwrap().sound_id, 2);
        assert_eq!(entry.select(0.999).unwrap().sound_id, 3);
        // A roll of exactly 1 is unreachable from `Random::rand`, but the clamp must not index off
        // the end if a caller supplies one.
        assert_eq!(entry.select(1.0).unwrap().sound_id, 3);
    }

    #[test]
    fn an_empty_table_decodes_without_entries() {
        let table =
            SoundTable::read(&mut Cursor::new(encode(0x2000_0002, &[]))).expect("should parse");
        assert!(table.entries.is_empty());
    }
}

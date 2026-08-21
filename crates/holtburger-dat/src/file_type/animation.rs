use crate::file_type::setup_model::{AnimationFrame, AnimationHook};
use crate::graphics::Frame;
use binrw::{
    BinRead, BinResult, BinWrite,
    io::{Read, Seek, Write},
};

/// Wire size of one `Frame`: a three-component origin and a four-component orientation.
const FRAME_BYTES: i64 = 7 * 4;

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct AnimationFlags: u32 {
        const POS_FRAMES = 0x1;
    }
}

#[derive(Debug, Clone)]
pub struct Animation {
    pub id: u32,
    pub flags: AnimationFlags,
    pub num_parts: u32,
    pub num_frames: u32,
    pub pos_frames: Vec<Frame>,
    pub part_frames: Vec<AnimationFrame>,
}

impl Animation {
    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let flags = AnimationFlags::from_bits_truncate(u32::read_le(reader)?);
        let num_parts = u32::read_le(reader)?;
        let num_frames = u32::read_le(reader)?;

        let mut pos_frames = Vec::with_capacity(if flags.contains(AnimationFlags::POS_FRAMES) {
            num_frames as usize
        } else {
            0
        });
        if flags.contains(AnimationFlags::POS_FRAMES) {
            for _ in 0..num_frames {
                pos_frames.push(Frame::read_le(reader)?);
            }
        }

        let mut part_frames = Vec::with_capacity(num_frames as usize);
        for _ in 0..num_frames {
            part_frames.push(AnimationFrame::read(reader, num_parts)?);
        }

        Ok(Self {
            id,
            flags,
            num_parts,
            num_frames,
            pos_frames,
            part_frames,
        })
    }

    pub fn write<W: Write + Seek>(&self, writer: &mut W) -> BinResult<()> {
        self.id.write_le(writer)?;
        self.flags.bits().write_le(writer)?;
        self.num_parts.write_le(writer)?;
        self.num_frames.write_le(writer)?;

        if self.flags.contains(AnimationFlags::POS_FRAMES) {
            for frame in &self.pos_frames {
                frame.write_le(writer)?;
            }
        }

        for part_frame in &self.part_frames {
            part_frame.write(writer)?;
        }

        Ok(())
    }

    /// Reads only the facts a host simulation consumes, without materialising part transforms.
    ///
    /// The projected motion contract keeps root position frames and simulation hooks and discards
    /// articulated part frames — but hooks are stored *inside* those frames, so the frames still
    /// have to be walked. This walk seeks past each frame's transforms instead of allocating them,
    /// which on the full profile avoids materialising 52 MB of data the caller immediately drops.
    ///
    /// The result carries `num_parts = 0` and empty per-frame transform lists, exactly as a pruned
    /// record does, so a consumer cannot tell which profile it came from — and neither can be
    /// mistaken for an animation that authors no parts, because nothing simulation-side reads them.
    pub fn read_simulation_facts<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let flags = AnimationFlags::from_bits_truncate(u32::read_le(reader)?);
        let num_parts = u32::read_le(reader)?;
        let num_frames = u32::read_le(reader)?;

        let mut pos_frames = Vec::new();
        if flags.contains(AnimationFlags::POS_FRAMES) {
            pos_frames.reserve(num_frames as usize);
            for _ in 0..num_frames {
                pos_frames.push(Frame::read_le(reader)?);
            }
        }

        let part_transform_bytes = i64::from(num_parts) * FRAME_BYTES;
        let mut part_frames = Vec::with_capacity(num_frames as usize);
        for _ in 0..num_frames {
            reader.seek(std::io::SeekFrom::Current(part_transform_bytes))?;
            let num_hooks = u32::read_le(reader)?;
            let mut hooks = Vec::with_capacity(num_hooks as usize);
            for _ in 0..num_hooks {
                hooks.push(AnimationHook::read(reader)?);
            }
            part_frames.push(AnimationFrame {
                frames: Vec::new(),
                hooks,
            });
        }

        Ok(Self {
            id,
            flags,
            num_parts: 0,
            num_frames,
            pos_frames,
            part_frames,
        })
    }

    /// Drops everything only a renderer reads, keeping what a host simulation reads.
    ///
    /// Survivors are the root position frames, the frame count, and the simulation-relevant hooks.
    /// The per-frame records themselves stay — emptied of part poses — because hooks are indexed by
    /// the frame that fires them, so collapsing the frame list would lose their timing.
    ///
    /// Presentation reads part frames from the unpruned record in the full profile; a pruned record
    /// declares itself as pruned in archive metadata, so absence here is never mistaken for absence
    /// in the source.
    pub fn prune_to_simulation_facts(&mut self) {
        self.num_parts = 0;
        for part_frame in &mut self.part_frames {
            part_frame.frames.clear();
            part_frame
                .hooks
                .retain(AnimationHook::is_simulation_relevant);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_type::setup_model::{AnimationHookPayload, EtherealHookPayload};
    use holtburger_common::{Quaternion, Vector3};
    use std::io::Cursor;

    /// One animation with part transforms and one hook, so the seeking read has something to skip.
    fn animation_with_parts() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x0300_4444u32.to_le_bytes());
        bytes.extend_from_slice(&AnimationFlags::POS_FRAMES.bits().to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes()); // two parts
        bytes.extend_from_slice(&2u32.to_le_bytes()); // two frames
        for _ in 0..2 {
            for value in [0.0f32, 0.5, 0.0, 1.0, 0.0, 0.0, 0.0] {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        for frame in 0..2 {
            for _ in 0..2 {
                for value in [9.0f32, 9.0, 9.0, 1.0, 0.0, 0.0, 0.0] {
                    bytes.extend_from_slice(&value.to_le_bytes());
                }
            }
            if frame == 1 {
                bytes.extend_from_slice(&1u32.to_le_bytes());
                bytes.extend_from_slice(&6u32.to_le_bytes()); // ethereal
                bytes.extend_from_slice(&0i32.to_le_bytes()); // both directions
                bytes.extend_from_slice(&1i32.to_le_bytes()); // ethereal = true
            } else {
                bytes.extend_from_slice(&0u32.to_le_bytes());
            }
        }
        bytes
    }

    /// The seeking read must agree with the full read on every fact a host consumes, and must not
    /// materialise the transforms it skipped.
    #[test]
    fn simulation_facts_match_the_full_read_without_materialising_part_transforms() {
        let bytes = animation_with_parts();
        let full = Animation::read(&mut Cursor::new(bytes.clone())).expect("full read");
        let facts =
            Animation::read_simulation_facts(&mut Cursor::new(bytes)).expect("simulation read");

        assert_eq!(facts.id, full.id);
        assert_eq!(facts.num_frames, full.num_frames);
        assert_eq!(facts.pos_frames, full.pos_frames);
        assert_eq!(facts.part_frames.len(), full.part_frames.len());
        assert_eq!(
            facts.num_parts, 0,
            "the seeking read reports the record it produced, not the one on the wire"
        );
        assert!(
            facts
                .part_frames
                .iter()
                .all(|frame| frame.frames.is_empty())
        );

        assert!(facts.part_frames[0].hooks.is_empty());
        assert_eq!(facts.part_frames[1].hooks.len(), 1);
        assert_eq!(
            facts.part_frames[1].hooks[0].payload,
            AnimationHookPayload::Ethereal(EtherealHookPayload { ethereal: true })
        );
    }

    /// A record that authors no root track must still walk its frames to find hooks.
    #[test]
    fn simulation_facts_read_hooks_from_a_record_with_no_root_track() {
        let mut bytes = animation_with_parts();
        // Clear POS_FRAMES and drop the root frames the flag accounted for.
        bytes[4..8].copy_from_slice(&0u32.to_le_bytes());
        bytes.drain(16..16 + 2 * 7 * 4);

        let facts =
            Animation::read_simulation_facts(&mut Cursor::new(bytes)).expect("simulation read");

        assert!(facts.pos_frames.is_empty());
        assert_eq!(facts.part_frames[1].hooks.len(), 1);
    }

    #[test]
    fn animation_reads_pos_frames_and_empty_part_frames() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x0300_1234u32.to_le_bytes());
        bytes.extend_from_slice(&AnimationFlags::POS_FRAMES.bits().to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());

        bytes.extend_from_slice(&1.0f32.to_le_bytes());
        bytes.extend_from_slice(&2.0f32.to_le_bytes());
        bytes.extend_from_slice(&3.0f32.to_le_bytes());
        bytes.extend_from_slice(&1.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.0f32.to_le_bytes());

        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&1.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.0f32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());

        let animation = Animation::read(&mut Cursor::new(bytes)).expect("animation should parse");

        assert_eq!(animation.id, 0x0300_1234);
        assert_eq!(animation.num_parts, 1);
        assert_eq!(animation.num_frames, 1);
        assert_eq!(animation.part_frames.len(), 1);
        assert_eq!(animation.part_frames[0].frames.len(), 1);
        assert!(animation.part_frames[0].hooks.is_empty());
        assert_eq!(
            animation.pos_frames,
            vec![Frame {
                origin: Vector3::new(1.0, 2.0, 3.0),
                orientation: Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            }]
        );
        assert_eq!(
            animation.part_frames[0].frames[0].orientation,
            Quaternion {
                w: 1.0,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            }
        );
    }
}

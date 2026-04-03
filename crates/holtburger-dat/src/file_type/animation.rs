use crate::file_type::setup_model::AnimationFrame;
use crate::graphics::Frame;
use binrw::{
    BinRead, BinResult,
    io::{Read, Seek},
};

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
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Vector3};
    use std::io::Cursor;

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

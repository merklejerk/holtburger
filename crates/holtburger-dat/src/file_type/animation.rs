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

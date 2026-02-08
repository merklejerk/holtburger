use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use byteorder::{ByteOrder, LittleEndian};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::{BitAnd, BitOr, Shr, Shl};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
pub struct Guid(pub u32);

impl fmt::UpperHex for Guid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl Guid {
    pub const NULL: Guid = Guid(0);

    pub fn is_player(&self) -> bool {
        (self.0 & 0x50000000) == 0x50000000
    }

    pub fn is_item(&self) -> bool {
        self.0 < 0x50000000 && self.0 > 0
    }
}

impl MessageUnpack for Guid {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let val = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Guid(val))
    }
}

impl MessagePack for Guid {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.0.to_le_bytes());
    }
}

impl fmt::Display for Guid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:08X}", self.0)
    }
}

impl fmt::Debug for Guid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "0x{:08X}", self.0)
    }
}

impl From<u32> for Guid {
    fn from(id: u32) -> Self {
        Guid(id)
    }
}

impl From<Guid> for u32 {
    fn from(guid: Guid) -> Self {
        guid.0
    }
}

impl BitAnd<u32> for Guid {
    type Output = u32;
    fn bitand(self, rhs: u32) -> u32 {
        self.0 & rhs
    }
}

impl BitOr<u32> for Guid {
    type Output = u32;
    fn bitor(self, rhs: u32) -> u32 {
        self.0 | rhs
    }
}

impl Shr<u32> for Guid {
    type Output = u32;
    fn shr(self, rhs: u32) -> u32 {
        self.0 >> rhs
    }
}

impl Shl<u32> for Guid {
    type Output = u32;
    fn shl(self, rhs: u32) -> u32 {
        self.0 << rhs
    }
}

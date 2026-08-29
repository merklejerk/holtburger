use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::Guid;

pub mod attribute;
pub mod description;
pub mod properties;
pub mod sound;
#[cfg(test)]
mod tests;
#[cfg(test)]
pub use self::attribute::*;
pub use self::description::*;
pub use self::properties::*;
pub use self::sound::*;

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectDeleteData {
    pub guid: Guid,
    /// Object-instance sequence identifying the exact incarnation to retire.
    pub instance_sequence: u16,
}

impl ProtocolUnpack for ObjectDeleteData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let instance_sequence = u16::unpack(data, offset)?;
        let _reserved = u16::unpack(data, offset)?;
        Some(ObjectDeleteData {
            guid,
            instance_sequence,
        })
    }
}

impl ProtocolPack for ObjectDeleteData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        self.instance_sequence.pack(buf);
        0u16.pack(buf);
    }
}

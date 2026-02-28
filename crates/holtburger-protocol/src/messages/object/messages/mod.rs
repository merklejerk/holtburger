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
}

impl ProtocolUnpack for ObjectDeleteData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        Some(ObjectDeleteData { guid })
    }
}

impl ProtocolPack for ObjectDeleteData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
    }
}

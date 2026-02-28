use crate::messages::utils::align_offset;
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerTeleportData {
    pub teleport_sequence: u16,
}

impl ProtocolUnpack for PlayerTeleportData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 2 > data.len() {
            return None;
        }
        let teleport_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        // Alignment (Writer.Align() in ACE)
        align_offset(offset, 4);

        Some(PlayerTeleportData { teleport_sequence })
    }
}

impl ProtocolPack for PlayerTeleportData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        // Align to 4 bytes
        crate::messages::utils::pad_to_4(buf);
    }
}

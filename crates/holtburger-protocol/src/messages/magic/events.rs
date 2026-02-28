use crate::messages::magic::types::Enchantment;
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;

#[derive(Debug, Clone, PartialEq)]
pub struct MagicUpdateEnchantmentEventData {
    pub target: Guid,
    pub sequence: u32,
    pub enchantment: Enchantment,
}

impl ProtocolUnpack for MagicUpdateEnchantmentEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let enchantment = Enchantment::unpack(data, offset)?;
        Some(MagicUpdateEnchantmentEventData {
            target: Guid::NULL,
            sequence: 0,
            enchantment,
        })
    }
}

impl ProtocolPack for MagicUpdateEnchantmentEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.enchantment.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicUpdateMultipleEnchantmentsEventData {
    pub target: Guid,
    pub sequence: u32,
    pub enchantments: Vec<Enchantment>,
}

impl ProtocolUnpack for MagicUpdateMultipleEnchantmentsEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut enchantments = Vec::new();
        for _ in 0..count {
            enchantments.push(Enchantment::unpack(data, offset)?);
        }
        Some(MagicUpdateMultipleEnchantmentsEventData {
            target: Guid::NULL,
            sequence: 0,
            enchantments,
        })
    }
}

impl ProtocolPack for MagicUpdateMultipleEnchantmentsEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.enchantments.len() as u32).to_le_bytes());
        for enchantment in &self.enchantments {
            enchantment.pack(buf);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicRemoveEnchantmentEventData {
    pub target: Guid,
    pub sequence: u32,
    pub spell_id: u16,
    pub layer: u16,
}

impl ProtocolUnpack for MagicRemoveEnchantmentEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(MagicRemoveEnchantmentEventData {
            target: Guid::NULL,
            sequence: 0,
            spell_id,
            layer,
        })
    }
}

impl ProtocolPack for MagicRemoveEnchantmentEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.spell_id.to_le_bytes());
        buf.extend_from_slice(&self.layer.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicRemoveMultipleEnchantmentsEventData {
    pub target: Guid,
    pub sequence: u32,
    pub spells: Vec<(u16, u16)>, // spell_id, layer
}

impl ProtocolUnpack for MagicRemoveMultipleEnchantmentsEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut spells = Vec::new();
        for _ in 0..count {
            if *offset + 4 > data.len() {
                return None;
            }
            let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
            let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
            *offset += 4;
            spells.push((spell_id, layer));
        }
        Some(MagicRemoveMultipleEnchantmentsEventData {
            target: Guid::NULL,
            sequence: 0,
            spells,
        })
    }
}

impl ProtocolPack for MagicRemoveMultipleEnchantmentsEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.spells.len() as u32).to_le_bytes());
        for (sid, layer) in &self.spells {
            buf.extend_from_slice(&sid.to_le_bytes());
            buf.extend_from_slice(&layer.to_le_bytes());
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicUpdateSpellEventData {
    pub spell_id: u16,
    pub layer: u16,
}

impl ProtocolUnpack for MagicUpdateSpellEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(MagicUpdateSpellEventData { spell_id, layer })
    }
}

impl ProtocolPack for MagicUpdateSpellEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u16::<LittleEndian>(self.spell_id).unwrap();
        buf.write_u16::<LittleEndian>(self.layer).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicRemoveSpellEventData {
    pub spell_id: u16,
    pub layer: u16,
}

impl ProtocolUnpack for MagicRemoveSpellEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(MagicRemoveSpellEventData { spell_id, layer })
    }
}

impl ProtocolPack for MagicRemoveSpellEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u16::<LittleEndian>(self.spell_id).unwrap();
        buf.write_u16::<LittleEndian>(self.layer).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_magic_update_spell_parity() {
        let expected = MagicUpdateSpellEventData {
            spell_id: 0x1234,
            layer: 1,
        };
        // Generated from ACE: SyntheticProtocolTests.DumpSpells
        let fixture = hex::decode("34120100").unwrap();
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_magic_remove_spell_parity() {
        let expected = MagicRemoveSpellEventData {
            spell_id: 0x5678,
            layer: 0,
        };
        // Generated from ACE: SyntheticProtocolTests.DumpSpells
        let fixture = hex::decode("78560000").unwrap();
        assert_pack_unpack_parity(&fixture, &expected);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicPurgeEnchantmentsEventData {
    pub target: Guid,
    pub sequence: u32,
}

impl ProtocolUnpack for MagicPurgeEnchantmentsEventData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(MagicPurgeEnchantmentsEventData {
            target: Guid::NULL,
            sequence: 0,
        })
    }
}

impl ProtocolPack for MagicPurgeEnchantmentsEventData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicPurgeBadEnchantmentsEventData {
    pub target: Guid,
    pub sequence: u32,
}

impl ProtocolUnpack for MagicPurgeBadEnchantmentsEventData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(MagicPurgeBadEnchantmentsEventData {
            target: Guid::NULL,
            sequence: 0,
        })
    }
}

impl ProtocolPack for MagicPurgeBadEnchantmentsEventData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicDispelEnchantmentEventData {
    pub target: Guid,
    pub sequence: u32,
    pub spell_id: u16,
    pub layer: u16,
}

impl ProtocolUnpack for MagicDispelEnchantmentEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(MagicDispelEnchantmentEventData {
            target: Guid::NULL,
            sequence: 0,
            spell_id,
            layer,
        })
    }
}

impl ProtocolPack for MagicDispelEnchantmentEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.spell_id.to_le_bytes());
        buf.extend_from_slice(&self.layer.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicDispelMultipleEnchantmentsEventData {
    pub target: Guid,
    pub sequence: u32,
    pub spells: Vec<(u16, u16)>,
}

impl ProtocolUnpack for MagicDispelMultipleEnchantmentsEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut spells = Vec::new();
        for _ in 0..count {
            if *offset + 4 > data.len() {
                return None;
            }
            let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
            let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
            *offset += 4;
            spells.push((spell_id, layer));
        }
        Some(MagicDispelMultipleEnchantmentsEventData {
            target: Guid::NULL,
            sequence: 0,
            spells,
        })
    }
}

impl ProtocolPack for MagicDispelMultipleEnchantmentsEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.spells.len() as u32).to_le_bytes());
        for (spell_id, layer) in &self.spells {
            buf.extend_from_slice(&spell_id.to_le_bytes());
            buf.extend_from_slice(&layer.to_le_bytes());
        }
    }
}

use crate::messages::magic::types::Enchantment;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub struct MagicUpdateEnchantmentData {
    pub target: Guid,
    pub sequence: u32,
    pub enchantment: Enchantment,
}

impl ProtocolUnpack for MagicUpdateEnchantmentData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let enchantment = Enchantment::unpack(data, offset)?;
        Some(MagicUpdateEnchantmentData {
            target: Guid::NULL,
            sequence: 0,
            enchantment,
        })
    }
}

impl ProtocolPack for MagicUpdateEnchantmentData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.enchantment.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicUpdateMultipleEnchantmentsData {
    pub target: Guid,
    pub sequence: u32,
    pub enchantments: Vec<Enchantment>,
}

impl ProtocolUnpack for MagicUpdateMultipleEnchantmentsData {
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
        Some(MagicUpdateMultipleEnchantmentsData {
            target: Guid::NULL,
            sequence: 0,
            enchantments,
        })
    }
}

impl ProtocolPack for MagicUpdateMultipleEnchantmentsData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.enchantments.len() as u32).to_le_bytes());
        for enchantment in &self.enchantments {
            enchantment.pack(buf);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicRemoveEnchantmentData {
    pub target: Guid,
    pub sequence: u32,
    pub spell_id: u16,
    pub layer: u16,
}

impl ProtocolUnpack for MagicRemoveEnchantmentData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(MagicRemoveEnchantmentData {
            target: Guid::NULL,
            sequence: 0,
            spell_id,
            layer,
        })
    }
}

impl ProtocolPack for MagicRemoveEnchantmentData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.spell_id.to_le_bytes());
        buf.extend_from_slice(&self.layer.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicRemoveMultipleEnchantmentsData {
    pub target: Guid,
    pub sequence: u32,
    pub spells: Vec<(u16, u16)>, // spell_id, layer
}

impl ProtocolUnpack for MagicRemoveMultipleEnchantmentsData {
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
        Some(MagicRemoveMultipleEnchantmentsData {
            target: Guid::NULL,
            sequence: 0,
            spells,
        })
    }
}

impl ProtocolPack for MagicRemoveMultipleEnchantmentsData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.spells.len() as u32).to_le_bytes());
        for (sid, layer) in &self.spells {
            buf.extend_from_slice(&sid.to_le_bytes());
            buf.extend_from_slice(&layer.to_le_bytes());
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicUpdateSpellData {
    pub spell_id: u16,
    pub layer: u16,
}

impl ProtocolUnpack for MagicUpdateSpellData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(MagicUpdateSpellData { spell_id, layer })
    }
}

impl ProtocolPack for MagicUpdateSpellData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u16::<LittleEndian>(self.spell_id).unwrap();
        buf.write_u16::<LittleEndian>(self.layer).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicRemoveSpellData {
    pub spell_id: u16,
    pub layer: u16,
}

impl ProtocolUnpack for MagicRemoveSpellData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(MagicRemoveSpellData { spell_id, layer })
    }
}

impl ProtocolPack for MagicRemoveSpellData {
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
        let expected = MagicUpdateSpellData {
            spell_id: 0x1234,
            layer: 1,
        };
        // Generated from ACE: SyntheticProtocolTests.DumpSpells
        let fixture = hex::decode("34120100").unwrap();
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_magic_remove_spell_parity() {
        let expected = MagicRemoveSpellData {
            spell_id: 0x5678,
            layer: 0,
        };
        // Generated from ACE: SyntheticProtocolTests.DumpSpells
        let fixture = hex::decode("78560000").unwrap();
        assert_pack_unpack_parity(&fixture, &expected);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicPurgeEnchantmentsData {
    pub target: Guid,
    pub sequence: u32,
}

impl ProtocolUnpack for MagicPurgeEnchantmentsData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(MagicPurgeEnchantmentsData {
            target: Guid::NULL,
            sequence: 0,
        })
    }
}

impl ProtocolPack for MagicPurgeEnchantmentsData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicPurgeBadEnchantmentsData {
    pub target: Guid,
    pub sequence: u32,
}

impl ProtocolUnpack for MagicPurgeBadEnchantmentsData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(MagicPurgeBadEnchantmentsData {
            target: Guid::NULL,
            sequence: 0,
        })
    }
}

impl ProtocolPack for MagicPurgeBadEnchantmentsData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicDispelEnchantmentData {
    pub target: Guid,
    pub sequence: u32,
    pub spell_id: u16,
    pub layer: u16,
}

impl ProtocolUnpack for MagicDispelEnchantmentData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let spell_id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let layer = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        Some(MagicDispelEnchantmentData {
            target: Guid::NULL,
            sequence: 0,
            spell_id,
            layer,
        })
    }
}

impl ProtocolPack for MagicDispelEnchantmentData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.spell_id.to_le_bytes());
        buf.extend_from_slice(&self.layer.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MagicDispelMultipleEnchantmentsData {
    pub target: Guid,
    pub sequence: u32,
    pub spells: Vec<(u16, u16)>,
}

impl ProtocolUnpack for MagicDispelMultipleEnchantmentsData {
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
        Some(MagicDispelMultipleEnchantmentsData {
            target: Guid::NULL,
            sequence: 0,
            spells,
        })
    }
}

impl ProtocolPack for MagicDispelMultipleEnchantmentsData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.spells.len() as u32).to_le_bytes());
        for (spell_id, layer) in &self.spells {
            buf.extend_from_slice(&spell_id.to_le_bytes());
            buf.extend_from_slice(&layer.to_le_bytes());
        }
    }
}

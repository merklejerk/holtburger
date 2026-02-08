use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::world::Guid;
use byteorder::{LittleEndian, WriteBytesExt, ByteOrder};

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerCreateData {
    pub guid: Guid,
}

impl ProtocolUnpack for PlayerCreateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        Some(PlayerCreateData { guid })
    }
}

impl ProtocolPack for PlayerCreateData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateAttributeData {
    pub sequence: u8,
    pub object_guid: Option<u32>,
    pub attribute: u32,
    pub ranks: u32,
    pub start: u32,
    pub xp: u32,
    pub is_public: bool,
}

impl UpdateAttributeData {
    pub fn unpack_private(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 17 > data.len() { return None; }
        let sequence = data[*offset];
        let attribute = LittleEndian::read_u32(&data[*offset + 1..*offset + 5]);
        let ranks = LittleEndian::read_u32(&data[*offset + 5..*offset + 9]);
        let start = LittleEndian::read_u32(&data[*offset + 9..*offset + 13]);
        let xp = LittleEndian::read_u32(&data[*offset + 13..*offset + 17]);
        *offset += 17;
        Some(UpdateAttributeData { sequence, object_guid: None, attribute, ranks, start, xp, is_public: false })
    }

    pub fn unpack_public(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 21 > data.len() { return None; }
        let sequence = data[*offset];
        let object_guid = Some(LittleEndian::read_u32(&data[*offset + 1..*offset + 5]));
        let attribute = LittleEndian::read_u32(&data[*offset + 5..*offset + 9]);
        let ranks = LittleEndian::read_u32(&data[*offset + 9..*offset + 13]);
        let start = LittleEndian::read_u32(&data[*offset + 13..*offset + 17]);
        let xp = LittleEndian::read_u32(&data[*offset + 17..*offset + 21]);
        *offset += 21;
        Some(UpdateAttributeData { sequence, object_guid, attribute, ranks, start, xp, is_public: true })
    }
}

impl ProtocolUnpack for UpdateAttributeData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Self::unpack_private(data, offset)
    }
}

impl ProtocolPack for UpdateAttributeData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if let Some(guid) = self.object_guid { buf.write_u32::<LittleEndian>(guid).unwrap(); }
        buf.write_u32::<LittleEndian>(self.attribute).unwrap();
        buf.write_u32::<LittleEndian>(self.ranks).unwrap();
        buf.write_u32::<LittleEndian>(self.start).unwrap();
        buf.write_u32::<LittleEndian>(self.xp).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateSkillData {
    pub sequence: u8,
    pub object_guid: Option<u32>,
    pub skill: u32,
    pub ranks: u32,
    pub adjust_pp: u32,
    pub status: u32,
    pub xp: u32,
    pub init: u32,
    pub resistance: u32,
    pub last_used: f64,
    pub is_public: bool,
}

impl UpdateSkillData {
    pub fn unpack_private(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 33 > data.len() { return None; }
        let sequence = data[*offset];
        let skill = LittleEndian::read_u32(&data[*offset + 1..*offset + 5]);
        let ranks = LittleEndian::read_u16(&data[*offset + 5..*offset + 7]) as u32;
        let adjust_pp = LittleEndian::read_u16(&data[*offset + 7..*offset + 9]) as u32;
        let status = LittleEndian::read_u32(&data[*offset + 9..*offset + 13]);
        let xp = LittleEndian::read_u32(&data[*offset + 13..*offset + 17]);
        let init = LittleEndian::read_u32(&data[*offset + 17..*offset + 21]);
        let resistance = LittleEndian::read_u32(&data[*offset + 21..*offset + 25]);
        let last_used = LittleEndian::read_f64(&data[*offset + 25..*offset + 33]);
        *offset += 33;
        Some(UpdateSkillData { sequence, object_guid: None, skill, ranks, adjust_pp, status, xp, init, resistance, last_used, is_public: false })
    }

    pub fn unpack_public(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 37 > data.len() { return None; }
        let sequence = data[*offset];
        let object_guid = Some(LittleEndian::read_u32(&data[*offset + 1..*offset + 5]));
        let skill = LittleEndian::read_u32(&data[*offset + 5..*offset + 9]);
        let ranks = LittleEndian::read_u16(&data[*offset + 9..*offset + 11]) as u32;
        let adjust_pp = LittleEndian::read_u16(&data[*offset + 11..*offset + 13]) as u32;
        let status = LittleEndian::read_u32(&data[*offset + 13..*offset + 17]);
        let xp = LittleEndian::read_u32(&data[*offset + 17..*offset + 21]);
        let init = LittleEndian::read_u32(&data[*offset + 21..*offset + 25]);
        let resistance = LittleEndian::read_u32(&data[*offset + 25..*offset + 29]);
        let last_used = LittleEndian::read_f64(&data[*offset + 29..*offset + 37]);
        *offset += 37;
        Some(UpdateSkillData { sequence, object_guid, skill, ranks, adjust_pp, status, xp, init, resistance, last_used, is_public: true })
    }
}

impl ProtocolUnpack for UpdateSkillData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Self::unpack_private(data, offset)
    }
}

impl ProtocolPack for UpdateSkillData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if let Some(guid) = self.object_guid { buf.write_u32::<LittleEndian>(guid).unwrap(); }
        buf.write_u32::<LittleEndian>(self.skill).unwrap();
        buf.write_u16::<LittleEndian>(self.ranks as u16).unwrap();
        buf.write_u16::<LittleEndian>(self.adjust_pp as u16).unwrap();
        buf.write_u32::<LittleEndian>(self.status).unwrap();
        buf.write_u32::<LittleEndian>(self.xp).unwrap();
        buf.write_u32::<LittleEndian>(self.init).unwrap();
        buf.write_u32::<LittleEndian>(self.resistance).unwrap();
        buf.write_f64::<LittleEndian>(self.last_used).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateVitalData {
    pub sequence: u8,
    pub object_guid: Option<u32>,
    pub vital: u32,
    pub ranks: u32,
    pub start: u32,
    pub xp: u32,
    pub current: u32,
    pub is_public: bool,
}

impl UpdateVitalData {
    pub fn unpack_private(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 21 > data.len() { return None; }
        let sequence = data[*offset];
        let vital = LittleEndian::read_u32(&data[*offset + 1..*offset + 5]);
        let ranks = LittleEndian::read_u32(&data[*offset + 5..*offset + 9]);
        let start = LittleEndian::read_u32(&data[*offset + 9..*offset + 13]);
        let xp = LittleEndian::read_u32(&data[*offset + 13..*offset + 17]);
        let current = LittleEndian::read_u32(&data[*offset + 17..*offset + 21]);
        *offset += 21;
        Some(UpdateVitalData { sequence, object_guid: None, vital, ranks, start, xp, current, is_public: false })
    }

    pub fn unpack_public(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 25 > data.len() { return None; }
        let sequence = data[*offset];
        let object_guid = Some(LittleEndian::read_u32(&data[*offset + 1..*offset + 5]));
        let vital = LittleEndian::read_u32(&data[*offset + 5..*offset + 9]);
        let ranks = LittleEndian::read_u32(&data[*offset + 9..*offset + 13]);
        let start = LittleEndian::read_u32(&data[*offset + 13..*offset + 17]);
        let xp = LittleEndian::read_u32(&data[*offset + 17..*offset + 21]);
        let current = LittleEndian::read_u32(&data[*offset + 21..*offset + 25]);
        *offset += 25;
        Some(UpdateVitalData { sequence, object_guid, vital, ranks, start, xp, current, is_public: true })
    }
}

impl ProtocolUnpack for UpdateVitalData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Self::unpack_private(data, offset)
    }
}

impl ProtocolPack for UpdateVitalData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if let Some(guid) = self.object_guid { buf.write_u32::<LittleEndian>(guid).unwrap(); }
        buf.write_u32::<LittleEndian>(self.vital).unwrap();
        buf.write_u32::<LittleEndian>(self.ranks).unwrap();
        buf.write_u32::<LittleEndian>(self.start).unwrap();
        buf.write_u32::<LittleEndian>(self.xp).unwrap();
        buf.write_u32::<LittleEndian>(self.current).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateVitalCurrentData {
    pub sequence: u8,
    pub object_guid: Option<u32>,
    pub vital: u32,
    pub current: u32,
}

impl UpdateVitalCurrentData {
    pub fn unpack_private(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 9 > data.len() { return None; }
        let sequence = data[*offset];
        let vital = LittleEndian::read_u32(&data[*offset + 1..*offset + 5]);
        let current = LittleEndian::read_u32(&data[*offset + 5..*offset + 9]);
        *offset += 9;
        Some(UpdateVitalCurrentData { sequence, object_guid: None, vital, current })
    }

    pub fn unpack_public(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 13 > data.len() { return None; }
        let sequence = data[*offset];
        let object_guid = Some(LittleEndian::read_u32(&data[*offset + 1..*offset + 5]));
        let vital = LittleEndian::read_u32(&data[*offset + 5..*offset + 9]);
        let current = LittleEndian::read_u32(&data[*offset + 9..*offset + 13]);
        *offset += 13;
        Some(UpdateVitalCurrentData { sequence, object_guid, vital, current })
    }
}

impl ProtocolUnpack for UpdateVitalCurrentData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Self::unpack_private(data, offset)
    }
}

impl ProtocolPack for UpdateVitalCurrentData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if let Some(guid) = self.object_guid { buf.write_u32::<LittleEndian>(guid).unwrap(); }
        buf.write_u32::<LittleEndian>(self.vital).unwrap();
        buf.write_u32::<LittleEndian>(self.current).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateSkillLevelData {
    pub sequence: u8,
    pub guid: Option<u32>,
    pub skill: u32,
    pub ranks: u32,
    pub is_public: bool,
}

impl UpdateSkillLevelData {
    pub fn unpack(data: &[u8], offset: &mut usize, is_public: bool) -> Option<Self> {
        if *offset >= data.len() { return None; }
        let sequence = data[*offset];
        *offset += 1;
        let mut guid = None;
        if is_public {
            if *offset + 4 > data.len() { return None; }
            guid = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if *offset + 8 > data.len() { return None; }
        let skill = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let ranks = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(UpdateSkillLevelData { sequence, guid, skill, ranks, is_public })
    }
}

impl ProtocolPack for UpdateSkillLevelData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        if let Some(guid) = self.guid { buf.write_u32::<LittleEndian>(guid).unwrap(); }
        buf.write_u32::<LittleEndian>(self.skill).unwrap();
        buf.write_u32::<LittleEndian>(self.ranks).unwrap();
    }
}

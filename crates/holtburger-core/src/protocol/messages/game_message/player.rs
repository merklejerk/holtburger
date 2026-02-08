use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::world::Guid;

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
pub struct UpdateAttribute<const PUBLIC: bool> {
    pub sequence: u8,
    pub object_guid: Option<u32>,
    pub attribute: u32,
    pub ranks: u32,
    pub start: u32,
    pub xp: u32,
}

impl<const PUBLIC: bool> ProtocolUnpack for UpdateAttribute<PUBLIC> {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let sequence = u8::unpack(data, offset)?;
        let object_guid = if PUBLIC {
            Some(u32::unpack(data, offset)?)
        } else {
            None
        };
        let attribute = u32::unpack(data, offset)?;
        let ranks = u32::unpack(data, offset)?;
        let start = u32::unpack(data, offset)?;
        let xp = u32::unpack(data, offset)?;
        Some(UpdateAttribute {
            sequence,
            object_guid,
            attribute,
            ranks,
            start,
            xp,
        })
    }
}

impl<const PUBLIC: bool> ProtocolPack for UpdateAttribute<PUBLIC> {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.sequence.pack(buf);
        if PUBLIC {
            self.object_guid.unwrap().pack(buf);
        }
        self.attribute.pack(buf);
        self.ranks.pack(buf);
        self.start.pack(buf);
        self.xp.pack(buf);
    }
}

pub type PrivateUpdateAttributeData = UpdateAttribute<false>;
pub type PublicUpdateAttributeData = UpdateAttribute<true>;

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateSkill<const PUBLIC: bool> {
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
}

impl<const PUBLIC: bool> ProtocolUnpack for UpdateSkill<PUBLIC> {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let sequence = u8::unpack(data, offset)?;
        let object_guid = if PUBLIC {
            Some(u32::unpack(data, offset)?)
        } else {
            None
        };
        let skill = u32::unpack(data, offset)?;
        let ranks = u16::unpack(data, offset)? as u32;
        let adjust_pp = u16::unpack(data, offset)? as u32;
        let status = u32::unpack(data, offset)?;
        let xp = u32::unpack(data, offset)?;
        let init = u32::unpack(data, offset)?;
        let resistance = u32::unpack(data, offset)?;
        let last_used = f64::unpack(data, offset)?;
        Some(UpdateSkill {
            sequence,
            object_guid,
            skill,
            ranks,
            adjust_pp,
            status,
            xp,
            init,
            resistance,
            last_used,
        })
    }
}

impl<const PUBLIC: bool> ProtocolPack for UpdateSkill<PUBLIC> {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.sequence.pack(buf);
        if PUBLIC {
            self.object_guid.unwrap().pack(buf);
        }
        self.skill.pack(buf);
        (self.ranks as u16).pack(buf);
        (self.adjust_pp as u16).pack(buf);
        self.status.pack(buf);
        self.xp.pack(buf);
        self.init.pack(buf);
        self.resistance.pack(buf);
        self.last_used.pack(buf);
    }
}

pub type PrivateUpdateSkillData = UpdateSkill<false>;
pub type PublicUpdateSkillData = UpdateSkill<true>;

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateVital<const PUBLIC: bool> {
    pub sequence: u8,
    pub object_guid: Option<u32>,
    pub vital: u32,
    pub ranks: u32,
    pub start: u32,
    pub xp: u32,
    pub current: u32,
}

impl<const PUBLIC: bool> ProtocolUnpack for UpdateVital<PUBLIC> {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let sequence = u8::unpack(data, offset)?;
        let object_guid = if PUBLIC {
            Some(u32::unpack(data, offset)?)
        } else {
            None
        };
        let vital = u32::unpack(data, offset)?;
        let ranks = u32::unpack(data, offset)?;
        let start = u32::unpack(data, offset)?;
        let xp = u32::unpack(data, offset)?;
        let current = u32::unpack(data, offset)?;
        Some(UpdateVital {
            sequence,
            object_guid,
            vital,
            ranks,
            start,
            xp,
            current,
        })
    }
}

impl<const PUBLIC: bool> ProtocolPack for UpdateVital<PUBLIC> {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.sequence.pack(buf);
        if PUBLIC {
            self.object_guid.unwrap().pack(buf);
        }
        self.vital.pack(buf);
        self.ranks.pack(buf);
        self.start.pack(buf);
        self.xp.pack(buf);
        self.current.pack(buf);
    }
}

pub type PrivateUpdateVitalData = UpdateVital<false>;
pub type PublicUpdateVitalData = UpdateVital<true>;

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateVitalCurrent<const PUBLIC: bool> {
    pub sequence: u8,
    pub object_guid: Option<u32>,
    pub vital: u32,
    pub current: u32,
}

impl<const PUBLIC: bool> ProtocolUnpack for UpdateVitalCurrent<PUBLIC> {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let sequence = u8::unpack(data, offset)?;
        let object_guid = if PUBLIC {
            Some(u32::unpack(data, offset)?)
        } else {
            None
        };
        let vital = u32::unpack(data, offset)?;
        let current = u32::unpack(data, offset)?;
        Some(UpdateVitalCurrent {
            sequence,
            object_guid,
            vital,
            current,
        })
    }
}

impl<const PUBLIC: bool> ProtocolPack for UpdateVitalCurrent<PUBLIC> {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.sequence.pack(buf);
        if PUBLIC {
            self.object_guid.unwrap().pack(buf);
        }
        self.vital.pack(buf);
        self.current.pack(buf);
    }
}

pub type PrivateUpdateVitalCurrentData = UpdateVitalCurrent<false>;
pub type PublicUpdateVitalCurrentData = UpdateVitalCurrent<true>;

#[derive(Debug, Clone, PartialEq)]
pub struct UpdateSkillLevel<const PUBLIC: bool> {
    pub sequence: u8,
    pub guid: Option<u32>,
    pub skill: u32,
    pub ranks: u32,
}

impl<const PUBLIC: bool> ProtocolUnpack for UpdateSkillLevel<PUBLIC> {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let sequence = u8::unpack(data, offset)?;
        let guid = if PUBLIC {
            Some(u32::unpack(data, offset)?)
        } else {
            None
        };
        let skill = u32::unpack(data, offset)?;
        let ranks = u32::unpack(data, offset)?;
        Some(UpdateSkillLevel {
            sequence,
            guid,
            skill,
            ranks,
        })
    }
}

impl<const PUBLIC: bool> ProtocolPack for UpdateSkillLevel<PUBLIC> {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.sequence.pack(buf);
        if PUBLIC {
            self.guid.unwrap().pack(buf);
        }
        self.skill.pack(buf);
        self.ranks.pack(buf);
    }
}

pub type PrivateUpdateSkillLevelData = UpdateSkillLevel<false>;
pub type PublicUpdateSkillLevelData = UpdateSkillLevel<true>;

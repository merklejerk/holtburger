use crate::messages::utils::{align_offset, pad_to_4, read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use holtburger_common::properties::PhysicsState;

macro_rules! define_update_property {
    ($name:ident, $type:ty) => {
        #[derive(Debug, Clone, PartialEq)]
        pub struct $name<const PUBLIC: bool> {
            pub sequence: u8,
            pub guid: Guid,
            pub property: u32,
            pub value: $type,
        }

        impl<const PUBLIC: bool> ProtocolUnpack for $name<PUBLIC> {
            fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
                let sequence = u8::unpack(data, offset)?;
                let guid = if PUBLIC {
                    Guid::unpack(data, offset)?
                } else {
                    Guid::NULL
                };
                let property = u32::unpack(data, offset)?;
                let value = <$type>::unpack(data, offset)?;
                Some($name {
                    sequence,
                    guid,
                    property,
                    value,
                })
            }
        }

        impl<const PUBLIC: bool> ProtocolPack for $name<PUBLIC> {
            fn pack(&self, buf: &mut Vec<u8>) {
                self.sequence.pack(buf);
                if PUBLIC {
                    self.guid.pack(buf);
                }
                self.property.pack(buf);
                self.value.pack(buf);
            }
        }
    };
}

define_update_property!(UpdatePropertyInt, i32);
pub type PrivateUpdatePropertyIntData = UpdatePropertyInt<false>;
pub type PublicUpdatePropertyIntData = UpdatePropertyInt<true>;

define_update_property!(UpdatePropertyInt64, i64);
pub type PrivateUpdatePropertyInt64Data = UpdatePropertyInt64<false>;
pub type PublicUpdatePropertyInt64Data = UpdatePropertyInt64<true>;

define_update_property!(UpdatePropertyBool, bool);
pub type PrivateUpdatePropertyBoolData = UpdatePropertyBool<false>;
pub type PublicUpdatePropertyBoolData = UpdatePropertyBool<true>;

define_update_property!(UpdatePropertyFloat, f64);
pub type PrivateUpdatePropertyFloatData = UpdatePropertyFloat<false>;
pub type PublicUpdatePropertyFloatData = UpdatePropertyFloat<true>;

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePropertyString<const PUBLIC: bool> {
    pub sequence: u8,
    pub guid: Guid,
    pub property: u32,
    pub value: String,
}

impl<const PUBLIC: bool> ProtocolUnpack for UpdatePropertyString<PUBLIC> {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let sequence = u8::unpack(data, offset)?;
        let property = u32::unpack(data, offset)?;
        let guid = if PUBLIC {
            Guid::unpack(data, offset)?
        } else {
            Guid::NULL
        };
        align_offset(offset, 4);
        let value = read_string16(data, offset)?;
        Some(UpdatePropertyString {
            sequence,
            guid,
            property,
            value,
        })
    }
}

impl<const PUBLIC: bool> ProtocolPack for UpdatePropertyString<PUBLIC> {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.sequence.pack(buf);
        self.property.pack(buf);
        if PUBLIC {
            self.guid.pack(buf);
        }
        pad_to_4(buf);
        write_string16(buf, &self.value);
    }
}

pub type PrivateUpdatePropertyStringData = UpdatePropertyString<false>;
pub type PublicUpdatePropertyStringData = UpdatePropertyString<true>;

define_update_property!(UpdatePropertyDataId, Guid);
pub type PrivateUpdatePropertyDataIdData = UpdatePropertyDataId<false>;
pub type PublicUpdatePropertyDataIdData = UpdatePropertyDataId<true>;

define_update_property!(UpdatePropertyInstanceId, Guid);
pub type PrivateUpdatePropertyInstanceIdData = UpdatePropertyInstanceId<false>;
pub type PublicUpdatePropertyInstanceIdData = UpdatePropertyInstanceId<true>;

#[derive(Debug, Clone, PartialEq)]
pub struct SetStateData {
    pub guid: Guid,
    pub physics_state: PhysicsState,
    pub instance_sequence: u16,
    pub state_sequence: u16,
}

impl ProtocolUnpack for SetStateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let physics_state =
            PhysicsState::from_bits_retain(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let state_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        Some(SetStateData {
            guid,
            physics_state,
            instance_sequence,
            state_sequence,
        })
    }
}

impl ProtocolPack for SetStateData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.physics_state.bits())
            .unwrap();
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.state_sequence).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParentEventData {
    pub parent_guid: Guid,
    pub child_guid: Guid,
    pub location: u32,
    pub placement: u32,
    pub parent_instance_sequence: u16,
    pub child_position_sequence: u16,
}

impl ProtocolUnpack for ParentEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let parent_guid = Guid::unpack(data, offset)?;
        let child_guid = Guid::unpack(data, offset)?;
        if *offset + 12 > data.len() {
            return None;
        }
        let location = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let placement = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let parent_instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let child_position_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        Some(ParentEventData {
            parent_guid,
            child_guid,
            location,
            placement,
            parent_instance_sequence,
            child_position_sequence,
        })
    }
}

impl ProtocolPack for ParentEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.parent_guid.pack(buf);
        self.child_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.location).unwrap();
        buf.write_u32::<LittleEndian>(self.placement).unwrap();
        buf.write_u16::<LittleEndian>(self.parent_instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.child_position_sequence)
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PickupEventData {
    pub guid: Guid,
    pub success: bool,
}

impl ProtocolUnpack for PickupEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let success = LittleEndian::read_u32(&data[*offset..*offset + 4]) != 0;
        *offset += 4;
        Some(PickupEventData { guid, success })
    }
}

impl ProtocolPack for PickupEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        buf.write_u32::<LittleEndian>(if self.success { 1 } else { 0 })
            .unwrap();
    }
}

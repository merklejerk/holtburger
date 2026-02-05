use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct ViewContentsItem {
    pub guid: u32,
    pub container_type: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ViewContentsData {
    pub container: u32,
    pub items: Vec<ViewContentsItem>,
}

impl MessageUnpack for ViewContentsData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let container = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let count = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) as usize;
        *offset += 8;

        if *offset + (count * 8) > data.len() {
            return None;
        }

        let mut items = Vec::with_capacity(count);
        for _ in 0..count {
            let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            let container_type = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
            *offset += 8;
            items.push(ViewContentsItem {
                guid,
                container_type,
            });
        }

        Some(ViewContentsData { container, items })
    }
}

impl MessagePack for ViewContentsData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.container).unwrap();
        buf.write_u32::<LittleEndian>(self.items.len() as u32)
            .unwrap();
        for item in &self.items {
            buf.write_u32::<LittleEndian>(item.guid).unwrap();
            buf.write_u32::<LittleEndian>(item.container_type).unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_view_contents_fixture() {
        let expected = ViewContentsData {
            container: 0x11111111,
            items: vec![
                ViewContentsItem {
                    guid: 0x22222222,
                    container_type: 1,
                },
                ViewContentsItem {
                    guid: 0x33333333,
                    container_type: 0,
                },
            ],
        };

        // Skip Opcode(4), Target(4), Seq(4), IntOp(4) = 16 bytes
        let data = &fixtures::VIEW_CONTENTS[16..];
        assert_pack_unpack_parity(data, &expected);
    }
}

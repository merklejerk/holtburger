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

    #[test]
    fn test_view_contents_unpack() {
        // Skip Opcode(4), Target(4), Seq(4), IntOp(4) = 16 bytes
        let mut offset = 16;
        let p = ViewContentsData::unpack(fixtures::VIEW_CONTENTS, &mut offset)
            .expect("Should unpack ViewContentsData");

        assert_eq!(p.container, 0x11111111);
        assert_eq!(p.items.len(), 2);
        assert_eq!(p.items[0].guid, 0x22222222);
        assert_eq!(p.items[0].container_type, 1);
        assert_eq!(p.items[1].guid, 0x33333333);
        assert_eq!(p.items[1].container_type, 0);
    }

    #[test]
    fn test_view_contents_pack() {
        let data = ViewContentsData {
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
        let mut buf = Vec::new();
        data.pack(&mut buf);

        // Payload only starts at index 16 in the full message
        assert_eq!(buf, &fixtures::VIEW_CONTENTS[16..]);
    }
}

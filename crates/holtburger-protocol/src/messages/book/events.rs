use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{LittleEndian, WriteBytesExt};
use holtburger_common::Guid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookPageData {
    pub author_id: u32,
    pub author_name: String,
    pub author_account: String,
    pub flags: u32,
    pub text_included: bool,
    pub ignore_author: bool,
    pub page_text: Option<String>,
}

impl ProtocolUnpack for BookPageData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let author_id = u32::unpack(data, offset)?;
        let author_name = read_string16(data, offset)?;
        let author_account = read_string16(data, offset)?;
        let flags = u32::unpack(data, offset)?;
        let text_included = u32::unpack(data, offset)? != 0;
        let ignore_author = u32::unpack(data, offset)? != 0;
        let page_text = if text_included {
            Some(read_string16(data, offset)?)
        } else {
            None
        };

        Some(Self {
            author_id,
            author_name,
            author_account,
            flags,
            text_included,
            ignore_author,
            page_text,
        })
    }
}

impl ProtocolPack for BookPageData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.author_id.pack(buf);
        write_string16(buf, &self.author_name);
        write_string16(buf, &self.author_account);
        self.flags.pack(buf);
        (self.text_included as u32).pack(buf);
        (self.ignore_author as u32).pack(buf);
        if self.text_included {
            write_string16(buf, self.page_text.as_deref().unwrap_or(""));
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookDataResponseEventData {
    pub object_guid: Guid,
    pub max_num_pages: u32,
    pub num_pages: u32,
    pub max_num_chars_per_page: u32,
    pub pages: Vec<BookPageData>,
    pub inscription: String,
    pub author_id: u32,
    pub author_name: String,
}

impl ProtocolUnpack for BookDataResponseEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let object_guid = Guid::unpack(data, offset)?;
        let max_num_pages = u32::unpack(data, offset)?;
        let num_pages = u32::unpack(data, offset)?;
        let max_num_chars_per_page = u32::unpack(data, offset)?;
        let page_count = u32::unpack(data, offset)? as usize;
        let mut pages = Vec::with_capacity(page_count);
        for _ in 0..page_count {
            pages.push(BookPageData::unpack(data, offset)?);
        }

        Some(Self {
            object_guid,
            max_num_pages,
            num_pages,
            max_num_chars_per_page,
            pages,
            inscription: read_string16(data, offset)?,
            author_id: u32::unpack(data, offset)?,
            author_name: read_string16(data, offset)?,
        })
    }
}

impl ProtocolPack for BookDataResponseEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.object_guid.pack(buf);
        self.max_num_pages.pack(buf);
        self.num_pages.pack(buf);
        self.max_num_chars_per_page.pack(buf);
        buf.write_u32::<LittleEndian>(self.pages.len() as u32)
            .unwrap();
        for page in &self.pages {
            page.pack(buf);
        }
        write_string16(buf, &self.inscription);
        self.author_id.pack(buf);
        write_string16(buf, &self.author_name);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookPageDataResponseEventData {
    pub object_guid: Guid,
    pub page_index: i32,
    pub page: BookPageData,
}

impl ProtocolUnpack for BookPageDataResponseEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            object_guid: Guid::unpack(data, offset)?,
            page_index: i32::unpack(data, offset)?,
            page: BookPageData::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for BookPageDataResponseEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.object_guid.pack(buf);
        self.page_index.pack(buf);
        self.page.pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_event::{GameEvent, GameEventMessage};
    use crate::messages::game_message::GameMessage;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_book_data_response_fixture() {
        // Generated from ACE: SyntheticProtocolTests.DumpBookProtocolFixtures
        let fixture = hex::decode("B0F700000100005021000000B4000000443322110300000003000000E803000002000000040302010A00536372696265204F6E6509006265657220676F6F64000200FFFF0000000001000000080706050A005363726962652054776F09006265657220676F6F64000200FFFF01000000010000001900546865207365636F6E6420706167652068617320746578742E0011005369676E656420616E64207365616C656400DDCCBBAA090041726368697669737400").unwrap();
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x21,
            event: GameEvent::BookDataResponse(Box::new(BookDataResponseEventData {
                object_guid: Guid(0x11223344),
                max_num_pages: 3,
                num_pages: 3,
                max_num_chars_per_page: 1000,
                pages: vec![
                    BookPageData {
                        author_id: 0x01020304,
                        author_name: "Scribe One".to_string(),
                        author_account: "beer good".to_string(),
                        flags: 0xFFFF0002,
                        text_included: false,
                        ignore_author: true,
                        page_text: None,
                    },
                    BookPageData {
                        author_id: 0x05060708,
                        author_name: "Scribe Two".to_string(),
                        author_account: "beer good".to_string(),
                        flags: 0xFFFF0002,
                        text_included: true,
                        ignore_author: true,
                        page_text: Some("The second page has text.".to_string()),
                    },
                ],
                inscription: "Signed and sealed".to_string(),
                author_id: 0xAABBCCDD,
                author_name: "Archivist".to_string(),
            })),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_book_page_data_response_fixture() {
        // Generated from ACE: SyntheticProtocolTests.DumpBookProtocolFixtures
        let fixture = hex::decode("B0F700000100005022000000B80000004433221101000000080706050A005363726962652054776F120050617373776F7264206973206368656573650200FFFF01000000000000001900546865207365636F6E6420706167652068617320746578742E00").unwrap();
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x22,
            event: GameEvent::BookPageDataResponse(Box::new(BookPageDataResponseEventData {
                object_guid: Guid(0x11223344),
                page_index: 1,
                page: BookPageData {
                    author_id: 0x05060708,
                    author_name: "Scribe Two".to_string(),
                    author_account: "Password is cheese".to_string(),
                    flags: 0xFFFF0002,
                    text_included: true,
                    ignore_author: false,
                    page_text: Some("The second page has text.".to_string()),
                },
            })),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }
}

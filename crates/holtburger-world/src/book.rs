use holtburger_protocol::messages::{BookDataResponseEventData, BookPageDataResponseEventData};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookPage {
    pub index: u32,
    pub author_id: u32,
    pub author_name: String,
    pub author_account: String,
    pub flags: u32,
    pub text_included: bool,
    pub ignore_author: bool,
    pub page_text: Option<String>,
}

impl BookPage {
    fn from_protocol(
        index: i32,
        page: &holtburger_protocol::messages::BookPageData,
    ) -> Option<Self> {
        Some(Self {
            index: u32::try_from(index).ok()?,
            author_id: page.author_id,
            author_name: page.author_name.clone(),
            author_account: page.author_account.clone(),
            flags: page.flags,
            text_included: page.text_included,
            ignore_author: page.ignore_author,
            page_text: page.page_text.clone(),
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BookData {
    pub max_num_pages: Option<u32>,
    pub num_pages: Option<u32>,
    pub max_num_chars_per_page: Option<u32>,
    pub pages: Vec<BookPage>,
    pub inscription: Option<String>,
    pub author_id: Option<u32>,
    pub author_name: Option<String>,
    pub ignore_author: Option<bool>,
}

impl BookData {
    pub fn from_response(response: &BookDataResponseEventData) -> Self {
        let pages = response
            .pages
            .iter()
            .enumerate()
            .filter_map(|(index, page)| BookPage::from_protocol(index as i32, page))
            .collect::<Vec<_>>();

        Self {
            max_num_pages: Some(response.max_num_pages),
            num_pages: Some(response.num_pages),
            max_num_chars_per_page: Some(response.max_num_chars_per_page),
            ignore_author: pages.first().map(|page| page.ignore_author),
            pages,
            inscription: Some(response.inscription.clone()),
            author_id: Some(response.author_id),
            author_name: Some(response.author_name.clone()),
        }
    }

    pub fn apply_page_response(&mut self, response: &BookPageDataResponseEventData) {
        let Some(updated_page) = BookPage::from_protocol(response.page_index, &response.page)
        else {
            return;
        };
        let updated_index = updated_page.index;

        if let Some(existing) = self
            .pages
            .iter_mut()
            .find(|page| page.index == updated_index)
        {
            *existing = updated_page;
            return;
        }

        self.pages.push(updated_page);
        self.pages.sort_by_key(|page| page.index);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;
    use holtburger_protocol::messages::{BookPageData, BookPageDataResponseEventData};

    #[test]
    fn apply_page_response_inserts_missing_page() {
        let mut book = BookData::default();

        book.apply_page_response(&BookPageDataResponseEventData {
            object_guid: Guid(0x11223344),
            page_index: 2,
            page: BookPageData {
                author_id: 7,
                author_name: "Scribe".to_string(),
                author_account: "acct".to_string(),
                flags: 0xFFFF0002,
                text_included: true,
                ignore_author: false,
                page_text: Some("hello".to_string()),
            },
        });

        assert_eq!(book.pages.len(), 1);
        assert_eq!(book.pages[0].index, 2);
        assert_eq!(book.pages[0].page_text.as_deref(), Some("hello"));
    }

    #[test]
    fn apply_page_response_ignores_negative_page_index() {
        let mut book = BookData::default();

        book.apply_page_response(&BookPageDataResponseEventData {
            object_guid: Guid(0x11223344),
            page_index: -1,
            page: BookPageData {
                author_id: 7,
                author_name: "Scribe".to_string(),
                author_account: "acct".to_string(),
                flags: 0xFFFF0002,
                text_included: true,
                ignore_author: false,
                page_text: Some("hello".to_string()),
            },
        });

        assert!(book.pages.is_empty());
    }
}

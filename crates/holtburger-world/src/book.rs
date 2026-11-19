use holtburger_protocol::messages::{BookDataResponseEventData, BookPageDataResponseEventData};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookPage {
    pub index: u32,
    pub author_name: String,
    pub page_text: Option<String>,
}

impl BookPage {
    fn from_protocol(
        index: i32,
        page: &holtburger_protocol::messages::BookPageData,
    ) -> Option<Self> {
        Some(Self {
            index: u32::try_from(index).ok()?,
            author_name: page.author_name.clone(),
            page_text: page.page_text.clone(),
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BookData {
    pub pages: Vec<BookPage>,
    pub inscription: Option<String>,
    pub author_name: Option<String>,
}

impl BookData {
    pub fn from_response(response: &BookDataResponseEventData) -> Self {
        let ignore_author = response
            .pages
            .first()
            .is_some_and(|page| page.ignore_author);
        let author_name = (!ignore_author && !response.author_name.trim().is_empty())
            .then(|| response.author_name.clone());
        let pages = response
            .pages
            .iter()
            .enumerate()
            .filter_map(|(index, page)| BookPage::from_protocol(index as i32, page))
            .collect::<Vec<_>>();

        Self {
            pages,
            inscription: Some(response.inscription.clone()),
            author_name,
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

    #[test]
    fn from_response_resolves_author_name_once_and_omits_ignored_or_blank_authors() {
        let make_page = |ignore_author: bool| BookPageData {
            author_id: 1,
            author_name: "Scribe".to_string(),
            author_account: "acct".to_string(),
            flags: 0,
            text_included: false,
            ignore_author,
            page_text: None,
        };

        let ignored = BookData::from_response(&BookDataResponseEventData {
            object_guid: Guid(1),
            max_num_pages: 1,
            num_pages: 1,
            max_num_chars_per_page: 100,
            pages: vec![make_page(true)],
            inscription: "Signed".to_string(),
            author_id: 1,
            author_name: "Archivist".to_string(),
        });
        assert_eq!(ignored.author_name, None);
        assert_eq!(ignored.pages[0].author_name, "Scribe");

        let blank = BookData::from_response(&BookDataResponseEventData {
            object_guid: Guid(1),
            max_num_pages: 1,
            num_pages: 1,
            max_num_chars_per_page: 100,
            pages: vec![make_page(false)],
            inscription: String::new(),
            author_id: 1,
            author_name: "   ".to_string(),
        });
        assert_eq!(blank.author_name, None);

        let named = BookData::from_response(&BookDataResponseEventData {
            object_guid: Guid(1),
            max_num_pages: 1,
            num_pages: 1,
            max_num_chars_per_page: 100,
            pages: vec![make_page(false)],
            inscription: "Signed".to_string(),
            author_id: 1,
            author_name: "Archivist".to_string(),
        });
        assert_eq!(named.author_name.as_deref(), Some("Archivist"));
    }
}

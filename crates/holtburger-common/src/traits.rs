pub trait Deduplicable {
    type Key: Eq + std::hash::Hash;
    fn dedupe_key(&self) -> Option<Self::Key>;
}

pub fn dedupe_events<T: Deduplicable>(events: Vec<T>) -> Vec<T> {
    let mut deduplicated = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();

    // Iterate backwards to keep the last occurrences of deduplicable events
    for event in events.into_iter().rev() {
        if let Some(key) = event.dedupe_key() {
            if !seen_keys.contains(&key) {
                deduplicated.push(event);
                seen_keys.insert(key);
            }
        } else {
            deduplicated.push(event);
        }
    }
    deduplicated.reverse();
    deduplicated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq, Clone)]
    enum TestEvent {
        Update(u32, String),
        Other(u32),
    }

    #[derive(Debug, PartialEq, Eq, Hash)]
    enum TestKey {
        Update(u32),
    }

    impl Deduplicable for TestEvent {
        type Key = TestKey;
        fn dedupe_key(&self) -> Option<Self::Key> {
            match self {
                TestEvent::Update(id, _) => Some(TestKey::Update(*id)),
                _ => None,
            }
        }
    }

    #[test]
    fn test_dedupe_events() {
        let events = vec![
            TestEvent::Update(1, "A".to_string()),
            TestEvent::Other(10),
            TestEvent::Update(1, "B".to_string()),
            TestEvent::Update(2, "C".to_string()),
            TestEvent::Other(20),
            TestEvent::Update(1, "C".to_string()),
        ];

        let deduplicated = dedupe_events(events);

        assert_eq!(deduplicated.len(), 4);
        // last Update(1, "C") should be kept, others removed
        // last Update(2, "C") kept
        // Others kept as is
        assert_eq!(deduplicated[0], TestEvent::Other(10));
        assert_eq!(deduplicated[1], TestEvent::Update(2, "C".to_string()));
        assert_eq!(deduplicated[2], TestEvent::Other(20));
        assert_eq!(deduplicated[3], TestEvent::Update(1, "C".to_string()));
    }
}

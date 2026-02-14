pub trait ProtocolUnpack: Sized {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self>;
}

pub trait ProtocolPack {
    fn pack(&self, writer: &mut Vec<u8>);
}

macro_rules! impl_primitive {
    ($t:ty, $read_fn:ident, $write_fn:ident, $size:expr) => {
        impl ProtocolUnpack for $t {
            fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
                use byteorder::ByteOrder;
                if *offset + $size > data.len() {
                    return None;
                }
                let val = byteorder::LittleEndian::$read_fn(&data[*offset..*offset + $size]);
                *offset += $size;
                Some(val)
            }
        }
        impl ProtocolPack for $t {
            fn pack(&self, writer: &mut Vec<u8>) {
                use byteorder::WriteBytesExt;
                writer.$write_fn::<byteorder::LittleEndian>(*self).unwrap();
            }
        }
    };
}

impl_primitive!(u16, read_u16, write_u16, 2);
impl_primitive!(u32, read_u32, write_u32, 4);
impl_primitive!(i32, read_i32, write_i32, 4);
impl_primitive!(u64, read_u64, write_u64, 8);
impl_primitive!(i64, read_i64, write_i64, 8);
impl_primitive!(f32, read_f32, write_f32, 4);
impl_primitive!(f64, read_f64, write_f64, 8);

impl ProtocolUnpack for u8 {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset >= data.len() {
            return None;
        }
        let val = data[*offset];
        *offset += 1;
        Some(val)
    }
}
impl ProtocolPack for u8 {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.push(*self);
    }
}

impl ProtocolUnpack for bool {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        u32::unpack(data, offset).map(|v| v != 0)
    }
}
impl ProtocolPack for bool {
    fn pack(&self, writer: &mut Vec<u8>) {
        (if *self { 1u32 } else { 0u32 }).pack(writer);
    }
}

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

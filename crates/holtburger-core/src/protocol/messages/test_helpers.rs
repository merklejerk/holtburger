use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use std::fmt::Debug;

pub fn assert_pack_unpack_parity<T: MessagePack + MessageUnpack + Debug + PartialEq>(
    data: &[u8],
    expected: &T,
) {
    let mut offset = 0;
    let unpacked = T::unpack(data, &mut offset).expect("Unpack failed");
    assert_eq!(
        &unpacked, expected,
        "Unpacked struct does not match expected"
    );

    let mut packed = Vec::new();
    unpacked.pack(&mut packed);
    assert_eq!(
        packed,
        data,
        "Packed bytes do not match original fixture\nActual:   {}\nExpected: {}",
        hex::encode(&packed),
        hex::encode(data)
    );
}

pub fn get_fixture(name: &str) -> Vec<u8> {
    use std::fs;
    use std::path::PathBuf;
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests");
    path.push("fixtures");
    path.push(name);
    fs::read(path).expect(&format!("Fixture not found: {}", name))
}

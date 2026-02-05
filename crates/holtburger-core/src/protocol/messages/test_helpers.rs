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

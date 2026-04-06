use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use encoding_rs::WINDOWS_1252;

pub fn align_to_4(len: usize) -> usize {
    (len + 3) & !3
}

/// Return number of padding bytes needed to align len to align boundary
pub fn pad_len(len: usize, align: usize) -> usize {
    (align - (len % align)) % align
}

/// Pad buf with zeroes until its length is a multiple of 4
pub fn pad_to_4(buf: &mut Vec<u8>) {
    let pad = pad_len(buf.len(), 4);
    if pad > 0 {
        buf.extend(std::iter::repeat_n(0, pad));
    }
}

/// Align an offset (in-place) to the specified alignment boundary.
pub fn align_offset(offset: &mut usize, align: usize) {
    *offset = (*offset + (align - 1)) & !(align - 1);
}

pub fn write_string16(buf: &mut Vec<u8>, s: &str) {
    let bytes = WINDOWS_1252.encode(s).0.into_owned();
    let len = bytes.len();
    if len >= 0xFFFF {
        buf.write_u16::<LittleEndian>(0xFFFF).unwrap();
        buf.write_u32::<LittleEndian>(len as u32).unwrap();
    } else {
        buf.write_u16::<LittleEndian>(len as u16).unwrap();
    }
    buf.extend_from_slice(&bytes);
    pad_to_4(buf);
}

pub fn write_string16_unpadded(buf: &mut Vec<u8>, s: &str) {
    let bytes = WINDOWS_1252.encode(s).0.into_owned();
    let len = bytes.len();
    if len >= 0xFFFF {
        buf.write_u16::<LittleEndian>(0xFFFF).unwrap();
        buf.write_u32::<LittleEndian>(len as u32).unwrap();
    } else {
        buf.write_u16::<LittleEndian>(len as u16).unwrap();
    }
    buf.extend_from_slice(&bytes);
}

pub fn write_string32(buf: &mut Vec<u8>, s: &str) {
    let s_len = s.len() as u32;
    let total_data_len = s_len + 1; // 1 byte prefix for packed length

    buf.extend_from_slice(&total_data_len.to_le_bytes());
    buf.push(s_len as u8); // Packed word prefix
    buf.extend_from_slice(s.as_bytes());

    let cur = buf.len();
    let pad = align_to_4(cur) - cur;
    for _ in 0..pad {
        buf.push(0);
    }
}

pub fn read_string16(data: &[u8], offset: &mut usize) -> Option<String> {
    if *offset + 2 > data.len() {
        return None;
    }
    let mut len = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
    *offset += 2;

    if len == 0xFFFF {
        if *offset + 4 > data.len() {
            return None;
        }
        len = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
    }

    if *offset + len > data.len() {
        return None;
    }
    let s = WINDOWS_1252
        .decode(&data[*offset..*offset + len])
        .0
        .into_owned();
    *offset += len;

    align_offset(offset, 4);
    Some(s)
}

pub fn read_hashtable_header(data: &[u8], offset: &mut usize) -> Option<(usize, usize)> {
    if *offset + 4 > data.len() {
        return None;
    }
    let count = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
    let buckets = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]) as usize;
    *offset += 4;
    Some((count, buckets))
}

pub fn write_hashtable_header(buf: &mut Vec<u8>, count: usize, buckets: usize) {
    buf.write_u16::<LittleEndian>(count as u16).unwrap();
    buf.write_u16::<LittleEndian>(buckets as u16).unwrap();
}

pub fn read_string16_unpadded(data: &[u8], offset: &mut usize) -> Option<String> {
    if *offset + 2 > data.len() {
        return None;
    }
    let mut len = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
    *offset += 2;

    if len == 0xFFFF {
        if *offset + 4 > data.len() {
            return None;
        }
        len = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
    }

    if *offset + len > data.len() {
        return None;
    }
    let s = WINDOWS_1252
        .decode(&data[*offset..*offset + len])
        .0
        .into_owned();
    *offset += len;
    Some(s)
}

pub fn read_data(data: &[u8], offset: &mut usize) -> Option<Vec<u8>> {
    if *offset + 4 > data.len() {
        return None;
    }
    let len = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
    *offset += 4;
    if *offset + len > data.len() {
        return None;
    }
    let buf = data[*offset..*offset + len].to_vec();
    *offset += len;
    Some(buf)
}

pub fn write_data(buf: &mut Vec<u8>, data: &[u8]) {
    buf.write_u32::<LittleEndian>(data.len() as u32).unwrap();
    buf.extend_from_slice(data);
}

pub fn read_packed_wclass_id(data: &[u8], offset: &mut usize) -> u32 {
    if data.len() < *offset + 2 {
        return 0;
    }
    let lo = LittleEndian::read_u16(&data[*offset..*offset + 2]);
    if (lo & 0x8000) != 0 {
        if data.len() < *offset + 4 {
            return 0;
        }
        let hi = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        (hi as u32) | (((lo & 0x7FFF) as u32) << 16)
    } else {
        *offset += 2;
        lo as u32
    }
}

pub fn write_packed_wclass_id(buf: &mut Vec<u8>, value: u32) {
    if value <= 0x7FFF {
        buf.write_u16::<LittleEndian>(value as u16).unwrap();
    } else {
        let lo = ((value >> 16) as u16) | 0x8000;
        let hi = (value & 0xFFFF) as u16;
        buf.write_u16::<LittleEndian>(lo).unwrap();
        buf.write_u16::<LittleEndian>(hi).unwrap();
    }
}

pub fn read_packed_data_id(data: &[u8], offset: &mut usize, base_id: u32) -> u32 {
    if data.len() < *offset + 2 {
        return base_id;
    }
    let lo = LittleEndian::read_u16(&data[*offset..*offset + 2]);
    if (lo & 0x8000) != 0 {
        if data.len() < *offset + 4 {
            return base_id;
        }
        let hi = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;
        let val = (hi as u32) | (((lo & 0x3FFF) as u32) << 16);
        base_id + val
    } else {
        *offset += 2;
        base_id + lo as u32
    }
}

pub fn write_packed_data_id(buf: &mut Vec<u8>, value: u32, base_id: u32) {
    let rel = value.wrapping_sub(base_id);
    if rel <= 0x7FFF {
        buf.write_u16::<LittleEndian>(rel as u16).unwrap();
    } else {
        let lo = ((rel >> 16) as u16) | 0x8000;
        let hi = (rel & 0xFFFF) as u16;
        buf.write_u16::<LittleEndian>(lo).unwrap();
        buf.write_u16::<LittleEndian>(hi).unwrap();
    }
}

pub fn build_login_payload(account: &str, password: &str, sequence: u32, version: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    write_string16(&mut payload, version); // ClientVersion

    // Placeholder for data_len
    let len_pos = payload.len();
    payload.extend_from_slice(&[0u8; 4]);

    let start_of_data = payload.len();

    payload.extend_from_slice(&0x02u32.to_le_bytes()); // NetAuthType: AccountPassword
    payload.extend_from_slice(&0x01u32.to_le_bytes()); // AuthFlags: EnableCrypto
    payload.extend_from_slice(&sequence.to_le_bytes()); // Timestamp
    write_string16(&mut payload, account);
    write_string16(&mut payload, ""); // AdminOverride
    write_string32(&mut payload, password);

    let data_len = (payload.len() - start_of_data) as u32;
    LittleEndian::write_u32(&mut payload[len_pos..len_pos + 4], data_len);

    payload
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_align_to_4() {
        assert_eq!(align_to_4(0), 0);
        assert_eq!(align_to_4(1), 4);
        assert_eq!(align_to_4(2), 4);
        assert_eq!(align_to_4(3), 4);
        assert_eq!(align_to_4(4), 4);
        assert_eq!(align_to_4(5), 8);
    }

    #[test]
    fn test_pad_to_4_and_align_offset() {
        let mut buf = vec![1u8];
        pad_to_4(&mut buf);
        assert_eq!(buf.len() % 4, 0);
        assert_eq!(buf, vec![1u8, 0, 0, 0]);

        let mut buf = vec![];
        pad_to_4(&mut buf);
        assert_eq!(buf.len(), 0);

        let mut off = 5usize;
        align_offset(&mut off, 4);
        assert_eq!(off % 4, 0);
        assert_eq!(off, 8);

        let mut off = 8usize;
        align_offset(&mut off, 4);
        assert_eq!(off, 8);
    }

    #[test]
    fn test_packed_wclass_id_small() {
        let val = 0x1234;
        let mut buf = Vec::new();
        write_packed_wclass_id(&mut buf, val);
        assert_eq!(buf, vec![0x34, 0x12]);

        let mut offset = 0;
        let read = read_packed_wclass_id(&buf, &mut offset);
        assert_eq!(read, val);
        assert_eq!(offset, 2);
    }

    #[test]
    fn test_packed_wclass_id_large() {
        let val = 0x12345678;
        let mut buf = Vec::new();
        write_packed_wclass_id(&mut buf, val);
        // lo = ((0x12345678 >> 16) | 0x8000) = 0x1234 | 0x8000 = 0x9234
        // hi = 0x12345678 & 0xFFFF = 0x5678
        // LE: 34 92 78 56
        assert_eq!(buf, vec![0x34, 0x92, 0x78, 0x56]);

        let mut offset = 0;
        let read = read_packed_wclass_id(&buf, &mut offset);
        assert_eq!(read, val);
        assert_eq!(offset, 4);
    }

    #[test]
    fn test_packed_data_id_known_type() {
        let val = 0x06001234;
        let mut buf = Vec::new();
        write_packed_data_id(&mut buf, val, 0x06000000);
        // Should write 0x1234 as packed u16
        assert_eq!(buf, vec![0x34, 0x12]);

        let mut offset = 0;
        let read = read_packed_data_id(&buf, &mut offset, 0x06000000);
        assert_eq!(read, val);
        assert_eq!(offset, 2);
    }

    #[test]
    fn test_packed_data_id_known_type_large() {
        let val = 0x06008000;
        let mut buf = Vec::new();
        write_packed_data_id(&mut buf, val, 0x06000000);
        // rel = 0x8000. lo = (0x8000 >> 16) | 0x8000 = 0 | 0x8000 = 0x8000. hi = 0x8000.
        // LE: 00 80 00 80
        assert_eq!(buf, vec![0x00, 0x80, 0x00, 0x80]);

        let mut offset = 0;
        let read = read_packed_data_id(&buf, &mut offset, 0x06000000);
        assert_eq!(read, val);
        assert_eq!(offset, 4);
    }

    #[test]
    fn test_string16_padding() {
        let s = "abc";
        let mut buf = Vec::new();
        write_string16(&mut buf, s);
        // length 0x0003, "abc", then 3 bytes of padding to reach multiple of 4 (including len prefix)
        // 2 + 3 = 5 bytes. Needs 3 bytes pad = 8 bytes.
        assert_eq!(buf.len(), 8);
        assert_eq!(&buf[0..2], &[0x03, 0x00]);
        assert_eq!(&buf[2..5], b"abc");
        assert_eq!(&buf[5..8], &[0, 0, 0]);

        let mut offset = 0;
        let read = read_string16(&buf, &mut offset).unwrap();
        assert_eq!(read, s);
        assert_eq!(offset, 8);
    }

    #[test]
    fn test_string16_windows_1252_round_trip() {
        let s = "Blackmoor’s Favor";
        let mut buf = Vec::new();
        write_string16(&mut buf, s);

        assert_eq!(&buf[0..2], &[0x11, 0x00]);
        assert_eq!(buf[11], 0x92);

        let mut offset = 0;
        let read = read_string16(&buf, &mut offset).unwrap();
        assert_eq!(read, s);
        assert_eq!(offset, buf.len());
    }

    #[test]
    fn test_string16_windows_1252_decoding_from_packet_bytes() {
        let mut buf = vec![
            0x11, 0x00, b'B', b'l', b'a', b'c', b'k', b'm', b'o', b'o', b'r', 0x92, b's', b' ',
            b'F', b'a', b'v', b'o', b'r',
        ];
        pad_to_4(&mut buf);

        let mut offset = 0;
        let read = read_string16(&buf, &mut offset).unwrap();
        assert_eq!(read, "Blackmoor’s Favor");
        assert_eq!(offset, buf.len());
    }

    #[test]
    fn test_string32_padding() {
        let mut buf = Vec::new();
        // 4 bytes len + 1 byte packed prefix + 1 byte "a" = 6. Pad to 8.
        write_string32(&mut buf, "a");
        assert_eq!(buf.len(), 8);
        assert_eq!(LittleEndian::read_u32(&buf[0..4]), 2); // 1 byte prefix + 1 byte string = 2
    }
}
pub fn ac_hash_sort<T: Copy + Ord, V, F>(items: &mut [(T, V)], buckets: u32, to_u32: F)
where
    F: Fn(T) -> u32,
{
    items.sort_by(|a, b| {
        let id_a = to_u32(a.0);
        let id_b = to_u32(b.0);
        let bucket_a = id_a % buckets;
        let bucket_b = id_b % buckets;
        bucket_a.cmp(&bucket_b).then(id_a.cmp(&id_b))
    });
}

pub fn ac_hash_sort_keys<T: Copy + Ord, F>(items: &mut [T], buckets: u32, to_u32: F)
where
    F: Fn(T) -> u32,
{
    items.sort_by(|&a, &b| {
        let id_a = to_u32(a);
        let id_b = to_u32(b);
        let bucket_a = id_a % buckets;
        let bucket_b = id_b % buckets;
        bucket_a.cmp(&bucket_b).then(id_a.cmp(&id_b))
    });
}

#[cfg(test)]
mod sort_tests {
    use super::*;

    #[test]
    fn test_hash_table_sorting() {
        let mut items = vec![
            (1u32, "one"),
            (65u32, "sixty-five"),  // Bucket 1 (65 % 64)
            (25u32, "twenty-five"), // Bucket 25
        ];

        // Using 64 buckets
        ac_hash_sort(&mut items, 64, |k| k);

        // Expected order:
        // 1. GUID 1 (Bucket 1)
        // 2. GUID 65 (Bucket 1)
        // 3. GUID 25 (Bucket 25)
        assert_eq!(items[0].0, 1);
        assert_eq!(items[1].0, 65);
        assert_eq!(items[2].0, 25);
    }
}

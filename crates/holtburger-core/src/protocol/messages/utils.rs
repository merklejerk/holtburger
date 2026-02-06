use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

pub fn align_to_4(len: usize) -> usize {
    (len + 3) & !3
}

pub fn write_string16(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let len = bytes.len();
    buf.write_u16::<LittleEndian>(len as u16).unwrap();
    buf.extend_from_slice(bytes);
    let structure_len = 2 + len;
    let pad = (4 - (structure_len % 4)) % 4;
    for _ in 0..pad {
        buf.push(0);
    }
}

pub fn write_string16_unpadded(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let len = bytes.len();
    buf.write_u16::<LittleEndian>(len as u16).unwrap();
    buf.extend_from_slice(bytes);
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
    let len = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
    *offset += 2;
    if *offset + len > data.len() {
        return None;
    }
    let s = String::from_utf8_lossy(&data[*offset..*offset + len]).to_string();
    *offset += len;
    let structure_len = 2 + len;
    let pad = (4 - (structure_len % 4)) % 4;
    *offset += pad;
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
    let len = LittleEndian::read_u16(&data[*offset..*offset + 2]) as usize;
    *offset += 2;
    if *offset + len > data.len() {
        return None;
    }
    let s = String::from_utf8_lossy(&data[*offset..*offset + len]).to_string();
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

pub fn read_packed_u32(data: &[u8], offset: &mut usize) -> u32 {
    if data.len() < *offset + 2 {
        return 0;
    }
    let val = LittleEndian::read_u16(&data[*offset..*offset + 2]);
    if (val & 0x8000) != 0 {
        if data.len() < *offset + 4 {
            return 0;
        }
        let full = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let lower = full >> 16;
        let higher = (full & 0x7FFF) << 16;
        higher | lower
    } else {
        *offset += 2;
        val as u32
    }
}

pub fn write_packed_u32(buf: &mut Vec<u8>, value: u32) {
    if value <= 32767 {
        buf.write_u16::<LittleEndian>(value as u16).unwrap();
    } else {
        let packed = (value << 16) | ((value >> 16) | 0x8000);
        buf.write_u32::<LittleEndian>(packed).unwrap();
    }
}

pub fn read_packed_u32_with_known_type(data: &[u8], offset: &mut usize, known_type: u32) -> u32 {
    let start = *offset;
    let raw = read_packed_u32(data, offset);
    if (*offset - start) == 2 {
        raw | known_type
    } else {
        raw
    }
}

pub fn write_packed_u32_with_known_type(buf: &mut Vec<u8>, value: u32, known_type: u32) {
    if known_type != 0 && (value & known_type) == known_type {
        write_packed_u32(buf, value - known_type);
    } else {
        write_packed_u32(buf, value);
    }
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
    fn test_packed_u32_small() {
        let val = 0x1234;
        let mut buf = Vec::new();
        write_packed_u32(&mut buf, val);
        assert_eq!(buf, vec![0x34, 0x12]);

        let mut offset = 0;
        let read = read_packed_u32(&buf, &mut offset);
        assert_eq!(read, val);
        assert_eq!(offset, 2);
    }

    #[test]
    fn test_packed_u32_large() {
        let val = 0x12345678;
        let mut buf = Vec::new();
        write_packed_u32(&mut buf, val);
        // packed = (value << 16) | ((value >> 16) | 0x8000)
        // (0x12345678 << 16) = 0x56780000
        // (0x12345678 >> 16) = 0x1234
        // 0x1234 | 0x8000 = 0x9234
        // packed = 0x56789234
        // LE: 34 92 78 56
        assert_eq!(buf, vec![0x34, 0x92, 0x78, 0x56]);

        let mut offset = 0;
        let read = read_packed_u32(&buf, &mut offset);
        assert_eq!(read, val);
        assert_eq!(offset, 4);
    }

    #[test]
    fn test_packed_u32_known_type() {
        let val = 0x06001234;
        let mut buf = Vec::new();
        write_packed_u32_with_known_type(&mut buf, val, 0x06000000);
        // Should write 0x1234 as packed u16
        assert_eq!(buf, vec![0x34, 0x12]);

        let mut offset = 0;
        let read = read_packed_u32_with_known_type(&buf, &mut offset, 0x06000000);
        assert_eq!(read, val);
        assert_eq!(offset, 2);
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
    fn test_string32_padding() {
        let mut buf = Vec::new();
        // 4 bytes len + 1 byte packed prefix + 1 byte "a" = 6. Pad to 8.
        write_string32(&mut buf, "a");
        assert_eq!(buf.len(), 8);
        assert_eq!(LittleEndian::read_u32(&buf[0..4]), 2); // 1 byte prefix + 1 byte string = 2
    }
}

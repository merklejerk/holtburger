use binrw::{BinRead, BinWrite};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};

pub fn read_compressed_u32<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<u32> {
    let b0 = u8::read(reader)?;
    if (b0 & 0x80) == 0 {
        Ok(b0 as u32)
    } else {
        let b1 = u8::read(reader)?;
        if (b0 & 0x40) == 0 {
            Ok(((b0 as u32 & 0x7F) << 8) | b1 as u32)
        } else {
            let s = u16::read_le(reader)?;
            Ok(((((b0 as u32 & 0x3F) << 8) | b1 as u32) << 16) | s as u32)
        }
    }
}

pub fn write_compressed_u32<W: Write + Seek>(writer: &mut W, val: u32) -> binrw::BinResult<()> {
    if val > 0x3FFF_FFFF {
        return Err(binrw::Error::Custom {
            pos: writer.stream_position()?,
            err: Box::new("u32 value too large for compressed format (>30 bits)"),
        });
    }

    if val < 0x80 {
        (val as u8).write(writer)?;
    } else if val < 0x4000 {
        let b0 = 0x80 | ((val >> 8) & 0x3F) as u8;
        let b1 = (val & 0xFF) as u8;
        b0.write(writer)?;
        b1.write(writer)?;
    } else {
        let b0 = 0xC0 | ((val >> 24) & 0x3F) as u8;
        let b1 = ((val >> 16) & 0xFF) as u8;
        let s = (val & 0xFFFF) as u16;
        b0.write(writer)?;
        b1.write(writer)?;
        s.write_le(writer)?;
    }
    Ok(())
}

pub fn read_smart_vec<T, R, F>(reader: &mut R, mut read_item: F) -> binrw::BinResult<Vec<T>>
where
    R: Read + Seek,
    F: FnMut(&mut R) -> binrw::BinResult<T>,
{
    let count = read_compressed_u32(reader)? as usize;
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        values.push(read_item(reader)?);
    }
    Ok(values)
}

pub fn read_smart_map<K, T, R, FK, FV>(
    reader: &mut R,
    mut read_key: FK,
    mut read_value: FV,
) -> binrw::BinResult<HashMap<K, T>>
where
    R: Read + Seek,
    K: Eq + std::hash::Hash,
    FK: FnMut(&mut R) -> binrw::BinResult<K>,
    FV: FnMut(&mut R) -> binrw::BinResult<T>,
{
    let count = read_compressed_u32(reader)? as usize;
    let mut values = HashMap::with_capacity(count);
    for _ in 0..count {
        let key = read_key(reader)?;
        values.insert(key, read_value(reader)?);
    }
    Ok(values)
}

pub fn read_pstring<R: Read + Seek>(
    reader: &mut R,
    size_of_length: u32,
) -> binrw::BinResult<String> {
    let length = match size_of_length {
        1 => u8::read(reader)? as usize,
        2 => u16::read_le(reader)? as usize,
        4 => u32::read_le(reader)? as usize,
        _ => {
            return Err(binrw::Error::AssertFail {
                pos: reader.stream_position().unwrap_or(0),
                message: "Unsupported PString length size".to_string(),
            });
        }
    };

    let mut buffer = vec![0u8; length];
    reader.read_exact(&mut buffer)?;

    // Asheron's Call usually uses Windows-1252 or similar.
    // encoding_rs can handle this.
    let (res, _, _) = encoding_rs::WINDOWS_1252.decode(&buffer);
    Ok(res.into_owned())
}

pub fn read_obfuscated_string<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<String> {
    let length = u16::read_le(reader)? as usize;
    let mut buffer = vec![0u8; length];
    reader.read_exact(&mut buffer)?;

    for byte in &mut buffer {
        // flip the bytes in the string to undo the obfuscation: i.e. 0xAB => 0xBA
        *byte = byte.rotate_left(4);
    }

    let (res, _, _) = encoding_rs::WINDOWS_1252.decode(&buffer);
    Ok(res.into_owned())
}

pub fn read_dotnet_string<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<String> {
    let mut length = 0usize;
    let mut shift = 0usize;

    loop {
        let byte = u8::read(reader)?;
        length |= ((byte & 0x7F) as usize) << shift;

        if (byte & 0x80) == 0 {
            break;
        }

        shift += 7;
        if shift >= 35 {
            return Err(binrw::Error::AssertFail {
                pos: reader.stream_position().unwrap_or(0),
                message: "invalid .NET BinaryReader string length".to_string(),
            });
        }
    }

    let mut buffer = vec![0u8; length];
    reader.read_exact(&mut buffer)?;

    let (res, _, _) = encoding_rs::WINDOWS_1252.decode(&buffer);
    Ok(res.into_owned())
}

pub fn align_boundary<R: Read + Seek>(reader: &mut R, boundary: u32) -> binrw::BinResult<()> {
    let pos = reader.stream_position()?;
    let delta = pos % boundary as u64;
    if delta != 0 {
        reader.seek(SeekFrom::Current((boundary as u64 - delta) as i64))?;
    }
    Ok(())
}

pub fn decompress_lrs(input: &[u8]) -> Vec<u8> {
    if input.len() < 4 {
        return input.to_vec();
    }

    let output_size = u32::from_le_bytes(input[0..4].try_into().unwrap()) as usize;
    let compressed_data = &input[4..];

    let mut output = Vec::with_capacity(output_size);
    let mut control_byte: u8 = 0;
    let mut control_bit: u8 = 0;
    let mut input_idx = 0;

    while output.len() < output_size && input_idx < compressed_data.len() {
        if control_bit == 0 {
            control_byte = compressed_data[input_idx];
            input_idx += 1;
            control_bit = 0x80;
        }

        if (control_byte & control_bit) != 0 {
            if input_idx + 1 >= compressed_data.len() {
                break;
            }
            let b1 = compressed_data[input_idx] as usize;
            let b2 = compressed_data[input_idx + 1] as usize;
            input_idx += 2;

            let offset = b1 | ((b2 & 0xF0) << 4);
            let length = (b2 & 0x0F) + 2;

            if offset == 0 {
                break;
            }

            for _ in 0..length {
                if output.len() >= output_size {
                    break;
                }
                let copy_idx = output.len().saturating_sub(offset);
                let byte = output[copy_idx];
                output.push(byte);
            }
        } else {
            output.push(compressed_data[input_idx]);
            input_idx += 1;
        }

        control_bit >>= 1;
    }

    output
}

pub trait FileExtPolyfill {
    fn read_exact_at_compat(&self, buf: &mut [u8], offset: u64) -> std::io::Result<()>;
}

impl FileExtPolyfill for std::fs::File {
    #[cfg(unix)]
    fn read_exact_at_compat(&self, buf: &mut [u8], offset: u64) -> std::io::Result<()> {
        use std::os::unix::fs::FileExt;
        self.read_exact_at(buf, offset)
    }

    #[cfg(windows)]
    fn read_exact_at_compat(&self, buf: &mut [u8], offset: u64) -> std::io::Result<()> {
        use std::os::windows::fs::FileExt;
        // Windows seek_read returns number of bytes read, so we loop to ensure exact read
        let mut read = 0;
        while read < buf.len() {
            let n = self.seek_read(&mut buf[read..], offset + read as u64)?;
            if n == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "failed to fill whole buffer",
                ));
            }
            read += n;
        }
        Ok(())
    }
}

/// Helper to find a portal.dat for testing/benchmarking purposes.
///
/// Priority 1: `HOLTBURGER_PORTAL_DAT` environment variable.
/// Priority 2: Repository-relative fallback (`dats/portal.dat` from workspace root).
pub fn get_portal_dat_path() -> Option<std::path::PathBuf> {
    if let Ok(path_str) = std::env::var("HOLTBURGER_PORTAL_DAT") {
        let path = std::path::PathBuf::from(path_str);
        if path.exists() {
            return Some(path);
        }
    }

    // Workspace-relative fallbacks
    let workspace_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../");

    // 1. Repository dats/ folder
    let repo_dats = workspace_root.join("dats/portal.dat");
    if repo_dats.exists() {
        return Some(repo_dats);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_compressed_u32_roundtrip() {
        let test_values = vec![0, 1, 0x7F, 0x80, 0x3FFF, 0x4000, 0x3FFF_FFFF];

        for val in test_values {
            let mut buf = Vec::new();
            let mut writer = Cursor::new(&mut buf);
            write_compressed_u32(&mut writer, val).unwrap();

            let mut reader = Cursor::new(&buf);
            let read_val = read_compressed_u32(&mut reader).unwrap();
            assert_eq!(val, read_val, "Value 0x{:08X} failed roundtrip", val);
        }
    }

    #[test]
    fn test_write_compressed_u32_overflow() {
        let mut buf = Vec::new();
        let mut writer = Cursor::new(&mut buf);
        let res = write_compressed_u32(&mut writer, 0x4000_0000);
        assert!(res.is_err());
    }

    #[test]
    fn test_read_smart_vec() {
        let bytes = [0x02, 0x44, 0x33, 0x22, 0x11, 0x88, 0x77, 0x66, 0x55];
        let mut reader = Cursor::new(bytes);

        let values = read_smart_vec(&mut reader, u32::read_le).unwrap();

        assert_eq!(values, vec![0x1122_3344, 0x5566_7788]);
    }

    #[test]
    fn test_read_smart_map() {
        let bytes = [
            0x02, // count
            0x01, 0x00, 0x00, 0x00, // key 1
            0xAA, 0xAA, 0x00, 0x00, // value 0xAAAA
            0x02, 0x00, 0x00, 0x00, // key 2
            0xBB, 0xBB, 0x00, 0x00, // value 0xBBBB
        ];
        let mut reader = Cursor::new(bytes);

        let values = read_smart_map(&mut reader, u32::read_le, u32::read_le).unwrap();

        assert_eq!(values.get(&1), Some(&0x0000_AAAA));
        assert_eq!(values.get(&2), Some(&0x0000_BBBB));
    }

    #[test]
    fn test_decompress_lrs_literal() {
        let input = vec![
            4, 0, 0, 0,    // Size 4
            0x00, // Control byte: all literals (0)
            0xAA, 0xBB, 0xCC, 0xDD,
        ];
        let decompressed = decompress_lrs(&input);
        assert_eq!(decompressed, vec![0xAA, 0xBB, 0xCC, 0xDD]);
    }

    #[test]
    fn test_decompress_lrs_backref() {
        // Output should be "ABCABC"
        // 'A', 'B', 'C', then backref to 'A', 'B', 'C' (offset 3, length 1+2=3)
        // Control bit starts at 0x80.
        let input = vec![
            6, 0, 0, 0,    // Size 6
            0x10, // 0001 0000. bits 0..3 are 0 (literals), bit 4 is 1 (backref)
            b'A', b'B', b'C', 0x03, 0x01, // b1=3, b2=1 (length 1+2=3)
        ];
        let decompressed = decompress_lrs(&input);
        assert_eq!(decompressed, b"ABCABC");
    }

    #[test]
    fn test_read_dotnet_string() {
        let bytes = [0x05, b'H', b'e', b'l', b'l', b'o'];
        let mut reader = Cursor::new(bytes);

        let value = read_dotnet_string(&mut reader).unwrap();

        assert_eq!(value, "Hello");
    }
}

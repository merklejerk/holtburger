use binrw::{BinRead, BinWrite};
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

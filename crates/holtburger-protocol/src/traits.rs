use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::guid::Guid;
use holtburger_common::position::WorldPosition;

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
                if *offset + $size > data.len() {
                    return None;
                }
                let val = LittleEndian::$read_fn(&data[*offset..*offset + $size]);
                *offset += $size;
                Some(val)
            }
        }
        impl ProtocolPack for $t {
            fn pack(&self, writer: &mut Vec<u8>) {
                writer.$write_fn::<LittleEndian>(*self).unwrap();
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

impl ProtocolUnpack for Guid {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let val = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(val.into())
    }
}

impl ProtocolPack for Guid {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&<Guid as Into<u32>>::into(*self).to_le_bytes());
    }
}

impl ProtocolPack for WorldPosition {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer
            .write_u32::<LittleEndian>(self.landblock_id.into())
            .unwrap();
        writer.write_f32::<LittleEndian>(self.coords.x).unwrap();
        writer.write_f32::<LittleEndian>(self.coords.y).unwrap();
        writer.write_f32::<LittleEndian>(self.coords.z).unwrap();
        writer.write_f32::<LittleEndian>(self.rotation.w).unwrap();
        writer.write_f32::<LittleEndian>(self.rotation.x).unwrap();
        writer.write_f32::<LittleEndian>(self.rotation.y).unwrap();
        writer.write_f32::<LittleEndian>(self.rotation.z).unwrap();
    }
}

impl ProtocolUnpack for WorldPosition {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if data.len() < *offset + 32 {
            return None;
        }
        let landblock_id = LittleEndian::read_u32(&data[*offset..*offset + 4]).into();
        *offset += 4;
        let x = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let y = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let z = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        let qw = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let qx = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let qy = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        let qz = LittleEndian::read_f32(&data[*offset + 12..*offset + 16]);
        *offset += 16;

        Some(Self {
            landblock_id,
            coords: holtburger_common::math::Vector3 { x, y, z },
            rotation: holtburger_common::math::Quaternion {
                w: qw,
                x: qx,
                y: qy,
                z: qz,
            },
        })
    }
}

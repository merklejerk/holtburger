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

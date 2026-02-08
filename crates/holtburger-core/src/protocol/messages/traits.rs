pub trait ProtocolUnpack: Sized {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self>;
}

pub trait ProtocolPack {
    fn pack(&self, writer: &mut Vec<u8>);
}

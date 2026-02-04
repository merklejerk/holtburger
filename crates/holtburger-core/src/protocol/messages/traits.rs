pub trait MessageUnpack: Sized {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self>;
}

pub trait MessagePack {
    fn pack(&self, writer: &mut Vec<u8>);
}

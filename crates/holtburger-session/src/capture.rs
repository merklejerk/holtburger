use anyhow::Result;
use byteorder::{LittleEndian, WriteBytesExt};
use std::fs::File;
use std::io::Write;
use std::net::SocketAddr;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Direction {
    Inbound = 0,
    Outbound = 1,
}

pub struct CaptureWriter {
    file: File,
}

impl CaptureWriter {
    pub fn create(path: &str) -> Result<Self> {
        let file = File::create(path)?;
        Ok(Self { file })
    }

    pub fn write_entry(
        &mut self,
        direction: Direction,
        addr: SocketAddr,
        data: &[u8],
    ) -> Result<()> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        self.file.write_u8(direction as u8)?;
        self.file.write_u64::<LittleEndian>(now)?;

        let addr_str = addr.to_string();
        self.file.write_u16::<LittleEndian>(addr_str.len() as u16)?;
        self.file.write_all(addr_str.as_bytes())?;

        self.file.write_u32::<LittleEndian>(data.len() as u32)?;
        self.file.write_all(data)?;

        self.file.flush()?;
        Ok(())
    }
}

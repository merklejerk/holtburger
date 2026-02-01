use anyhow::{Result, anyhow};
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use std::fs::File;
use std::io::{Read, Write};
use std::net::SocketAddr;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Direction {
    Inbound = 0,
    Outbound = 1,
}

pub struct CaptureEntry {
    pub direction: Direction,
    pub timestamp_ms: u64,
    pub addr: SocketAddr,
    pub data: Vec<u8>,
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

pub struct CaptureReader {
    file: File,
}

pub struct ReplayTransport {
    pub reader: std::sync::Arc<std::sync::Mutex<CaptureReader>>,
}

#[crate::session::async_trait]
impl crate::session::Transport for ReplayTransport {
    async fn send_to(&self, _buf: &[u8], _addr: SocketAddr) -> anyhow::Result<usize> {
        Ok(_buf.len())
    }

    async fn recv_from(&self, buf: &mut [u8]) -> anyhow::Result<(usize, SocketAddr)> {
        let mut reader = self
            .reader
            .lock()
            .map_err(|_| anyhow::anyhow!("Lock poisoned"))?;
        while let Some(entry) = reader.read_next()? {
            if entry.direction == Direction::Inbound {
                let len = entry.data.len().min(buf.len());
                buf[..len].copy_from_slice(&entry.data[..len]);
                return Ok((len, entry.addr));
            }
        }
        Err(anyhow::anyhow!("End of capture"))
    }
}

impl CaptureReader {
    pub fn open(path: &str) -> Result<Self> {
        let file = File::open(path)?;
        Ok(Self { file })
    }

    pub fn read_next(&mut self) -> Result<Option<CaptureEntry>> {
        let direction_u8 = match self.file.read_u8() {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(e.into()),
        };

        let direction = if direction_u8 == 0 {
            Direction::Inbound
        } else {
            Direction::Outbound
        };
        let timestamp_ms = self.file.read_u64::<LittleEndian>()?;

        let addr_len = self.file.read_u16::<LittleEndian>()? as usize;
        let mut addr_buf = vec![0u8; addr_len];
        self.file.read_exact(&mut addr_buf)?;
        let addr_str = String::from_utf8_lossy(&addr_buf);
        let addr: SocketAddr = addr_str.parse().map_err(|_| anyhow!("Invalid address"))?;

        let data_len = self.file.read_u32::<LittleEndian>()? as usize;
        let mut data = vec![0u8; data_len];
        self.file.read_exact(&mut data)?;

        Ok(Some(CaptureEntry {
            direction,
            timestamp_ms,
            addr,
            data,
        }))
    }
}

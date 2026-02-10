use thiserror::Error;
use std::path::PathBuf;

#[derive(Error, Debug)]
pub enum DatError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Binary read error: {0}")]
    BinRead(#[from] binrw::Error),

    #[error("File ID {0:08X} not found in provider")]
    NotFound(u32),

    #[error("Invalid magic for format: {0}")]
    InvalidMagic(String),

    #[error("Unsupported version: {0}")]
    UnsupportedVersion(u32),

    #[error("Corruption detected: {0}")]
    Corruption(String),

    #[error("Failed to decompress file {0:08X}")]
    DecompressionFailed(u32),

    #[error("Failed to open file at path: {0}")]
    PathError(PathBuf),

    #[error("Other error: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, DatError>;

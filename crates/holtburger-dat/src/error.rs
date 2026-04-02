use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DatError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Binary read error: {0}")]
    BinRead(#[from] binrw::Error),

    #[error("File ID {0:08X} not found in provider")]
    NotFound(u32),

    #[error("Duplicate File ID {0:08X} detected")]
    DuplicateId(u32),

    #[error("Duplicate namespaced file {namespace}:{file_id:08X} detected")]
    DuplicateNamespacedId { namespace: String, file_id: u32 },

    #[error("Invalid magic for format: {0}")]
    InvalidMagic(String),

    #[error("Unsupported version: {0}")]
    UnsupportedVersion(u32),

    #[error("Invalid namespace: {0}")]
    InvalidNamespace(String),

    #[error("Corruption detected: {0}")]
    Corruption(String),

    #[error("Failed to recover compressed file {0:08X}")]
    DecompressionFailed(u32),

    #[error("Failed to open file at {path}: {source}")]
    PathError {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("Other error: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, DatError>;

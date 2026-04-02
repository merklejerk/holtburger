use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ToolError {
    #[error("Failed to open DAT database at {0}: {1}")]
    DatOpen(PathBuf, String),

    #[error("Failed to read file 0x{id:08X} from DAT: {source}")]
    DatRead {
        id: u32,
        #[source]
        source: holtburger_dat::error::DatError,
    },

    #[error("Failed to write HBA archive to {0}: {1}")]
    HbaWrite(PathBuf, String),

    #[error("Failed to create output directory: {0}")]
    Io(#[from] std::io::Error),

    #[error("Progress bar error: {0}")]
    Indicatif(#[from] indicatif::style::TemplateError),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Failed to derive required asset: {0}")]
    AssetDerivation(String),
}

pub type Result<T> = std::result::Result<T, ToolError>;

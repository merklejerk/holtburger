pub mod dat2hba;
pub mod error;
pub mod spell_export;
#[cfg(feature = "weenie-catalog-export")]
pub mod weenie_catalog_export;
pub mod weenie_catalog_survey;

/// Canonical installed and portable location of the optional Explorer weenie catalog.
pub const DEFAULT_WEENIE_CATALOG_PATH: &str = "dats/weenies.hwc";

pub use dat2hba::{
    ArchiveProfile, Dat2HbaOptions, DatInputSpec, process_dat, process_dat_with_mode,
    process_inputs, run,
};
pub use error::{Result, ToolError};

//! Portable offline ACE World weenie catalog for the Explorer host.

mod codec;
mod model;
mod reader;
mod writer;

pub use model::{
    AnimPartChange, PhysicsBoolOverrides, SubPalette, TemplateAppearance, TemplatePhysics,
    TextureChange, WeenieTemplate, WeenieTemplateIdentity, WieldEntry,
};
pub use reader::{
    CatalogIdentityReadError, CatalogLookupError, CatalogOpenError, CatalogRecordInfo,
    WeenieCatalog,
};
pub use writer::{CatalogWriteError, write_catalog_atomic};

/// Conventional extension for Holtburger weenie catalog assets.
pub const CATALOG_EXTENSION: &str = "hwc";
/// Current portable file-format version.
pub const CATALOG_FORMAT_VERSION: u32 = 6;

#[cfg(test)]
mod tests;

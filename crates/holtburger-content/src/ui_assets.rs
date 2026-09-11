//! Static enum/image lookup, independent of inventory or renderer residency.

use crate::{
    ContentRepository,
    render_surface_pixels::{UnsupportedDirectColorFormat, decode_direct_color},
};
use holtburger_dat::{
    EOR_PORTAL_NAMESPACE, ResourceKey,
    file_type::{DidMapper, RenderSurface},
};
use std::{collections::HashMap, io::Cursor, sync::Arc};
use thiserror::Error;

/// Root of the authored enum-group mapping chain.
pub const MASTER_DID_MAPPER: u32 = 0x25000000;

/// A static-content lookup failure with enough identity for user-facing diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum UiAssetError {
    /// An enum key has no nonzero target in either map.
    #[error("DID mapper {mapper:#010x} has no entry {entry:#010x}")]
    MissingMapping { mapper: u32, entry: u32 },
    /// No mounted record supplies the requested resource.
    #[error("UI asset {id:#010x} is missing")]
    MissingAsset { id: u32 },
    /// A record exists but could not be read or decoded.
    #[error("UI asset {id:#010x}: {detail}")]
    InvalidAsset { id: u32, detail: String },
    /// Indexed or otherwise unsupported art must not silently become blank pixels.
    #[error("UI image {id:#010x} has unsupported format {format:#x}")]
    UnsupportedFormat { id: u32, format: u32 },
}

/// Authored image extent and normalized direct-color pixels, before UI composition.
#[derive(Debug, Clone)]
pub struct UiImage {
    /// Original width; consumers clip instead of stretching smaller sources.
    pub width: u32,
    /// Original height.
    pub height: u32,
    /// Tightly packed RGBA8 bytes, validated during decoding.
    pub pixels: Vec<u8>,
}

/// Narrow static source interface, also useful for deterministic composition fixtures.
pub trait UiAssets {
    /// Resolve a group through the master mapper, then an enum through that group's mapper.
    fn enum_did(&mut self, group: u32, entry: u32) -> Result<u32, UiAssetError>;
    /// Decode a direct RenderSurface DID; no SurfaceTexture or scene role is required.
    fn image(&mut self, id: u32) -> Result<Arc<UiImage>, UiAssetError>;
}

/// Shares parsed sources (including failures) during one caller-owned preparation batch.
pub struct UiAssetReader<'a> {
    repository: &'a ContentRepository,
    maps: HashMap<u32, Result<Arc<DidMapper>, UiAssetError>>,
    images: HashMap<u32, Result<Arc<UiImage>, UiAssetError>>,
}

impl<'a> UiAssetReader<'a> {
    /// Borrows the existing content owner; owns no archive or persistent resource lifetime.
    pub fn new(repository: &'a ContentRepository) -> Self {
        Self {
            repository,
            maps: HashMap::new(),
            images: HashMap::new(),
        }
    }

    fn mapper_entry(&mut self, id: u32, entry: u32) -> Result<u32, UiAssetError> {
        let repo = self.repository;
        let mapper = self
            .maps
            .entry(id)
            .or_insert_with(|| {
                let bytes = read(repo, id)?;
                let map = DidMapper::unpack(&mut Cursor::new(bytes)).map_err(|e| invalid(id, e))?;
                if map.id != id {
                    return Err(invalid(id, "embedded mapper identity mismatch"));
                }
                Ok(Arc::new(map))
            })
            .as_ref()
            .map_err(Clone::clone)?;
        // Retail EnumIDMap::EnumToDID (acclient.c:79979) searches client then server IDs.
        mapper
            .client_ids
            .entries
            .get(&entry)
            .or_else(|| mapper.server_ids.entries.get(&entry))
            .copied()
            .filter(|id| *id != 0)
            .ok_or(UiAssetError::MissingMapping { mapper: id, entry })
    }
}

impl UiAssets for UiAssetReader<'_> {
    fn enum_did(&mut self, group: u32, entry: u32) -> Result<u32, UiAssetError> {
        let mapper = self.mapper_entry(MASTER_DID_MAPPER, group)?;
        self.mapper_entry(mapper, entry)
    }

    fn image(&mut self, id: u32) -> Result<Arc<UiImage>, UiAssetError> {
        let repo = self.repository;
        self.images
            .entry(id)
            .or_insert_with(|| {
                let bytes = read(repo, id)?;
                let surface =
                    RenderSurface::unpack(&mut Cursor::new(bytes)).map_err(|e| invalid(id, e))?;
                if surface.id != id {
                    return Err(invalid(id, "embedded image identity mismatch"));
                }
                if surface.width == 0 || surface.height == 0 {
                    return Err(invalid(id, "empty image extent"));
                }
                let pixels = decode_direct_color(&surface).map_err(|e| {
                    if let Some(unsupported) = e.downcast_ref::<UnsupportedDirectColorFormat>() {
                        UiAssetError::UnsupportedFormat {
                            id,
                            format: unsupported.format.raw(),
                        }
                    } else {
                        invalid(id, e)
                    }
                })?;
                Ok(Arc::new(UiImage {
                    width: surface.width,
                    height: surface.height,
                    pixels,
                }))
            })
            .clone()
    }
}

fn read(repository: &ContentRepository, id: u32) -> Result<Vec<u8>, UiAssetError> {
    let key = ResourceKey::new(EOR_PORTAL_NAMESPACE, id);
    if repository.resource_metadata(key).is_none() {
        return Err(UiAssetError::MissingAsset { id });
    }
    repository
        .read_resource(key)
        .map(|resource| resource.bytes)
        .map_err(|e| invalid(id, e))
}

fn invalid(id: u32, detail: impl std::fmt::Display) -> UiAssetError {
    UiAssetError::InvalidAsset {
        id,
        detail: detail.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::CountingSource;
    use holtburger_dat::file_type::PixelFormatId;

    fn mapper(id: u32, client: &[(u32, u32)], server: &[(u32, u32)]) -> Vec<u8> {
        let mut bytes = id.to_le_bytes().to_vec();
        for entries in [client, server] {
            bytes.extend([0, entries.len() as u8]);
            for (key, value) in entries {
                bytes.extend(key.to_le_bytes());
                bytes.extend(value.to_le_bytes());
            }
            bytes.extend([0, 0]); // Numbering and empty name map.
        }
        bytes
    }
    fn surface(id: u32, format: PixelFormatId, data: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for value in [id, 0, 1, 1, format.raw(), data.len() as u32] {
            bytes.extend(value.to_le_bytes());
        }
        bytes.extend(data);
        if format == PixelFormatId::Index16 {
            bytes.extend(0x04000001u32.to_le_bytes());
        }
        bytes
    }
    #[test]
    fn follows_both_mapping_levels_and_reuses_sources_without_scene_dependencies() {
        let group = 0x10000004;
        let map = 0x25000008;
        let image = 0x06000001;
        let source = Arc::new(CountingSource::new(HashMap::from([
            (
                (EOR_PORTAL_NAMESPACE.into(), MASTER_DID_MAPPER),
                mapper(MASTER_DID_MAPPER, &[], &[(group, map)]),
            ),
            (
                (EOR_PORTAL_NAMESPACE.into(), map),
                mapper(map, &[(1, image)], &[(1, 99), (2, image)]),
            ),
            (
                (EOR_PORTAL_NAMESPACE.into(), image),
                surface(image, PixelFormatId::R8G8B8, &[1, 2, 3]),
            ),
        ])));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let mut reader = UiAssetReader::new(&repository);
        assert_eq!(reader.enum_did(group, 1).unwrap(), image);
        assert_eq!(reader.enum_did(group, 2).unwrap(), image);
        assert!(
            matches!(reader.enum_did(group, 3), Err(UiAssetError::MissingMapping { mapper, entry: 3 }) if mapper == map)
        );
        let first = reader.image(image).unwrap();
        assert_eq!(first.pixels, [3, 2, 1, 255]);
        assert!(Arc::ptr_eq(&first, &reader.image(image).unwrap()));
        for id in [MASTER_DID_MAPPER, map, image] {
            assert_eq!(source.read_count(EOR_PORTAL_NAMESPACE, id), 1);
        }
    }
    #[test]
    fn distinguishes_missing_damaged_and_unsupported_images_and_retains_failures_per_batch() {
        let broken = 0x06000001;
        let indexed = 0x06000002;
        let source = Arc::new(CountingSource::new(HashMap::from([
            (
                (EOR_PORTAL_NAMESPACE.into(), broken),
                surface(broken, PixelFormatId::R8G8B8, &[1]),
            ),
            (
                (EOR_PORTAL_NAMESPACE.into(), indexed),
                surface(indexed, PixelFormatId::Index16, &[0, 0]),
            ),
        ])));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let mut reader = UiAssetReader::new(&repository);
        assert!(matches!(
            reader.image(0x06000003),
            Err(UiAssetError::MissingAsset { .. })
        ));
        for _ in 0..2 {
            assert!(matches!(
                reader.image(broken),
                Err(UiAssetError::InvalidAsset { .. })
            ));
        }
        assert_eq!(source.read_count(EOR_PORTAL_NAMESPACE, broken), 1);
        assert!(matches!(
            reader.image(indexed),
            Err(UiAssetError::UnsupportedFormat { .. })
        ));
    }
}

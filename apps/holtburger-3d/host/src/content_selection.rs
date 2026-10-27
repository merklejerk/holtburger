//! App-owned admission of visual content before host startup or saved-location acceptance.

use anyhow::{Context, Result};
use holtburger_content::{
    ContentRepository, ContentResourceError, ContentResourceErrorKind, ResolvedContent,
};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::host_mode::HostContentSelection;

/// Surface texture retained by full conversion and omitted by both small archive profiles.
/// This is a cheap admission heuristic, not a claim that every runtime dependency is present.
pub const VISUAL_CONTENT_SENTINEL: ResourceKey<'static> =
    ResourceKey::new(EOR_PORTAL_NAMESPACE, 0x0500_000C);

const CONTENT_GUIDANCE: &str =
    "Select a retail DAT installation or a full HBA; TUI micro/pruned content cannot render 3D";

fn accepts(repository: &ContentRepository) -> bool {
    repository
        .resource_metadata(VISUAL_CONTENT_SENTINEL)
        .is_some()
}

/// Shared candidate ordering stays in content; the 3D application chooses its admission rule.
pub fn resolve(selection: HostContentSelection) -> Result<ResolvedContent> {
    match selection {
        HostContentSelection::Automatic(root) => {
            ResolvedContent::discover(root, accepts).context(CONTENT_GUIDANCE)
        }
        HostContentSelection::Explicit(path) => {
            let resolved = ResolvedContent::open(path)?;
            if !accepts(&resolved.repository) {
                return Err(ContentResourceError {
                    kind: ContentResourceErrorKind::Missing,
                    namespace: VISUAL_CONTENT_SENTINEL.namespace.into(),
                    file_id: VISUAL_CONTENT_SENTINEL.file_id,
                    source_description: resolved.repository.source_description().map(str::to_owned),
                    source: anyhow::anyhow!(CONTENT_GUIDANCE),
                }
                .into());
            }
            Ok(resolved)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::{HbaWriter, file_type::DatFileType};

    #[test]
    fn admission_reads_only_index_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("assets.hba");
        let mut writer = HbaWriter::new();
        writer
            .add(
                VISUAL_CONTENT_SENTINEL.namespace,
                VISUAL_CONTENT_SENTINEL.file_id,
                DatFileType::SurfaceTexture as u32,
                vec![0],
            )
            .unwrap();
        writer.write(&path).unwrap();
        let resolved = resolve(HostContentSelection::Explicit(path)).unwrap();
        assert!(accepts(&resolved.repository));
    }

    #[test]
    fn missing_sentinel_is_a_recoverable_content_failure() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("assets.hba");
        let mut writer = HbaWriter::new();
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                0x0400_0001,
                DatFileType::Palette as u32,
                vec![0],
            )
            .unwrap();
        writer.write(&path).unwrap();
        let error = resolve(HostContentSelection::Explicit(path)).unwrap_err();
        assert!(matches!(
            crate::content_failure::ContentFailure::from_error(&error),
            Some(crate::content_failure::ContentFailure::Resource { file_id, .. })
                if file_id == VISUAL_CONTENT_SENTINEL.file_id
        ));
        assert!(format!("{error:#}").contains(CONTENT_GUIDANCE));
    }
}

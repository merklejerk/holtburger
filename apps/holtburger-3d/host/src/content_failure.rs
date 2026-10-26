//! Native-facing failure reporting at app-owned necessary-content boundaries.

use std::sync::mpsc::SyncSender;

use anyhow::{Context, Result};
use holtburger_content::{
    CharacterTitleCatalogError, ContentResourceError, ContentSelectionError, ContractCatalogError,
    MotionContractError,
};
use holtburger_dat::file_type::ClothingBuildObjDescError;
use serde::{Deserialize, Serialize};

use crate::protocol::{PROTOCOL_VERSION, ProtocolError, ProtocolFrame, application_error};

/// Actionable content facts; ordinary application/transport failures never enter this contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContentFailure {
    /// A location could not be mounted or discovery found no archives.
    Selection {
        /// Missing content permits bounded discovery; invalid content must stay visible.
        reason: SelectionFailureReason,
        /// Full source diagnostic, including attempted locations when applicable.
        message: String,
    },
    /// A necessary resource could not be read or decoded.
    Resource {
        /// Archive namespace owning the resource ID.
        namespace: String,
        /// Resource ID that could not be loaded.
        file_id: u32,
        /// Selected filesystem source, absent for injected repositories.
        source: Option<String>,
        /// Full cause chain for diagnostics.
        message: String,
    },
    /// Raw records fail a content-owned integrity contract.
    Integrity {
        /// Contract refusal and referenced resource identities.
        message: String,
    },
}

/// Surface-level selection outcome used by native candidate ordering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectionFailureReason {
    /// Location disappeared or discovery exhausted its candidate list.
    Absent,
    /// Directory exists but contains no supported archives.
    Empty,
    /// An existing selection cannot be opened or has ambiguous/invalid archives.
    Invalid,
}

impl ContentFailure {
    /// Classifies retained causes, without parsing formatted error messages.
    pub fn from_error(error: &anyhow::Error) -> Option<Self> {
        for cause in error.chain() {
            if let Some(resource) = cause.downcast_ref::<ContentResourceError>() {
                return Some(Self::Resource {
                    namespace: resource.namespace.clone(),
                    file_id: resource.file_id,
                    source: resource.source_description.clone(),
                    message: format!("{error:#}"),
                });
            }
            if let Some(selection) = cause.downcast_ref::<ContentSelectionError>() {
                let reason = match selection {
                    ContentSelectionError::NotDiscovered { .. } => SelectionFailureReason::Absent,
                    ContentSelectionError::Empty { .. } => SelectionFailureReason::Empty,
                    ContentSelectionError::Unavailable { source, .. }
                        if source.kind() == std::io::ErrorKind::NotFound =>
                    {
                        SelectionFailureReason::Absent
                    }
                    _ => SelectionFailureReason::Invalid,
                };
                return Some(Self::Selection {
                    reason,
                    message: format!("{error:#}"),
                });
            }
            if cause.is::<MotionContractError>()
                || cause.is::<CharacterTitleCatalogError>()
                || cause.is::<ContractCatalogError>()
            {
                return Some(Self::Integrity {
                    message: format!("{error:#}"),
                });
            }
            // Clothing's callback contract retains palette identity in its own error type.
            // Invalid user shades and incompatible clothing choices are application errors.
            if let Some(
                ClothingBuildObjDescError::MissingPaletteSet { palette_set_id }
                | ClothingBuildObjDescError::InvalidPaletteSet { palette_set_id, .. },
            ) = cause.downcast_ref::<ClothingBuildObjDescError>()
            {
                return Some(Self::Resource {
                    namespace: holtburger_dat::EOR_PORTAL_NAMESPACE.to_owned(),
                    file_id: *palette_set_id,
                    source: None,
                    message: format!("{error:#}"),
                });
            }
        }
        None
    }
}

/// A stdio reporter in production or an explicitly detached reporter for injected hosts.
#[derive(Clone)]
pub enum ContentFailureReporter {
    /// Fixtures and non-stdio hosts retain errors through their existing result paths.
    Detached,
    /// Dedicated frames bypass renderer-specific world event inventories.
    Stdio(SyncSender<ProtocolFrame>),
}

impl ContentFailureReporter {
    /// Reports only classified content failures; expected optional absence is handled upstream.
    pub fn required<T>(&self, result: Result<T>) -> Result<T> {
        if let Err(error) = &result {
            self.report_error(error)?;
        }
        result
    }

    fn report_error(&self, error: &anyhow::Error) -> Result<()> {
        if let Some(failure) = ContentFailure::from_error(error)
            && let Self::Stdio(sender) = self
        {
            sender
                .send(ProtocolFrame::ContentFailed { failure })
                .context("sidecar writer stopped while reporting required content failure")?;
        }
        Ok(())
    }

    /// Keeps the ordinary command rejection while also notifying native persistence.
    pub fn command_error(&self, error: anyhow::Error) -> ProtocolError {
        if let Err(report_error) = self.report_error(&error) {
            return application_error(format!("{report_error:#}; original failure: {error:#}"));
        }
        application_error(format!("{error:#}"))
    }

    /// Terminal startup failures are valid before a handshake, with their own version check.
    pub fn startup_frame(error: &anyhow::Error) -> Option<ProtocolFrame> {
        ContentFailure::from_error(error).map(|failure| ProtocolFrame::StartupFailed {
            protocol_version: PROTOCOL_VERSION,
            failure,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::ContentRepository;
    use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
    use std::sync::mpsc;

    #[test]
    fn required_resource_failure_notifies_native_without_turning_absence_into_failure() {
        let (sender, receiver) = mpsc::sync_channel(8);
        let reporter = ContentFailureReporter::Stdio(sender);
        assert_eq!(reporter.required::<Option<()>>(Ok(None)).unwrap(), None);
        assert!(receiver.try_recv().is_err());
        let repository = ContentRepository::from_mounts(Vec::new());
        assert!(
            reporter
                .required(
                    repository.read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, 0x0100_0001))
                )
                .is_err()
        );
        assert!(matches!(
            receiver.try_recv().unwrap(),
            ProtocolFrame::ContentFailed {
                failure: ContentFailure::Resource {
                    file_id: 0x0100_0001,
                    ..
                }
            }
        ));
    }

    #[test]
    fn application_failures_stay_out_of_asset_recovery() {
        let (sender, receiver) = mpsc::sync_channel(8);
        let reporter = ContentFailureReporter::Stdio(sender);
        assert!(
            reporter
                .required::<()>(Err(anyhow::anyhow!("worker stopped")))
                .is_err()
        );
        assert!(receiver.try_recv().is_err());
        assert!(
            ContentFailureReporter::startup_frame(&anyhow::anyhow!("host configuration invalid"))
                .is_none()
        );
    }
}

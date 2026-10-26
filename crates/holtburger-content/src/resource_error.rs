use thiserror::Error;

/// Optional dependency selection may skip absent/pruned records, but must retain invalid data errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentResourceErrorKind {
    /// No mounted source contains the requested key.
    Missing,
    /// The consumer requires detail intentionally removed from the available record.
    Pruned,
    /// A present record cannot be read or decoded.
    Invalid,
}

impl std::fmt::Display for ContentResourceErrorKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Missing => "Missing",
            Self::Pruned => "Pruned",
            Self::Invalid => "Invalid",
        })
    }
}

/// A failed resource read or decode; necessity is decided by its consuming operation.
#[derive(Debug, Error)]
#[error("{kind} resource {namespace}:0x{file_id:08X}")]
pub struct ContentResourceError {
    /// Availability distinguishes optional absence from a broken present dependency.
    pub kind: ContentResourceErrorKind,
    /// Archive namespace of the attempted resource.
    pub namespace: String,
    /// File ID of the attempted resource.
    pub file_id: u32,
    /// Selection description, when the repository has filesystem provenance.
    pub source_description: Option<String>,
    /// Original read/decode failure, retained for diagnostics and typed classification.
    #[source]
    pub source: anyhow::Error,
}

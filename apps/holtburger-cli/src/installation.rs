//! Portable TUI resources are located by the application, independently of invocation directory.

use std::path::PathBuf;

/// Locate one bundled resource directory alongside the native TUI executable.
pub fn bundled_resource_path(directory: &str) -> PathBuf {
    let mut path = std::env::current_exe().expect("could not locate the running TUI executable");
    path.set_file_name(directory);
    path
}

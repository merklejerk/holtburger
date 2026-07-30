//! Debug Harness for Asheron's Call Reverse Engineering
//!
//! This crate is a dedicated space for temporary research, debugging, and
//! throwaway test harnesses. Use this to validate network traffic,
//! experiment with protocol logic, or test file format parsers in isolation.
//!
//! Recommended usage:
//! - Add temporary research code to `src/` or as a binary in `src/bin/`.
//! - Delete a harness once its investigation concludes. Its findings belong in the plan or doc it
//!   informed; the tool that produced them is not evidence and does not need to survive.

pub mod prelude {
    pub use anyhow::Result;
    pub use holtburger_core;
}

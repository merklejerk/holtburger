//! Debug Harness for Asheron's Call Reverse Engineering
//!
//! This crate is a dedicated space for temporary research, debugging, and 
//! throwaway test harnesses. Use this to validate network traffic, 
//! experiment with protocol logic, or test file format parsers in isolation.
//!
//! Recommended usage:
//! - Add temporary research code to `src/` or as modules here.
//! - Create standalone test clients in the `examples/` directory.

pub mod prelude {
    pub use anyhow::Result;
    pub use holtburger_core;
}

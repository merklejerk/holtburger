//! Validate the TUI's production content bootstrap without opening a socket or terminal UI.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_core::ClientRuntimeBuilder;
use holtburger_dat::file_type::CharGen;
use std::path::PathBuf;

/// Reads bootstrap assets and character-generation data from a supplied HBA installation.
#[derive(Parser)]
struct Arguments {
    /// Single HBA archive or directory containing HBA archives.
    content: PathBuf,
}

fn main() -> Result<()> {
    let arguments = Arguments::parse();
    let content = if arguments.content.is_dir() {
        ContentRepository::from_hba_dir(&arguments.content)
    } else {
        ContentRepository::from_hba_path(&arguments.content)
    }
    .context("open TUI content")?;
    ClientRuntimeBuilder::new("content-bootstrap-probe")
        .load_assets(&content)
        .context("load production client bootstrap")?;
    let character_generation = content
        .read_asset::<CharGen>("character generation")
        .context("load TUI character-generation data")?;
    println!(
        "Content bootstrap passed: {} heritage groups",
        character_generation.heritage_groups.len()
    );
    Ok(())
}

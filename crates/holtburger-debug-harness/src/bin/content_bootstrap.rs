//! Validate the TUI's production content bootstrap without opening a socket or terminal UI.

use anyhow::{Context, Result, ensure};
use clap::Parser;
use holtburger_content::NavigationContent;
use holtburger_core::ClientRuntimeBuilder;
use std::path::PathBuf;
use std::sync::Arc;

/// Representative interior owner retained in both the full corpus and focused generation fixture.
const TOPOLOGY_PROBE_OWNER: u32 = 0x8602_ffff;

/// Reads the actual CLI bootstrap, creation catalog, and prepared/model-free navigation source.
#[derive(Parser)]
struct Arguments {
    /// Prepared content directory or exact full HBA file.
    content: PathBuf,
}

fn main() -> Result<()> {
    let arguments = Arguments::parse();
    let content =
        Arc::new(NavigationContent::open(&arguments.content).context("open CLI content")?);
    ClientRuntimeBuilder::new("content-bootstrap-probe")
        .navigation_content(Arc::clone(&content))
        .load_assets(content.bootstrap())
        .context("load production client bootstrap")?;
    let character_generation = content
        .bootstrap()
        .read_character_gen_catalog()
        .context("load complete CLI character-generation catalog")?;
    let scene = content
        .load_collision(TOPOLOGY_PROBE_OWNER)?
        .context("CLI content has no representative interior navigation owner")?;
    let cells = scene.static_geometry.cell_volumes().len();
    let shells = scene.static_geometry.colliders.len();
    ensure!(
        cells > 0,
        "CLI navigation probe owner has no interior cells"
    );
    ensure!(shells > 0, "CLI navigation probe owner has no room shells");
    println!(
        "CLI content bootstrap passed: {} heritage groups, {cells} cells, {shells} room shells",
        character_generation.heritage_groups.len(),
    );
    Ok(())
}

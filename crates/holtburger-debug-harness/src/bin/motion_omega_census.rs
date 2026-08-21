//! Does shipped content author physical omega, and about which axis?
//!
//! The plan carries "physical omega is never represented as a global rotation" as debt, justified
//! by a measurement of *authored root frames* being yaw-only. Those are a different source: root
//! frames come from an animation's position frames, while physical omega is a `MotionData` field on
//! a motion-table entry. This measures the field itself.
//!
//! The distinction matters because the local-versus-global rule only becomes observable for a
//! rotation about a non-vertical axis.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::MotionTable;
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use std::io::Cursor;

#[derive(Parser)]
#[command(about = "Census motion-table physical omega by magnitude and axis")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let index: Vec<_> = content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_PORTAL_NAMESPACE && entry.type_id == 0x09)
        .cloned()
        .collect();

    let mut tables = 0usize;
    let mut entries = 0usize;
    let mut with_omega = 0usize;
    let mut vertical_only = 0usize;
    let mut non_vertical = 0usize;
    let mut max_horizontal = 0.0f32;
    let mut examples: Vec<String> = Vec::new();

    for entry in &index {
        let bytes = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, entry.file_id))?
            .bytes;
        let Ok(table) = MotionTable::read(&mut Cursor::new(&bytes)) else {
            continue;
        };
        tables += 1;
        for (key, motion) in table.cycles.iter().chain(table.modifiers.iter()) {
            entries += 1;
            let Some(omega) = motion.omega else {
                continue;
            };
            if omega.length() == 0.0 {
                continue;
            }
            with_omega += 1;
            // AC authors Z-up, so a vertical spin is omega about Z alone.
            let horizontal = omega.x.abs().max(omega.y.abs());
            max_horizontal = max_horizontal.max(horizontal);
            if horizontal == 0.0 {
                vertical_only += 1;
            } else {
                non_vertical += 1;
                if examples.len() < 15 {
                    examples.push(format!(
                        "    table 0x{:08X}  key 0x{key:08X}  omega ({:.4}, {:.4}, {:.4})",
                        entry.file_id, omega.x, omega.y, omega.z
                    ));
                }
            }
        }
    }

    println!("motion tables scanned:        {tables}");
    println!("cycle + modifier entries:     {entries}");
    println!("authoring non-zero omega:     {with_omega}");
    println!("  vertical only (Z axis):     {vertical_only}");
    println!("  NON-VERTICAL:               {non_vertical}");
    println!("  max horizontal component:   {max_horizontal}");
    if !examples.is_empty() {
        println!();
        println!(
            "non-vertical omega — the case the local/global rule would become observable for:"
        );
        for line in &examples {
            println!("{line}");
        }
    }
    Ok(())
}

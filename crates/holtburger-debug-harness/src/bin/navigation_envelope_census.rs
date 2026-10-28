//! Census model-free navigation envelopes using the existing retail setup-sphere resolver.

use std::{io::Cursor, path::PathBuf};

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_core::resolve_setup_physical_spheres;
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey, file_type::SetupModel};
use serde::Serialize;

/// Read only setup records; no model, animation, script, or network access is needed.
#[derive(Parser)]
struct Args {
    /// Full or bootstrap HBA containing setup records.
    #[arg(long)]
    content: PathBuf,
}

/// Distinguishes authored envelopes from the existing retail dummy and invalid authored geometry.
#[derive(Default, Serialize)]
struct Census {
    setups: usize,
    authored_single: usize,
    authored_pair: usize,
    retail_dummy: usize,
    invalid: Vec<InvalidEnvelope>,
}

/// A source setup requiring investigation rather than an invented geometry fallback.
#[derive(Serialize)]
struct InvalidEnvelope {
    setup_id: u32,
    error: String,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::from_hba_path(args.content)?;
    let mut census = Census::default();
    for entry in content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_PORTAL_NAMESPACE && entry.type_id == 0x02)
    {
        let bytes = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, entry.file_id))?
            .bytes;
        let setup = SetupModel::read(&mut Cursor::new(bytes))
            .with_context(|| format!("decode setup 0x{:08X}", entry.file_id))?;
        census.setups += 1;
        match resolve_setup_physical_spheres(&setup, 1.0) {
            Ok(_) => match setup.spheres.len() {
                0 => census.retail_dummy += 1,
                1 => census.authored_single += 1,
                _ => census.authored_pair += 1,
            },
            Err(error) => census.invalid.push(InvalidEnvelope {
                setup_id: setup.id,
                error: error.to_string(),
            }),
        }
    }
    println!("{}", serde_json::to_string_pretty(&census)?);
    Ok(())
}

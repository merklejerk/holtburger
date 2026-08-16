use std::path::PathBuf;

use anyhow::{Context, Result, ensure};
use clap::Parser;
use holtburger_tools::DEFAULT_WEENIE_CATALOG_PATH;

/// Exports an offline Explorer weenie catalog from one ACE World database.
#[derive(Debug, Parser)]
struct Arguments {
    /// Environment variable containing the ACE World MySQL/MariaDB connection URL.
    #[arg(long)]
    database_url_env: String,
    /// Canonical ACE World revision or explicit operator provenance label.
    #[arg(long)]
    provenance: String,
    /// Destination `.hwc` catalog path.
    #[arg(long, default_value = DEFAULT_WEENIE_CATALOG_PATH)]
    output: PathBuf,
}

fn main() -> Result<()> {
    let arguments = Arguments::parse();
    let database_url = std::env::var(&arguments.database_url_env).with_context(|| {
        format!(
            "database URL environment variable {} is not set",
            arguments.database_url_env
        )
    })?;
    ensure!(
        !database_url.trim().is_empty(),
        "database URL environment variable {} is empty",
        arguments.database_url_env
    );
    let count = holtburger_tools::weenie_catalog_export::export_weenie_catalog(
        &database_url,
        &arguments.provenance,
        &arguments.output,
    )?;
    println!(
        "exported {count} weenie templates to {}",
        arguments.output.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_the_canonical_catalog_location() {
        let arguments = Arguments::try_parse_from([
            "export-weenie-catalog",
            "--database-url-env",
            "ACE_WORLD_SQL_URL",
            "--provenance",
            "ACE-World-test",
        ])
        .unwrap();

        assert_eq!(arguments.output, PathBuf::from(DEFAULT_WEENIE_CATALOG_PATH));
    }
}

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_tools::DEFAULT_WEENIE_CATALOG_PATH;
use holtburger_tools::weenie_catalog_survey::survey_weenie_catalog;

#[derive(Debug, Parser)]
#[command(
    author,
    version,
    about = "Survey an offline weenie catalog against mounted client content"
)]
struct Cli {
    /// Offline `.hwc` catalog to survey.
    #[arg(long, default_value = DEFAULT_WEENIE_CATALOG_PATH)]
    catalog: PathBuf,
    /// HBA directory or single HBA archive used for setup/GfxObj facts.
    #[arg(long, default_value = "dats")]
    content: PathBuf,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let content = if cli.content.is_dir() {
        ContentRepository::from_hba_dir(&cli.content)
    } else {
        ContentRepository::from_hba_path(&cli.content)
    }
    .with_context(|| format!("could not open content at {}", cli.content.display()))?;
    let survey = survey_weenie_catalog(&cli.catalog, &content)?;
    serde_json::to_writer_pretty(std::io::stdout().lock(), &survey)
        .context("could not write survey JSON")?;
    println!();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_the_canonical_content_layout() {
        let cli = Cli::try_parse_from(["survey-weenie-catalog"]).unwrap();

        assert_eq!(cli.catalog, PathBuf::from(DEFAULT_WEENIE_CATALOG_PATH));
        assert_eq!(cli.content, PathBuf::from("dats"));
    }
}

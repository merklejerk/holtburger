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
    /// Installation directory used for setup/GfxObj facts; otherwise use default discovery.
    #[arg(long)]
    content: Option<PathBuf>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let content = ContentRepository::select_installation(cli.content)?;
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
    fn defaults_catalog_and_leaves_content_to_discovery() {
        let cli = Cli::try_parse_from(["survey-weenie-catalog"]).unwrap();

        assert_eq!(cli.catalog, PathBuf::from(DEFAULT_WEENIE_CATALOG_PATH));
        assert!(cli.content.is_none());
    }
}

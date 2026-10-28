//! Generate or inspect the prepared CLI navigation/bootstrap pair locally.

use anyhow::Result;
use clap::{Parser, Subcommand};
use holtburger_tools::cli_content;
use std::path::PathBuf;

#[derive(Parser)]
#[command(about = "Generate or inspect distributable CLI content without a server or frontend")]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Generate content/ and cli-content.zip in a new output directory.
    Generate {
        /// Full source HBA; raw DATs can be converted locally with dat2hba first.
        #[arg(long)]
        source: PathBuf,
        /// New output directory; existing outputs are never overwritten.
        #[arg(long)]
        output: PathBuf,
    },
    /// Inspect the content/ archives and print navigation block counts.
    Info {
        #[arg(long)]
        content: PathBuf,
    },
}

fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    match Args::parse().command {
        Command::Generate { source, output } => cli_content::generate(&source, &output)?,
        Command::Info { content } => cli_content::inspect(&content)?,
    };
    Ok(())
}

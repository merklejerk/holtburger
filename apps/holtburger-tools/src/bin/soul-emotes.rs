use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    author,
    version,
    about = "Inspect the resolved soul-emote catalog from mounted HBA content"
)]
struct Cli {
    /// HBA directory or single HBA archive to inspect
    path: PathBuf,
    /// Optional soul-emote token to resolve directly, such as wave
    #[arg(long)]
    token: Option<String>,
    /// Limit the number of rows printed for full catalog output
    #[arg(long, default_value_t = 50)]
    limit: usize,
}

fn open_repository(path: &PathBuf) -> Result<ContentRepository> {
    if path.is_dir() {
        return ContentRepository::from_hba_dir(path)
            .with_context(|| format!("failed to open HBA directory {}", path.display()));
    }

    ContentRepository::from_hba_path(path)
        .with_context(|| format!("failed to open HBA path {}", path.display()))
}

fn main() -> Result<()> {
    env_logger::init();
    let cli = Cli::parse();
    let repository = open_repository(&cli.path)?;
    let catalog = repository.read_soul_emote_catalog()?;

    if let Some(token) = cli.token.as_deref() {
        let Some(resolved) = catalog.resolve(token) else {
            anyhow::bail!("unknown soul emote token: {}", token);
        };

        println!("token: {}", resolved.token);
        println!("pose: {}", resolved.pose);
        println!("my_emote: {}", resolved.my_emote.unwrap_or("<missing>"));
        println!(
            "other_emote: {}",
            resolved.other_emote.unwrap_or("<missing>")
        );
        return Ok(());
    }

    println!(
        "loaded {} soul emote tokens and {} poses",
        catalog.tokens.len(),
        catalog.poses.len()
    );

    for token in catalog.tokens.values().take(cli.limit) {
        let resolved = catalog.resolve(&token.token);
        let other_emote = resolved
            .and_then(|entry| entry.other_emote)
            .unwrap_or("<missing>");
        println!("{} => {} => {}", token.token, token.pose, other_emote);
    }

    if catalog.tokens.len() > cli.limit {
        println!(
            "... truncated {} additional tokens; rerun with --limit to see more",
            catalog.tokens.len() - cli.limit
        );
    }

    Ok(())
}

use anyhow::Result;
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
    /// Installation directory to inspect; otherwise use default discovery.
    #[arg(long)]
    content: Option<PathBuf>,
    /// Optional soul-emote token to resolve directly, such as wave
    #[arg(long)]
    token: Option<String>,
    /// Limit the number of rows printed for full catalog output
    #[arg(long, default_value_t = 50)]
    limit: usize,
}

fn main() -> Result<()> {
    env_logger::init();
    let cli = Cli::parse();
    let repository = ContentRepository::select_installation(cli.content)?;
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
        catalog.tokens().len(),
        catalog.poses().len()
    );

    for token in catalog.tokens().values().take(cli.limit) {
        let resolved = catalog.resolve(&token.token);
        let other_emote = resolved
            .and_then(|entry| entry.other_emote)
            .unwrap_or("<missing>");
        println!("{} => {} => {}", token.token, token.pose, other_emote);
    }

    if catalog.tokens().len() > cli.limit {
        println!(
            "... truncated {} additional tokens; rerun with --limit to see more",
            catalog.tokens().len() - cli.limit
        );
    }

    Ok(())
}

use clap::Parser;
use holtburger_tools::{Args, run};

fn main() -> holtburger_tools::error::Result<()> {
    env_logger::init();
    let args = Args::parse();

    println!("🎨 holtburger-tools: starting the glow-up...");
    run(args)?;
    println!("✨ Glow-up complete!");

    Ok(())
}

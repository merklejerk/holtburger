use clap::{CommandFactory, Parser};
use holtburger_tools::{BundleMode, Dat2HbaOptions, run};

#[derive(Parser, Debug)]
#[command(
    author,
    version,
    about = "Strips Asheron's Call DAT files into Lite HBA archives"
)]
struct Args {
    /// Path to the retail DAT file to process
    input: std::path::PathBuf,

    /// Path to the output HBA archive
    output: std::path::PathBuf,

    /// Archive bundle style to emit: pruned, full, or micro.
    #[arg(long, value_enum, default_value_t = BundleMode::Pruned)]
    bundle: BundleMode,
}

fn main() -> holtburger_tools::error::Result<()> {
    env_logger::init();
    let args = Args::parse();

    println!("🎨 holtburger-tools: starting the glow-up...");
    run(Dat2HbaOptions {
        input: args.input,
        output: args.output,
        bundle: args.bundle,
    })?;
    println!("✨ Glow-up complete!");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_default_bundle_mode_is_pruned() {
        let args = Args::try_parse_from(["dat2hba", "portal.dat", "portal.hba"])
            .expect("default args should parse");

        assert_eq!(args.bundle, BundleMode::Pruned);
    }

    #[test]
    fn args_parse_explicit_micro_bundle() {
        let args = Args::try_parse_from([
            "dat2hba",
            "portal.dat",
            "portal-micro.hba",
            "--bundle",
            "micro",
        ])
        .expect("micro bundle args should parse");

        assert_eq!(args.bundle, BundleMode::Micro);
    }

    #[test]
    fn cli_help_lists_bundle_styles() {
        let help = Args::command().render_long_help().to_string();

        assert!(help.contains("--bundle <BUNDLE>"));
        assert!(help.contains("[possible values: pruned, full, micro]"));
        assert!(!help.contains("--profile"));
        assert!(!help.contains("--full"));
    }
}

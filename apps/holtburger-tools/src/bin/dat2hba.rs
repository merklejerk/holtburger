use clap::Parser;
use holtburger_tools::{ArchiveProfile, Dat2HbaOptions, run};

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

    /// Archive profile to emit: pruned, full, or micro.
    #[arg(long, value_enum, default_value_t = ArchiveProfile::Pruned)]
    profile: ArchiveProfile,
}

fn main() -> holtburger_tools::error::Result<()> {
    env_logger::init();
    let args = Args::parse();

    println!("🎨 holtburger-tools: starting the glow-up...");
    run(Dat2HbaOptions {
        input: args.input,
        output: args.output,
        profile: args.profile,
    })?;
    println!("✨ Glow-up complete!");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn args_default_profile_is_pruned() {
        let args = Args::try_parse_from(["dat2hba", "portal.dat", "portal.hba"])
            .expect("default args should parse");

        assert_eq!(args.profile, ArchiveProfile::Pruned);
    }

    #[test]
    fn args_parse_explicit_micro_profile() {
        let args = Args::try_parse_from([
            "dat2hba",
            "portal.dat",
            "portal-micro.hba",
            "--profile",
            "micro",
        ])
        .expect("micro profile args should parse");

        assert_eq!(args.profile, ArchiveProfile::Micro);
    }

    #[test]
    fn cli_help_lists_profile_styles() {
        let help = Args::command().render_long_help().to_string();

        assert!(help.contains("--profile <PROFILE>"));
        assert!(help.contains("[possible values: pruned, full, micro]"));
        assert!(!help.contains("--full"));
    }
}

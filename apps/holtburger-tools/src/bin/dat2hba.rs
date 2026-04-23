use clap::Parser;
use holtburger_tools::{ArchiveProfile, Dat2HbaOptions, DatInputSpec, ToolError, run};
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Debug, Clone, PartialEq, Eq)]
struct InputArg {
    namespace: Option<String>,
    path: PathBuf,
}

impl FromStr for InputArg {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if let Some((namespace, path)) = value.split_once('=')
            && !namespace.is_empty()
            && !path.is_empty()
        {
            return Ok(Self {
                namespace: Some(namespace.to_string()),
                path: PathBuf::from(path),
            });
        }

        Ok(Self {
            namespace: None,
            path: PathBuf::from(value),
        })
    }
}

#[derive(Parser, Debug)]
#[command(
    author,
    version,
    about = "Strips one or more Asheron's Call DAT files into a namespace-aware HBA archive"
)]
struct Args {
    /// Input DAT specs followed by the output HBA path. The last positional argument is always the output path.
    /// Use `namespace=path` for any input that needs an explicit namespace.
    #[arg(required = true, num_args = 2.., value_name = "[NAMESPACE=]DAT ... HBA")]
    paths: Vec<String>,

    /// Archive profile to emit: pruned, full, or micro. Defaults to full.
    #[arg(long, value_enum, default_value_t = ArchiveProfile::Full)]
    profile: ArchiveProfile,
}

impl Args {
    fn into_options(self) -> Result<Dat2HbaOptions, ToolError> {
        let output = self.paths.last().map(PathBuf::from).ok_or_else(|| {
            ToolError::Validation(
                "dat2hba requires at least one input and one output path".to_string(),
            )
        })?;

        let inputs = self.paths[..self.paths.len() - 1]
            .iter()
            .map(|value| {
                InputArg::from_str(value)
                    .map(|input| DatInputSpec {
                        path: input.path,
                        namespace: input.namespace,
                    })
                    .map_err(ToolError::Validation)
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Dat2HbaOptions {
            inputs,
            output,
            profile: self.profile,
        })
    }
}

fn main() -> holtburger_tools::error::Result<()> {
    env_logger::init();
    let options = Args::parse().into_options()?;

    println!("🎨 holtburger-tools: starting the glow-up...");
    run(options)?;
    println!("✨ Glow-up complete!");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn args_default_profile_is_full() {
        let args = Args::try_parse_from(["dat2hba", "portal.dat", "portal.hba"])
            .expect("default args should parse");
        let options = args
            .into_options()
            .expect("args should convert into options");

        assert_eq!(options.profile, ArchiveProfile::Full);
        assert_eq!(options.inputs.len(), 1);
        assert_eq!(options.inputs[0].path, PathBuf::from("portal.dat"));
        assert_eq!(options.inputs[0].namespace, None);
        assert_eq!(options.output, PathBuf::from("portal.hba"));
    }

    #[test]
    fn args_parse_multiple_inputs_with_explicit_namespaces() {
        let args = Args::try_parse_from([
            "dat2hba",
            "eor/portal=client_portal.dat",
            "eor/cell=client_cell_1.dat",
            "bundle.hba",
            "--profile",
            "full",
        ])
        .expect("multi-input args should parse");
        let options = args
            .into_options()
            .expect("args should convert into options");

        assert_eq!(options.profile, ArchiveProfile::Full);
        assert_eq!(options.inputs.len(), 2);
        assert_eq!(options.inputs[0].namespace.as_deref(), Some("eor/portal"));
        assert_eq!(options.inputs[1].namespace.as_deref(), Some("eor/cell"));
        assert_eq!(options.output, PathBuf::from("bundle.hba"));
    }

    #[test]
    fn output_path_is_not_parsed_as_namespaced_input() {
        let args = Args::try_parse_from(["dat2hba", "portal.dat", "derived=test.hba"])
            .expect("args should parse");
        let options = args
            .into_options()
            .expect("args should convert into options");

        assert_eq!(options.inputs.len(), 1);
        assert_eq!(options.inputs[0].path, PathBuf::from("portal.dat"));
        assert_eq!(options.output, PathBuf::from("derived=test.hba"));
    }

    #[test]
    fn cli_help_describes_positional_io() {
        let help = Args::command().render_long_help().to_string();

        assert!(help.contains("The last positional argument is always the output path"));
        assert!(help.contains("namespace=path"));
        assert!(help.contains("[possible values: pruned, full, micro]"));
    }
}

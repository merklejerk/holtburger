use std::env::VarError;
use std::path::PathBuf;

use anyhow::{Context, Result, ensure};
use clap::Parser;
use holtburger_tools::DEFAULT_WEENIE_CATALOG_PATH;

/// Conventional variable holding the ACE World connection URL when none is passed directly.
const DEFAULT_DATABASE_URL_ENV: &str = "ACE_WORLD_SQL_URL";

/// Exports an offline Explorer weenie catalog from one ACE World database.
#[derive(Debug, Parser)]
struct Arguments {
    /// ACE World MySQL/MariaDB connection URL. Overrides `--database-url-env`; note that this
    /// places credentials in the process arguments and the shell history.
    #[arg(long)]
    database_url: Option<String>,
    /// Environment variable holding the connection URL, read when `--database-url` is absent.
    #[arg(long, default_value = DEFAULT_DATABASE_URL_ENV)]
    database_url_env: String,
    /// Destination `.hwc` catalog path.
    #[arg(long, default_value = DEFAULT_WEENIE_CATALOG_PATH)]
    output: PathBuf,
}

impl Arguments {
    /// Resolves the connection URL, preferring the direct argument over the named variable.
    ///
    /// The environment reader is injected so precedence stays testable without mutating the
    /// process environment, which no longer has a safe API and is shared across parallel tests.
    fn resolve_database_url(
        &self,
        read_environment: impl FnOnce(&str) -> Result<String, VarError>,
    ) -> Result<String> {
        let (url, source) = match &self.database_url {
            Some(url) => (url.clone(), "--database-url".to_owned()),
            None => (
                read_environment(&self.database_url_env).with_context(|| {
                    format!(
                        "pass --database-url or set the database URL environment variable {}",
                        self.database_url_env
                    )
                })?,
                format!("environment variable {}", self.database_url_env),
            ),
        };
        ensure!(
            !url.trim().is_empty(),
            "the ACE World database URL from {source} is empty"
        );
        Ok(url)
    }
}

fn main() -> Result<()> {
    let arguments = Arguments::parse();
    let count = holtburger_tools::weenie_catalog_export::export_weenie_catalog(
        &arguments.resolve_database_url(|name: &str| std::env::var(name))?,
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

    const DIRECT_URL: &str = "mysql://direct@127.0.0.1:3306/ace_world";
    const ENVIRONMENT_URL: &str = "mysql://environment@127.0.0.1:3306/ace_world";

    fn arguments(extra: &[&str]) -> Arguments {
        let mut argv = vec!["export-weenie-catalog"];
        argv.extend_from_slice(extra);
        Arguments::try_parse_from(argv).unwrap()
    }

    #[test]
    fn defaults_to_the_canonical_catalog_location_and_environment_variable() {
        let arguments = arguments(&[]);

        assert_eq!(arguments.output, PathBuf::from(DEFAULT_WEENIE_CATALOG_PATH));
        assert_eq!(arguments.database_url_env, DEFAULT_DATABASE_URL_ENV);
    }

    #[test]
    fn direct_url_wins_over_a_populated_environment_variable() {
        let resolved = arguments(&["--database-url", DIRECT_URL])
            .resolve_database_url(|_| Ok(ENVIRONMENT_URL.to_owned()))
            .unwrap();

        assert_eq!(resolved, DIRECT_URL);
    }

    #[test]
    fn reads_the_named_variable_when_no_direct_url_is_passed() {
        let resolved = arguments(&["--database-url-env", "CUSTOM_ACE_WORLD_URL"])
            .resolve_database_url(|name| {
                assert_eq!(name, "CUSTOM_ACE_WORLD_URL");
                Ok(ENVIRONMENT_URL.to_owned())
            })
            .unwrap();

        assert_eq!(resolved, ENVIRONMENT_URL);
    }

    #[test]
    fn a_blank_url_is_rejected_and_names_the_source_that_supplied_it() {
        let direct = arguments(&["--database-url", "   "])
            .resolve_database_url(|_| Ok(ENVIRONMENT_URL.to_owned()))
            .unwrap_err()
            .to_string();
        assert!(direct.contains("--database-url"), "{direct}");

        let environment = arguments(&[])
            .resolve_database_url(|_| Ok(String::new()))
            .unwrap_err()
            .to_string();
        assert!(
            environment.contains(DEFAULT_DATABASE_URL_ENV),
            "{environment}"
        );
    }

    #[test]
    fn an_unset_variable_reports_both_ways_to_supply_the_url() {
        let error = arguments(&[])
            .resolve_database_url(|_| Err(VarError::NotPresent))
            .unwrap_err()
            .to_string();

        assert!(error.contains("--database-url"), "{error}");
        assert!(error.contains(DEFAULT_DATABASE_URL_ENV), "{error}");
    }
}

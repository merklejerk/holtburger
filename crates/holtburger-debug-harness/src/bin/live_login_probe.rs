//! Noninteractive authentication probe. Credentials come only from environment variables.

use anyhow::{Context, Result, bail};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_core::{ClientCommand, ClientLifecycleState, ClientRuntimeBuilder, ClientViewEvent};
use std::{path::PathBuf, time::Duration};
use tokio::{sync::mpsc, time::timeout};

/// A single authentication attempt; never selects or mutates a character.
#[derive(Parser)]
struct Args {
    /// Server endpoint used by the development client.
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    /// Server UDP port.
    #[arg(long, default_value_t = 9000)]
    port: u16,
    /// Client content root; normal discovery applies when omitted.
    #[arg(long)]
    content: Option<PathBuf>,
    /// Submit a deliberately incorrect password to verify the server's boot explanation.
    #[arg(long)]
    wrong_password: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let account = std::env::var("HOLTBURGER_PROBE_ACCOUNT")
        .context("HOLTBURGER_PROBE_ACCOUNT is required")?;
    let password = std::env::var("HOLTBURGER_PROBE_PASSWORD")
        .context("HOLTBURGER_PROBE_PASSWORD is required")?;
    if account.is_empty() || password.is_empty() {
        bail!("Probe credentials must be nonempty");
    }
    let submitted = if args.wrong_password {
        format!("{password}-intentional-probe-mismatch")
    } else {
        password.clone()
    };
    let content = ContentRepository::discover(args.content)?;
    let mut builder = ClientRuntimeBuilder::new(account.clone()).server(args.host, args.port);
    builder.load_assets(&content)?;
    let mut client = builder.connect().await?;
    let mut events = client.subscribe_client_view_events();
    let (commands, receiver) = mpsc::unbounded_channel();
    client.set_command_rx(receiver);
    let mut task = tokio::spawn(async move {
        let result = client.run().await;
        (result, client.exit_outcome().cloned())
    });
    commands.send(ClientCommand::Login(submitted.clone()))?;
    let observed = timeout(Duration::from_secs(25), async {
        loop {
            match events.recv().await? {
                ClientViewEvent::LifecycleChanged(ClientLifecycleState::CharacterSelection {
                    ..
                }) => return Ok::<_, anyhow::Error>(None),
                ClientViewEvent::LifecycleChanged(ClientLifecycleState::Exiting { outcome }) => {
                    return Ok(Some(outcome));
                }
                _ => {}
            }
        }
    })
    .await;

    // Even failed or timed-out probes retire their authority before returning.
    if matches!(observed, Ok(Ok(None))) {
        commands.send(ClientCommand::Disconnect)?;
    }
    let joined = match timeout(Duration::from_secs(2), &mut task).await {
        Ok(result) => result.context("login probe runtime panicked")?,
        Err(_) => {
            task.abort();
            let cancelled = task.await;
            if let Err(error) = cancelled
                && !error.is_cancelled()
            {
                return Err(error.into());
            }
            bail!("Login probe did not complete and retire within its deadline");
        }
    };
    let outcome = observed.context("login probe observation timed out")??;
    if let Some(outcome) = outcome.or(joined.1.filter(|outcome| outcome.failure.is_some())) {
        let diagnostic = outcome
            .diagnostic()
            .replace(&submitted, "[redacted]")
            .replace(&password, "[redacted]")
            .replace(&account, "[redacted]");
        println!(
            "{}",
            serde_json::json!({"authenticated": false, "diagnostic": diagnostic})
        );
        if args.wrong_password
            && !matches!(
                outcome.failure.as_ref().map(|failure| &failure.cause),
                Some(holtburger_core::ConnectionFailureCause::AccountBoot(Some(reason))) if !reason.trim().is_empty()
            )
        {
            bail!("Expected a server boot explanation for the intentionally incorrect password");
        }
        if !args.wrong_password {
            bail!("Expected authentication success, received a server rejection");
        }
    } else {
        joined.0?;
        println!(
            "{}",
            serde_json::json!({"authenticated": true, "retired": true})
        );
        if args.wrong_password {
            bail!("Server accepted the intentionally incorrect password");
        }
    }
    Ok(())
}

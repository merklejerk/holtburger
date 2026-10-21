//! Capture/replay stationary inputs or exercise live movement and combat through core commands.
//!
//! Credentials use HOLTBURGER_PROBE_ACCOUNT/PASSWORD; raw fixtures contain private game messages.

use anyhow::{Context, Result, bail, ensure};
use clap::{Parser, Subcommand};
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_core::client::runtime_fixture::RuntimeFixture;
use holtburger_core::client::runtime_fixture::RuntimeFixtureReport;
use holtburger_core::{
    ClientCommand, ClientLifecycleState, ClientRuntimeBuilder, ClientViewEvent,
    ContentAssetService, ContentClientCollisionSource, ContentClientDynamicScaleSource,
};
use serde::Serialize;
use std::{fs::OpenOptions, io::Write, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::{broadcast, mpsc};
use tokio::time::{Instant, timeout, timeout_at};

#[path = "runtime_scene_fixture/stress.rs"]
mod stress;

/// Content source and one explicit capture, replay, or live stress operation.
#[derive(Parser)]
struct Args {
    /// Installed content root; normal discovery is used when omitted.
    #[arg(long, global = true)]
    content: Option<PathBuf>,
    #[command(subcommand)]
    operation: Operation,
}

/// Capture and stress contact ACE; replay uses an in-memory transport.
#[derive(Subcommand)]
enum Operation {
    Capture {
        /// New private MessagePack file; existing files are never overwritten.
        #[arg(long)]
        output: PathBuf,
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        #[arg(long, default_value_t = 9000)]
        port: u16,
        /// Character GUID in decimal. Omit only when exactly one active character exists.
        #[arg(long)]
        character: Option<u32>,
        /// Stationary observation duration after world activation.
        #[arg(long, default_value_t = 45, value_parser = clap::value_parser!(u64).range(1..=120))]
        seconds: u64,
    },
    Stress {
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        #[arg(long, default_value_t = 9000)]
        port: u16,
        /// Character GUID in decimal; required when multiple active characters exist.
        #[arg(long)]
        character: Option<u32>,
        /// Observation after startup settlement; default leaves margin around a 60-second audit.
        #[arg(long, default_value_t = 65, value_parser = clap::value_parser!(u64).range(61..=120))]
        seconds: u64,
    },
    Replay {
        /// Previously captured private MessagePack file.
        #[arg(long)]
        input: PathBuf,
        /// Untimed full replays that warm the shared content decode cache.
        #[arg(long, default_value_t = 1, value_parser = clap::value_parser!(u64).range(0..=10))]
        warmups: u64,
        /// Measured paced replays, each starting with a fresh core client.
        #[arg(long, default_value_t = 5, value_parser = clap::value_parser!(u64).range(1..=10))]
        repeats: u64,
    },
}

/// One structured benchmark sample; stdout contains only these records during replay.
#[derive(Serialize)]
struct MeasuredReplay {
    /// One-based measured iteration after explicit warmup.
    run: u64,
    /// Costs and workload audits produced by the production replay path.
    report: RuntimeFixtureReport,
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .target(env_logger::Target::Stderr)
        .init();
    let args = Args::parse();
    let repository = Arc::new(ContentRepository::discover(args.content)?);
    let service = Arc::new(ContentAssetService::new(
        Arc::clone(&repository),
        Arc::new(ContentDecodeCache::new()),
    ));
    let builder = |account: String| -> Result<ClientRuntimeBuilder> {
        let mut builder = ClientRuntimeBuilder::new(account)
            .collision_source(Arc::new(ContentClientCollisionSource::new(
                Arc::clone(&service),
                Arc::clone(&repository),
            )))
            .dynamic_scale_source(Arc::new(ContentClientDynamicScaleSource::new(Arc::clone(
                &service,
            ))));
        builder.load_assets(repository.as_ref())?;
        Ok(builder)
    };
    match args.operation {
        Operation::Capture {
            output,
            host,
            port,
            character,
            seconds,
        } => {
            let account = secret("HOLTBURGER_PROBE_ACCOUNT")?;
            let password = secret("HOLTBURGER_PROBE_PASSWORD")?;
            // Refuse an overwrite before connecting or selecting a character.
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&output)
                .context("create private fixture file")?;
            let mut client = builder(account)?.server(host, port).connect().await?;
            client.start_fixture_capture()?;
            let mut events = client.subscribe_client_view_events();
            let (commands, rx) = mpsc::unbounded_channel();
            client.set_command_rx(rx);
            let mut task = tokio::spawn(async move {
                let result = client.run().await;
                (result, client.finish_fixture_capture())
            });
            let result = observe(&commands, &mut events, password, character, seconds).await;
            let disconnect = commands.send(ClientCommand::Disconnect);
            let joined = match timeout(Duration::from_secs(5), &mut task).await {
                Ok(joined) => joined.context("capture task failed")?,
                Err(_) => {
                    task.abort();
                    let stopped = task.await;
                    ensure!(
                        stopped.is_err_and(|error| error.is_cancelled()),
                        "capture task failed during shutdown"
                    );
                    bail!("capture runtime did not stop after Disconnect; observation: {result:?}");
                }
            };
            result?;
            disconnect.context("runtime stopped before Disconnect")?;
            joined.0?;
            let fixture = joined.1?;
            file.write_all(&rmp_serde::to_vec_named(&fixture)?)?;
            file.sync_all()?;
            println!("Saved private fixture to {}", output.display());
        }
        Operation::Stress {
            host,
            port,
            character,
            seconds,
        } => {
            let account = secret("HOLTBURGER_PROBE_ACCOUNT")?;
            let password = secret("HOLTBURGER_PROBE_PASSWORD")?;
            let client = builder(account)?.server(host, port).connect().await?;
            stress::run(client, password, character, seconds).await?;
        }
        Operation::Replay {
            input,
            warmups,
            repeats,
        } => {
            ensure!(
                input.metadata()?.len() <= 64 * 1024 * 1024,
                "fixture exceeds 64 MiB"
            );
            let fixture: RuntimeFixture = rmp_serde::from_slice(&std::fs::read(input)?)?;
            fixture.validate()?;
            for warmup in 1..=warmups {
                fixture.replay(builder("offline-fixture".into())?).await?;
                eprintln!("Completed untimed content warmup {warmup}/{warmups}");
            }
            for run in 1..=repeats {
                let report = fixture.replay(builder("offline-fixture".into())?).await?;
                println!(
                    "{}",
                    serde_json::to_string(&MeasuredReplay { run, report })?
                );
            }
        }
    }
    Ok(())
}

fn secret(name: &str) -> Result<String> {
    let value = std::env::var(name).with_context(|| format!("{name} is required"))?;
    ensure!(!value.is_empty(), "{name} must not be empty");
    Ok(value)
}

async fn observe(
    commands: &mpsc::UnboundedSender<ClientCommand>,
    events: &mut broadcast::Receiver<ClientViewEvent>,
    password: String,
    requested: Option<u32>,
    seconds: u64,
) -> Result<()> {
    enter_world(commands, events, password, requested).await?;
    println!("World active; observing for {seconds} seconds");
    let deadline = Instant::now() + Duration::from_secs(seconds);
    loop {
        match timeout_at(deadline, events.recv()).await {
            Err(_) => return Ok(()),
            Ok(Ok(_)) => {}
            Ok(Err(error)) => return Err(error).context("scene observation stream failed"),
        }
    }
}

/// Shared entry path deliberately requires an unambiguous active character.
async fn enter_world(
    commands: &mpsc::UnboundedSender<ClientCommand>,
    events: &mut broadcast::Receiver<ClientViewEvent>,
    password: String,
    requested: Option<u32>,
) -> Result<holtburger_common::Guid> {
    commands.send(ClientCommand::Login(password))?;
    let deadline = Instant::now() + Duration::from_secs(45);
    let characters = loop {
        if let ClientViewEvent::LifecycleChanged(ClientLifecycleState::CharacterSelection {
            characters,
        }) = receive(events, deadline).await?
        {
            break characters;
        }
    };
    let active = characters
        .iter()
        .filter(|character| character.delete_time == 0)
        .collect::<Vec<_>>();
    let selected = match requested {
        Some(guid) => active
            .iter()
            .find(|character| character.guid.0 == guid)
            .copied()
            .context("requested character is not active on this account")?,
        None => {
            ensure!(
                active.len() == 1,
                "account has {} active characters; supply --character GUID",
                active.len()
            );
            active[0]
        }
    };
    let player = selected.guid;
    commands.send(ClientCommand::SelectCharacter(player))?;
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if matches!(
            receive(events, deadline).await?,
            ClientViewEvent::LifecycleChanged(ClientLifecycleState::InWorld)
        ) {
            break;
        }
    }
    Ok(player)
}

async fn receive(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    deadline: Instant,
) -> Result<ClientViewEvent> {
    timeout_at(deadline, events.recv())
        .await
        .context("timed out waiting for scene lifecycle")?
        .context("scene lifecycle stream failed")
}

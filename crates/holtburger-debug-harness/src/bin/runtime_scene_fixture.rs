//! Capture and replay stationary scene inputs through the production runtime.
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
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tempfile::NamedTempFile;
use tokio::sync::{broadcast, mpsc};
use tokio::time::{Instant, timeout, timeout_at};

/// Encoded artifact limit shared by capture publication and replay input.
const MAX_FIXTURE_BYTES: u64 = 64 * 1024 * 1024;

/// Private sibling file removed on failure; the destination appears only after publication.
struct PendingFixtureOutput {
    /// Tempfile creates owner-only files on Unix and removes abandoned partial writes.
    file: NamedTempFile,
    /// Final name, protected against overwrites again at publication time.
    destination: PathBuf,
}

impl PendingFixtureOutput {
    fn new(destination: PathBuf) -> Result<Self> {
        // Reject existing paths before logging in, including dangling symlinks. Publication's
        // no-clobber operation also protects a destination created while capture is running.
        match destination.symlink_metadata() {
            Ok(_) => bail!(
                "fixture destination already exists: {}",
                destination.display()
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error).context("inspect fixture destination"),
        }
        let parent = destination
            .parent()
            .context("fixture destination has no parent")?;
        Ok(Self {
            file: NamedTempFile::new_in(parent).context("create private fixture temporary file")?,
            destination,
        })
    }

    fn publish(mut self, fixture: &impl Serialize) -> Result<()> {
        let encoded = rmp_serde::to_vec_named(fixture).context("encode fixture")?;
        ensure_fixture_size(encoded.len() as u64)?;
        self.file.write_all(&encoded).context("write fixture")?;
        self.file.as_file().sync_all().context("sync fixture")?;
        self.file
            .persist_noclobber(&self.destination)
            // Retain the I/O cause, but drop PersistError's temporary file immediately on failure.
            .map_err(|error| error.error)
            .context("publish fixture without overwriting destination")?;
        Ok(())
    }
}

fn ensure_fixture_size(bytes: u64) -> Result<()> {
    ensure!(
        bytes <= MAX_FIXTURE_BYTES,
        "fixture exceeds {MAX_FIXTURE_BYTES} bytes"
    );
    Ok(())
}

fn read_fixture_bytes(input: &Path) -> Result<Vec<u8>> {
    let mut encoded = Vec::new();
    // Bound the actual read rather than trusting a metadata snapshot of a changing file.
    File::open(input)?
        .take(MAX_FIXTURE_BYTES + 1)
        .read_to_end(&mut encoded)?;
    ensure_fixture_size(encoded.len() as u64)?;
    Ok(encoded)
}

/// Content source and one explicit capture or replay operation.
#[derive(Parser)]
struct Args {
    /// Installed content root; normal discovery is used when omitted.
    #[arg(long, global = true)]
    content: Option<PathBuf>,
    #[command(subcommand)]
    operation: Operation,
}

/// Capture contacts ACE; replay uses an in-memory transport.
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
            let pending_output = PendingFixtureOutput::new(output.clone())?;
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
            pending_output.publish(&fixture)?;
            println!("Saved private fixture to {}", output.display());
        }
        Operation::Replay {
            input,
            warmups,
            repeats,
        } => {
            let fixture: RuntimeFixture = rmp_serde::from_slice(&read_fixture_bytes(&input)?)?;
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

/// Capture requires an unambiguous active character.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn published_capture_round_trips_and_remains_private() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("scene.msgpack");
        let sample = vec![1_u32, 2, 3];
        let pending = PendingFixtureOutput::new(destination.clone()).unwrap();
        assert!(!destination.exists());
        pending.publish(&sample).unwrap();
        let decoded: Vec<u32> =
            rmp_serde::from_slice(&read_fixture_bytes(&destination).unwrap()).unwrap();
        assert_eq!(decoded, sample);
        assert_eq!(directory.path().read_dir().unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                destination.metadata().unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn abandoned_capture_removes_temporary_file_without_publishing() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("scene.msgpack");
        let mut pending = PendingFixtureOutput::new(destination.clone()).unwrap();
        // Model a failed capture after partial private output, before publication.
        pending.file.write_all(b"partial").unwrap();
        drop(pending);
        assert!(!destination.exists());
        assert_eq!(directory.path().read_dir().unwrap().count(), 0);
    }

    #[test]
    fn serialization_failure_does_not_leave_an_artifact() {
        /// Exercises failure before any encoded fixture is ready for publication.
        struct RejectedSample;
        impl Serialize for RejectedSample {
            fn serialize<S: serde::Serializer>(
                &self,
                _: S,
            ) -> std::result::Result<S::Ok, S::Error> {
                Err(serde::ser::Error::custom("sample encoding rejected"))
            }
        }
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("scene.msgpack");
        let error = PendingFixtureOutput::new(destination.clone())
            .unwrap()
            .publish(&RejectedSample)
            .unwrap_err();
        assert!(format!("{error:#}").contains("sample encoding rejected"));
        assert!(!destination.exists());
        assert_eq!(directory.path().read_dir().unwrap().count(), 0);
    }

    #[test]
    fn existing_and_concurrently_created_destinations_are_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("scene.msgpack");
        let pending = PendingFixtureOutput::new(destination.clone()).unwrap();
        let original = b"existing capture";
        std::fs::write(&destination, original).unwrap();
        assert!(PendingFixtureOutput::new(destination.clone()).is_err());
        let error = pending.publish(&vec![1_u32]).unwrap_err();
        assert!(error.to_string().contains("without overwriting"));
        assert_eq!(std::fs::read(&destination).unwrap(), original);
        assert_eq!(directory.path().read_dir().unwrap().count(), 1);
    }

    #[test]
    fn oversized_captures_and_replay_files_share_the_same_limit() {
        assert!(ensure_fixture_size(MAX_FIXTURE_BYTES).is_ok());
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("scene.msgpack");
        // MessagePack's sequence header puts this payload just above the encoded-size limit.
        let oversized = vec![0_u8; MAX_FIXTURE_BYTES as usize];
        let write_error = PendingFixtureOutput::new(destination.clone())
            .unwrap()
            .publish(&oversized)
            .unwrap_err();
        drop(oversized);
        assert!(!destination.exists());
        assert_eq!(directory.path().read_dir().unwrap().count(), 0);
        File::create(&destination)
            .unwrap()
            .set_len(MAX_FIXTURE_BYTES + 1)
            .unwrap();
        let read_error = read_fixture_bytes(&destination).unwrap_err();
        assert_eq!(write_error.to_string(), read_error.to_string());
    }
}

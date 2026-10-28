//! Noninteractive housing information probe; submits no payment or management mutation.
//!
//! Credentials come only from `HOLTBURGER_PROBE_ACCOUNT` and
//! `HOLTBURGER_PROBE_PASSWORD`. An explicit character prevents accidental selection.

use anyhow::{Context, Result, bail};
use clap::Parser;
use holtburger_common::Guid;
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_core::{
    ClientCommand, ClientLifecycleState, ClientRuntimeBuilder, ClientViewEvent,
    ContentAssetService, ContentClientPhysicsSource, client::housing::HousingSnapshot,
};
use holtburger_world::housing::HomeKnowledge;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    sync::{broadcast, mpsc},
    time::{Instant, timeout, timeout_at},
};

/// Connection and read scope; every queried housing type is explicit.
#[derive(Debug, Parser)]
struct Args {
    /// ACE host.
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    /// ACE port.
    #[arg(long, default_value_t = 9000)]
    port: u16,
    /// Content root; use normal discovery when omitted.
    #[arg(long)]
    content: Option<PathBuf>,
    /// Character GUID as a decimal u32.
    #[arg(long)]
    character: u32,
    /// Search type: 1 cottage, 2 villa, 3 mansion, 4 apartment.
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..=4))]
    house_type: u32,
    /// Maximum seconds per read/login phase.
    #[arg(long, default_value_t = 30, value_parser = clap::value_parser!(u64).range(1..))]
    timeout_seconds: u64,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let account = secret("HOLTBURGER_PROBE_ACCOUNT")?;
    let password = secret("HOLTBURGER_PROBE_PASSWORD")?;
    let duration = Duration::from_secs(args.timeout_seconds);
    let repository = Arc::new(ContentRepository::discover(args.content.clone())?);
    let service = Arc::new(ContentAssetService::new(
        Arc::clone(&repository),
        Arc::new(ContentDecodeCache::new()),
    ));
    let physical_source = Arc::new(ContentClientPhysicsSource::new(
        service,
        Arc::clone(&repository),
    ));
    let mut builder = ClientRuntimeBuilder::new(account)
        .server(args.host.clone(), args.port)
        .physical_movement_source(physical_source.clone(), physical_source.clone());
    builder.load_assets(repository.as_ref())?;
    let mut client = builder.connect().await?;
    let mut events = client.subscribe_client_view_events();
    let (commands, command_rx) = mpsc::unbounded_channel();
    client.set_command_rx(command_rx);
    let mut task = tokio::spawn(async move { client.run().await });
    let result = probe(&commands, &mut events, &args, password, duration).await;
    // Always retire the runtime, including on timeout or a rejected read.
    let disconnect = commands.send(ClientCommand::Disconnect);
    let shutdown = match timeout(Duration::from_secs(2), &mut task).await {
        Ok(joined) => joined.context("housing runtime task failed")?,
        Err(_) => {
            task.abort();
            if let Err(error) = task.await
                && !error.is_cancelled()
            {
                return Err(error).context("housing runtime failed during forced shutdown");
            }
            bail!("housing runtime did not stop after Disconnect; probe result: {result:?}");
        }
    };
    result?;
    disconnect.context("runtime stopped before Disconnect")?;
    shutdown
}

fn secret(name: &str) -> Result<String> {
    let value = std::env::var(name).with_context(|| format!("{name} is required"))?;
    if value.is_empty() {
        bail!("{name} must not be empty");
    }
    Ok(value)
}

async fn probe(
    commands: &mpsc::UnboundedSender<ClientCommand>,
    events: &mut broadcast::Receiver<ClientViewEvent>,
    args: &Args,
    password: String,
    duration: Duration,
) -> Result<()> {
    commands
        .send(ClientCommand::Login(password))
        .map_err(|_| anyhow::anyhow!("runtime stopped before login"))?;
    let character = Guid(args.character);
    wait(events, duration, "character roster", |event| {
        let lifecycle = match event {
            ClientViewEvent::LifecycleChanged(lifecycle) => lifecycle,
            ClientViewEvent::ApplicationSnapshot(snapshot) => snapshot.lifecycle,
            _ => return None,
        };
        match lifecycle {
            ClientLifecycleState::CharacterSelection { characters, .. } => Some(
                characters
                    .iter()
                    .any(|entry| entry.guid == character && entry.delete_time == 0),
            ),
            _ => None,
        }
    })
    .await?
    .then_some(())
    .context("requested character is not selectable")?;
    commands.send(ClientCommand::SelectCharacter(character))?;
    wait(events, duration, "world entry", |event| match event {
        ClientViewEvent::LifecycleChanged(ClientLifecycleState::InWorld) => Some(()),
        _ => None,
    })
    .await?;
    commands.send(ClientCommand::RequestCurrentApplicationState)?;
    let snapshot = wait(
        events,
        duration,
        "active character snapshot",
        |event| match event {
            ClientViewEvent::ApplicationSnapshot(snapshot) => Some(snapshot),
            _ => None,
        },
    )
    .await?;
    if snapshot.local_player_guid != Some(character)
        || snapshot.lifecycle != ClientLifecycleState::InWorld
    {
        bail!("active character snapshot does not match the selected character");
    }
    let ready =
        |housing: &HousingSnapshot| !housing.refreshing && housing.home != HomeKnowledge::Unqueried;
    let home = if ready(&snapshot.housing) {
        snapshot.housing
    } else {
        wait_housing(events, duration, "initial home", ready).await?
    };
    println!("HOME {:?}", home.home);
    if matches!(home.home, HomeKnowledge::Owned { .. }) {
        commands.send(ClientCommand::QueryHousingAccess)?;
        let access = wait_housing(events, duration, "access records", |housing| {
            !housing.access.refreshing && housing.access.records.is_some()
        })
        .await?;
        println!("ACCESS {:?}", access.access);
    }
    commands.send(ClientCommand::SearchHousing {
        house_type: args.house_type,
    })?;
    let search = wait_housing(events, duration, "available housing", |housing| {
        housing.search.pending_type.is_none()
            && housing
                .search
                .results
                .as_ref()
                .is_some_and(|result| result.house_type == args.house_type)
    })
    .await?;
    println!("SEARCH {:?}", search.search);
    println!("PASS housing information reads; no payment or management action submitted");
    Ok(())
}

async fn wait_housing(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    duration: Duration,
    phase: &str,
    ready: impl Fn(&HousingSnapshot) -> bool,
) -> Result<HousingSnapshot> {
    wait(events, duration, phase, |event| {
        let housing = match event {
            ClientViewEvent::HousingUpdated(housing) => housing,
            ClientViewEvent::ApplicationSnapshot(snapshot) => snapshot.housing,
            _ => return None,
        };
        ready(&housing).then_some(housing)
    })
    .await
}

async fn wait<T>(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    duration: Duration,
    phase: &str,
    extract: impl Fn(ClientViewEvent) -> Option<T>,
) -> Result<T> {
    let deadline = Instant::now() + duration;
    loop {
        let event = timeout_at(deadline, events.recv())
            .await
            .with_context(|| format!("timed out waiting for {phase}"))?
            .with_context(|| format!("lost housing probe events during {phase}"))?;
        if let Some(value) = extract(event) {
            return Ok(value);
        }
    }
}

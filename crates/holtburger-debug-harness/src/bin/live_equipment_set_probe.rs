//! Noninteractive equipment-set experiment for an explicitly selected disposable character.
//! Credentials come from environment variables only; no equipment requests are inferred.

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand, ValueEnum};
use holtburger_common::{Guid, properties::EquipMask};
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_core::{
    ClientApplicationSnapshot, ClientCommand, ClientLifecycleState, ClientRuntimeBuilder,
    ClientViewEvent, ContentAssetService, ContentClientCollisionSource,
    client::equipment_set::EquipmentBinding,
};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_world::entity_facts::{EntityDescription, EntityStorageLocation};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    sync::{broadcast, mpsc},
    time::{Instant, timeout, timeout_at},
};

/// Explicit server, character, and equipment targets prevent accidental account-wide probing.
#[derive(Debug, Parser)]
struct Args {
    /// ACE host.
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    /// ACE port.
    #[arg(long, default_value_t = 9000)]
    port: u16,
    /// Optional normal content-discovery override.
    #[arg(long)]
    content: Option<PathBuf>,
    /// Maximum seconds for each login/read phase.
    #[arg(long, default_value_t = 30, value_parser = clap::value_parser!(u64).range(1..))]
    timeout_seconds: u64,
    /// Read-only roster/inspection or explicitly requested equipment experiment.
    #[command(subcommand)]
    scope: Scope,
}

/// Discovery never submits equipment or stance commands.
#[derive(Debug, Subcommand)]
enum Scope {
    Roster,
    Inspect {
        /// Character GUID, decimal or hexadecimal.
        #[arg(long, value_parser = parse_number)]
        character: u32,
    },
    Swap(SwapArgs),
}

/// Mutation requires explicit character and item bindings.
#[derive(Debug, clap::Args)]
struct SwapArgs {
    /// Disposable character GUID, decimal or hexadecimal.
    #[arg(long, value_parser = parse_number)]
    character: u32,
    /// Exact owned GUID@equipment-mask or empty@mask request; repeat for each binding.
    #[arg(long, required = true, value_parser = parse_binding)]
    binding: Vec<EquipmentBinding>,
    /// Stance to establish before the experiment; choose a supported equipped family.
    #[arg(long, value_enum, default_value_t = Mode::Peace)]
    combat_mode: Mode,
    /// Submit during the requested transition instead of waiting for confirmed initial stance.
    #[arg(long)]
    pending_transition: bool,
    /// Consecutive activations, including overlapping peace admission when applicable.
    #[arg(long, default_value_t = 1, value_parser = clap::value_parser!(u32).range(1..=2))]
    activations: u32,
    /// Observation window after submission; this is a diagnostic window, not command pacing.
    #[arg(long, default_value_t = 5, value_parser = clap::value_parser!(u64).range(1..))]
    observe_seconds: u64,
}

/// Initial stance is explicit so the same bindings can be compared across combat modes.
#[derive(Debug, Clone, Copy, ValueEnum)]
enum Mode {
    Peace,
    Melee,
    Missile,
    Magic,
}

impl From<Mode> for CombatMode {
    fn from(mode: Mode) -> Self {
        match mode {
            Mode::Peace => Self::NonCombat,
            Mode::Melee => Self::Melee,
            Mode::Missile => Self::Missile,
            Mode::Magic => Self::Magic,
        }
    }
}

fn parse_number(value: &str) -> Result<u32, String> {
    if let Some(hex) = value.strip_prefix("0x") {
        u32::from_str_radix(hex, 16).map_err(|error| error.to_string())
    } else {
        value.parse::<u32>().map_err(|error| error.to_string())
    }
}

fn parse_binding(value: &str) -> Result<EquipmentBinding, String> {
    let (item, mask) = value
        .split_once('@')
        .ok_or("Expected GUID@equipment-mask")?;
    let item = if item == "empty" {
        None
    } else {
        let guid = Guid(parse_number(item)?);
        if guid == Guid::NULL {
            return Err("Equipment GUID must be nonzero".into());
        }
        Some(guid)
    };
    let target =
        EquipMask::from_bits(parse_number(mask)?).ok_or("Unknown equipment-location bits")?;
    if target.is_empty() {
        return Err("Equipment mask must be nonzero".into());
    }
    Ok(EquipmentBinding { item, target })
}

fn secret(name: &str) -> Result<String> {
    let value = std::env::var(name).with_context(|| format!("{name} is required"))?;
    if value.is_empty() {
        bail!("{name} must not be empty");
    }
    Ok(value)
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let account = secret("HOLTBURGER_PROBE_ACCOUNT")?;
    let password = secret("HOLTBURGER_PROBE_PASSWORD")?;
    let repository = Arc::new(ContentRepository::discover(args.content.clone())?);
    let service = Arc::new(ContentAssetService::new(
        Arc::clone(&repository),
        Arc::new(ContentDecodeCache::new()),
    ));
    let mut builder = ClientRuntimeBuilder::new(account)
        .server(args.host.clone(), args.port)
        .collision_source(Arc::new(ContentClientCollisionSource::new(
            service,
            Arc::clone(&repository),
        )));
    builder.load_assets(repository.as_ref())?;
    let mut client = builder.connect().await?;
    let mut events = client.subscribe_client_view_events();
    let (commands, command_rx) = mpsc::unbounded_channel();
    client.set_command_rx(command_rx);
    let mut task = tokio::spawn(async move { client.run().await });
    let result = probe(&commands, &mut events, &args, password).await;
    let disconnect = commands.send(ClientCommand::Disconnect);
    let shutdown = match timeout(Duration::from_secs(2), &mut task).await {
        Ok(joined) => joined.context("equipment runtime task failed")?,
        Err(_) => {
            task.abort();
            if let Err(error) = task.await
                && !error.is_cancelled()
            {
                return Err(error.into());
            }
            bail!("Equipment runtime did not stop after Disconnect; probe result: {result:?}");
        }
    };
    result?;
    disconnect.context("runtime stopped before Disconnect")?;
    shutdown
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
            .with_context(|| format!("Timed out waiting for {phase}"))?
            .with_context(|| format!("Lost equipment probe events during {phase}"))?;
        if let Some(value) = extract(event) {
            return Ok(value);
        }
    }
}

fn print_equipment(label: &str, snapshot: &ClientApplicationSnapshot) {
    for entity in &snapshot.entities.entities {
        if entity.owned_by_player
            && matches!(entity.location, EntityStorageLocation::Equipped { .. })
        {
            println!("{label} {:?} {:?}", entity.guid, entity.location);
        }
    }
    println!("{label} combat={:?}", snapshot.combat_mode);
}

async fn probe(
    commands: &mpsc::UnboundedSender<ClientCommand>,
    events: &mut broadcast::Receiver<ClientViewEvent>,
    args: &Args,
    password: String,
) -> Result<()> {
    let duration = Duration::from_secs(args.timeout_seconds);
    commands.send(ClientCommand::Login(password))?;
    let characters = wait(events, duration, "character roster", |event| match event {
        ClientViewEvent::LifecycleChanged(ClientLifecycleState::CharacterSelection {
            characters,
            ..
        }) => Some(characters),
        _ => None,
    })
    .await?;
    if matches!(args.scope, Scope::Roster) {
        for entry in characters {
            println!(
                "CHARACTER {:?} name={:?} delete_time={}",
                entry.guid, entry.name, entry.delete_time
            );
        }
        return Ok(());
    }
    let character = Guid(match &args.scope {
        Scope::Roster => unreachable!("roster returned before world entry"),
        Scope::Inspect { character } => *character,
        Scope::Swap(swap) => swap.character,
    });
    if !characters
        .iter()
        .any(|entry| entry.guid == character && entry.delete_time == 0)
    {
        bail!("Explicit character is not selectable");
    }
    commands.send(ClientCommand::SelectCharacter(character))?;
    wait(events, duration, "world entry", |event| {
        matches!(
            event,
            ClientViewEvent::LifecycleChanged(ClientLifecycleState::InWorld)
        )
        .then_some(())
    })
    .await?;
    commands.send(ClientCommand::RequestCurrentApplicationState)?;
    let baseline = wait(events, duration, "baseline", |event| match event {
        ClientViewEvent::ApplicationSnapshot(snapshot) => Some(snapshot),
        _ => None,
    })
    .await?;
    if baseline.local_player_guid != Some(character) {
        bail!("Baseline character differs from explicit probe character");
    }
    if matches!(args.scope, Scope::Inspect { .. }) {
        for entity in &baseline.entities.entities {
            if entity.owned_by_player {
                match &entity.description {
                    EntityDescription::Known {
                        name,
                        equip_locations,
                        ..
                    } => println!(
                        "OWNED {:?} {:?} name={name:?} allowed={equip_locations:?}",
                        entity.guid, entity.location
                    ),
                    EntityDescription::Pending => {
                        println!("OWNED {:?} {:?} name=pending", entity.guid, entity.location)
                    }
                }
            }
        }
        print_equipment("BASELINE", &baseline);
        return Ok(());
    }
    let Scope::Swap(swap) = &args.scope else {
        bail!("Equipment experiment scope was not selected");
    };
    print_equipment("BASELINE", &baseline);
    for binding in &swap.binding {
        if binding.item.is_some_and(|item| {
            !baseline
                .entities
                .entities
                .iter()
                .any(|entity| entity.guid == item && entity.owned_by_player)
        }) {
            bail!(
                "Explicit binding {:?} is not confirmed player-owned; no equipment set submitted",
                binding.item
            );
        }
    }
    let mode = CombatMode::from(swap.combat_mode);
    if baseline.combat_mode != mode {
        commands.send(ClientCommand::SetCombatMode(mode))?;
        if !swap.pending_transition {
            wait(
                events,
                duration,
                "initial combat mode",
                |event| match event {
                    ClientViewEvent::CombatModeUpdated { mode: confirmed } if confirmed == mode => {
                        Some(())
                    }
                    _ => None,
                },
            )
            .await?;
        }
    }
    let started = Instant::now();
    for activation in 0..swap.activations {
        println!("SUBMIT {activation} {:?}", swap.binding);
        commands.send(ClientCommand::ApplyEquipmentSet(swap.binding.clone()))?;
    }
    let deadline = started + Duration::from_secs(swap.observe_seconds);
    loop {
        let event = match timeout_at(deadline, events.recv()).await {
            Ok(result) => result.context("Equipment observation stream failed")?,
            Err(_) => break,
        };
        let elapsed = started.elapsed().as_secs_f64();
        match event {
            ClientViewEvent::ActionResult { source, reason } => {
                println!("RESULT {elapsed:.6} {source:?} {reason:?}")
            }
            ClientViewEvent::CombatModeUpdated { mode } => println!("STANCE {elapsed:.6} {mode:?}"),
            ClientViewEvent::EntityFactsChanged(delta) => {
                for entity in delta.upserts {
                    if entity.owned_by_player {
                        println!(
                            "PLACEMENT {elapsed:.6} {:?} {:?}",
                            entity.guid, entity.location
                        );
                    }
                }
            }
            _ => {}
        }
    }
    commands.send(ClientCommand::RequestCurrentApplicationState)?;
    let final_state = wait(events, duration, "final equipment", |event| match event {
        ClientViewEvent::ApplicationSnapshot(snapshot) => Some(snapshot),
        _ => None,
    })
    .await?;
    print_equipment("FINAL", &final_state);
    println!(
        "OBSERVED {:.6} seconds; inspect FINAL for actual equipment; original outfit is not restored",
        started.elapsed().as_secs_f64()
    );
    Ok(())
}

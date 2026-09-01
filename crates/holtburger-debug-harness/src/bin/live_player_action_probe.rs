//! Noninteractive local-ACE proof for one client-authored player action lifecycle.
//!
//! Credentials are read from `HOLTBURGER_PROBE_ACCOUNT` and
//! `HOLTBURGER_PROBE_PASSWORD`; they never enter process arguments or output.

use anyhow::{Context, Result, bail};
use clap::{Parser, ValueEnum};
use holtburger_common::Guid;
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_core::{
    ClientCommand, ClientLifecycleState, ClientRuntimeBuilder, ClientViewEvent,
    ContentAssetService, ContentClientCollisionSource, DynamicEntityClipCompletion,
    DynamicEntityEvent, DynamicEntityMotion,
};
use holtburger_protocol::messages::combat::CombatMode;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};
use tokio::time::{Instant, timeout_at};

#[derive(Debug, Parser)]
#[command(about = "Prove a live local-player SoulEmote motion leaves and returns to steady motion")]
struct Args {
    /// ACE server host.
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    /// ACE server port.
    #[arg(long, default_value_t = 9000)]
    port: u16,
    /// Explicit content root; normal discovery is used when omitted.
    #[arg(long)]
    content: Option<std::path::PathBuf>,
    /// Character GUID in decimal or `0x` hexadecimal; defaults to the first active character.
    #[arg(long, value_parser = parse_guid)]
    character_guid: Option<Guid>,
    /// SoulEmote token resolved by the loaded retail chat-pose catalog.
    #[arg(long, default_value = "wave")]
    token: String,
    /// Equipped combat family whose steady stance should be entered and retired.
    #[arg(long, value_enum, default_value_t = CombatModeArg::Magic)]
    combat_mode: CombatModeArg,
    /// Maximum seconds for login, entry, and the action lifecycle independently.
    #[arg(long, default_value_t = 30)]
    timeout_seconds: u64,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CombatModeArg {
    Melee,
    Missile,
    Magic,
}

impl From<CombatModeArg> for CombatMode {
    fn from(value: CombatModeArg) -> Self {
        match value {
            CombatModeArg::Melee => Self::Melee,
            CombatModeArg::Missile => Self::Missile,
            CombatModeArg::Magic => Self::Magic,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ObservedMotion(Option<DynamicEntityMotion>);

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    let args = Args::parse();
    let account = required_secret("HOLTBURGER_PROBE_ACCOUNT")?;
    let password = required_secret("HOLTBURGER_PROBE_PASSWORD")?;
    let phase_timeout = Duration::from_secs(args.timeout_seconds);

    let repository = Arc::new(
        ContentRepository::discover(args.content.clone()).context("content discovery failed")?,
    );
    let service = Arc::new(ContentAssetService::new(
        Arc::clone(&repository),
        Arc::new(ContentDecodeCache::new()),
    ));
    let mut builder = ClientRuntimeBuilder::new(account)
        .server(args.host, args.port)
        .collision_source(Arc::new(ContentClientCollisionSource::new(
            service,
            Arc::clone(&repository),
        )));
    builder
        .load_assets(repository.as_ref())
        .context("client bootstrap content failed")?;
    let mut client = builder.connect().await.context("ACE connection failed")?;
    let mut events = client.subscribe_client_view_events();
    let (commands, command_rx) = mpsc::unbounded_channel();
    client.set_command_rx(command_rx);
    let client_task = tokio::spawn(async move { client.run().await });

    commands
        .send(ClientCommand::RequestCurrentApplicationState)
        .context("client stopped before initial state request")?;
    commands
        .send(ClientCommand::Login(password))
        .context("client stopped before login")?;

    let characters = wait_for_characters(&mut events, phase_timeout).await?;
    let selected = args
        .character_guid
        .map(|guid| characters.iter().find(|character| character.guid == guid))
        .unwrap_or_else(|| {
            characters
                .iter()
                .find(|character| character.delete_time == 0)
        })
        .with_context(|| {
            args.character_guid.map_or_else(
                || "account has no active character".to_owned(),
                |guid| format!("requested character 0x{:08X} is not selectable", guid.0),
            )
        })?;
    println!(
        "selected character 0x{:08X} {:?}",
        selected.guid.0, selected.name
    );
    commands
        .send(ClientCommand::SelectCharacter(selected.guid))
        .context("client stopped before character selection")?;

    let player_guid = wait_for_world_entry(&mut events, selected.guid, phase_timeout).await?;
    commands
        .send(ClientCommand::RequestCurrentApplicationState)
        .context("client stopped before baseline request")?;
    let baseline = wait_for_player_clip(&mut events, player_guid, phase_timeout).await?;
    println!("baseline motion {}", describe_motion(baseline.0));

    commands
        .send(ClientCommand::SoulEmote(args.token.clone()))
        .context("client stopped before SoulEmote")?;
    let action_result = wait_for_action_return(
        &mut events,
        player_guid,
        baseline,
        &args.token,
        phase_timeout,
    )
    .await;

    let transitions = match action_result {
        Ok(transitions) => transitions,
        Err(error) => {
            let _ = commands.send(ClientCommand::Disconnect);
            return Err(error);
        }
    };

    println!("observed {} motion transitions:", transitions.len());
    for (index, motion) in transitions.iter().enumerate() {
        println!("  {index}: {}", describe_motion(motion.0));
    }
    println!(
        "PASS local player action {:?} left and returned to its steady motion",
        args.token
    );

    let combat_mode = CombatMode::from(args.combat_mode);
    commands
        .send(ClientCommand::SetCombatMode(combat_mode))
        .context("client stopped before combat stance request")?;
    let combat_clip = wait_for_combat_stance(
        &mut events,
        player_guid,
        baseline,
        combat_mode,
        phase_timeout,
    )
    .await;
    let _ = commands.send(ClientCommand::SetCombatMode(CombatMode::NonCombat));
    let combat_clip = match combat_clip {
        Ok(motion) => motion,
        Err(error) => {
            let _ = commands.send(ClientCommand::Disconnect);
            return Err(error);
        }
    };
    println!(
        "combat mode {combat_mode:?} steady motion {}",
        describe_motion(combat_clip.0)
    );
    let noncombat_result =
        wait_for_noncombat_return(&mut events, player_guid, baseline, phase_timeout).await;
    let _ = commands.send(ClientCommand::Disconnect);
    noncombat_result?;
    println!("PASS player combat stance entered and returned to NonCombat");

    drop(commands);
    match tokio::time::timeout(Duration::from_secs(2), client_task).await {
        Ok(Ok(result)) => result.context("client runtime failed during disconnect")?,
        Ok(Err(error)) => return Err(error).context("client runtime task failed"),
        Err(_) => {}
    }
    Ok(())
}

async fn wait_for_combat_stance(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    player_guid: Guid,
    baseline: ObservedMotion,
    requested_mode: CombatMode,
    duration: Duration,
) -> Result<ObservedMotion> {
    let deadline = Instant::now() + duration;
    let mut confirmed = false;
    loop {
        let event = recv_before(events, deadline, "combat stance").await?;
        if let ClientViewEvent::CombatModeUpdated { mode } = event {
            if mode != requested_mode {
                bail!(
                    "ACE resolved requested combat mode {requested_mode:?} as {mode:?}; choose an equipped combat family"
                );
            }
            confirmed = true;
            continue;
        }
        let Some(motion) = player_motion_from_event(&event, player_guid) else {
            continue;
        };
        if confirmed
            && motion != baseline
            && motion.0.is_some_and(|motion| {
                matches!(
                    motion,
                    DynamicEntityMotion::Playing {
                        completion: DynamicEntityClipCompletion::Loop,
                        ..
                    }
                )
            })
        {
            return Ok(motion);
        }
    }
}

async fn wait_for_noncombat_return(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    player_guid: Guid,
    baseline: ObservedMotion,
    duration: Duration,
) -> Result<()> {
    let deadline = Instant::now() + duration;
    let mut confirmed = false;
    let mut returned = false;
    while !confirmed || !returned {
        let event = recv_before(events, deadline, "NonCombat return").await?;
        if let ClientViewEvent::CombatModeUpdated { mode } = event {
            if mode == CombatMode::NonCombat {
                confirmed = true;
            }
            continue;
        }
        returned |= player_motion_from_event(&event, player_guid) == Some(baseline);
    }
    Ok(())
}

fn required_secret(name: &str) -> Result<String> {
    let value = std::env::var(name).with_context(|| format!("{name} is required"))?;
    if value.is_empty() {
        bail!("{name} must not be empty");
    }
    Ok(value)
}

fn parse_guid(raw: &str) -> Result<Guid, String> {
    let value = raw
        .strip_prefix("0x")
        .or_else(|| raw.strip_prefix("0X"))
        .map_or_else(|| raw.parse::<u32>(), |hex| u32::from_str_radix(hex, 16))
        .map_err(|error| format!("invalid GUID {raw:?}: {error}"))?;
    Ok(Guid(value))
}

async fn wait_for_characters(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    duration: Duration,
) -> Result<Vec<holtburger_core::ClientCharacterSummary>> {
    let deadline = Instant::now() + duration;
    loop {
        match recv_before(events, deadline, "character selection").await? {
            ClientViewEvent::LifecycleChanged(ClientLifecycleState::CharacterSelection {
                characters,
            })
            | ClientViewEvent::ApplicationSnapshot(holtburger_core::ClientApplicationSnapshot {
                lifecycle: ClientLifecycleState::CharacterSelection { characters },
                ..
            }) => return Ok(characters),
            _ => {}
        }
    }
}

async fn wait_for_world_entry(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    selected_guid: Guid,
    duration: Duration,
) -> Result<Guid> {
    let deadline = Instant::now() + duration;
    let mut player_guid = None;
    let mut in_world = false;
    while player_guid.is_none() || !in_world {
        match recv_before(events, deadline, "world entry").await? {
            ClientViewEvent::LocalPlayerEstablished { player_guid: guid } => {
                player_guid = Some(guid)
            }
            ClientViewEvent::LifecycleChanged(ClientLifecycleState::InWorld) => in_world = true,
            ClientViewEvent::ApplicationSnapshot(snapshot) => {
                player_guid = snapshot.local_player_guid.or(player_guid);
                in_world |= snapshot.lifecycle == ClientLifecycleState::InWorld;
            }
            _ => {}
        }
    }
    let player_guid = player_guid.expect("loop requires local-player identity");
    if player_guid != selected_guid {
        bail!(
            "selected character 0x{:08X} entered as 0x{:08X}",
            selected_guid.0,
            player_guid.0
        );
    }
    Ok(player_guid)
}

async fn wait_for_player_clip(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    player_guid: Guid,
    duration: Duration,
) -> Result<ObservedMotion> {
    let deadline = Instant::now() + duration;
    loop {
        let event = recv_before(events, deadline, "local-player baseline motion").await?;
        if let Some(motion) = player_motion_from_event(&event, player_guid) {
            return Ok(motion);
        }
    }
}

async fn wait_for_action_return(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    player_guid: Guid,
    baseline: ObservedMotion,
    token: &str,
    duration: Duration,
) -> Result<Vec<ObservedMotion>> {
    let deadline = Instant::now() + duration;
    let mut current = baseline;
    let mut transitions = vec![baseline];
    let mut left_baseline = false;
    let mut server_confirmed = false;
    loop {
        let event = recv_before(events, deadline, "SoulEmote action return")
            .await
            .with_context(|| {
                format!(
                    "action {token:?}: server_confirmed={server_confirmed}, left_baseline={left_baseline}, transitions={}",
                    transitions
                        .iter()
                        .map(|motion| describe_motion(motion.0))
                        .collect::<Vec<_>>()
                        .join(" -> ")
                )
            })?;
        if matches!(&event, ClientViewEvent::SoulEmote { .. }) {
            server_confirmed = true;
        }
        let Some(motion) = player_motion_from_event(&event, player_guid) else {
            continue;
        };
        if motion != current {
            current = motion;
            transitions.push(motion);
        }
        if motion != baseline {
            left_baseline = true;
        } else if left_baseline && server_confirmed {
            return Ok(transitions);
        }
        if Instant::now() >= deadline {
            bail!("player action {token:?} did not return before timeout");
        }
    }
}

async fn recv_before(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    deadline: Instant,
    phase: &str,
) -> Result<ClientViewEvent> {
    loop {
        match timeout_at(deadline, events.recv()).await {
            Ok(Ok(event)) => return Ok(event),
            Ok(Err(broadcast::error::RecvError::Lagged(skipped))) => {
                eprintln!("probe receiver lagged by {skipped} events during {phase}");
            }
            Ok(Err(broadcast::error::RecvError::Closed)) => {
                bail!("client event stream closed during {phase}")
            }
            Err(_) => bail!("timed out waiting for {phase}"),
        }
    }
}

fn player_motion_from_event(event: &ClientViewEvent, guid: Guid) -> Option<ObservedMotion> {
    let view = match event {
        ClientViewEvent::ApplicationSnapshot(snapshot) => snapshot
            .dynamic
            .entities
            .iter()
            .find(|entity| entity.identity.guid == guid),
        ClientViewEvent::DynamicEntity(DynamicEntityEvent::Snapshot { snapshot }) => snapshot
            .entities
            .iter()
            .find(|entity| entity.identity.guid == guid),
        ClientViewEvent::DynamicEntity(DynamicEntityEvent::Upserted { entity }) => {
            (entity.identity.guid == guid).then_some(entity.as_ref())
        }
        ClientViewEvent::DynamicEntity(DynamicEntityEvent::Ticked { batch }) => batch
            .advances
            .iter()
            .map(|advance| advance.entity.as_ref())
            .chain(batch.updates.iter().map(Box::as_ref))
            .find(|entity| entity.identity.guid == guid),
        _ => None,
    }?;
    Some(ObservedMotion(view.motion))
}

fn describe_motion(motion: Option<DynamicEntityMotion>) -> String {
    motion.map_or_else(
        || "none".to_owned(),
        |motion| match motion {
            DynamicEntityMotion::Playing {
                animation_id,
                completion,
                framerate,
                high_frame,
                low_frame,
            } => format!(
                "0x{:08X} rate={} frames={}..={} completion={:?}",
                animation_id, framerate, low_frame, high_frame, completion
            ),
            DynamicEntityMotion::Settled {
                animation_id,
                frame,
            } => format!("0x{animation_id:08X} settled frame={frame}"),
        },
    )
}

//! Exercise production navigation composition against local ACE without a terminal UI.
//! Credentials come from HOLTBURGER_PROBE_ACCOUNT / HOLTBURGER_PROBE_PASSWORD.

use anyhow::{Context, Result, bail, ensure};
use clap::Parser;
use holtburger_common::{Guid, position::WorldPosition};
use holtburger_content::navigation_bundle::{BOOTSTRAP_FILE, NAVIGATION_FILE, NavigationArchive};
use holtburger_content::{ContentRepository, NavigationSceneSource, PreparedNavigationSource};
use holtburger_core::client::movement_types::{
    AutonomousDriveIntent, ClientDirectedCommand, Gait, PlayerDriveIntent,
};
use holtburger_core::{
    ClientCommand, ClientLifecycleState, ClientRuntimeBuilder, ClientViewEvent, DynamicEntityEvent,
    DynamicEntityPlacementView, DynamicEntityView,
};
use serde::Deserialize;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    sync::{broadcast, mpsc},
    time::{Instant, timeout_at},
};

/// Explicit diagnostic inputs; never selects an arbitrary account character.
#[derive(Parser)]
struct Arguments {
    /// Prepared CLI directory, always supplying navigation.hnav.
    #[arg(long)]
    content: PathBuf,
    /// Optional reference HBA override; otherwise use bootstrap.hba from the prepared directory.
    #[arg(long)]
    bootstrap: Option<PathBuf>,
    /// JSON containing start and target WorldPositions. Movement stays within one owner.
    #[arg(long)]
    route: PathBuf,
    /// Character GUID in decimal (no names or credentials are logged).
    #[arg(long)]
    character: u32,
}

/// Only endpoints are read: production core owns interpolation, containment, and publication.
#[derive(Deserialize)]
struct Route {
    start: WorldPosition,
    target: WorldPosition,
}

/// Probe-owned observations; never supplies an alternate world pose to core.
struct Observations {
    player: Guid,
    pose: Option<WorldPosition>,
    in_world: bool,
}

impl Observations {
    fn observe_entity(&mut self, entity: &DynamicEntityView) -> Result<()> {
        if entity.identity.guid == self.player
            && let DynamicEntityPlacementView::World { pose, .. } = entity.placement
        {
            self.observe(ClientViewEvent::EntityMoved {
                guid: self.player,
                pos: pose,
            })?;
        }
        Ok(())
    }

    fn observe(&mut self, event: ClientViewEvent) -> Result<()> {
        match event {
            ClientViewEvent::ApplicationSnapshot(snapshot) => {
                self.in_world = snapshot.lifecycle == ClientLifecycleState::InWorld;
                for entity in &snapshot.dynamic.entities {
                    self.observe_entity(entity)?;
                }
            }
            ClientViewEvent::DynamicEntity(event) => match event {
                DynamicEntityEvent::Snapshot { snapshot } => {
                    for entity in &snapshot.entities {
                        self.observe_entity(entity)?;
                    }
                }
                DynamicEntityEvent::Upserted { entity } => self.observe_entity(&entity)?,
                DynamicEntityEvent::Ticked { batch } => {
                    for advance in &batch.advances {
                        self.observe_entity(&advance.entity)?;
                    }
                    for entity in &batch.updates {
                        self.observe_entity(entity)?;
                    }
                }
                DynamicEntityEvent::Removed { .. } => {}
            },
            ClientViewEvent::LifecycleChanged(state) => {
                self.in_world = state == ClientLifecycleState::InWorld;
                println!("LIFECYCLE in_world={}", self.in_world);
            }
            ClientViewEvent::EntityMoved { guid, pos } if guid == self.player => {
                if self
                    .pose
                    .is_none_or(|previous| previous.landblock_id != pos.landblock_id)
                {
                    println!("CELL {}", serde_json::to_string(&pos)?);
                }
                self.pose = Some(pos);
            }
            ClientViewEvent::ForcedReposition {
                guid,
                pos,
                sequence,
            } if guid == self.player => {
                println!(
                    "CORRECTION sequence={sequence} {}",
                    serde_json::to_string(&pos)?
                );
                self.pose = Some(pos);
            }
            ClientViewEvent::TeleportStarted { sequence } => {
                println!("TELEPORT sequence={sequence}")
            }
            ClientViewEvent::ServerMessage { message, .. } => println!("SERVER {message}"),
            _ => {}
        }
        Ok(())
    }
}

async fn receive(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    deadline: Instant,
) -> Result<ClientViewEvent> {
    timeout_at(deadline, events.recv())
        .await
        .context("probe phase timed out")?
        .context("probe lost client events")
}

fn teleport(commands: &mpsc::UnboundedSender<ClientCommand>, pose: WorldPosition) -> Result<()> {
    commands
        .send(ClientCommand::Talk(format!(
            "@teleloc 0x{:08X} {} {} {} {} {} {} {}",
            pose.landblock_id.0,
            pose.coords.x,
            pose.coords.y,
            pose.coords.z,
            pose.rotation.w,
            pose.rotation.x,
            pose.rotation.y,
            pose.rotation.z,
        )))
        .context("runtime stopped before diagnostic teleport")
}

async fn drain_for(
    events: &mut broadcast::Receiver<ClientViewEvent>,
    observed: &mut Observations,
    duration: Duration,
) -> Result<()> {
    let deadline = Instant::now() + duration;
    loop {
        match timeout_at(deadline, events.recv()).await {
            Ok(event) => observed.observe(event.context("probe lost client events")?)?,
            Err(_) => return Ok(()),
        }
    }
}

async fn run_route(
    commands: &mpsc::UnboundedSender<ClientCommand>,
    events: &mut broadcast::Receiver<ClientViewEvent>,
    observed: &mut Observations,
    route: &Route,
) -> Result<()> {
    teleport(commands, route.start)?;
    drain_for(events, observed, Duration::from_secs(4)).await?;
    let pose = observed.pose.context("no pose after start teleport")?;
    ensure!(
        observed.in_world
            && pose.landblock_id == route.start.landblock_id
            && pose.distance_to(&route.start) < 0.05,
        "start teleport did not activate at requested pose"
    );
    commands.send(ClientCommand::Talk("@myloc".into()))?;
    let direction = route.target.coords - route.start.coords;
    ensure!(direction.length() > 0.0, "route has no travel");
    let delta = direction * (0.2 / direction.length());
    let deadline = Instant::now() + Duration::from_secs(40);
    let mut interval = tokio::time::interval(Duration::from_millis(50));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut acquire = true;
    loop {
        if Instant::now() >= deadline {
            bail!(
                "production navigation did not reach target; last pose {:?}",
                observed.pose
            );
        }
        tokio::select! {
            event = events.recv() => observed.observe(event.context("probe lost client events")?)?,
            _ = interval.tick() => {
                let pose = observed.pose.context("lost local pose")?;
                if pose.distance_to(&route.target) < 0.05 {
                    ensure!(pose.landblock_id == route.target.landblock_id, "target reached with unexpected cell");
                    commands.send(ClientCommand::DriveSelf(PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Settle)))?;
                    println!("ARRIVED {}", serde_json::to_string(&pose)?);
                    break;
                }
                let intent = AutonomousDriveIntent { desired_world_delta: delta, desired_heading: None, target_hint: Some(route.target), gait: Gait::Run, force_grounded: false };
                let command = if acquire { ClientDirectedCommand::Acquire(intent) } else { ClientDirectedCommand::Update(intent) };
                acquire = false;
                commands.send(ClientCommand::DriveSelf(PlayerDriveIntent::ClientDirected(command)))?;
            }
        }
    }
    drain_for(events, observed, Duration::from_secs(1)).await?;
    commands.send(ClientCommand::Talk("@myloc".into()))?;
    drain_for(events, observed, Duration::from_secs(1)).await
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    let arguments = Arguments::parse();
    let route: Route = serde_json::from_slice(&std::fs::read(arguments.route)?)?;
    ensure!(
        route.start.landblock_id.0 >> 16 == route.target.landblock_id.0 >> 16,
        "probe route must stay within one owner"
    );
    let account = std::env::var("HOLTBURGER_PROBE_ACCOUNT").context("missing probe account")?;
    let password = std::env::var("HOLTBURGER_PROBE_PASSWORD").context("missing probe password")?;
    let bootstrap_path = arguments
        .bootstrap
        .unwrap_or_else(|| arguments.content.join(BOOTSTRAP_FILE));
    let bootstrap = Arc::new(ContentRepository::from_hba_path(bootstrap_path)?);
    let navigation = Arc::new(PreparedNavigationSource::new(
        Arc::clone(&bootstrap),
        NavigationSceneSource::new(NavigationArchive::open(
            arguments.content.join(NAVIGATION_FILE),
        )?),
    ));
    let mut builder = ClientRuntimeBuilder::new(account)
        .server("127.0.0.1", 9000)
        .navigation_movement_source(navigation.clone(), navigation);
    builder.load_assets(&bootstrap)?;
    let mut client = builder.connect().await?;
    let mut events = client.subscribe_client_view_events();
    let (commands, rx) = mpsc::unbounded_channel();
    client.set_command_rx(rx);
    let task = tokio::spawn(async move { client.run().await });
    commands.send(ClientCommand::Login(password))?;
    let player = Guid(arguments.character);
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let ClientViewEvent::LifecycleChanged(ClientLifecycleState::CharacterSelection {
            characters,
            ..
        }) = receive(&mut events, deadline).await?
        {
            ensure!(
                characters
                    .iter()
                    .any(|entry| entry.guid == player && entry.delete_time == 0),
                "requested character not selectable"
            );
            break;
        }
    }
    commands.send(ClientCommand::SelectCharacter(player))?;
    let mut observed = Observations {
        player,
        pose: None,
        in_world: false,
    };
    let deadline = Instant::now() + Duration::from_secs(30);
    while !observed.in_world {
        observed.observe(receive(&mut events, deadline).await?)?;
    }
    commands.send(ClientCommand::RequestCurrentApplicationState)?;
    drain_for(&mut events, &mut observed, Duration::from_secs(1)).await?;
    let original = observed.pose.context("no canonical initial pose")?;
    println!("ORIGINAL {}", serde_json::to_string(&original)?);
    let result = run_route(&commands, &mut events, &mut observed, &route).await;
    commands.send(ClientCommand::DriveSelf(PlayerDriveIntent::ClientDirected(
        ClientDirectedCommand::Release,
    )))?;
    teleport(&commands, original)?;
    drain_for(&mut events, &mut observed, Duration::from_secs(4)).await?;
    commands.send(ClientCommand::Talk("@myloc".into()))?;
    drain_for(&mut events, &mut observed, Duration::from_secs(1)).await?;
    commands.send(ClientCommand::Disconnect)?;
    timeout_at(Instant::now() + Duration::from_secs(3), task)
        .await
        .context("runtime disconnect timed out")???;
    let restored = observed.pose.context("no restored pose")?;
    ensure!(
        restored.landblock_id == original.landblock_id && restored.distance_to(&original) < 0.05,
        "original pose was not restored"
    );
    result?;
    println!("PASS production navigation route and authoritative restoration");
    Ok(())
}

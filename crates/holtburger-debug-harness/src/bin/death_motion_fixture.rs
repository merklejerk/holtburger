//! Produce browser evidence from real content and production ObjectCreate/UpdateMotion handling.

use anyhow::{Context, Result, ensure};
use clap::Parser;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_content::{ContentRepository, SoulEmoteCatalog};
use holtburger_core::DynamicEntityMotion;
use holtburger_protocol::messages::GameMessage;
use holtburger_protocol::messages::movement::messages::motion::MovementInvalid;
use holtburger_protocol::messages::movement::{
    InterpretedMotionCommand, InterpretedMotionState, MotionStance, MovementEventData,
    MovementStateFlags, MovementType, MovementTypeData,
};
use holtburger_protocol::messages::object::messages::description::ObjectDescriptionData;
use holtburger_protocol::traits::ProtocolPack;
use holtburger_world::{WorldBootstrap, WorldState};
use serde::Serialize;
use std::{sync::Arc, time::Duration};

/// Command-line archive source and evidence artifact destination.
#[derive(Parser)]
struct Args {
    /// Directory containing client archives.
    #[arg(long)]
    content: Option<std::path::PathBuf>,
    /// MessagePack artifact consumed by the browser harness.
    #[arg(long)]
    output: std::path::PathBuf,
}

/// One production-world presentation level at a known lifecycle boundary.
#[derive(Serialize)]
struct Sample {
    /// Screenshot suffix and scenario label.
    label: &'static str,
    /// Entity identity, changed when ACE replaces the mob with a corpse.
    guid: u32,
    /// Production frontend motion projection, without diagnostic pose substitution.
    motion: DynamicEntityMotion,
    /// Browser delay after applying this level, allowing its own playback to advance.
    wait_ms: u32,
    /// Re-realize an existing corpse to test late observation.
    fresh: bool,
}

fn movement(command: InterpretedMotionCommand) -> MovementInvalid {
    MovementInvalid {
        state: InterpretedMotionState {
            flags: MovementStateFlags::FORWARD_COMMAND,
            forward_command: Some(command),
            ..Default::default()
        },
        sticky_object: None,
    }
}

fn create(guid: Guid, command: InterpretedMotionCommand) -> GameMessage {
    let mut data = ObjectDescriptionData::with_guid(guid);
    data.public_weenie_desc.name = Some("Drudge Prowler".into());
    data.public_weenie_desc.wcid = 192;
    data.csetup_id = Some(0x0200_07dd);
    data.mtable_id = Some(0x0900_0008);
    data.pos = Some(WorldPosition {
        landblock_id: Guid(0xda55_ffff),
        coords: Vector3::new(12.0, 12.0, 0.0),
        ..Default::default()
    });
    let mut bytes = vec![MovementType::Invalid as u8, 0];
    MotionStance::NonCombat.interpreted().pack(&mut bytes);
    movement(command).pack(&mut bytes);
    data.movement_data = Some(bytes);
    GameMessage::ObjectCreate(Box::new(data))
}

fn update(guid: Guid, sequence: u16, command: InterpretedMotionCommand) -> GameMessage {
    GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid,
        object_instance_sequence: 0,
        movement_sequence: sequence,
        server_control_sequence: 0,
        is_autonomous: false,
        movement_type: MovementType::Invalid,
        motion_flags: 0,
        current_style: MotionStance::NonCombat.interpreted(),
        data: MovementTypeData::Invalid(movement(command)),
    }))
}

fn capture(
    world: &WorldState,
    guid: Guid,
    label: &'static str,
    wait_ms: u32,
    fresh: bool,
) -> Result<Sample> {
    let motion = world
        .motion_runtimes
        .motion_presentation(guid)
        .context("world produced no motion")?;
    println!("{label}: {motion:?}");
    Ok(Sample {
        label,
        guid: guid.0,
        motion: motion.into(),
        wait_ms,
        fresh,
    })
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content)?;
    let bootstrap = WorldBootstrap::new(
        content.read_asset("skills")?,
        content.read_asset("spells")?,
        content.read_asset("xp")?,
        content.read_motion_sequence_catalog()?,
        SoulEmoteCatalog::default(),
    );
    let mut world = WorldState::new(Arc::new(bootstrap));
    let mob = Guid(0x7000_0001);
    let corpse = Guid(0x7000_0002);
    world.handle_message(&create(mob, InterpretedMotionCommand(3)));
    let mut samples = vec![capture(&world, mob, "alive", 100, false)?];
    // Twitch1 is an action route present in the Drudge noncombat table.
    world.handle_message(&update(mob, 1, InterpretedMotionCommand(0x51)));
    ensure!(
        world.motion_runtimes.has_actions(mob),
        "fixture action was not admitted"
    );
    samples.push(capture(&world, mob, "action", 100, false)?);
    world.handle_message(&update(mob, 2, InterpretedMotionCommand::DEAD));
    ensure!(
        !world.motion_runtimes.has_actions(mob),
        "death retained the previous action"
    );
    samples.push(capture(&world, mob, "death-start", 100, false)?);
    world.advance_authored_motion(Duration::from_millis(500));
    samples.push(capture(&world, mob, "death-midpoint", 400, false)?);
    world.advance_authored_motion(Duration::from_secs(2));
    samples.push(capture(&world, mob, "death-end", 1500, false)?);
    world.handle_message(&create(corpse, InterpretedMotionCommand::DEAD));
    world.remove_entity(mob);
    samples.push(capture(&world, corpse, "corpse", 100, false)?);
    world.advance_authored_motion(Duration::from_secs(2));
    samples.push(capture(&world, corpse, "late-corpse", 100, true)?);
    std::fs::write(args.output, rmp_serde::to_vec_named(&samples)?)?;
    Ok(())
}

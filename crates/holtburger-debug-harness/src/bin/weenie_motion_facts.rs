//! What is one weenie, actually? Template physics, setup, and default-animation root facts.
//!
//! Written to check the "Bats" divergence (WCID 36449), whose description had been reasoned from
//! the animation side alone and turned out wrong about scenery, translation, and collidability.
//! Takes any `--wcid`, because the same three questions came up again for the `SetOmega` carriers.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_common::properties::PhysicsState;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::{Animation, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_weenie_catalog::WeenieCatalog;
use std::io::Cursor;

#[derive(Parser)]
#[command(about = "Report the template and animation facts behind the Bats divergence")]
struct Args {
    #[arg(long, default_value = "dats/weenies.hwc")]
    catalog: std::path::PathBuf,
    #[arg(long)]
    content: Option<std::path::PathBuf>,
    #[arg(long, default_value_t = 36449)]
    wcid: u32,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let catalog = WeenieCatalog::open(&args.catalog).context("catalog open failed")?;
    let template = catalog
        .lookup(args.wcid)?
        .with_context(|| format!("wcid {} is not in the catalog", args.wcid))?;

    println!("wcid {}  class {:?}", template.wcid, template.class_name);
    println!("  name             {:?}", template.name);
    println!("  weenie_type      {}", template.weenie_type);
    println!(
        "  setup_did        {:?}",
        template.setup_did.map(|d| format!("0x{d:08X}"))
    );
    println!(
        "  motion_table_did {:?}",
        template.motion_table_did.map(|d| format!("0x{d:08X}"))
    );
    println!("  default_scale    {:?}", template.default_scale);

    let base = template.physics.base_mask.unwrap_or(0);
    let overrides = &template.physics.overrides;
    let bit = |mask: PhysicsState| base & mask.bits() != 0;
    let ethereal = overrides.ethereal.unwrap_or(bit(PhysicsState::ETHEREAL));
    let ignores = overrides
        .ignore_collisions
        .unwrap_or(bit(PhysicsState::IGNORE_COLLISIONS));
    let gravity = overrides.gravity.unwrap_or(bit(PhysicsState::GRAVITY));
    println!("  physics base     0x{base:08X}");
    println!(
        "    ethereal          {ethereal}   (override {:?})",
        overrides.ethereal
    );
    println!(
        "    ignore_collisions {ignores}   (override {:?})",
        overrides.ignore_collisions
    );
    println!(
        "    gravity           {gravity}   (override {:?})",
        overrides.gravity
    );
    println!("    static bit        {}", bit(PhysicsState::STATIC));
    println!(
        "    report_collisions {}",
        bit(PhysicsState::REPORT_COLLISIONS)
    );

    let Some(setup_did) = template.setup_did else {
        println!("\nno setup; nothing further to report");
        return Ok(());
    };
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let read = |id: u32| -> Result<Vec<u8>> {
        Ok(content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, id))
            .with_context(|| format!("read 0x{id:08X}"))?
            .bytes)
    };
    let setup = SetupModel::read(&mut Cursor::new(&read(setup_did)?))?;
    println!("\nsetup 0x{setup_did:08X}");
    println!("  parts             {}", setup.parts.len());
    println!(
        "  default_animation {:?}",
        setup.default_animation.map(|d| format!("0x{d:08X}"))
    );
    println!(
        "  default_script    {:?}",
        setup.default_script.map(|d| format!("0x{d:08X}"))
    );
    println!(
        "  default_mtable    {:?}",
        setup.default_motion_table.map(|d| format!("0x{d:08X}"))
    );

    let Some(animation_id) = setup.default_animation else {
        println!("\nsetup declares no default animation");
        return Ok(());
    };
    let animation = Animation::read(&mut Cursor::new(&read(animation_id)?))?;
    println!("\ndefault animation 0x{animation_id:08X}");
    println!("  frames      {}", animation.num_frames);
    println!("  parts       {}", animation.num_parts);
    println!("  pos_frames  {}", animation.pos_frames.len());

    let mut max_translation = 0.0f32;
    let mut max_tilt = 0.0f32;
    let mut max_yaw_component = 0.0f32;
    let mut min_w = 1.0f32;
    let mut identity_frames = 0usize;
    for frame in &animation.pos_frames {
        max_translation = max_translation.max(frame.origin.length());
        let q = frame.orientation;
        max_tilt = max_tilt.max(q.x.abs().max(q.y.abs()));
        max_yaw_component = max_yaw_component.max(q.z.abs());
        min_w = min_w.min(q.w.abs());
        if frame.origin.length() == 0.0 && q.z.abs() == 0.0 && (q.w.abs() - 1.0).abs() < 1e-6 {
            identity_frames += 1;
        }
    }
    println!("  max |origin|          {max_translation}");
    println!("  max |qx| or |qy|      {max_tilt}  (non-zero means a non-yaw tilt)");
    println!("  max |qz|              {max_yaw_component}  (non-zero means real yaw)");
    println!("  min |qw|              {min_w}");
    println!(
        "  identity frames       {identity_frames} of {}",
        animation.pos_frames.len()
    );

    Ok(())
}

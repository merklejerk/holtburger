//! Measures the real emitted bundle when every archive profile carries the complete motion
//! representation, rather than trusting the analytical byte model.
//!
//! Builds a candidate micro archive from an existing micro bundle plus all motion tables, all
//! setup models, and every table-referenced animation pruned to simulation facts, using the same
//! writer and compression the real tool uses.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::{Animation, MotionTable, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, HbaReader, HbaStreamWriter, ResourceKey};
use std::collections::BTreeSet;
use std::io::Cursor;
use std::path::PathBuf;

const SETUP_MODEL_TYPE: u32 = 0x02;
const ANIMATION_TYPE: u32 = 0x03;
const MOTION_TABLE_TYPE: u32 = 0x09;

#[derive(Parser)]
#[command(about = "Measure the emitted micro bundle with complete motion content")]
struct Args {
    /// Existing micro bundle whose entries seed the candidate archive.
    #[arg(long)]
    micro: PathBuf,
    /// Directory the candidate archives are written to.
    #[arg(long)]
    out_dir: PathBuf,
    #[arg(long)]
    content: Option<PathBuf>,
}

/// One emitted candidate, so the marginal cost of each content class is visible.
struct Candidate {
    label: &'static str,
    include_setup_models: bool,
    prune_animations: bool,
}

const CANDIDATES: [Candidate; 3] = [
    Candidate {
        label: "micro + tables + pruned animations",
        include_setup_models: false,
        prune_animations: true,
    },
    Candidate {
        label: "micro + tables + pruned animations + setups",
        include_setup_models: true,
        prune_animations: true,
    },
    Candidate {
        label: "micro + tables + UNPRUNED animations + setups",
        include_setup_models: true,
        prune_animations: false,
    },
];

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    std::fs::create_dir_all(&args.out_dir).context("output directory")?;

    let index: Vec<_> = content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_PORTAL_NAMESPACE)
        .cloned()
        .collect();
    let ids_of = |type_id: u32| -> Vec<u32> {
        let mut ids: Vec<u32> = index
            .iter()
            .filter(|entry| entry.type_id == type_id)
            .map(|entry| entry.file_id)
            .collect();
        ids.sort_unstable();
        ids
    };
    let read = |file_id: u32| -> Result<Vec<u8>> {
        Ok(content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, file_id))?
            .bytes)
    };

    let motion_table_ids = ids_of(MOTION_TABLE_TYPE);
    let setup_ids = ids_of(SETUP_MODEL_TYPE);
    let animation_ids: BTreeSet<u32> = ids_of(ANIMATION_TYPE).into_iter().collect();

    let mut referenced: BTreeSet<u32> = BTreeSet::new();
    let mut table_bytes = 0usize;
    for id in &motion_table_ids {
        let bytes = read(*id)?;
        table_bytes += bytes.len();
        let table = MotionTable::read(&mut Cursor::new(bytes))
            .with_context(|| format!("decode motion table 0x{id:08X}"))?;
        let linked = table.links.values().flat_map(|links| links.values());
        for motion_data in table
            .cycles
            .values()
            .chain(table.modifiers.values())
            .chain(linked)
        {
            referenced.extend(motion_data.anims.iter().map(|anim| anim.anim_id));
        }
    }

    let mut raw_animation_bytes = 0usize;
    let mut pruned_animation_bytes = 0usize;
    let mut pruned_animations: Vec<(u32, Vec<u8>)> = Vec::with_capacity(referenced.len());
    let mut raw_animations: Vec<(u32, Vec<u8>)> = Vec::with_capacity(referenced.len());
    for id in &referenced {
        anyhow::ensure!(
            animation_ids.contains(id),
            "animation 0x{id:08X} is referenced but absent from the archive"
        );
        let bytes = read(*id)?;
        raw_animation_bytes += bytes.len();

        let mut animation = Animation::read(&mut Cursor::new(bytes.clone()))
            .with_context(|| format!("decode animation 0x{id:08X}"))?;
        animation.prune_to_simulation_facts();
        let mut pruned = Vec::new();
        animation
            .write(&mut Cursor::new(&mut pruned))
            .with_context(|| format!("re-emit animation 0x{id:08X}"))?;

        // A pruned record must still decode, or the profile ships bytes no client can read.
        Animation::read(&mut Cursor::new(pruned.clone()))
            .with_context(|| format!("re-read pruned animation 0x{id:08X}"))?;

        pruned_animation_bytes += pruned.len();
        pruned_animations.push((*id, pruned));
        raw_animations.push((*id, bytes));
    }

    let mut setup_bytes = 0usize;
    let mut setups: Vec<(u32, Vec<u8>)> = Vec::with_capacity(setup_ids.len());
    for id in &setup_ids {
        let bytes = read(*id)?;
        // Small profiles prune setups the way `dat2hba` already does, so this measures the form
        // they would actually ship in rather than the full-profile form.
        let mut setup = SetupModel::unpack(&mut Cursor::new(&bytes))
            .with_context(|| format!("decode setup 0x{id:08X}"))?;
        setup.prune();
        let mut pruned = Vec::new();
        setup
            .pack(&mut Cursor::new(&mut pruned))
            .with_context(|| format!("re-emit setup 0x{id:08X}"))?;
        setup_bytes += pruned.len();
        setups.push((*id, pruned));
    }

    println!("uncompressed source bytes");
    println!(
        "  {} motion tables:            {:.2} MB",
        motion_table_ids.len(),
        table_bytes as f64 / 1_048_576.0
    );
    println!(
        "  {} referenced animations raw: {:.2} MB",
        referenced.len(),
        raw_animation_bytes as f64 / 1_048_576.0
    );
    println!(
        "  the same animations pruned:   {:.2} MB",
        pruned_animation_bytes as f64 / 1_048_576.0
    );
    println!(
        "  {} setup models (pruned form): {:.2} MB",
        setup_ids.len(),
        setup_bytes as f64 / 1_048_576.0
    );
    println!();

    let baseline = std::fs::metadata(&args.micro)?.len();
    println!("baseline micro bundle: {baseline} bytes");

    for candidate in &CANDIDATES {
        let path = args
            .out_dir
            .join(format!("{}.hba", candidate.label.replace(' ', "_")));
        let mut writer = HbaStreamWriter::create(&path)?;
        writer.set_compression(true);

        let source = HbaReader::open(&args.micro)?;
        for entry in source.entries() {
            let entry = entry?;
            let namespace = entry.namespace_id()?;
            let bytes = source.get_file_in_namespace(namespace.as_str(), entry.file_id)?;
            if entry.is_pruned() {
                writer.add_pruned(namespace.as_str(), entry.file_id, entry.type_id, bytes)?;
            } else {
                writer.add(namespace.as_str(), entry.file_id, entry.type_id, bytes)?;
            }
        }

        for id in &motion_table_ids {
            writer.add(EOR_PORTAL_NAMESPACE, *id, MOTION_TABLE_TYPE, read(*id)?)?;
        }
        let animations = if candidate.prune_animations {
            &pruned_animations
        } else {
            &raw_animations
        };
        for (id, bytes) in animations {
            if candidate.prune_animations {
                writer.add_pruned(EOR_PORTAL_NAMESPACE, *id, ANIMATION_TYPE, bytes.clone())?;
            } else {
                writer.add(EOR_PORTAL_NAMESPACE, *id, ANIMATION_TYPE, bytes.clone())?;
            }
        }
        if candidate.include_setup_models {
            for (id, bytes) in &setups {
                writer.add_pruned(EOR_PORTAL_NAMESPACE, *id, SETUP_MODEL_TYPE, bytes.clone())?;
            }
        }
        writer.finish()?;

        let size = std::fs::metadata(&path)?.len();
        println!(
            "  {:<48} {:>9} bytes ({:.2} MB, +{:.2} MB over baseline)",
            candidate.label,
            size,
            size as f64 / 1_048_576.0,
            (size - baseline) as f64 / 1_048_576.0
        );
    }

    Ok(())
}

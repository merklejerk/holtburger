use anyhow::{Context, Result};
use clap::Parser;
use holtburger_dat::{DatDatabase, DatFileType, HbaWriter};
use indicatif::{ProgressBar, ProgressStyle};
use std::path::{Path, PathBuf};

#[derive(Parser, Debug)]
#[command(author, version, about = "Strips Asheron's Call DAT files into Lite HBA archives")]
struct Args {
    /// Path to the retail DAT file to process
    input: PathBuf,

    /// Path to the output HBA archive
    output: PathBuf,
}

fn should_keep(id: u32) -> bool {
    let file_type = DatFileType::from_id(id);
    match file_type {
        DatFileType::Model
        | DatFileType::SetupModel
        | DatFileType::Animation
        | DatFileType::AnimationDone
        | DatFileType::EnvCell
        | DatFileType::Table
        | DatFileType::Region
        | DatFileType::CombatTable
        | DatFileType::PhysicsScript
        | DatFileType::PhysicsScriptTable
        | DatFileType::LanguageString
        | DatFileType::Landblock
        | DatFileType::LandblockInfo
        | DatFileType::IndoorCell => true,

        DatFileType::Texture
        | DatFileType::SurfaceTexture
        | DatFileType::Audio
        | DatFileType::Palette
        | DatFileType::Surface
        | DatFileType::Clothing
        | DatFileType::Scene
        | DatFileType::Font
        | DatFileType::Unknown => false,
    }
}

fn process_dat(input_path: &Path, output_path: &Path) -> Result<()> {
    println!("Processing {:?} -> {:?}", input_path, output_path);
    
    let db = DatDatabase::new(input_path)?;
    let mut writer = HbaWriter::new();
    writer.set_compression(true);

    let pb = ProgressBar::new(db.files.len() as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta}) {msg}")?
            .progress_chars("#>-"),
    );

    let mut kept_count = 0;
    for &id in db.files.keys() {
        if should_keep(id) {
            let data = db.get_file(id)?;
            writer.add(id, (id >> 24) as u32, data);
            kept_count += 1;
        }
        pb.inc(1);
    }
    pb.finish_with_message(format!("Done! Kept {}/{} files.", kept_count, db.files.len()));

    writer.write(output_path)?;
    Ok(())
}

fn main() -> Result<()> {
    env_logger::init();
    let args = Args::parse();

    println!("🎨 holtburger-tools: starting the glow-up...");
    
    if let Some(parent) = args.output.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).context("Failed to create output directory")?;
        }
    }

    process_dat(&args.input, &args.output)?;

    println!("✨ Glow-up complete! Lite archive generated at {:?}", args.output);
    
    Ok(())
}

use anyhow::Result;
use clap::{Parser, Subcommand};
use holtburger_core::dat::DatDatabase;
use std::path::PathBuf;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[arg(short, long, value_name = "FILE")]
    dat: PathBuf,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List all files in the DAT
    List,
    /// Get info about a specific file ID
    Info {
        #[arg(value_name = "ID")]
        id: String,
    },
    /// Export a file to disk
    Export {
        #[arg(value_name = "ID")]
        id: String,
        #[arg(short, long, value_name = "OUT")]
        output: Option<PathBuf>,
    },
    /// Extract a file to its native format if possible
    Extract {
        #[arg(value_name = "ID")]
        id: String,
        #[arg(short, long, value_name = "OUT")]
        output: Option<PathBuf>,
    },
    /// Inspect a Weenie template
    Weenie {
        #[arg(value_name = "ID")]
        id: String,
    },
    /// Inspect a Landblock
    Landblock {
        #[arg(value_name = "ID")]
        id: String,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    println!("Loading DAT: {:?}", cli.dat);
    let db = DatDatabase::new(cli.dat)?;
    println!("Loaded DAT with {} files.", db.files.len());

    match cli.command {
        Commands::List => {
            let mut ids: Vec<_> = db.files.keys().collect();
            ids.sort();
            for id in ids {
                let entry = &db.files[id];
                println!(
                    "{:08X} - {:<25} - Size: {:<10} - Offset: {:08X} - Flags: {:08X}",
                    id,
                    entry.file_type().to_string(),
                    entry.size,
                    entry.offset,
                    entry.bit_flags
                );
            }
        }
        Commands::Info { id } => {
            let id_val = u32::from_str_radix(id.trim_start_matches("0x"), 16)?;
            if let Some(entry) = db.files.get(&id_val) {
                println!("File ID: {:08X}", entry.id);
                println!("Type:    {}", entry.file_type());
                println!("Size:    {}", entry.size);
                println!("Offset:  {:08X}", entry.offset);
                println!("Flags:   {:08X}", entry.bit_flags);
            } else {
                println!("File ID {:08X} not found.", id_val);
            }
        }
        Commands::Export { id, output } => {
            let id_val = u32::from_str_radix(id.trim_start_matches("0x"), 16)?;
            let data = db.get_file(id_val)?;
            let out_path = output.unwrap_or_else(|| PathBuf::from(format!("{:08X}.bin", id_val)));
            std::fs::write(&out_path, data)?;
            println!("Exported {:08X} to {:?}", id_val, out_path);
        }
        Commands::Extract { id, output } => {
            let id_val = u32::from_str_radix(id.trim_start_matches("0x"), 16)?;
            let data = db.get_file(id_val)?;

            match id_val >> 24 {
                0x06 => {
                    // Texture
                    // Header is 24 bytes for most textures
                    let format = u32::from_le_bytes(data[16..20].try_into().unwrap());
                    if format == 500 {
                        // JPEG
                        let out_path =
                            output.unwrap_or_else(|| PathBuf::from(format!("{:08X}.jpg", id_val)));
                        std::fs::write(&out_path, &data[24..])?;
                        println!("Extracted JPEG texture {:08X} to {:?}", id_val, out_path);
                    } else {
                        println!(
                            "Texture {:08X} is not a JPEG (Format {}), exporting as .bin",
                            id_val, format
                        );
                        let out_path =
                            output.unwrap_or_else(|| PathBuf::from(format!("{:08X}.bin", id_val)));
                        std::fs::write(&out_path, data)?;
                    }
                }
                0x0A => {
                    // Wave
                    let format_size = 18;
                    let out_path =
                        output.unwrap_or_else(|| PathBuf::from(format!("{:08X}.wav", id_val)));

                    // Simple RIFF WAV header
                    let mut wav = Vec::new();
                    let data_size = data.len() - 12 - format_size;
                    wav.extend_from_slice(b"RIFF");
                    wav.extend_from_slice(&((36 + data_size) as u32).to_le_bytes());
                    wav.extend_from_slice(b"WAVEfmt ");
                    wav.extend_from_slice(&(16u32).to_le_bytes()); // Chunk size
                    wav.extend_from_slice(&data[12..28]); // WAVEFORMAT (subset of WAVEFORMATEX)
                    wav.extend_from_slice(b"data");
                    wav.extend_from_slice(&(data_size as u32).to_le_bytes());
                    wav.extend_from_slice(&data[30..]);

                    std::fs::write(&out_path, wav)?;
                    println!("Extracted WAV audio {:08X} to {:?}", id_val, out_path);
                }
                0x01 => {
                    // Model
                    println!(
                        "Model {:08X} (GraphicsObject) exported as .bin (AC custom format)",
                        id_val
                    );
                    let out_path =
                        output.unwrap_or_else(|| PathBuf::from(format!("{:08X}.bin", id_val)));
                    std::fs::write(&out_path, data)?;
                }
                _ => {
                    println!(
                        "No extraction specialist for type {:02X}, exporting raw .bin",
                        id_val >> 24
                    );
                    let out_path =
                        output.unwrap_or_else(|| PathBuf::from(format!("{:08X}.bin", id_val)));
                    std::fs::write(&out_path, data)?;
                }
            }
        }
        Commands::Weenie { id } => {
            let id_val = u32::from_str_radix(id.trim_start_matches("0x"), 16)?;
            let data = db.get_file(id_val)?;
            let weenie = holtburger_core::dat::weenie::Weenie::unpack(&data)?;
            println!("Weenie Class ID: {:08X}", weenie.wcid);
            println!("Weenie Type:     {}", weenie.weenie_type);
            if let Some(name) = weenie.name() {
                println!("Name:            {}", name);
            }
            if let Some(icon) = weenie.icon_id() {
                println!("Icon ID:         {:08X}", icon);
            }
            println!("Properties (Int):    {}", weenie.properties_int.len());
            println!("Properties (Float):  {}", weenie.properties_float.len());
            println!("Properties (String): {}", weenie.properties_string.len());
            println!("Properties (DID):    {}", weenie.properties_did.len());
        }
        Commands::Landblock { id } => {
            let mut id_val = u32::from_str_radix(id.trim_start_matches("0x"), 16)?;

            // Auto-fix ID if they passed base landblock ID
            if id_val & 0xFFFF == 0 {
                id_val |= 0xFFFF;
            }

            let terrain_data = db.get_file(id_val)?;
            let lb = holtburger_core::dat::landblock::CellLandblock::unpack(&terrain_data)?;
            println!("Landblock ID:   {:08X}", lb.id);
            println!("Has Objects:     {}", lb.has_objects != 0);
            println!("Terrain Vertices: {}", lb.terrain.len());
            println!("Height Vertices:  {}", lb.height.len());

            println!("\nHeightmap (9x9):");
            for y in (0..9).rev() {
                for x in 0..9 {
                    print!("{:3} ", lb.height[x * 9 + y]);
                }
                println!();
            }

            let info_id = (id_val & 0xFFFF0000) | 0xFFFE;
            if let Ok(info_data) = db.get_file(info_id) {
                let info = holtburger_core::dat::landblock::LandblockInfo::unpack(&info_data)?;
                println!("\nLandblock Info ({:08X}):", info_id);
                println!("Objects:   {}", info.objects.len());
                println!("Buildings: {}", info.buildings.len());
                for b in &info.buildings {
                    println!(
                        "  Building model: {:08X} at {:?}",
                        b.model_id, b.frame.origin
                    );
                }
            }
        }
    }

    Ok(())
}

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use holtburger_dat::{DatDatabase, DatFileType, HbaReader, HbaWriter, ResourceProvider};
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

enum Provider {
    Dat(DatDatabase),
    Hba(HbaReader),
}

impl Provider {
    fn open(path: &Path) -> Result<Self> {
        match path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref()
        {
            Some("hba") => Ok(Self::Hba(HbaReader::open(path)?)),
            Some("dat") => Ok(Self::Dat(DatDatabase::new(path)?)),
            _ => {
                let hba_path = path.with_extension("hba");
                if hba_path.exists() {
                    return Ok(Self::Hba(HbaReader::open(&hba_path)?));
                }

                let dat_path = path.with_extension("dat");
                if dat_path.exists() {
                    return Ok(Self::Dat(DatDatabase::new(&dat_path)?));
                }

                Err(anyhow::anyhow!(
                    "Could not open provider for {:?}. Expected .hba or .dat",
                    path
                ))
            }
        }
    }

    fn get_file(&self, id: u32) -> Result<Vec<u8>> {
        match self {
            Self::Dat(db) => Ok(db.get_file(id)?),
            Self::Hba(hba) => Ok(hba.get_file(id)?),
        }
    }

    fn list_ids(&self) -> Vec<u32> {
        let mut ids = match self {
            Self::Dat(db) => db.files.keys().copied().collect::<Vec<_>>(),
            Self::Hba(hba) => hba.entries().filter_map(|e| e.ok().map(|e| e.id)).collect(),
        };
        ids.sort();
        ids
    }

    fn kind_name(&self) -> &'static str {
        match self {
            Self::Dat(_) => "DAT",
            Self::Hba(_) => "HBA",
        }
    }

    fn file_count(&self) -> usize {
        match self {
            Self::Dat(db) => db.files.len(),
            Self::Hba(hba) => hba.header.entry_count as usize,
        }
    }

    fn print_info(&self, id: u32) {
        match self {
            Self::Dat(db) => {
                if let Some(entry) = db.files.get(&id) {
                    println!("File ID: {:08X}", entry.id);
                    println!("Type:    {}", entry.file_type());
                    println!("Size:    {}", entry.size);
                    println!("Offset:  {:08X}", entry.offset);
                    println!("Flags:   {:08X}", entry.bit_flags);
                } else {
                    println!("File ID {:08X} not found.", id);
                }
            }
            Self::Hba(hba) => {
                if let Ok(entry) = hba.find_entry(id) {
                    println!("File ID: {:08X}", entry.id);
                    println!("Type:    {}", DatFileType::from_id(entry.id));
                    println!("Size:    {}", entry.size);
                    println!("Offset:  {:08X}", entry.offset);
                    println!("Flags:   {:02X}", entry.flags);
                    println!("Pruned:  {}", entry.is_pruned());
                    println!("Compressed: {}", entry.is_compressed());
                } else {
                    println!("File ID {:08X} not found.", id);
                }
            }
        }
    }

    fn print_list_entry(&self, id: u32) {
        match self {
            Self::Dat(db) => {
                let entry = &db.files[&id];
                println!(
                    "{:08X} - {:<25} - Size: {:<10} - Offset: {:08X} - Flags: {:08X}",
                    id,
                    entry.file_type().to_string(),
                    entry.size,
                    entry.offset,
                    entry.bit_flags
                );
            }
            Self::Hba(hba) => {
                if let Ok(entry) = hba.find_entry(id) {
                    println!(
                        "{:08X} - {:<25} - Size: {:<10} - Offset: {:08X} - Flags: {:02X}",
                        id,
                        DatFileType::from_id(id).to_string(),
                        entry.size,
                        entry.offset,
                        entry.flags
                    );
                }
            }
        }
    }
}

fn parse_id_auto(raw: &str) -> Result<u32> {
    let trimmed = raw.trim();
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        return Ok(u32::from_str_radix(hex, 16)?);
    }

    if let Ok(v) = trimmed.parse::<u32>() {
        return Ok(v);
    }

    Ok(u32::from_str_radix(trimmed, 16)?)
}

#[derive(Subcommand)]
enum Commands {
    /// List meta info about the HBA/DAT file itself
    Meta {
        /// Path to the DAT or HBA file
        path: PathBuf,
    },
    /// List all files in the DAT
    List {
        /// Path to the DAT or HBA file
        path: PathBuf,
    },
    /// Get info about a specific file ID
    Info {
        /// Path to the DAT or HBA file
        path: PathBuf,
        #[arg(value_name = "ID")]
        id: String,
    },
    /// Export a file to disk
    Export {
        /// Path to the DAT or HBA file
        path: PathBuf,
        #[arg(value_name = "ID")]
        id: String,
        #[arg(short, long, value_name = "OUT")]
        output: Option<PathBuf>,
    },
    /// Extract a file to its native format if possible
    Extract {
        /// Path to the DAT or HBA file
        path: PathBuf,
        #[arg(value_name = "ID")]
        id: String,
        #[arg(short, long, value_name = "OUT")]
        output: Option<PathBuf>,
    },
    /// Inspect a Weenie template
    Weenie {
        /// Path to the DAT or HBA file
        path: PathBuf,
        #[arg(value_name = "ID")]
        id: String,
    },
    /// Scan table records for a WCID-based Weenie entry
    WeenieFind {
        /// Path to the DAT or HBA file
        path: PathBuf,
        #[arg(value_name = "WCID")]
        wcid: String,
    },
    /// Inspect a Landblock
    Landblock {
        /// Path to the DAT or HBA file
        path: PathBuf,
        #[arg(value_name = "ID")]
        id: String,
    },
    /// Pack a directory into an HBA archive
    HbaPack {
        /// Input directory containing files named [ID].[TYPE] (hex)
        input: PathBuf,
        /// Output HBA file
        output: PathBuf,
        /// Enable compression
        #[arg(short, long)]
        compress: bool,
    },
}

fn pack_hba(input: &Path, output: &Path, compress: bool) -> Result<()> {
    let mut writer = HbaWriter::new();
    writer.set_compression(compress);

    println!("Packing files from {:?} into {:?}", input, output);

    let mut count = 0;
    for entry in std::fs::read_dir(input).context("Failed to read input directory")? {
        let entry = entry?;
        let path = entry.path();

        if path.is_file() {
            let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let parts: Vec<&str> = filename.split('.').collect();

            if parts.len() == 2 {
                let id = u32::from_str_radix(parts[0], 16)
                    .with_context(|| format!("Invalid hex ID in filename: {}", filename))?;
                let type_id = u32::from_str_radix(parts[1], 16)
                    .with_context(|| format!("Invalid hex Type ID in filename: {}", filename))?;

                let data = std::fs::read(&path)?;
                writer.add(id, type_id, data)?;
                count += 1;
            } else {
                println!(
                    "Skipping {} (expected format: [ID].[TYPE] in hex)",
                    filename
                );
            }
        }
    }

    writer.write(output).context("Failed to write HBA file")?;
    println!("Successfully packed {} files into {:?}", count, output);
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::HbaPack {
            input,
            output,
            compress,
        } => pack_hba(&input, &output, compress),

        Commands::Meta { path } => {
            let provider = Provider::open(&path)?;
            println!(
                "Loaded {} provider with {} files.",
                provider.kind_name(),
                provider.file_count()
            );
            println!("--- Meta Information ---");
            println!("Provider:    {}", provider.kind_name());
            println!("File Count:  {}", provider.file_count());
            match &provider {
                Provider::Hba(hba) => {
                    println!("Version:     {}", hba.header.version);
                    println!("Index Offs:  0x{:08X}", hba.header.index_offset);
                    println!("Meta Size:   {}", hba.header.metadata_size);
                    println!("Profile:     0x{:02X}", hba.header.profile);
                }
                Provider::Dat(_db) => {
                    println!("Note: Detailed DAT meta not yet implemented.");
                }
            }
            Ok(())
        }
        Commands::List { path } => {
            let provider = Provider::open(&path)?;
            let ids = provider.list_ids();
            for id in ids {
                provider.print_list_entry(id);
            }
            Ok(())
        }
        Commands::Info { path, id } => {
            let provider = Provider::open(&path)?;
            let id_val = parse_id_auto(&id)?;
            provider.print_info(id_val);
            Ok(())
        }
        Commands::Export { path, id, output } => {
            let provider = Provider::open(&path)?;
            let id_val = parse_id_auto(&id)?;
            let data = provider.get_file(id_val)?;
            let out_path = output.unwrap_or_else(|| PathBuf::from(format!("{:08X}.bin", id_val)));
            std::fs::write(&out_path, data)?;
            println!("Exported {:08X} to {:?}", id_val, out_path);
            Ok(())
        }
        Commands::Extract { path, id, output } => {
            let provider = Provider::open(&path)?;
            let id_val = parse_id_auto(&id)?;
            let data = provider.get_file(id_val)?;

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
            Ok(())
        }
        Commands::Weenie { path, id } => {
            let provider = Provider::open(&path)?;
            let parsed = parse_id_auto(&id)?;
            let direct_ids = vec![parsed];

            let mut loaded = None;
            for file_id in &direct_ids {
                if let Some(weenie) = provider
                    .get_file(*file_id)
                    .ok()
                    .and_then(|data| holtburger_dat::weenie::Weenie::unpack(&data).ok())
                {
                    loaded = Some((*file_id, weenie));
                    break;
                }
            }

            if let Some((file_id, weenie)) = loaded {
                println!("File ID:         {:08X}", file_id);
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
            } else {
                println!("Could not decode a Weenie record from ID {:08X}.", parsed);
            }
            Ok(())
        }
        Commands::WeenieFind { path, wcid } => {
            let provider = Provider::open(&path)?;
            let target_wcid = parse_id_auto(&wcid)?;
            let candidate_ids: Vec<u32> = provider
                .list_ids()
                .into_iter()
                .filter(|id| (*id >> 24) == 0x0E)
                .collect();

            println!(
                "Scanning {} table files (0x0E prefix) for WCID {}...",
                candidate_ids.len(),
                target_wcid
            );

            let mut hits = 0usize;
            for file_id in candidate_ids {
                let Ok(data) = provider.get_file(file_id) else {
                    continue;
                };

                let Ok(table) = holtburger_dat::weenie::WeenieTable::unpack(&data) else {
                    continue;
                };

                if let Some(weenie) = table.entries.get(&target_wcid) {
                    hits += 1;
                    println!("Hit in table {:08X}", file_id);
                    println!("  Entry WCID: {:08X}", weenie.wcid);
                    println!("  WeenieType: {}", weenie.weenie_type);
                    if let Some(name) = weenie.name() {
                        println!("  Name: {}", name);
                    }
                }
            }

            if hits == 0 {
                println!(
                    "No WCID {} entries found in scan-able table files (0x0E range).",
                    target_wcid
                );
            }
            Ok(())
        }
        Commands::Landblock { path, id } => {
            let provider = Provider::open(&path)?;
            let mut id_val = parse_id_auto(&id)?;

            // Auto-fix ID if they passed base landblock ID
            if id_val & 0xFFFF == 0 {
                id_val |= 0xFFFF;
            }

            let terrain_data = provider.get_file(id_val)?;
            let lb = holtburger_dat::landblock::CellLandblock::unpack(&terrain_data)?;
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
            if let Ok(info_data) = provider.get_file(info_id) {
                let info = holtburger_dat::landblock::LandblockInfo::unpack(&info_data)?;
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
            Ok(())
        }
    }
}

use anyhow::{Context, Result};
use binrw::BinRead;
use clap::{Parser, Subcommand};
use holtburger_dat::archive::HbaEntry;
use holtburger_dat::{
    DatDatabase, DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaReader, HbaWriter,
    ResourceProvider,
};
use holtburger_tools::spell_export::{
    SpellExportField, SpellExportPreset, SpellExportRequest, SpellExportSchool, export_spell_table,
};
use std::collections::BTreeMap;
use std::fs;
use std::io::Cursor;
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

    fn get_file_in_namespace(&self, namespace: Option<&str>, id: u32) -> Result<Vec<u8>> {
        match self {
            Self::Dat(db) => Ok(db.get_file(id)?),
            Self::Hba(hba) => match namespace {
                Some(namespace) => Ok(hba.get_file_in_namespace(namespace, id)?),
                None => Ok(hba.get_file(id)?),
            },
        }
    }

    fn get_hba_entry(&self, namespace: Option<&str>, id: u32) -> Result<Option<HbaEntry>> {
        match self {
            Self::Dat(_) => Ok(None),
            Self::Hba(hba) => {
                let entry = match namespace {
                    Some(namespace) => hba.find_entry_in_namespace(namespace, id)?,
                    None => hba.find_entry(id)?,
                };
                Ok(Some(entry))
            }
        }
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
}

fn format_type_label(type_id: u32) -> String {
    let file_type = DatFileType::from_type_id(type_id);
    if file_type == DatFileType::Unknown {
        format!("Unknown (0x{:08X})", type_id)
    } else {
        format!("{} (0x{:08X})", file_type, type_id)
    }
}

fn sanitize_namespace_for_filename(namespace: &str) -> String {
    namespace
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' => '_',
            other => other,
        })
        .collect()
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

fn read_spell_table(
    provider: &Provider,
    namespace: Option<&str>,
) -> Result<holtburger_dat::file_type::SpellTable> {
    let bytes = provider
        .get_file_in_namespace(namespace, holtburger_dat::file_type::SpellTable::FILE_ID)?;
    let mut cursor = Cursor::new(bytes);
    Ok(holtburger_dat::file_type::SpellTable::read_le(&mut cursor)?)
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
        /// Namespace label for multi-namespace HBA archives
        #[arg(long)]
        namespace: Option<String>,
    },
    /// Export a file to disk
    Export {
        /// Path to the DAT or HBA file
        path: PathBuf,
        #[arg(value_name = "ID")]
        id: String,
        /// Namespace label for multi-namespace HBA archives
        #[arg(long)]
        namespace: Option<String>,
        #[arg(short, long, value_name = "OUT")]
        output: Option<PathBuf>,
    },
    /// Export the spell table to JSON
    SpellExport {
        /// Path to the DAT or HBA file
        path: PathBuf,
        /// Namespace label for multi-namespace HBA archives
        #[arg(long)]
        namespace: Option<String>,
        /// Spell schools to include in the export
        #[arg(long, value_enum, value_delimiter = ',')]
        schools: Vec<SpellExportSchool>,
        /// Spell category IDs to include in the export
        #[arg(long, value_delimiter = ',')]
        categories: Vec<u32>,
        /// Spell fields to include in the export
        #[arg(long, value_enum, value_delimiter = ',')]
        fields: Vec<SpellExportField>,
        /// Field preset to use when no explicit fields are provided
        #[arg(long, value_enum, default_value_t = SpellExportPreset::Base)]
        preset: SpellExportPreset,
        /// Output JSON file; prints to stdout when omitted
        #[arg(short, long, value_name = "OUT")]
        output: Option<PathBuf>,
    },
    /// Extract a file to its native format if possible
    Extract {
        /// Path to the DAT or HBA file
        path: PathBuf,
        #[arg(value_name = "ID")]
        id: String,
        /// Namespace label for multi-namespace HBA archives
        #[arg(long)]
        namespace: Option<String>,
        #[arg(short, long, value_name = "OUT")]
        output: Option<PathBuf>,
    },
    /// Inspect a Weenie template
    Weenie {
        /// Path to the DAT or HBA file
        path: PathBuf,
        #[arg(value_name = "ID")]
        id: String,
        /// Namespace label for multi-namespace HBA archives
        #[arg(long)]
        namespace: Option<String>,
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
        /// Namespace label for multi-namespace HBA archives
        #[arg(long)]
        namespace: Option<String>,
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
    let namespace = infer_single_dataset_namespace(output);

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
                writer.add(namespace, id, type_id, data)?;
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

fn infer_single_dataset_namespace(path: &Path) -> &'static str {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if stem.contains("cell") {
        EOR_CELL_NAMESPACE
    } else {
        EOR_PORTAL_NAMESPACE
    }
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
                    let mut counts = BTreeMap::new();
                    for entry in hba.entries() {
                        let entry = entry?;
                        let namespace = entry.namespace_id()?.to_string();
                        *counts.entry(namespace).or_insert(0usize) += 1;
                    }
                    println!("Namespaces:  {}", counts.len());
                    for (namespace, count) in counts {
                        println!("  {} -> {} entries", namespace, count);
                    }
                }
                Provider::Dat(db) => {
                    println!("Magic:       0x{:08X}", db.header.magic);
                    println!("Block Size:  {}", db.header.block_size);
                    println!("Dataset:     {}", db.header.dataset);
                    match db.retail_namespace_hint() {
                        Some(namespace) => println!("Namespace:   {}", namespace),
                        None => println!("Namespace:   <unknown retail dataset>"),
                    }
                }
            }
            Ok(())
        }
        Commands::List { path } => {
            let provider = Provider::open(&path)?;
            match &provider {
                Provider::Dat(db) => {
                    let mut ids = db.files.keys().copied().collect::<Vec<_>>();
                    ids.sort();
                    for id in ids {
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
                }
                Provider::Hba(hba) => {
                    for entry in hba.entries() {
                        let entry = entry?;
                        let namespace = entry.namespace_id()?;
                        println!(
                            "{}:{:08X} - {:<28} - Size: {:<10} - Offset: {:08X} - Flags: {:02X}",
                            namespace,
                            entry.file_id,
                            format_type_label(entry.type_id),
                            entry.size,
                            entry.offset,
                            entry.flags
                        );
                    }
                }
            }
            Ok(())
        }
        Commands::Info {
            path,
            id,
            namespace,
        } => {
            let provider = Provider::open(&path)?;
            let id_val = parse_id_auto(&id)?;
            match &provider {
                Provider::Dat(db) => {
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
                Provider::Hba(_) => {
                    let entry = provider
                        .get_hba_entry(namespace.as_deref(), id_val)?
                        .expect("HBA provider should return an entry or an error");
                    println!("Namespace: {}", entry.namespace_id()?);
                    println!("File ID:   {:08X}", entry.file_id);
                    println!("Type:      {}", format_type_label(entry.type_id));
                    println!("Size:      {}", entry.size);
                    println!("Offset:    {:08X}", entry.offset);
                    println!("Flags:     {:02X}", entry.flags);
                    println!("Pruned:    {}", entry.is_pruned());
                    println!("Compressed:{}", entry.is_compressed());
                }
            }
            Ok(())
        }
        Commands::Export {
            path,
            id,
            namespace,
            output,
        } => {
            let provider = Provider::open(&path)?;
            let id_val = parse_id_auto(&id)?;
            let data = provider.get_file_in_namespace(namespace.as_deref(), id_val)?;
            let out_path = output.unwrap_or_else(|| {
                match provider.get_hba_entry(namespace.as_deref(), id_val) {
                    Ok(Some(entry)) => PathBuf::from(format!(
                        "{}_{:08X}.bin",
                        sanitize_namespace_for_filename(
                            entry.namespace_id().expect("valid namespace").as_str()
                        ),
                        id_val
                    )),
                    _ => PathBuf::from(format!("{:08X}.bin", id_val)),
                }
            });
            std::fs::write(&out_path, data)?;
            println!("Exported {:08X} to {:?}", id_val, out_path);
            Ok(())
        }
        Commands::SpellExport {
            path,
            namespace,
            schools,
            categories,
            fields,
            preset,
            output,
        } => {
            let provider = Provider::open(&path)?;
            let spell_table = read_spell_table(&provider, namespace.as_deref())?;
            let request = SpellExportRequest {
                fields,
                preset,
                schools,
                categories,
            };
            let export = export_spell_table(&spell_table, &request);
            let serialized = serde_json::to_string_pretty(&export)
                .context("could not serialize spell export")?;

            if let Some(output) = output {
                if let Some(parent) = output.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("could not create {}", parent.display()))?;
                }

                fs::write(&output, format!("{serialized}\n"))
                    .with_context(|| format!("could not write {}", output.display()))?;
                println!(
                    "wrote {} spells with {} fields to {}",
                    export.spells.len(),
                    export.fields.len(),
                    output.display()
                );
            } else {
                println!("{serialized}");
            }

            Ok(())
        }
        Commands::Extract {
            path,
            id,
            namespace,
            output,
        } => {
            let provider = Provider::open(&path)?;
            let id_val = parse_id_auto(&id)?;
            let data = provider.get_file_in_namespace(namespace.as_deref(), id_val)?;

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
        Commands::Weenie {
            path,
            id,
            namespace,
        } => {
            let provider = Provider::open(&path)?;
            let parsed = parse_id_auto(&id)?;
            let direct_ids = vec![parsed];

            let mut loaded = None;
            for file_id in &direct_ids {
                if let Some(weenie) = provider
                    .get_file_in_namespace(namespace.as_deref(), *file_id)
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
                println!("Properties (Int):    {}", weenie.properties.ints.0.len());
                println!("Properties (Float):  {}", weenie.properties.floats.0.len());
                println!("Properties (String): {}", weenie.properties.strings.0.len());
                println!("Properties (DID):    {}", weenie.properties.dids.0.len());
            } else {
                println!("Could not decode a Weenie record from ID {:08X}.", parsed);
            }
            Ok(())
        }
        Commands::WeenieFind { path, wcid } => {
            let provider = Provider::open(&path)?;
            let target_wcid = parse_id_auto(&wcid)?;
            let candidate_entries: Vec<(Option<String>, u32)> = match &provider {
                Provider::Dat(db) => db
                    .files
                    .keys()
                    .copied()
                    .filter(|id| (*id >> 24) == 0x0E)
                    .map(|file_id| (None, file_id))
                    .collect(),
                Provider::Hba(hba) => hba
                    .entries()
                    .filter_map(|entry| match entry {
                        Ok(entry) if entry.type_id == DatFileType::Table as u32 => {
                            Some((Some(entry.namespace_id().ok()?.to_string()), entry.file_id))
                        }
                        _ => None,
                    })
                    .collect(),
            };

            println!(
                "Scanning {} table files (0x0E prefix) for WCID {}...",
                candidate_entries.len(),
                target_wcid
            );

            let mut hits = 0usize;
            for (namespace, file_id) in candidate_entries {
                let Ok(data) = provider.get_file_in_namespace(namespace.as_deref(), file_id) else {
                    continue;
                };

                let Ok(table) = holtburger_dat::weenie::WeenieTable::unpack(&data) else {
                    continue;
                };

                if let Some(weenie) = table.entries.get(&target_wcid) {
                    hits += 1;
                    match namespace {
                        Some(namespace) => println!("Hit in table {}:{:08X}", namespace, file_id),
                        None => println!("Hit in table {:08X}", file_id),
                    }
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
        Commands::Landblock {
            path,
            id,
            namespace,
        } => {
            let provider = Provider::open(&path)?;
            let mut id_val = parse_id_auto(&id)?;

            // Auto-fix ID if they passed base landblock ID
            if id_val & 0xFFFF == 0 {
                id_val |= 0xFFFF;
            }

            let terrain_data = provider.get_file_in_namespace(namespace.as_deref(), id_val)?;
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
            if let Ok(info_data) = provider.get_file_in_namespace(namespace.as_deref(), info_id) {
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

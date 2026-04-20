use anyhow::{Context, Result};
use clap::Parser;
use indicatif::{ProgressBar, ProgressStyle};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use zip::ZipArchive;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Output JSON file path. Use '-' for stdout.
    #[arg(short, long, default_value = "creature_resists.json")]
    output: String,

    /// Optional binary output file path (.bin). Use '-' for stdout.
    #[arg(short, long)]
    binary: Option<String>,

    /// Skip downloading and use a local zip or sql file
    #[arg(short, long)]
    input: Option<PathBuf>,

    /// Keep the downloaded files
    #[arg(short, long)]
    keep: bool,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
/// High-fidelity creature resistance data exported to JSON.
///
/// Values > 1.0 indicate vulnerability, < 1.0 indicate resistance.
/// 1.0 is neutral. Missing keys default to 1.0.
struct CreatureResists {
    /// Human-readable weenie name
    pub name: String,
    /// Creature Type ID (e.g., 1 for Olthoi, 4 for Drudge)
    pub creature_type: u32,
    /// Map of damage type (slash, pierce, fire, etc.) to multiplier
    pub resists: HashMap<String, f64>,
}

/*
 * COMPACT BINARY FORMAT (.bin)
 * ----------------------------
 * The binary output consists of a sequence of 64-bit little-endian words,
 * one for each creature. The list is sorted by Weenie ID (ascending) to
 * allow for efficient binary search.
 *
 * Each 64-bit word is packed as follows (bits 0-63):
 *
 * [00-23] (24 bits) : Weenie Class ID (up to 16,777,215)
 * [24-27] (04 bits) : Pierce Resistance (4-bit range)
 * [28-31] (04 bits) : Bludgeon Resistance
 * [32-35] (04 bits) : Slash Resistance
 * [36-39] (04 bits) : Acid Resistance
 * [40-43] (04 bits) : Cold Resistance
 * [44-47] (04 bits) : Fire Resistance
 * [48-51] (04 bits) : Electric Resistance
 * [52-55] (04 bits) : Nether Resistance
 * [56-63] (08 bits) : Creature Type ID (0-255)
 *
 * RESISTANCE ENCODING:
 * 4-bit fields represent a linear range from 0.0 to 1.0:
 * 0 (0000) = 0.0 multiplier (Immune)
 * 15 (1111) = 1.0 multiplier (Neutral)
 * Values are calculated as: (multiplier * 15.0).round().clamp(0, 15)
 * Note: This format is lossy and cannot represent vulnerabilities (> 1.0).
 */

const WEENIE_TYPE_CREATURE: u32 = 10;

// Property IDs
const PROP_CREATURE_TYPE: u32 = 2;

const RESIST_SLASH: u32 = 64;
const RESIST_PIERCE: u32 = 65;
const RESIST_BLUDGEON: u32 = 66;
const RESIST_FIRE: u32 = 67;
const RESIST_COLD: u32 = 68;
const RESIST_ACID: u32 = 69;
const RESIST_ELECTRIC: u32 = 70;
const RESIST_NETHER: u32 = 166;

fn main() -> Result<()> {
    env_logger::init();
    let args = Args::parse();

    let sql_path = if let Some(ref input) = args.input {
        if input.extension().is_some_and(|ext| ext == "zip") {
            extract_zip(input)?
        } else {
            input.clone()
        }
    } else {
        let zip_path = download_latest_db()?;
        let sql_path = extract_zip(&zip_path)?;
        if !args.keep {
            std::fs::remove_file(zip_path).ok();
        }
        sql_path
    };

    eprintln!("Parsing SQL file: {}", sql_path.display());
    let mut results = parse_sql(&sql_path)?;

    let original_count = results.len();
    results.retain(|_, v| {
        !v.resists.is_empty() && v.resists.values().any(|&r| (r - 1.0).abs() > 0.001)
    });
    let filtered_count = results.len();

    eprintln!(
        "Writing {} creatures (filtered out {} with no resists or all 1.0)",
        filtered_count,
        original_count - filtered_count
    );

    if args.output == "-" {
        serde_json::to_writer(std::io::stdout(), &results)?;
    } else {
        eprintln!("Writing JSON to {}...", args.output);
        let json_file = File::create(&args.output)?;
        serde_json::to_writer_pretty(json_file, &results)?;
    }

    if let Some(bin_path) = args.binary {
        let mut sorted_creatures: Vec<_> = results.iter().collect();
        sorted_creatures.sort_by_key(|&(&id, _)| id);

        let mut bin_out: Box<dyn Write> = if bin_path == "-" {
            Box::new(std::io::stdout())
        } else {
            eprintln!("Writing compact binary to {}...", bin_path);
            Box::new(File::create(bin_path)?)
        };

        for (&id, creature) in sorted_creatures {
            // Encode: ID(24) || PIERCE(4) || BLUDGEON(4) || SLASH(4) || ACID(4) || COLD(4) || FIRE(4) || ELECTRIC(4) || NETHER(4) || CREATURE_TYPE(8)
            let mut packed: u64 = (id & 0xFFFFFF) as u64;

            let p = encode_resist(creature.resists.get("pierce").cloned().unwrap_or(1.0));
            let b = encode_resist(creature.resists.get("bludgeon").cloned().unwrap_or(1.0));
            let s = encode_resist(creature.resists.get("slash").cloned().unwrap_or(1.0));
            let a = encode_resist(creature.resists.get("acid").cloned().unwrap_or(1.0));
            let c = encode_resist(creature.resists.get("cold").cloned().unwrap_or(1.0));
            let f = encode_resist(creature.resists.get("fire").cloned().unwrap_or(1.0));
            let e = encode_resist(creature.resists.get("electric").cloned().unwrap_or(1.0));
            let n = encode_resist(creature.resists.get("nether").cloned().unwrap_or(1.0));
            let ct = (creature.creature_type & 0xFF) as u8;

            packed |= (p as u64) << 24;
            packed |= (b as u64) << 28;
            packed |= (s as u64) << 32;
            packed |= (a as u64) << 36;
            packed |= (c as u64) << 40;
            packed |= (f as u64) << 44;
            packed |= (e as u64) << 48;
            packed |= (n as u64) << 52;
            packed |= (ct as u64) << 56;

            bin_out.write_all(&packed.to_le_bytes())?;
        }
        bin_out.flush()?;
    }

    if !args.keep && args.input.is_none() {
        std::fs::remove_file(sql_path).ok();
    }

    eprintln!("Done, bestie! Stay winning. 💅");
    Ok(())
}

fn encode_resist(val: f64) -> u8 {
    // 0 = 0.0, 15 = 1.0. Clamped to handle vulnerabilities (lossy)
    (val * 15.0).round().clamp(0.0, 15.0) as u8
}

fn download_latest_db() -> Result<PathBuf> {
    eprintln!("Looking up latest release from ACEmulator/ACE-World-16PY-Patches...");
    let client = reqwest::blocking::Client::builder()
        .user_agent("holtburger-tools")
        .build()?;

    let release_info: serde_json::Value = client
        .get("https://api.github.com/repos/ACEmulator/ACE-World-16PY-Patches/releases/latest")
        .send()?
        .json()?;

    let asset = &release_info["assets"][0];
    let download_url = asset["browser_download_url"]
        .as_str()
        .context("No download URL found")?;
    let file_name = asset["name"].as_str().context("No file name found")?;

    eprintln!("Downloading {}...", file_name);
    let mut response = client.get(download_url).send()?;
    let total_size = response
        .content_length()
        .context("Failed to get content length")?;

    let pb = ProgressBar::new(total_size);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {bytes}/{total_bytes} ({eta})")?
            .progress_chars("#>-"),
    );

    let mut dest_path = std::env::current_dir()?;
    dest_path.push(file_name);
    let mut dest_file = File::create(&dest_path)?;

    let mut buffer = [0; 8192];
    loop {
        let n = response.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut dest_file, &buffer[..n])?;
        pb.inc(n as u64);
    }
    pb.finish_with_message("Download complete");

    Ok(dest_path)
}

fn extract_zip(zip_path: &std::path::Path) -> Result<PathBuf> {
    eprintln!("Extracting {}...", zip_path.display());
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;

    // Usually there's only one SQL file in the zip
    let mut sql_file_name = None;
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        if file.name().ends_with(".sql") {
            sql_file_name = Some(file.name().to_string());
            break;
        }
    }

    let sql_file_name = sql_file_name.context("No SQL file found in zip")?;
    let mut out_path = std::env::current_dir()?;
    out_path.push(&sql_file_name);

    let mut sql_file = archive.by_name(&sql_file_name)?;
    let mut out_file = File::create(&out_path)?;
    std::io::copy(&mut sql_file, &mut out_file)?;

    Ok(out_path)
}

fn parse_sql(sql_path: &std::path::Path) -> Result<HashMap<u32, CreatureResists>> {
    let file = File::open(sql_path)?;
    let metadata = file.metadata()?;
    let pb = ProgressBar::new(metadata.len());
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{wide_bar:.magenta/blue}] {percent}% Parsing SQL...")?
            .progress_chars("#>-"),
    );

    let reader = BufReader::new(file);

    // Regex for: INSERT INTO `weenie` VALUES (123, 'Name', 10, ...)
    // ACE format: (class_id, name, type, last_modified)
    let weenie_row_re = Regex::new(r"\((\d+)\s*,\s*'(.*?)'\s*,\s*(\d+)\s*,\s*'.*?'\)")?;

    // Regex for: INSERT INTO `weenie_properties_float` VALUES (id, object_id, type, value)
    let float_row_re = Regex::new(
        r"\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s*\)",
    )?;

    // Regex for: INSERT INTO `weenie_properties_int` VALUES (id, object_id, type, value)
    let int_row_re = Regex::new(r"\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)")?;

    let mut creatures = HashMap::new();
    let mut creature_ids = std::collections::HashSet::new();

    for line in reader.lines() {
        let line = line?;
        pb.inc(line.len() as u64 + 1);

        let lower = line.to_lowercase();
        if lower.contains("insert into `weenie` ") {
            for caps in weenie_row_re.captures_iter(&line) {
                let class_id: u32 = caps[1].parse()?;
                let name = caps[2].to_string();
                let weenie_type: u32 = caps[3].parse()?;

                if weenie_type == WEENIE_TYPE_CREATURE {
                    creature_ids.insert(class_id);
                    creatures.insert(
                        class_id,
                        CreatureResists {
                            name,
                            creature_type: 0, // Default to Invalid
                            resists: HashMap::new(),
                        },
                    );
                }
            }
        } else if lower.contains("insert into `weenie_properties_float` ") {
            for caps in float_row_re.captures_iter(&line) {
                let object_id: u32 = caps[2].parse()?;
                let prop_type: u32 = caps[3].parse()?;
                let value: f64 = caps[4].parse()?;

                if creature_ids.contains(&object_id) {
                    let resist_name = match prop_type {
                        RESIST_SLASH => Some("slash"),
                        RESIST_PIERCE => Some("pierce"),
                        RESIST_BLUDGEON => Some("bludgeon"),
                        RESIST_FIRE => Some("fire"),
                        RESIST_COLD => Some("cold"),
                        RESIST_ACID => Some("acid"),
                        RESIST_ELECTRIC => Some("electric"),
                        RESIST_NETHER => Some("nether"),
                        _ => None,
                    };

                    if let Some(name) = resist_name
                        && let Some(creature) = creatures.get_mut(&object_id)
                    {
                        creature.resists.insert(name.to_string(), value);
                    }
                }
            }
        } else if lower.contains("insert into `weenie_properties_int` ") {
            for caps in int_row_re.captures_iter(&line) {
                let object_id: u32 = caps[2].parse()?;
                let prop_type: u32 = caps[3].parse()?;
                let value: u32 = caps[4].parse()?;

                if creature_ids.contains(&object_id)
                    && prop_type == PROP_CREATURE_TYPE
                    && let Some(creature) = creatures.get_mut(&object_id)
                {
                    creature.creature_type = value;
                }
            }
        }
    }
    pb.finish_with_message("Parsing complete");

    Ok(creatures)
}

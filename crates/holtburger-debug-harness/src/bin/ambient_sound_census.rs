//! How often does continuous ambience re-fire, and how long are the sounds it fires?
//!
//! Sizes whether a continuous ambient sound could carry a synthesized world position without
//! drifting audibly. Drift is `listener_speed * wave_duration` — the duration, not the re-fire
//! interval, because a voice only drifts while it is still playing.
//!
//! Retail gives these sounds no position at all (`PlayAmbientSoundFromCenter` hardcodes distance
//! `0.0` and pan `0`, acclient.c:366840-366863; `ConstantSound::AddTo` accumulates weight and
//! discards the `diff` and `dir` it is handed, acclient.c:367233-367240). This measures what
//! inventing one would cost.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};

#[derive(Parser)]
#[command(about = "Census region ambient sound descriptors")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let cache = ContentDecodeCache::new();
    let region = cache
        .region_desc(&content)
        .context("region decode failed")?;

    let mut continuous: Vec<f32> = Vec::new();
    let mut intermittent: Vec<f32> = Vec::new();
    // Drift only matters while a voice is audible, so each continuous descriptor also resolves to
    // the actual wave durations it can select — drift is over the *sound*, not the interval.
    let mut durations: Vec<f32> = Vec::new();

    let sound = region
        .sound_info
        .as_ref()
        .context("region carries no ambient sound record")?;
    for table in &sound.tables {
        // One decode per table, shared by every continuous entry that resolves against it.
        let stb = read_sound_table(&content, table.stb_id).ok();
        for entry in &table.sounds {
            if !entry.is_continuous {
                intermittent.push(entry.min_rate);
                continue;
            }
            continuous.push(entry.min_rate);
            let Some(candidates) = stb
                .as_ref()
                .and_then(|table| table.entries.get(&entry.sound_type))
            else {
                continue;
            };
            for candidate in &candidates.candidates {
                if let Ok(seconds) = wave_duration_seconds(&content, candidate.sound_id) {
                    durations.push(seconds);
                }
            }
        }
    }

    continuous.sort_by(f32::total_cmp);
    intermittent.sort_by(f32::total_cmp);
    durations.sort_by(f32::total_cmp);

    println!("ambient tables: {}", sound.tables.len());
    report("continuous", &continuous);
    report("intermittent", &intermittent);

    const WALK_SPEED_METERS_PER_SECOND: f32 = 5.0;
    report("continuous wave durations (s)", &durations);
    if let Some(median) = durations.get(durations.len() / 2) {
        println!(
            "median continuous sound drifts {:.1} m during one playback at {WALK_SPEED_METERS_PER_SECOND} m/s",
            median * WALK_SPEED_METERS_PER_SECOND
        );
    }
    if let Some(longest) = durations.last() {
        println!(
            "longest continuous sound drifts {:.1} m during one playback",
            longest * WALK_SPEED_METERS_PER_SECOND
        );
    }
    Ok(())
}

fn read_sound_table(
    content: &ContentRepository,
    stb_id: u32,
) -> Result<holtburger_dat::file_type::sound_table::SoundTable> {
    let resource = content.read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, stb_id))?;
    Ok(holtburger_dat::file_type::sound_table::SoundTable::read(
        &mut std::io::Cursor::new(&resource.bytes),
    )?)
}

fn wave_duration_seconds(content: &ContentRepository, wave_id: u32) -> Result<f32> {
    let resource = content.read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, wave_id))?;
    let wave =
        holtburger_dat::file_type::wave::Wave::read(&mut std::io::Cursor::new(&resource.bytes))?;
    let bytes_per_second = wave.header.average_bytes_per_second.max(1) as f32;
    Ok(wave.data.len() as f32 / bytes_per_second)
}

fn report(label: &str, rates: &[f32]) {
    if rates.is_empty() {
        println!("{label}: none");
        return;
    }
    let median = rates[rates.len() / 2];
    println!(
        "{label}: n={} min={:.3}s median={:.3}s max={:.3}s",
        rates.len(),
        rates[0],
        median,
        rates[rates.len() - 1]
    );
}

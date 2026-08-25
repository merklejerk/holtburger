//! How wrong is retail's fixed camera pivot height for the bodies the explorer can possess?
//!
//! Retail parks the third-person pivot at a hard-coded local `(0, 0, 1.5)` regardless of what the
//! camera is pivoting on (`SmartBox::set_viewer_home`, acclient.c:138183-138187). That is authored
//! against a standing human; the explorer can possess anything with a physical body. This sizes the
//! error against three per-entity candidates: the authored setup height retail itself uses for
//! attack cones (`CPartArray::GetHeight`, acclient.c:313220), and the top and the center of the
//! motion sphere the boom already selects as its collision target.
//!
//! This is the evidence behind the `RETAIL DIVERGENCE` on `resolve_camera_pivot_offset`. The sphere
//! center wins: it lands within 0.25m of retail's constant for 64.3% of self-propelled templates
//! against 4.8% for either height candidate, and it reproduces the human — the one body retail's
//! constant was authored against — to within a centimetre without being told about it.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_core::resolve_setup_physical_spheres;
use holtburger_dat::file_type::SetupModel;
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_weenie_catalog::WeenieCatalog;
use std::collections::HashMap;
use std::io::Cursor;

const SETUP_MODEL_TYPE: u32 = 0x02;
/// Retail's fixed pivot offset above the pivot object's origin, in metres.
const RETAIL_PIVOT_HEIGHT: f32 = 1.5;
/// ACE `WeenieType` values for self-propelled bodies: Creature, Admin, Vendor, Cow.
///
/// These are the templates that arrive as moving dynamic entities, so they are the population a
/// possession camera actually rides. Everything else is scenery or inventory.
const MOBILE_WEENIE_TYPES: [i32; 4] = [10, 11, 12, 15];

#[derive(Parser)]
#[command(about = "Census per-entity camera pivot height candidates across the weenie catalog")]
struct Args {
    #[arg(long, default_value = "dats/weenies.hwc")]
    catalog: std::path::PathBuf,
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

/// One template's resolved pivot-height candidates, all in world metres at the template's scale.
struct Row {
    name: String,
    weenie_type: i32,
    /// `setup.height * scale`, which is what `CPhysicsObj::GetHeight` returns.
    authored_height: f32,
    /// Top of the sphere the boom already selects as its collision target.
    sphere_top: f32,
    /// Center of that same sphere.
    sphere_center: f32,
    /// Whether the setup authored an upper-constraint sphere at all.
    has_upper: bool,
    /// Whether the setup authored no motion spheres and fell back to retail's dummy sphere.
    uses_dummy_sphere: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let catalog = WeenieCatalog::open(&args.catalog).context("catalog open failed")?;
    let setups = read_setups(&content)?;
    println!("setups decoded: {}", setups.len());

    let rows = resolve_rows(&catalog, &setups)?;
    let all: Vec<&Row> = rows.iter().collect();
    let mobile: Vec<&Row> = rows
        .iter()
        .filter(|row| MOBILE_WEENIE_TYPES.contains(&row.weenie_type))
        .collect();

    for (label, population) in [("all templates", &all), ("mobile bodies", &mobile)] {
        println!("\n== {label}: {} templates ==", population.len());
        report_composition(population);
        report_error("authored setup height", population, |row| {
            row.authored_height
        });
        report_error("selected sphere top", population, |row| row.sphere_top);
        report_error("selected sphere center", population, |row| {
            row.sphere_center
        });
    }

    report_chosen_rule(&mobile);
    report_sphereless_mobile_bodies(&mobile);
    report_named_probes(&rows);
    Ok(())
}

fn read_setups(content: &ContentRepository) -> Result<HashMap<u32, SetupModel>> {
    let mut setups = HashMap::new();
    for entry in content.resource_index().iter().filter(|entry| {
        entry.namespace == EOR_PORTAL_NAMESPACE && entry.type_id == SETUP_MODEL_TYPE
    }) {
        let bytes = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, entry.file_id))?
            .bytes;
        let setup = SetupModel::read(&mut Cursor::new(bytes))
            .with_context(|| format!("decode setup 0x{:08X}", entry.file_id))?;
        setups.insert(setup.id, setup);
    }
    Ok(setups)
}

/// Resolves each template's candidates through the same code the runtime uses.
fn resolve_rows(catalog: &WeenieCatalog, setups: &HashMap<u32, SetupModel>) -> Result<Vec<Row>> {
    let mut rows = Vec::new();
    let wcids: Vec<u32> = catalog.records().map(|record| record.wcid).collect();
    for wcid in wcids {
        let Some(template) = catalog.lookup(wcid)? else {
            continue;
        };
        let Some(setup) = template.setup_did.and_then(|id| setups.get(&id)) else {
            continue;
        };
        let authored_scale = template.default_scale.unwrap_or(1.0) as f32;
        let scale = if authored_scale.is_finite() && authored_scale > 0.0 {
            authored_scale
        } else {
            1.0
        };
        let spheres = resolve_setup_physical_spheres(setup, scale)
            .with_context(|| format!("resolve spheres for wcid {wcid}"))?;
        let selected = spheres.upper_constraint().unwrap_or(spheres.primary());
        rows.push(Row {
            name: template
                .name
                .clone()
                .unwrap_or_else(|| template.class_name.clone()),
            weenie_type: template.weenie_type,
            authored_height: setup.height * scale,
            sphere_top: selected.center.z + selected.radius,
            sphere_center: selected.center.z,
            has_upper: spheres.upper_constraint().is_some(),
            uses_dummy_sphere: setup.spheres.is_empty(),
        });
    }
    println!("templates with a resolvable setup: {}", rows.len());
    Ok(rows)
}

/// What geometry the population actually authors, which decides which candidates are even available.
fn report_composition(population: &[&Row]) {
    let dummy = count(population, |row| row.uses_dummy_sphere);
    let no_height = count(population, |row| row.authored_height <= 0.0);
    let upper = count(population, |row| row.has_upper);
    let negative = count(population, |row| row.authored_height < 0.0);
    println!(
        "  no motion sphere (falls back to the dummy): {dummy} ({:.1}%); \
height <= 0: {no_height} ({:.1}%); upper constraint: {upper} ({:.1}%); \
negative height: {negative}",
        percent(dummy, population.len()),
        percent(no_height, population.len()),
        percent(upper, population.len())
    );
}

/// Distance from retail's fixed pivot to one candidate, which is the comparison that picks a rule.
fn report_error(label: &str, population: &[&Row], height: impl Fn(&Row) -> f32) {
    let mut errors: Vec<f32> = population
        .iter()
        .map(|row| (RETAIL_PIVOT_HEIGHT - height(row)).abs())
        .collect();
    errors.sort_by(|left, right| left.total_cmp(right));
    let within = errors.iter().filter(|error| **error <= 0.25).count();
    let far = errors.iter().filter(|error| **error > 1.0).count();
    println!(
        "  vs {label}: median off {:.2}m, p90 {:.2}m, max {:.2}m; \
within 0.25m for {:.1}%, off by more than 1m for {:.1}%",
        quantile(&errors, 0.5),
        quantile(&errors, 0.9),
        errors.last().copied().unwrap_or(0.0),
        percent(within, population.len()),
        percent(far, population.len())
    );
}

/// How often each source of `max(sphere center, half authored height)` actually decides the pivot.
fn report_chosen_rule(mobile: &[&Row]) {
    let half_wins = count(mobile, |row| row.authored_height * 0.5 > row.sphere_center);
    let half_wins_clearly = count(mobile, |row| {
        row.authored_height * 0.5 > row.sphere_center + 0.25
    });
    let degenerate = count(mobile, |row| {
        row.uses_dummy_sphere && row.authored_height <= 0.0
    });
    println!("\nmax(sphere center, half authored height) over mobile bodies:");
    println!(
        "  half the height wins for {half_wins} ({:.1}%), by more than 0.25m for \
{half_wins_clearly} ({:.1}%); neither source usable for {degenerate} ({:.1}%)",
        percent(half_wins, mobile.len()),
        percent(half_wins_clearly, mobile.len()),
        percent(degenerate, mobile.len())
    );
}

/// The slice the height fallback exists for: bodies whose collision geometry says nothing at all.
fn report_sphereless_mobile_bodies(mobile: &[&Row]) {
    let mut sphereless: Vec<&&Row> = mobile
        .iter()
        .filter(|row| row.uses_dummy_sphere)
        .collect::<Vec<_>>();
    sphereless.sort_by(|left, right| right.authored_height.total_cmp(&left.authored_height));
    let tall = sphereless
        .iter()
        .filter(|row| row.authored_height > 0.5)
        .count();
    println!("\nmobile bodies that author no motion sphere:");
    println!(
        "  {} templates; {} ({:.1}%) still author a setup height above 0.5m, so the dummy \
sphere's 0.10m center would frame their feet",
        sphereless.len(),
        tall,
        percent(tall, sphereless.len())
    );
    for row in sphereless.iter().take(5) {
        println!(
            "  {:<38} type {:>3}  authored h={:>6.2}",
            truncate(&row.name),
            row.weenie_type,
            row.authored_height
        );
    }
}

fn report_named_probes(rows: &[Row]) {
    println!("\nnamed probes (retail's constant was authored against the human):");
    for probe in ["Human", "Chair", "Gromnie"] {
        let Some(row) = rows.iter().find(|row| row.name == probe) else {
            println!("  {probe:<10} (no template by that exact name)");
            continue;
        };
        println!(
            "  {:<10} type {:>3}  h={:>6.2}  top={:>6.2}  center={:>6.2}  upper={}",
            row.name,
            row.weenie_type,
            row.authored_height,
            row.sphere_top,
            row.sphere_center,
            row.has_upper
        );
    }
}

fn count(population: &[&Row], predicate: impl Fn(&Row) -> bool) -> usize {
    population.iter().filter(|row| predicate(row)).count()
}

fn quantile(sorted: &[f32], fraction: f32) -> f32 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() - 1) as f32 * fraction).round() as usize;
    sorted[index]
}

fn percent(count: usize, total: usize) -> f32 {
    if total == 0 {
        return 0.0;
    }
    100.0 * count as f32 / total as f32
}

fn truncate(name: &str) -> String {
    name.chars().take(36).collect()
}

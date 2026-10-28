//! Local generation and inspection of the distributable CLI content pair.

use std::{
    collections::{BTreeMap, BTreeSet, btree_map::Entry},
    fs::{self, File},
    io::Cursor,
    path::Path,
    sync::Arc,
};

use anyhow::{Context, Result, ensure};
use holtburger_content::navigation_bundle::{
    BOOTSTRAP_FILE, NAVIGATION_FILE, NavigationArchive, NavigationArchiveWriter,
    NavigationBlockKind, NavigationBuilding, NavigationBuildingPortal, NavigationCell,
    NavigationPortalConnection, NavigationPortalGeometry, NavigationRoomGeometry,
    NavigationTerrain,
};
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockAsset, LandblockAssetAssembler,
    LandblockCellStructureRef, LandblockInteriorSystemAssembler, LandblockInteriorSystemAsset,
    LandblockPortalEndpoint, LandblockRoomShellAssembler, StaticColliderPlacement,
};
use holtburger_dat::{
    EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaStreamWriter, ResourceKey,
    file_type::{Animation, DatFileType},
    manifest::StripperManifest,
};
use zip::{CompressionMethod, DateTime, ZipWriter, write::SimpleFileOptions};

/// Prepared facts for one owner, ready for streaming cells and merging shared structures.
struct PreparedOwner {
    cells: Vec<NavigationCell>,
    structures: BTreeMap<LandblockCellStructureRef, NavigationRoomGeometry>,
}

/// Produces an unpublished output directory containing `content/` and `cli-content.zip`.
/// Existing outputs are refused, and a failure leaves no partial published pair.
pub fn generate(source: &Path, output: &Path) -> Result<()> {
    ensure!(
        !output.try_exists()?,
        "output already exists: {}",
        output.display()
    );
    let parent = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let staging = tempfile::Builder::new()
        .prefix(".cli-content-")
        .tempdir_in(parent)?;
    let content_dir = staging.path().join("content");
    fs::create_dir(&content_dir)?;
    let content = ContentRepository::from_hba_path(source).context("open source HBA")?;
    let owners = content
        .resource_index()
        .iter()
        .filter(|entry| {
            entry.namespace == EOR_CELL_NAMESPACE && entry.type_id == DatFileType::Landblock as u32
        })
        .map(|entry| entry.file_id)
        .collect::<BTreeSet<_>>();
    ensure!(
        !owners.is_empty(),
        "source has no landblock records; provide a full content HBA"
    );
    let bootstrap = content_dir.join(BOOTSTRAP_FILE);
    generate_bootstrap(&content, &bootstrap)?;
    let parsed = ContentRepository::from_hba_path(&bootstrap)?;
    parsed
        .read_character_gen_catalog()
        .context("validate complete character-creation catalog")?;
    parsed
        .read_motion_reference_data()
        .context("validate bootstrap motion closure")?;

    let cache = ContentDecodeCache::new();
    let region = cache.active_region_data(&content)?;
    let navigation = content_dir.join(NAVIGATION_FILE);
    let mut writer = NavigationArchiveWriter::create(&navigation)?;
    let mut shared: BTreeMap<u32, BTreeMap<u32, NavigationRoomGeometry>> = BTreeMap::new();
    let mut cell_count = 0;
    for (index, owner) in owners.iter().copied().enumerate() {
        let landblock = LandblockAssetAssembler
            .assemble(&content, &cache, &region, owner)?
            .with_context(|| format!("missing source landblock 0x{owner:08X}"))?;
        let interior = LandblockInteriorSystemAssembler
            .assemble(&content, &cache, &landblock)
            .with_context(|| format!("assemble source topology 0x{owner:08X}"))?;
        let prepared = prepare_owner(&landblock, &interior)?;
        if !prepared.cells.is_empty() {
            writer.add_cells(owner, &prepared.cells)?;
            cell_count += prepared.cells.len() as u64;
        }
        for (reference, geometry) in prepared.structures {
            let environment = shared.entry(reference.environment_id).or_default();
            match environment.entry(reference.local_selector) {
                Entry::Vacant(entry) => {
                    entry.insert(geometry);
                }
                Entry::Occupied(mut entry) => {
                    entry.get_mut().portals.extend(geometry.portals);
                }
            }
        }
        writer.add_terrain(owner, &prepare_terrain(&landblock))?;
        if (index + 1) % 1000 == 0 {
            log::info!(
                "prepared {} / {} owners, {} cells",
                index + 1,
                owners.len(),
                cell_count
            );
        }
    }
    let room_structures: u64 = shared.values().map(|rooms| rooms.len() as u64).sum();
    for (environment, rooms) in shared {
        writer.add_room_geometry(environment, &rooms)?;
    }
    writer.finish()?;
    write_zip(&content_dir, &staging.path().join("cli-content.zip"))?;
    fs::rename(staging.path(), output).context("publish complete generated output")?;
    log::info!(
        "Generated CLI content: {} owners, {cell_count} cells, {room_structures} shared room structures",
        owners.len()
    );
    Ok(())
}

fn generate_bootstrap(content: &ContentRepository, output: &Path) -> Result<()> {
    let manifest = StripperManifest::micro();
    let mut writer = HbaStreamWriter::create(output)?;
    let mut entries = content.resource_index().iter().collect::<Vec<_>>();
    entries.sort_by(|a, b| (&a.namespace, a.file_id).cmp(&(&b.namespace, b.file_id)));
    for entry in entries {
        let kind = DatFileType::from_namespaced_id(&entry.namespace, entry.file_id);
        let keep = manifest.should_keep_entry(&entry.namespace, entry.file_id, kind)
            || (entry.namespace == EOR_PORTAL_NAMESPACE && kind == DatFileType::Clothing);
        if !keep {
            continue;
        }
        let resource = content.read_resource(ResourceKey::new(&entry.namespace, entry.file_id))?;
        if kind == DatFileType::Animation {
            let mut animation = Animation::read(&mut Cursor::new(resource.bytes))?;
            animation.prune_to_simulation_facts();
            let mut data = Cursor::new(Vec::new());
            animation.write(&mut data)?;
            writer.add_pruned(
                &entry.namespace,
                entry.file_id,
                entry.type_id,
                data.into_inner(),
            )?;
        } else if resource.metadata.is_pruned {
            writer.add_pruned(
                &entry.namespace,
                entry.file_id,
                entry.type_id,
                resource.bytes,
            )?;
        } else {
            // Intact setups retain model-free sphere/default-motion facts. Their small light
            // fields need no separate pruning path; no referenced visual resources are copied.
            writer.add(
                &entry.namespace,
                entry.file_id,
                entry.type_id,
                resource.bytes,
            )?;
        }
    }
    writer.finish()?;
    Ok(())
}

fn prepare_owner(
    landblock: &LandblockAsset,
    interior: &LandblockInteriorSystemAsset,
) -> Result<PreparedOwner> {
    let rooms = LandblockRoomShellAssembler.assemble(landblock, interior)?;
    let shells = rooms
        .colliders
        .iter()
        .map(|collider| {
            let StaticColliderPlacement::EnvCellShell { cell_id } = collider.source_placement
            else {
                anyhow::bail!("room assembler included an object obstacle");
            };
            Ok((cell_id, Arc::clone(&collider.shape)))
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    let portals = interior
        .topology
        .portals
        .iter()
        .map(|p| ((p.source.env_cell_id, p.source.portal_index), p))
        .collect::<BTreeMap<_, _>>();
    let mut prepared = PreparedOwner {
        cells: Vec::new(),
        structures: BTreeMap::new(),
    };
    for cell in &interior.cells {
        let selector = (cell.env_cell_id & 0xffff) as u16;
        let volume = rooms
            .cell_volume(selector)
            .context("room assembler omitted a cell volume")?;
        let geometry = prepared
            .structures
            .entry(cell.structure)
            .or_insert_with(|| NavigationRoomGeometry {
                planes: volume.planes.clone(),
                shell: shells.get(&cell.env_cell_id).cloned(),
                portals: BTreeMap::new(),
            });
        let mut connections = Vec::new();
        for (index, aperture) in volume.portals.iter().enumerate() {
            let source = portals
                .get(&(cell.env_cell_id, index))
                .context("portal source is missing")?;
            geometry.portals.insert(
                source.polygon_id,
                NavigationPortalGeometry {
                    plane: aperture.plane,
                    vertices: aperture.aperture_vertices.clone(),
                },
            );
            let (other_cell_id, other_portal_id) = match source.endpoint {
                LandblockPortalEndpoint::Internal {
                    other_cell_id,
                    other_portal_id,
                    ..
                }
                | LandblockPortalEndpoint::Outside {
                    other_cell_id,
                    other_portal_id,
                    ..
                } => (other_cell_id, other_portal_id),
            };
            connections.push(NavigationPortalConnection {
                flags: source.flags,
                polygon_id: source.polygon_id,
                other_cell_id,
                other_portal_id,
            });
        }
        prepared.cells.push(NavigationCell {
            selector,
            flags: cell.flags & !0x02,
            authored_cell_id: cell.authored_cell_id,
            structure: cell.structure,
            placement: cell.placement,
            portals: connections,
            restriction_object_id: cell.restriction_object_id,
        });
    }
    prepared.cells.sort_by_key(|cell| cell.selector);
    Ok(prepared)
}

fn prepare_terrain(landblock: &LandblockAsset) -> NavigationTerrain {
    NavigationTerrain {
        scene_class: landblock.scene_class,
        terrain: landblock.terrain.clone(),
        buildings: landblock
            .buildings
            .iter()
            .map(|building| NavigationBuilding {
                placement: building.placement,
                portals: building
                    .portals
                    .iter()
                    .map(|portal| NavigationBuildingPortal {
                        flags: portal.flags,
                        other_cell_id: portal.other_cell_id,
                        other_portal_id: portal.other_portal_id,
                        linked_cells: portal.stab_cell_ids.clone(),
                    })
                    .collect(),
            })
            .collect(),
        restrictions: landblock
            .restrictions
            .iter()
            .map(|r| (r.cell_id, r.restriction_object_id))
            .collect(),
    }
}

fn write_zip(content: &Path, output: &Path) -> Result<()> {
    let mut zip = ZipWriter::new(File::create_new(output)?);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .last_modified_time(DateTime::default())
        .unix_permissions(0o644);
    for name in [BOOTSTRAP_FILE, NAVIGATION_FILE] {
        zip.start_file(name, options)?;
        std::io::copy(&mut File::open(content.join(name))?, &mut zip)?;
    }
    zip.finish()?.sync_all()?;
    Ok(())
}

/// Opens the two archives and prints block counts without a separate metadata receipt.
pub fn inspect(content: &Path) -> Result<()> {
    ContentRepository::from_hba_path(content.join(BOOTSTRAP_FILE))?;
    let archive = NavigationArchive::open(content.join(NAVIGATION_FILE))?;
    let mut owners = 0;
    let mut cell_blocks = 0;
    let mut shared_blocks = 0;
    for key in archive.keys() {
        match key.kind {
            NavigationBlockKind::Terrain => owners += 1,
            NavigationBlockKind::Cells => cell_blocks += 1,
            NavigationBlockKind::SharedGeometry => shared_blocks += 1,
        }
    }
    log::info!(
        "CLI content: {owners} terrain owners, {cell_blocks} cell blocks, {shared_blocks} shared geometry blocks"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn generation_failure_does_not_publish_a_partial_pair() {
        let dir = tempfile::TempDir::new().unwrap();
        let source = dir.path().join("empty.hba");
        HbaStreamWriter::create(&source).unwrap().finish().unwrap();
        let output = dir.path().join("generated");
        assert!(generate(&source, &output).is_err());
        assert!(!output.exists());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn generation_refuses_an_existing_output_before_touching_it() {
        let dir = tempfile::TempDir::new().unwrap();
        let output = dir.path().join("generated");
        fs::create_dir(&output).unwrap();
        fs::write(output.join("preserved"), b"existing output").unwrap();
        assert!(generate(&dir.path().join("missing-source.hba"), &output).is_err());
        assert_eq!(
            fs::read(output.join("preserved")).unwrap(),
            b"existing output"
        );
    }

    #[test]
    fn approved_input_zip_has_stable_bytes_and_exact_companions() {
        let dir = tempfile::TempDir::new().unwrap();
        let content = dir.path().join("content");
        fs::create_dir(&content).unwrap();
        for name in [BOOTSTRAP_FILE, NAVIGATION_FILE] {
            fs::write(content.join(name), name.as_bytes()).unwrap();
        }
        let first = dir.path().join("first.zip");
        let second = dir.path().join("second.zip");
        write_zip(&content, &first).unwrap();
        write_zip(&content, &second).unwrap();
        assert_eq!(fs::read(&first).unwrap(), fs::read(&second).unwrap());
        let mut archive = zip::ZipArchive::new(File::open(first).unwrap()).unwrap();
        let expected = [BOOTSTRAP_FILE, NAVIGATION_FILE];
        assert_eq!(archive.len(), expected.len());
        for name in expected {
            let mut bytes = Vec::new();
            archive
                .by_name(name)
                .unwrap()
                .read_to_end(&mut bytes)
                .unwrap();
            assert_eq!(bytes, name.as_bytes());
        }
    }
}

#[cfg(test)]
#[path = "cli_content/geometry_tests.rs"]
mod geometry_tests;

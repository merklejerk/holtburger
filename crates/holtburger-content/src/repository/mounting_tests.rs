//! Synthetic archives exercise the actual directory and sector readers without retail files.

use std::fs;
use std::path::Path;

use holtburger_dat::{
    DAT_CELL_BLOCK_SIZE, DAT_HEADER_OFFSET, DAT_HIGHRES_SUBSET, DAT_MAGIC, DAT_PORTAL_BLOCK_SIZE,
    DIRECTORY_NODE_SIZE, DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaWriter,
    ResourceKey,
};
use tempfile::tempdir;

use super::{ContentRepository, ContentSelectionError, ResolvedContent};

#[test]
fn discovery_skips_absence_but_stops_at_a_broken_installation() {
    let root = tempdir().unwrap();
    let empty = root.path().join("empty");
    let valid = root.path().join("valid");
    fs::create_dir(&empty).unwrap();
    fs::create_dir(&valid).unwrap();
    write_hba(
        &valid.join("assets.hba"),
        EOR_PORTAL_NAMESPACE,
        0x0100_0001,
        b"resource",
        false,
    );
    let candidates = vec![root.path().join("absent"), empty.clone(), valid.clone()];
    let selection = ResolvedContent::discover_candidates(candidates.clone()).unwrap();
    assert_eq!(selection.location, fs::canonicalize(valid).unwrap());
    fs::write(empty.join("broken.hba"), b"broken").unwrap();
    let error = ResolvedContent::discover_candidates(candidates).unwrap_err();
    assert!(matches!(
        error.downcast_ref::<ContentSelectionError>(),
        Some(ContentSelectionError::Archive { .. })
    ));
}

/// A DAT directory has 62 child addresses followed by a count and up to 61 entries.
const DIRECTORY_BRANCH_COUNT: usize = 62;
/// Every sector starts with the next-sector address, followed by payload bytes.
const SECTOR_LINK_BYTES: usize = size_of::<u32>();

fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + size_of::<u32>()].copy_from_slice(&value.to_le_bytes());
}

fn write_sectors(bytes: &mut [u8], offset: usize, block_size: usize, payload: &[u8]) {
    let capacity = block_size - SECTOR_LINK_BYTES;
    let count = payload.len().div_ceil(capacity);
    for (index, chunk) in payload.chunks(capacity).enumerate() {
        let sector = offset + index * block_size;
        let next = if index + 1 == count {
            0
        } else {
            sector + block_size
        };
        put_u32(bytes, sector, next as u32);
        bytes[sector + SECTOR_LINK_BYTES..sector + SECTOR_LINK_BYTES + chunk.len()]
            .copy_from_slice(chunk);
    }
}

/// Encodes the header fields and one leaf exactly as `DatDatabase` reads them.
fn write_dat(path: &Path, dataset: u32, id: u32, payload: &[u8]) {
    write_dat_subset(path, dataset, 0, id, payload);
}

/// Subset is encoded in the header so role selection is independent of filenames.
fn write_dat_subset(path: &Path, dataset: u32, subset: u32, id: u32, payload: &[u8]) {
    let block_size = if dataset == 2 {
        DAT_CELL_BLOCK_SIZE
    } else {
        DAT_PORTAL_BLOCK_SIZE
    } as usize;
    let capacity = block_size - SECTOR_LINK_BYTES;
    // Leave a full sector after the header start; never use an in-memory struct size on disk.
    let root = (DAT_HEADER_OFFSET as usize).div_ceil(block_size) * block_size + block_size;
    let data_offset = root + DIRECTORY_NODE_SIZE.div_ceil(capacity) * block_size;
    let length = data_offset + payload.len().div_ceil(capacity) * block_size;
    let mut bytes = vec![0; length];
    let header = [
        DAT_MAGIC,
        block_size as u32,
        length as u32,
        dataset,
        subset,
        0,
        0,
        0,
        root as u32,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    for (index, value) in header.into_iter().enumerate() {
        put_u32(
            &mut bytes,
            DAT_HEADER_OFFSET as usize + index * size_of::<u32>(),
            value,
        );
    }
    let mut directory = vec![0; DIRECTORY_NODE_SIZE];
    let count_offset = DIRECTORY_BRANCH_COUNT * size_of::<u32>();
    put_u32(&mut directory, count_offset, 1);
    // DatFileEntry: flags, id, first sector, stored length, timestamp, version.
    for (index, value) in [0, id, data_offset as u32, payload.len() as u32, 0, 0]
        .into_iter()
        .enumerate()
    {
        put_u32(
            &mut directory,
            count_offset + (index + 1) * size_of::<u32>(),
            value,
        );
    }
    write_sectors(&mut bytes, root, block_size, &directory);
    write_sectors(&mut bytes, data_offset, block_size, payload);
    fs::write(path, bytes).unwrap();
}

fn write_hba(path: &Path, namespace: &str, id: u32, payload: &[u8], pruned: bool) {
    let mut writer = HbaWriter::new();
    let type_id = DatFileType::from_namespaced_id(namespace, id) as u32;
    if pruned {
        writer
            .add_pruned(namespace, id, type_id, payload.to_vec())
            .unwrap();
    } else {
        writer
            .add(namespace, id, type_id, payload.to_vec())
            .unwrap();
    }
    writer.write(path).unwrap();
}

#[test]
fn dat_and_hba_supply_equivalent_payloads_inventory_and_provenance() {
    let root = tempdir().unwrap();
    let payload = vec![0x42; DIRECTORY_NODE_SIZE];
    for (dataset, namespace, id, expected_type) in [
        (1, EOR_PORTAL_NAMESPACE, 0x0100_0001, DatFileType::Model),
        (2, EOR_CELL_NAMESPACE, 0x0007_0219, DatFileType::IndoorCell),
        (
            3,
            holtburger_dat::EOR_LANGUAGE_NAMESPACE,
            0x2300_0001,
            DatFileType::StringTable,
        ),
    ] {
        let dat = root.path().join(format!("{dataset}.DAT"));
        let hba = root.path().join(format!("{dataset}.HBA"));
        write_dat(&dat, dataset, id, &payload);
        write_hba(&hba, namespace, id, &payload, false);
        for path in [&dat, &hba] {
            let repository = ContentRepository::open_selected(path).unwrap();
            assert_eq!(
                repository
                    .read_resource(ResourceKey::new(namespace, id))
                    .unwrap()
                    .bytes,
                payload
            );
            let index = repository.resource_index();
            assert_eq!(index.len(), 1);
            assert_eq!(
                (&*index[0].namespace, index[0].file_id, index[0].type_id),
                (namespace, id, expected_type as u32)
            );
            assert!(!index[0].is_pruned);
            if namespace == EOR_CELL_NAMESPACE && (0x0100..0xfffe).contains(&(id & 0xffff)) {
                assert_eq!(repository.archived_env_cells(id), &[id]);
            } else {
                assert!(repository.archived_env_cells(id).is_empty());
            }
            let revisions = repository.mounted_sources();
            assert_eq!(revisions.len(), 1);
            assert_eq!(revisions[0].path, fs::canonicalize(path).unwrap());
            assert_eq!(revisions[0].size, fs::metadata(path).unwrap().len());
            assert_eq!(
                revisions[0].modified,
                fs::metadata(path).unwrap().modified().unwrap()
            );
        }
    }
}

#[test]
fn archived_env_cells_are_unique_sorted_and_scoped_to_the_cell_namespace_and_owner() {
    let root = tempdir().unwrap();
    let ids = [
        0x0007_0219,
        0x0007_0100,
        0x0008_0100,
        0x0007_0001,
        0x0007_fffe,
        0x0007_ffff,
    ];
    let mut writer = HbaWriter::new();
    for id in ids {
        writer.add(EOR_CELL_NAMESPACE, id, 0, vec![0]).unwrap();
    }
    writer
        .add(EOR_PORTAL_NAMESPACE, 0x0007_0300, 0, vec![0])
        .unwrap();
    writer.write(root.path().join("cells.hba")).unwrap();
    // Duplicate mounted entries must not become duplicate interior cells.
    write_hba(
        &root.path().join("duplicate.hba"),
        EOR_CELL_NAMESPACE,
        ids[0],
        &[0],
        false,
    );
    let repository = ContentRepository::open_selected(root.path()).unwrap();
    assert_eq!(
        repository.archived_env_cells(0x0007_ffff),
        &[0x0007_0100, 0x0007_0219]
    );
    assert_eq!(repository.archived_env_cells(0x0008_ffff), &[0x0008_0100]);
    assert!(repository.archived_env_cells(0x0009_ffff).is_empty());
}

#[test]
fn directories_prefer_hba_and_preserve_full_over_pruned_resolution() {
    let root = tempdir().unwrap();
    let id = 0x0100_0001;
    write_dat(&root.path().join("retail.dat"), 1, id, b"DAT");
    write_hba(
        &root.path().join("a.hba"),
        EOR_PORTAL_NAMESPACE,
        id,
        b"pruned",
        true,
    );
    write_hba(
        &root.path().join("b.hba"),
        EOR_PORTAL_NAMESPACE,
        id,
        b"full",
        false,
    );
    let repository = ContentRepository::open_selected(root.path()).unwrap();
    assert_eq!(repository.mounted_sources().len(), 2);
    assert_eq!(
        repository
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, id))
            .unwrap()
            .bytes,
        b"full"
    );
    assert!(repository.mounted_sources()[0].path.ends_with("a.hba"));
}

#[test]
fn dat_directories_mount_distinct_namespaces_and_reject_duplicates() {
    let root = tempdir().unwrap();
    let id = 0x0100_0001;
    write_dat(&root.path().join("portal.dat"), 1, id, b"portal");
    write_dat(&root.path().join("cell.dat"), 2, id, b"cell");
    let repository = ContentRepository::open_selected(root.path()).unwrap();
    assert_eq!(repository.resource_index().len(), 2);
    assert_eq!(
        repository
            .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, id))
            .unwrap()
            .bytes,
        b"cell"
    );
    write_dat(&root.path().join("duplicate.dat"), 1, id, b"duplicate");
    let error = ContentRepository::open_selected(root.path()).unwrap_err();
    assert!(matches!(
        error.downcast_ref::<ContentSelectionError>(),
        Some(ContentSelectionError::DuplicateDatKind { .. })
    ));
}

#[test]
fn retail_highres_shares_portal_namespace_and_wins_by_membership() {
    let root = tempdir().unwrap();
    let shared_id = 0x0600_0001;
    // The base name sorts first and neither filename identifies its role.
    let portal = root.path().join("a.dat");
    let highres = root.path().join("z.dat");
    write_dat(&portal, 1, shared_id, b"base texture");
    let base = ContentRepository::open_selected(root.path()).unwrap();
    assert_eq!(
        base.read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, shared_id))
            .unwrap()
            .bytes,
        b"base texture"
    );

    write_dat_subset(
        &highres,
        1,
        DAT_HIGHRES_SUBSET,
        shared_id,
        b"highres texture",
    );
    let both = ContentRepository::open_selected(root.path()).unwrap();
    assert_eq!(both.mounted_sources().len(), 2);
    assert_eq!(
        both.read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, shared_id))
            .unwrap()
            .bytes,
        b"highres texture"
    );
    assert_eq!(
        both.mounted_sources()[0].path,
        fs::canonicalize(&highres).unwrap()
    );

    // When highres has no matching member, the base archive still supplies it.
    write_dat_subset(
        &highres,
        1,
        DAT_HIGHRES_SUBSET,
        shared_id + 1,
        b"other texture",
    );
    let distinct = ContentRepository::open_selected(root.path()).unwrap();
    assert_eq!(
        distinct
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, shared_id))
            .unwrap()
            .bytes,
        b"base texture"
    );
    assert_eq!(
        distinct
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, shared_id + 1))
            .unwrap()
            .bytes,
        b"other texture"
    );

    write_dat_subset(
        &root.path().join("duplicate.dat"),
        1,
        DAT_HIGHRES_SUBSET,
        shared_id + 2,
        b"ambiguous",
    );
    assert!(matches!(
        ContentRepository::open_selected(root.path())
            .unwrap_err()
            .downcast_ref::<ContentSelectionError>(),
        Some(ContentSelectionError::DuplicateDatKind {
            kind: holtburger_dat::RetailDatKind::HighResolutionPortal,
            ..
        })
    ));
}

#[test]
fn layered_portal_inventory_projects_each_resolved_key_once() {
    use binrw::BinRead;
    let root = tempdir().unwrap();
    let id = 0x0300_0001;
    write_dat(&root.path().join("base.dat"), 1, id, &1u32.to_le_bytes());
    write_dat_subset(
        &root.path().join("highres.dat"),
        1,
        DAT_HIGHRES_SUBSET,
        id,
        &2u32.to_le_bytes(),
    );
    let repository = ContentRepository::open_selected(root.path()).unwrap();
    assert_eq!(repository.resource_index().len(), 2);
    let projected = repository
        .decode_portal_records(DatFileType::Animation, u32::read_le)
        .unwrap();
    assert_eq!(projected, vec![2]);
}

#[test]
fn explicit_selection_never_probes_a_sibling_or_hides_invalid_hba() {
    let root = tempdir().unwrap();
    let id = 0x0100_0001;
    write_dat(&root.path().join("assets.dat"), 1, id, b"DAT");
    let missing_hba = ContentRepository::open_selected(root.path().join("assets.hba")).unwrap_err();
    assert!(matches!(
        missing_hba.downcast_ref::<ContentSelectionError>(),
        Some(ContentSelectionError::Unavailable { .. })
    ));
    fs::write(root.path().join("assets.hba"), b"invalid").unwrap();
    assert!(matches!(
        ContentRepository::open_selected(root.path())
            .unwrap_err()
            .downcast_ref::<ContentSelectionError>(),
        Some(ContentSelectionError::Archive { .. })
    ));
    assert_eq!(
        ContentRepository::open_selected(root.path().join("assets.dat"))
            .unwrap()
            .mounted_sources()
            .len(),
        1
    );
}

#[test]
fn empty_and_unrecognized_selections_fail_explicitly() {
    let root = tempdir().unwrap();
    assert!(matches!(
        ContentRepository::open_selected(root.path())
            .unwrap_err()
            .downcast_ref::<ContentSelectionError>(),
        Some(ContentSelectionError::Empty { .. })
    ));
    let path = root.path().join("unknown.dat");
    write_dat(&path, 99, 0x0100_0001, b"unknown");
    assert!(matches!(
        ContentRepository::open_selected(path)
            .unwrap_err()
            .downcast_ref::<ContentSelectionError>(),
        Some(ContentSelectionError::Archive { .. })
    ));
}

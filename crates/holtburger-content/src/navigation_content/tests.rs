use super::*;
use crate::navigation_bundle::{NavigationArchiveError, NavigationArchiveWriter, sha256_file};
use holtburger_dat::{HbaStreamWriter, ResourceKey};
use tempfile::TempDir;

fn bootstrap(path: &Path, bytes: &[u8]) {
    let mut writer = HbaStreamWriter::create(path).unwrap();
    writer.add("probe", 7, 0, bytes.to_vec()).unwrap();
    writer.finish().unwrap();
}

fn pair(root: &Path) {
    let bootstrap_path = root.join(BOOTSTRAP_FILE);
    bootstrap(&bootstrap_path, b"selected");
    NavigationArchiveWriter::create(
        root.join(NAVIGATION_FILE),
        sha256_file(bootstrap_path).unwrap(),
    )
    .unwrap()
    .finish()
    .unwrap();
}

#[test]
fn prepared_pair_opens_only_its_indexed_bootstrap_and_keeps_absent_coverage_absent() {
    let temp = TempDir::new().unwrap();
    pair(temp.path());
    bootstrap(&temp.path().join("other.hba"), b"unselected sibling");
    let source = NavigationContent::open(temp.path()).unwrap();
    assert_eq!(source.bootstrap().mounted_sources().len(), 1);
    assert_eq!(source.bootstrap().resource_index().len(), 1);
    assert_eq!(
        source
            .bootstrap()
            .read_resource(ResourceKey::new("probe", 7))
            .unwrap()
            .bytes,
        b"selected"
    );
    assert!(source.load_scene_class(0x8602_ffff).unwrap().is_none());
    assert!(source.load_collision(0x8602_ffff).unwrap().is_none());
}

#[test]
fn full_hba_file_is_an_exact_selection_even_beside_a_prepared_pair() {
    let temp = TempDir::new().unwrap();
    pair(temp.path());
    let full = temp.path().join("full.hba");
    bootstrap(&full, b"explicit HBA");
    let source = NavigationContent::open(&full).unwrap();
    assert_eq!(source.bootstrap().mounted_sources().len(), 1);
    assert_eq!(
        source
            .bootstrap()
            .read_resource(ResourceKey::new("probe", 7))
            .unwrap()
            .bytes,
        b"explicit HBA"
    );
}

#[test]
fn incomplete_pair_never_falls_back_to_another_hba() {
    for missing in [BOOTSTRAP_FILE, NAVIGATION_FILE] {
        let temp = TempDir::new().unwrap();
        pair(temp.path());
        bootstrap(&temp.path().join("full.hba"), b"must not be selected");
        std::fs::remove_file(temp.path().join(missing)).unwrap();
        let error = NavigationContent::open(temp.path()).err().unwrap();
        assert!(
            matches!(error.downcast_ref::<NavigationContentSelectionError>(),
            Some(NavigationContentSelectionError::MissingCompanion { missing: path })
                if *path == temp.path().join(missing))
        );
    }
}

#[test]
fn selecting_mismatched_companions_preserves_the_typed_pair_error() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join(BOOTSTRAP_FILE);
    bootstrap(&path, b"selected");
    let mut wrong_hash = sha256_file(path).unwrap();
    wrong_hash[0] ^= 0xff;
    NavigationArchiveWriter::create(temp.path().join(NAVIGATION_FILE), wrong_hash)
        .unwrap()
        .finish()
        .unwrap();
    let error = NavigationContent::open(temp.path()).err().unwrap();
    assert!(matches!(
        error.downcast_ref::<NavigationArchiveError>(),
        Some(NavigationArchiveError::BootstrapMismatch)
    ));
}

#[test]
fn unavailable_location_and_unsupported_file_are_different_errors() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("missing.hba");
    let error = NavigationContent::open(&path).err().unwrap();
    assert_eq!(
        error.downcast_ref::<std::io::Error>().unwrap().kind(),
        std::io::ErrorKind::NotFound
    );
    let dat = temp.path().join("client_portal.dat");
    std::fs::write(&dat, b"unsupported retail input").unwrap();
    let error = NavigationContent::open(&dat).err().unwrap();
    assert!(
        matches!(error.downcast_ref::<NavigationContentSelectionError>(),
        Some(NavigationContentSelectionError::UnsupportedLocation { path }) if *path == dat)
    );
}

#[test]
fn automatic_discovery_skips_absent_locations_and_opens_the_first_existing_source() {
    let temp = TempDir::new().unwrap();
    let absent = temp.path().join("absent");
    let selected = temp.path().join("selected.hba");
    bootstrap(&selected, b"selected");
    let source = NavigationContent::discover_candidates([absent, selected]).unwrap();
    assert_eq!(source.bootstrap().resource_index().len(), 1);
}

#[test]
fn automatic_discovery_does_not_bypass_an_incomplete_prepared_pair() {
    let temp = TempDir::new().unwrap();
    let incomplete = temp.path().join("incomplete");
    std::fs::create_dir(&incomplete).unwrap();
    bootstrap(&incomplete.join(BOOTSTRAP_FILE), b"incomplete");
    let other = temp.path().join("other.hba");
    bootstrap(&other, b"must not be selected");
    let error = NavigationContent::discover_candidates([incomplete.clone(), other])
        .err()
        .unwrap();
    assert!(
        matches!(error.downcast_ref::<NavigationContentSelectionError>(),
        Some(NavigationContentSelectionError::MissingCompanion { missing }) if *missing == incomplete.join(NAVIGATION_FILE))
    );
}

#[test]
fn absent_automatic_locations_report_the_actual_search_order() {
    let temp = TempDir::new().unwrap();
    let paths = [temp.path().join("first"), temp.path().join("second")];
    let error = NavigationContent::discover_candidates(paths.clone())
        .err()
        .unwrap();
    assert!(
        matches!(error.downcast_ref::<NavigationContentSelectionError>(),
        Some(NavigationContentSelectionError::NotDiscovered { paths: searched }) if *searched == paths)
    );
}

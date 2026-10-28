use super::*;
use std::sync::{Arc, Barrier};
use tempfile::{NamedTempFile, TempDir};

const CELLS: NavigationBlockKey = NavigationBlockKey {
    kind: NavigationBlockKind::Cells,
    id: 0x8602_ffff,
};
const GEOMETRY: NavigationBlockKey = NavigationBlockKey {
    kind: NavigationBlockKind::SharedGeometry,
    id: 0x0d00_0001,
};
const BOOTSTRAP_DIGEST: [u8; 32] = [7; 32];

/// Serializes wire input independently of the validated writer, allowing malformed fixtures.
fn fixture(payload: &[u8], entries: &[WireEntry]) -> NamedTempFile {
    let mut file = NamedTempFile::new().unwrap();
    Header {
        magic: MAGIC,
        version: NAVIGATION_FORMAT_VERSION,
        entry_count: entries.len() as u32,
        directory_offset: HEADER_BYTES + payload.len() as u64,
        bootstrap_sha256: BOOTSTRAP_DIGEST,
    }
    .write(file.as_file_mut())
    .unwrap();
    assert_eq!(file.as_file_mut().stream_position().unwrap(), HEADER_BYTES);
    file.write_all(payload).unwrap();
    for entry in entries {
        let before = file.as_file_mut().stream_position().unwrap();
        entry.write(file.as_file_mut()).unwrap();
        assert_eq!(
            file.as_file_mut().stream_position().unwrap() - before,
            DIRECTORY_ENTRY_BYTES
        );
    }
    file
}

fn raw_entry(key: NavigationBlockKey, payload_length: u32) -> WireEntry {
    WireEntry {
        kind: key.kind as u32,
        id: key.id,
        offset: HEADER_BYTES,
        decoded_length: payload_length,
        stored_length: payload_length,
        encoding: 0,
    }
}

fn replace_header(file: &mut NamedTempFile, update: impl FnOnce(&mut Header)) {
    file.seek(SeekFrom::Start(0)).unwrap();
    let mut header = Header::read(file.as_file_mut()).unwrap();
    update(&mut header);
    file.seek(SeekFrom::Start(0)).unwrap();
    header.write(file.as_file_mut()).unwrap();
}

#[test]
fn compressed_and_raw_products_roundtrip_with_companion_identity() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("navigation.hnav");
    let cells = b"shared room geometry".repeat(256);
    let mut writer = NavigationArchiveWriter::create(&path, BOOTSTRAP_DIGEST).unwrap();
    writer.add_block(CELLS, &cells).unwrap();
    writer.add_block(GEOMETRY, b"abc").unwrap();
    writer.finish().unwrap();
    let archive = NavigationArchive::open(&path).unwrap();
    assert_eq!(archive.bootstrap_sha256(), &BOOTSTRAP_DIGEST);
    assert_eq!(archive.keys().collect::<Vec<_>>(), vec![CELLS, GEOMETRY]);
    assert_eq!(archive.read_block(CELLS).unwrap(), Some(cells));
    assert_eq!(archive.read_block(GEOMETRY).unwrap(), Some(b"abc".to_vec()));
    assert!(
        archive
            .read_block(NavigationBlockKey {
                kind: NavigationBlockKind::Terrain,
                id: CELLS.id
            })
            .unwrap()
            .is_none()
    );
    assert!(matches!(archive.entries[0].encoding, Encoding::Zstd));
    assert!(matches!(archive.entries[1].encoding, Encoding::Raw));
}

#[test]
fn readers_can_load_distinct_blocks_concurrently() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("navigation.hnav");
    let mut writer = NavigationArchiveWriter::create(&path, BOOTSTRAP_DIGEST).unwrap();
    writer.add_block(CELLS, b"cells").unwrap();
    writer.add_block(GEOMETRY, b"geometry").unwrap();
    writer.finish().unwrap();
    let archive = Arc::new(NavigationArchive::open(&path).unwrap());
    let barrier = Arc::new(Barrier::new(2));
    std::thread::scope(|scope| {
        for (key, expected) in [
            (CELLS, b"cells".as_slice()),
            (GEOMETRY, b"geometry".as_slice()),
        ] {
            let archive = Arc::clone(&archive);
            let barrier = Arc::clone(&barrier);
            scope.spawn(move || {
                barrier.wait();
                assert_eq!(archive.read_block(key).unwrap().unwrap(), expected);
            });
        }
    });
}

#[test]
fn duplicate_write_preserves_the_first_block() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("navigation.hnav");
    let mut writer = NavigationArchiveWriter::create(&path, BOOTSTRAP_DIGEST).unwrap();
    writer.add_block(CELLS, b"first").unwrap();
    assert!(matches!(
        writer.add_block(CELLS, b"second"),
        Err(NavigationArchiveError::Duplicate(CELLS))
    ));
    writer.finish().unwrap();
    assert_eq!(
        NavigationArchive::open(&path)
            .unwrap()
            .read_block(CELLS)
            .unwrap()
            .unwrap(),
        b"first"
    );
    assert!(matches!(
        NavigationArchiveWriter::create(&path, BOOTSTRAP_DIGEST),
        Err(NavigationArchiveError::Io(_))
    ));
}

#[test]
fn fixed_input_generates_identical_files() {
    let dir = TempDir::new().unwrap();
    let mut bytes = Vec::new();
    for name in ["first.hnav", "second.hnav"] {
        let path = dir.path().join(name);
        let mut writer = NavigationArchiveWriter::create(&path, BOOTSTRAP_DIGEST).unwrap();
        writer
            .add_block(GEOMETRY, &b"structure".repeat(32))
            .unwrap();
        writer.add_block(CELLS, b"cell").unwrap();
        writer.finish().unwrap();
        bytes.push(std::fs::read(path).unwrap());
    }
    assert_eq!(bytes[0], bytes[1]);
}

#[test]
fn wrong_magic_and_unsupported_version_are_distinct() {
    let mut file = fixture(&[], &[]);
    replace_header(&mut file, |h| h.magic[0] ^= 0xff);
    assert!(matches!(
        NavigationArchive::open(file.path()),
        Err(NavigationArchiveError::Magic)
    ));
    let mut file = fixture(&[], &[]);
    replace_header(&mut file, |h| h.version = NAVIGATION_FORMAT_VERSION + 1);
    assert!(matches!(
        NavigationArchive::open(file.path()),
        Err(NavigationArchiveError::Version(_))
    ));
}

#[test]
fn truncated_header_and_invalid_directory_are_rejected() {
    let file = NamedTempFile::new().unwrap();
    assert!(matches!(
        NavigationArchive::open(file.path()),
        Err(NavigationArchiveError::Wire(_))
    ));
    for offset in [HEADER_BYTES - 1, u64::MAX] {
        let mut file = fixture(&[], &[]);
        replace_header(&mut file, |h| {
            h.directory_offset = offset;
            h.entry_count = 1;
        });
        assert!(matches!(
            NavigationArchive::open(file.path()),
            Err(NavigationArchiveError::DirectoryRange)
        ));
    }
}

#[test]
fn unknown_kind_and_encoding_are_rejected() {
    let mut entry = raw_entry(CELLS, 1);
    entry.kind = u32::MAX;
    let file = fixture(b"x", &[entry]);
    assert!(matches!(
        NavigationArchive::open(file.path()),
        Err(NavigationArchiveError::BlockKind(_))
    ));
    entry.kind = CELLS.kind as u32;
    entry.encoding = u32::MAX;
    let file = fixture(b"x", &[entry]);
    assert!(matches!(
        NavigationArchive::open(file.path()),
        Err(NavigationArchiveError::Encoding(_))
    ));
}

#[test]
fn duplicate_and_reversed_directory_keys_are_rejected() {
    let first = raw_entry(CELLS, 1);
    for second in [
        first,
        raw_entry(
            NavigationBlockKey {
                id: CELLS.id - 1,
                ..CELLS
            },
            1,
        ),
    ] {
        let file = fixture(b"x", &[first, second]);
        assert!(matches!(
            NavigationArchive::open(file.path()),
            Err(NavigationArchiveError::DirectoryOrder)
        ));
    }
}

#[test]
fn payload_range_and_raw_length_are_validated() {
    for offset in [HEADER_BYTES - 1, HEADER_BYTES + 1, u64::MAX] {
        let mut entry = raw_entry(CELLS, 1);
        entry.offset = offset;
        let file = fixture(b"x", &[entry]);
        assert!(matches!(
            NavigationArchive::open(file.path()),
            Err(NavigationArchiveError::BlockRange(CELLS))
        ));
    }
    let mut entry = raw_entry(CELLS, 1);
    entry.decoded_length += 1;
    let file = fixture(b"x", &[entry]);
    assert!(matches!(
        NavigationArchive::open(file.path()),
        Err(NavigationArchiveError::RawLength(CELLS))
    ));
}

#[test]
fn compressed_length_mismatch_is_checked_on_read() {
    let decoded = b"cell portal planes".repeat(128);
    let payload = zstd::encode_all(Cursor::new(&decoded), 3).unwrap();
    for declared in [decoded.len() - 1, decoded.len() + 1] {
        let entry = WireEntry {
            decoded_length: declared as u32,
            encoding: 1,
            ..raw_entry(CELLS, payload.len() as u32)
        };
        let file = fixture(&payload, &[entry]);
        let archive = NavigationArchive::open(file.path()).unwrap();
        assert!(matches!(
            archive.read_block(CELLS),
            Err(NavigationArchiveError::DecodedLength(CELLS))
        ));
    }
}

#[test]
fn selecting_a_pair_rejects_a_different_bootstrap_generation() {
    let dir = TempDir::new().unwrap();
    let bootstrap = dir.path().join("bootstrap.hba");
    let navigation = dir.path().join("navigation.hnav");
    std::fs::write(&bootstrap, b"first bootstrap generation").unwrap();
    let digest = sha256_file(&bootstrap).unwrap();
    NavigationArchiveWriter::create(&navigation, digest)
        .unwrap()
        .finish()
        .unwrap();
    NavigationArchive::open_for_bootstrap(&navigation, &bootstrap).unwrap();
    std::fs::write(&bootstrap, b"second bootstrap generation").unwrap();
    assert!(matches!(
        NavigationArchive::open_for_bootstrap(&navigation, &bootstrap),
        Err(NavigationArchiveError::BootstrapMismatch)
    ));
}

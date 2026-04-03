use holtburger_dat::{
    DatDatabase, DatFileType, EOR_PORTAL_NAMESPACE, HbaReader, HbaWriter, ResourceProvider,
};
use tempfile::NamedTempFile;
mod common;
use common::get_portal_dat_path;

#[test]
fn test_hba_parity_with_retail_portal() {
    let dat_path = match get_portal_dat_path() {
        Some(path) => path,
        None => {
            println!("Skipping parity test: HOLTBURGER_PORTAL_DAT not set and fallback not found");
            return;
        }
    };

    println!("Starting parity test for {:?}", dat_path);
    let dat_db = DatDatabase::new(&dat_path).expect("Failed to open retail DAT");

    // 1. Create a Lite HBA in memory/temp file
    let mut writer = HbaWriter::new();
    writer.set_compression(true);

    let mut kept_ids = Vec::new();
    for &id in dat_db.files.keys() {
        if DatFileType::from_id(id).is_essential() {
            let data = dat_db.get_file(id).expect("Failed to read from DAT");
            writer
                .add(EOR_PORTAL_NAMESPACE, id, id >> 24, data)
                .expect("Failed to add to writer");
            kept_ids.push(id);
        }
    }

    let temp_hba = NamedTempFile::new().expect("Failed to create temp file");
    writer.write(temp_hba.path()).expect("Failed to write HBA");

    // 2. Open the HBA and verify parity
    let hba_reader = HbaReader::open(temp_hba.path()).expect("Failed to open generated HBA");

    println!("Verifying parity for {} files...", kept_ids.len());
    let mut verified_count = 0;

    for id in kept_ids {
        let dat_data = dat_db.get_file(id).expect("Failed to get file from DAT");
        let hba_data = hba_reader
            .get_file(id)
            .expect("Failed to get file from HBA");

        assert_eq!(
            dat_data.len(),
            hba_data.len(),
            "Size mismatch for file 0x{:08X}",
            id
        );

        // We only check a subset of bytes if there are thousands of files to speed it up,
        // or just check everything since it's an integration test.
        assert_eq!(
            dat_data, hba_data,
            "Byte parity mismatch for file 0x{:08X}",
            id
        );

        verified_count += 1;
        if verified_count % 5000 == 0 {
            println!("Verified {} files...", verified_count);
        }
    }

    println!(
        "SUCCESS: Verified parity for {}/{} essential files.",
        verified_count,
        dat_db.files.len()
    );
}

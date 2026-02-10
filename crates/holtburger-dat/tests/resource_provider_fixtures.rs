use holtburger_dat::{DatDatabase, ResourceProvider};

mod common;

use common::get_portal_dat_path;

#[test]
fn test_retail_dat_provider() {
    let dat_path = match get_portal_dat_path() {
        Some(path) => path,
        None => {
            println!("Skipping test: HOLTBURGER_PORTAL_DAT not set and fallback not found");
            return;
        }
    };

    let db = DatDatabase::new(&dat_path).expect("Failed to open portal.dat");

    // List first 5 file IDs for debugging if needed
    let first_ids: Vec<u32> = db.files.keys().take(5).cloned().collect();
    println!("Found file IDs: {:08X?}", first_ids);

    assert!(!db.files.is_empty(), "Database should not be empty");

    // Pick the first one and try to read it
    let first_id = *db.files.keys().next().unwrap();
    assert!(db.exists(first_id));

    let data = db.get_file(first_id).expect("Should be able to read data");
    assert!(!data.is_empty(), "Data should not be empty");
}

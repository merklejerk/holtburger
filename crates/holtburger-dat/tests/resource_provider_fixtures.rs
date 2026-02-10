use holtburger_dat::{DatDatabase, ResourceProvider};
use std::path::PathBuf;

#[test]
fn test_retail_dat_provider() {
    let mut dat_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dat_path.push("../../ace-root/dats/client_portal.dat");

    if !dat_path.exists() {
        println!("Skipping test: retail DAT not found at {:?}", dat_path);
        return;
    }

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

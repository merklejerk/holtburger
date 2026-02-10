use criterion::{black_box, criterion_group, criterion_main, Criterion};
use holtburger_dat::{DatDatabase, DatFileType, HbaReader, HbaWriter, ResourceProvider};
use std::path::PathBuf;
use tempfile::NamedTempFile;

fn get_portal_dat_path() -> Option<PathBuf> {
    if let Ok(path_str) = std::env::var("HOLTBURGER_PORTAL_DAT") {
        let path = PathBuf::from(path_str);
        if path.exists() { return Some(path); }
    }
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../");
    let fallback = workspace_root.join("ace-root/dats/client_portal.dat");
    if fallback.exists() { return Some(fallback); }
    None
}

fn bench_providers(c: &mut Criterion) {
    let dat_path = match get_portal_dat_path() {
        Some(path) => path,
        None => return,
    };

    let dat_db = DatDatabase::new(&dat_path).expect("Failed to open DAT");
    
    // Select 50 file IDs to cycle through
    let ids: Vec<u32> = dat_db.files.keys()
        .filter(|&&id| DatFileType::from_id(id).is_essential())
        .take(50)
        .cloned()
        .collect();

    // Create an HBA for benchmarking
    let mut writer = HbaWriter::new();
    writer.set_compression(true);
    for &id in &ids {
        let data = dat_db.get_file(id).unwrap();
        writer.add(id, (id >> 24) as u32, data);
    }
    
    let temp_hba = NamedTempFile::new().unwrap();
    writer.write(temp_hba.path()).unwrap();
    let hba = HbaReader::open(temp_hba.path()).unwrap();

    let mut group = c.benchmark_group("ResourceProvider");

    group.bench_function("DatDatabase::get_file", |b| {
        let mut i = 0;
        b.iter(|| {
            let id = ids[i % ids.len()];
            black_box(dat_db.get_file(id).unwrap());
            i += 1;
        })
    });

    group.bench_function("HbaReader::get_file (Compressed)", |b| {
        let mut i = 0;
        b.iter(|| {
            let id = ids[i % ids.len()];
            black_box(hba.get_file(id).unwrap());
            i += 1;
        })
    });

    group.finish();
}

criterion_group!(benches, bench_providers);
criterion_main!(benches);

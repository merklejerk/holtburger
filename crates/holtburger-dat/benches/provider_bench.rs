use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use holtburger_dat::{
    DatDatabase, DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaReader, HbaWriter,
    ResourceProvider,
};
use tempfile::NamedTempFile;

const SYNTHETIC_NAMESPACE_ENTRIES: u32 = 4096;

fn bench_providers(c: &mut Criterion) {
    let dat_path = match holtburger_dat::utils::get_portal_dat_path() {
        Some(path) => path,
        None => return,
    };

    let dat_db = DatDatabase::new(&dat_path).expect("Failed to open DAT");

    // Select 50 file IDs to cycle through
    let ids: Vec<u32> = dat_db
        .files
        .keys()
        .filter(|&&id| DatFileType::from_id(id).is_essential())
        .take(50)
        .cloned()
        .collect();

    // Create an HBA for benchmarking
    let mut writer = HbaWriter::new();
    writer.set_compression(true);
    for &id in &ids {
        let data = dat_db.get_file(id).unwrap();
        writer
            .add(EOR_PORTAL_NAMESPACE, id, id >> 24, data)
            .expect("Benchmark failed to build HBA");
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

fn bench_namespaced_hba(c: &mut Criterion) {
    let ids: Vec<u32> = (0..SYNTHETIC_NAMESPACE_ENTRIES)
        .map(|index| 0x0E00_0000u32 + index)
        .collect();

    let mut writer = HbaWriter::new();
    writer.set_compression(false);
    for &id in &ids {
        let payload = vec![(id & 0xFF) as u8; 96];
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                id,
                DatFileType::Table as u32,
                payload.clone(),
            )
            .expect("Synthetic portal HBA entry should be added");
        writer
            .add(
                EOR_CELL_NAMESPACE,
                id,
                DatFileType::Landblock as u32,
                payload,
            )
            .expect("Synthetic cell HBA entry should be added");
    }

    let temp_hba = NamedTempFile::new().unwrap();
    writer.write(temp_hba.path()).unwrap();
    let hba = HbaReader::open(temp_hba.path()).unwrap();

    let mut group = c.benchmark_group("NamespacedHbaReader");

    group.bench_function("find_entry_in_namespace", |b| {
        let mut i = 0;
        b.iter(|| {
            let id = ids[i % ids.len()];
            black_box(
                hba.find_entry_in_namespace(EOR_PORTAL_NAMESPACE, id)
                    .unwrap(),
            );
            i += 1;
        })
    });

    group.bench_function("get_file_in_namespace", |b| {
        let mut i = 0;
        b.iter(|| {
            let id = ids[i % ids.len()];
            black_box(hba.get_file_in_namespace(EOR_CELL_NAMESPACE, id).unwrap());
            i += 1;
        })
    });

    group.bench_function("entries_iteration", |b| {
        b.iter(|| {
            let count = hba.entries().count();
            black_box(count);
        })
    });

    group.finish();
}

criterion_group!(benches, bench_providers, bench_namespaced_hba);
criterion_main!(benches);

//! Character-layout census: setup parent indices used by humanoid gesture composition.
use anyhow::Result;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::{CharGen, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use std::io::Cursor;
fn main() -> Result<()> {
    let content = ContentRepository::discover(None)?;
    let read = |id| -> Result<Vec<u8>> {
        Ok(content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, id))?
            .bytes)
    };
    let chargen = CharGen::read(&mut Cursor::new(read(CharGen::FILE_ID)?))?;
    let mut groups: Vec<_> = chargen.heritage_groups.values().collect();
    groups.sort_by_key(|g| &g.name);
    for heritage in groups {
        for gender in heritage.genders.values() {
            let setup = SetupModel::read(&mut Cursor::new(read(gender.setup_id)?))?;
            println!(
                "{} {} setup={:#010x} motion={:#010x} parts={} parents={:?}",
                heritage.name,
                gender.name,
                gender.setup_id,
                gender.motion_table,
                setup.parts.len(),
                setup.parent_index
            );
        }
    }
    Ok(())
}

//! Real-asset visual probe. Run from the repository root with an output directory argument.
use anyhow::{Context, Result};
use holtburger_3d_host::ui_icons::{
    PrepareUiIconsRequest, UiIconRequest, UiIconResult, UiIconSpec, prepare_ui_icons,
};
use holtburger_common::properties::ItemType;
use holtburger_content::ContentRepository;
use std::{num::NonZeroU32, path::PathBuf};
fn main() -> Result<()> {
    let directory = PathBuf::from(
        std::env::args()
            .nth(1)
            .context("provide output directory")?,
    );
    std::fs::create_dir_all(&directory)?;
    let repository = ContentRepository::discover(Some("dats".into()))?;
    let item = |base, kind: ItemType, effects, overlay, underlay| UiIconSpec::Item {
        base: NonZeroU32::new(base),
        item_type: kind.bits(),
        ui_effects: effects,
        overlay: NonZeroU32::new(overlay),
        underlay: NonZeroU32::new(underlay),
    };
    let specs = vec![
        // ACE World WCID 273 (coinstack), PropertyDataId.Icon (8).
        UiIconSpec::Base {
            base: NonZeroU32::new(0x0600229f).context("pyreal icon ID")?,
        },
        UiIconSpec::MainPack {
            overlay: None,
            underlay: None,
            ui_effects: 0,
        },
        item(0x06002276, ItemType::CLOTHING, 0, 0, 0),
        item(0x06002276, ItemType::CLOTHING, 1, 0, 0),
        item(0x06006bf2, ItemType::JEWELRY, 0, 0x06006c38, 0),
        item(0x06002276, ItemType::CLOTHING, 1, 0, 0x06005b0c),
        item(0x0600127e, ItemType::SERVICE, 0, 0, 0),
        item(0x06003788, ItemType::MISC, 0, 0, 0),
        item(0x06002276, ItemType::CLOTHING, 0, 0x06006d77, 0),
    ];
    let request = PrepareUiIconsRequest {
        icons: specs
            .into_iter()
            .enumerate()
            .map(|(index, spec)| UiIconRequest {
                key: index.to_string(),
                spec,
            })
            .collect(),
    };
    for icon in prepare_ui_icons(&repository, &request)? {
        let (image, issues) = match icon.result {
            UiIconResult::Ready { image } => (image, None),
            UiIconResult::Degraded { image, issues } => (image, Some(issues)),
            UiIconResult::Failed { issues } => anyhow::bail!("{}: {issues:?}", icon.key),
        };
        std::fs::write(directory.join(format!("{}.png", icon.key)), image)?;
        println!("{}: {}", icon.key, serde_json::to_string(&issues)?);
    }
    Ok(())
}

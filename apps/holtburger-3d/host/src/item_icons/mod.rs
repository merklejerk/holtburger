//! App-local retail icon recipe resolution and bounded PNG preparation.

pub mod compositor;

use crate::protocol::{HostResponse, ProtocolFrame, encode_frame};
use anyhow::{Result, ensure};
use compositor::{ICON_SIZE, IconLayers, compose};
use holtburger_content::{
    ContentRepository,
    ui_assets::{UiAssetError, UiAssetReader, UiAssets, UiImage},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    num::NonZeroU32,
    sync::Arc,
};

/// Measured latency-friendly ceiling; one frontend repository dispatches one batch at a time.
pub const MAX_ICON_BATCH: usize = 32;
/// Maximum encoded icon request/response, including the host frame envelope.
pub const MAX_ICON_FRAME_BYTES: usize = 256 * 1024;
/// Correlation keys are bounded independently of item names or asset error text.
pub const MAX_ICON_KEY_BYTES: usize = 128;
const BACKGROUNDS: u32 = 0x10000004;
const EFFECTS: u32 = 0x10000005;
const UI_ASSETS: u32 = 7;
const PLAYER_ICON: u32 = 0x10000004;
const DEFAULT_ENTRY: u32 = 33;
const CONTAINER_ENTRY: u32 = 10;

/// Semantic icon inputs only; main-pack role is selected by frontend player identity.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ItemIconSpec {
    /// Standalone authored graphic, without category backing or item effects.
    Base {
        /// Required RenderSurface identity, independent of a live item.
        base: NonZeroU32,
    },
    Item {
        /// Nonzero server base DID, absent before one is assigned.
        base: Option<NonZeroU32>,
        /// Complete public classification; the resolver owns lowest-bit interpretation.
        item_type: u32,
        /// Optional authored layer above the base.
        overlay: Option<NonZeroU32>,
        /// Optional authored layer below the working base.
        underlay: Option<NonZeroU32>,
        /// Full server mask; irrelevant higher bits do not change the resolved recipe.
        ui_effects: u32,
    },
    MainPack {
        /// Player-authored custom layer; main pack only overrides base and background.
        overlay: Option<NonZeroU32>,
        /// Player-authored underlay.
        underlay: Option<NonZeroU32>,
        /// Player's server effects mask.
        ui_effects: u32,
    },
}

/// One opaque frontend correlation key and its complete inputs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ItemIconRequest {
    pub key: String,
    pub spec: ItemIconSpec,
}

/// A batch has unique keys and is bounded before any asset work begins.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrepareItemIconsRequest {
    pub icons: Vec<ItemIconRequest>,
}

/// Layer context for console diagnostics; it does not expose server item identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum IconLayer {
    Base,
    Background,
    Effects,
    Overlay,
    Underlay,
    Composition,
}

/// One visible degradation or required-art failure. Detail is bounded at its producer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconIssue {
    pub layer: IconLayer,
    pub code: IconIssueCode,
    /// Optional source DID; mapping errors identify mapper/enum in the detail.
    pub asset_id: Option<u32>,
    pub detail: String,
}

/// Stable failure categories used by presentation diagnostics, not retry policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum IconIssueCode {
    UnassignedBase,
    MissingMapping,
    MissingAsset,
    UnsupportedFormat,
    Decode,
    Composition,
}

/// Nonempty by construction; malformed states cannot serialize as a failure with no reason.
#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct IconIssues(Vec<IconIssue>);

/// Exactly one terminal outcome per requested key.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ItemIconResult {
    Ready {
        #[serde(with = "serde_bytes")]
        image: Vec<u8>,
    },
    Degraded {
        #[serde(with = "serde_bytes")]
        image: Vec<u8>,
        issues: IconIssues,
    },
    Failed {
        issues: IconIssues,
    },
}

/// Wire result is flattened for straightforward discriminated-union validation in the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct PreparedItemIcon {
    pub key: String,
    #[serde(flatten)]
    pub result: ItemIconResult,
}

/// Resolved artwork identity, independent of raw masks and per-request degradation reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Recipe {
    Base(u32),
    Composed {
        base: u32,
        background: u32,
        effects: u32,
        overlay: Option<u32>,
        underlay: Option<u32>,
    },
}

/// Resolved cache identity and the artwork required to prepare it.
struct ResolvedIcon {
    recipe: Recipe,
    artwork: ResolvedArtwork,
}

/// Base-only requests never resolve or require decorative layers.
enum ResolvedArtwork {
    Base(Arc<UiImage>),
    Composed {
        base: Arc<UiImage>,
        background: Arc<UiImage>,
        effects: Arc<UiImage>,
        overlay: Option<Arc<UiImage>>,
        underlay: Option<Arc<UiImage>>,
    },
}

impl PrepareItemIconsRequest {
    /// Reject malformed envelopes without decoding content or acquiring runtime locks.
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.icons.is_empty() && self.icons.len() <= MAX_ICON_BATCH,
            "icon batch must contain 1..={MAX_ICON_BATCH} entries"
        );
        let mut keys = HashSet::new();
        for icon in &self.icons {
            ensure!(
                !icon.key.is_empty() && icon.key.len() <= MAX_ICON_KEY_BYTES,
                "icon key must contain 1..={MAX_ICON_KEY_BYTES} bytes"
            );
            ensure!(keys.insert(&icon.key), "duplicate icon request key");
        }
        Ok(())
    }
}

/// Synchronous CPU/content work; the host adapter invokes this through spawn_blocking.
pub fn prepare_item_icons(
    repository: &ContentRepository,
    request: &PrepareItemIconsRequest,
) -> Result<Vec<PreparedItemIcon>> {
    prepare_with_assets(&mut UiAssetReader::new(repository), request)
}

/// Prepare and encode the binary response off the async runtime workers.
/// The maximum-width request ID accounts for the actual protocol response envelope.
pub async fn prepare_item_icon_bytes(
    repository: Arc<ContentRepository>,
    request: PrepareItemIconsRequest,
) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || {
        let icons = prepare_item_icons(&repository, &request)?;
        encode_response(&icons)
    })
    .await?
}

fn encode_response(icons: &[PreparedItemIcon]) -> Result<Vec<u8>> {
    let bytes = rmp_serde::to_vec_named(icons)?;
    let frame = encode_frame(&ProtocolFrame::Response {
        id: u64::MAX,
        result: Ok(HostResponse::Binary(bytes.clone())),
    })?;
    ensure!(
        frame.len() <= MAX_ICON_FRAME_BYTES,
        "icon response exceeds byte limit"
    );
    Ok(bytes)
}

fn prepare_with_assets(
    assets: &mut impl UiAssets,
    request: &PrepareItemIconsRequest,
) -> Result<Vec<PreparedItemIcon>> {
    request.validate()?;
    let mut images: HashMap<Recipe, Vec<u8>> = HashMap::new();
    let mut output = Vec::with_capacity(request.icons.len());
    for request in &request.icons {
        let mut issues = Vec::new();
        let prepared = resolve(assets, &request.spec, &mut issues).and_then(|resolved| {
            if let Some(image) = images.get(&resolved.recipe) {
                return Ok(image.clone());
            }
            let pixels = match &resolved.artwork {
                ResolvedArtwork::Base(base) => compositor::canvas(base),
                ResolvedArtwork::Composed {
                    base,
                    background,
                    effects,
                    overlay,
                    underlay,
                } => compose(IconLayers {
                    base,
                    background,
                    effects,
                    overlay: overlay.as_deref(),
                    underlay: underlay.as_deref(),
                }),
            }
            .map_err(|e| issue(IconLayer::Composition, IconIssueCode::Composition, None, e))?;
            let image = encode_png(&pixels)
                .map_err(|e| issue(IconLayer::Composition, IconIssueCode::Composition, None, e))?;
            images.insert(resolved.recipe, image.clone());
            Ok(image)
        });
        let result = match prepared {
            Ok(image) if issues.is_empty() => ItemIconResult::Ready { image },
            Ok(image) => ItemIconResult::Degraded {
                image,
                issues: IconIssues(issues),
            },
            Err(error) => {
                issues.push(error);
                ItemIconResult::Failed {
                    issues: IconIssues(issues),
                }
            }
        };
        output.push(PreparedItemIcon {
            key: request.key.clone(),
            result,
        });
    }
    Ok(output)
}

fn resolve(
    assets: &mut impl UiAssets,
    spec: &ItemIconSpec,
    issues: &mut Vec<IconIssue>,
) -> Result<ResolvedIcon, IconIssue> {
    let (base_id, background_entry, overlay, underlay, effects) = match *spec {
        ItemIconSpec::Base { base } => {
            return Ok(ResolvedIcon {
                recipe: Recipe::Base(base.get()),
                artwork: ResolvedArtwork::Base(
                    assets
                        .image(base.get())
                        .map_err(|e| asset_issue(IconLayer::Base, e))?,
                ),
            });
        }
        ItemIconSpec::Item {
            base,
            item_type,
            overlay,
            underlay,
            ui_effects,
        } => (
            base.map(NonZeroU32::get).ok_or_else(|| {
                issue(
                    IconLayer::Base,
                    IconIssueCode::UnassignedBase,
                    None,
                    "no base icon assigned",
                )
            })?,
            mask_entry(item_type),
            overlay,
            underlay,
            ui_effects,
        ),
        ItemIconSpec::MainPack {
            overlay,
            underlay,
            ui_effects,
        } => (
            assets
                .enum_did(UI_ASSETS, PLAYER_ICON)
                .map_err(|e| asset_issue(IconLayer::Base, e))?,
            CONTAINER_ENTRY,
            overlay,
            underlay,
            ui_effects,
        ),
    };
    let base = assets
        .image(base_id)
        .map_err(|e| asset_issue(IconLayer::Base, e))?;
    let background_id = assets
        .enum_did(BACKGROUNDS, background_entry)
        .map_err(|e| asset_issue(IconLayer::Background, e))?;
    let background = assets
        .image(background_id)
        .map_err(|e| asset_issue(IconLayer::Background, e))?;
    let preferred = mask_entry(effects);
    let load_effect = |assets: &mut dyn UiAssets, entry| {
        let id = assets.enum_did(EFFECTS, entry)?;
        Ok::<_, UiAssetError>((id, assets.image(id)?))
    };
    let (effects_id, effects) = match load_effect(assets, preferred) {
        Ok(value) => value,
        Err(error) if preferred != DEFAULT_ENTRY => {
            issues.push(asset_issue(IconLayer::Effects, error));
            load_effect(assets, DEFAULT_ENTRY).map_err(|e| asset_issue(IconLayer::Effects, e))?
        }
        Err(error) => return Err(asset_issue(IconLayer::Effects, error)),
    };
    let overlay = optional_image(assets, overlay, IconLayer::Overlay, issues);
    let underlay = optional_image(assets, underlay, IconLayer::Underlay, issues);
    Ok(ResolvedIcon {
        recipe: Recipe::Composed {
            base: base_id,
            background: background_id,
            effects: effects_id,
            overlay: overlay.as_ref().map(|(id, _)| *id),
            underlay: underlay.as_ref().map(|(id, _)| *id),
        },
        artwork: ResolvedArtwork::Composed {
            base,
            background,
            effects,
            overlay: overlay.map(|(_, image)| image),
            underlay: underlay.map(|(_, image)| image),
        },
    })
}

fn optional_image(
    assets: &mut impl UiAssets,
    id: Option<NonZeroU32>,
    layer: IconLayer,
    issues: &mut Vec<IconIssue>,
) -> Option<(u32, Arc<UiImage>)> {
    let id = id?.get();
    match assets.image(id) {
        Ok(image) => Some((id, image)),
        Err(error) => {
            issues.push(asset_issue(layer, error));
            None
        }
    }
}

fn mask_entry(mask: u32) -> u32 {
    mask.trailing_zeros() + 1
}

fn asset_issue(layer: IconLayer, error: UiAssetError) -> IconIssue {
    let (code, id) = match &error {
        UiAssetError::MissingMapping { .. } => (IconIssueCode::MissingMapping, None),
        UiAssetError::MissingAsset { id } => (IconIssueCode::MissingAsset, Some(*id)),
        UiAssetError::InvalidAsset { id, .. } => (IconIssueCode::Decode, Some(*id)),
        UiAssetError::UnsupportedFormat { id, .. } => (IconIssueCode::UnsupportedFormat, Some(*id)),
    };
    issue(layer, code, id, error)
}

fn issue(
    layer: IconLayer,
    code: IconIssueCode,
    asset_id: Option<u32>,
    detail: impl std::fmt::Display,
) -> IconIssue {
    // Source paths/decoder text are diagnostic only; bound them before crossing transport.
    IconIssue {
        layer,
        code,
        asset_id,
        detail: detail.to_string().chars().take(256).collect(),
    }
}

fn encode_png(pixels: &[u8]) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, ICON_SIZE as u32, ICON_SIZE as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        encoder.write_header()?.write_image_data(pixels)?;
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests;

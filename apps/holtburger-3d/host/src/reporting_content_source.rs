//! App-local adapters report necessary background loads before worker diagnostics become text.

use std::sync::Arc;

use anyhow::Result;
use holtburger_content::{LandblockCollisionAsset, LandblockSceneClass, SceneContentSource};
use holtburger_core::{
    ClientBodySource, ClientDynamicScriptFacts, ClientDynamicScriptSource, ClientEntityBodyFacts,
    ClientSelectionEnvelopeProfile, ClientSelectionEnvelopeSource, PreparedClientDynamicScript,
    PreparedDynamicScriptTimeline,
};
use holtburger_world::{DynamicPhysicalBodyDefinition, SelectionEnvelope, SelectionGeometry};

use crate::content_failure::ContentFailureReporter;
use crate::host_simulation_runtime::CollisionSource;

/// Preserves each existing source contract, adding only native required-failure reporting.
pub struct ReportingContentSource<T> {
    inner: T,
    failures: ContentFailureReporter,
}

impl<T: ClientDynamicScriptSource> ClientDynamicScriptSource for ReportingContentSource<T> {
    fn prepare_generation(
        &self,
        facts: ClientDynamicScriptFacts,
    ) -> Result<PreparedClientDynamicScript> {
        self.failures.required(self.inner.prepare_generation(facts))
    }

    fn prepare_cue(
        &self,
        table_did: u32,
        cue: u32,
        intensity: f32,
    ) -> Result<Option<Arc<PreparedDynamicScriptTimeline>>> {
        self.failures
            .required(self.inner.prepare_cue(table_did, cue, intensity))
    }
}

impl<T> ReportingContentSource<T> {
    /// The host explicitly supplies both the actual source and its reporting lifecycle.
    pub fn new(inner: T, failures: ContentFailureReporter) -> Self {
        Self { inner, failures }
    }
}

impl<T: SceneContentSource> SceneContentSource for ReportingContentSource<T> {
    fn load_scene_class(&self, owner: u32) -> Result<Option<LandblockSceneClass>> {
        self.failures.required(self.inner.load_scene_class(owner))
    }

    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        self.failures
            .required(self.inner.load_collision(landblock_id))
    }
}

impl<T: ClientBodySource> ClientBodySource for ReportingContentSource<T> {
    fn prepare_body(&self, facts: ClientEntityBodyFacts) -> Result<DynamicPhysicalBodyDefinition> {
        self.failures.required(self.inner.prepare_body(facts))
    }
}

impl<T: ClientSelectionEnvelopeSource> ClientSelectionEnvelopeSource for ReportingContentSource<T> {
    fn resolve_profile(
        &self,
        geometry: &SelectionGeometry,
    ) -> Result<ClientSelectionEnvelopeProfile> {
        self.failures.required(self.inner.resolve_profile(geometry))
    }

    fn prepare_envelope(
        &self,
        profile: &ClientSelectionEnvelopeProfile,
    ) -> Result<SelectionEnvelope> {
        self.failures.required(self.inner.prepare_envelope(profile))
    }
}

impl<T: CollisionSource> CollisionSource for ReportingContentSource<T> {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        self.failures
            .required(self.inner.load_collision(landblock_id))
    }
}

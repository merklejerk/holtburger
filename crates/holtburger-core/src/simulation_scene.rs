//! Body-neutral desired, pending, and installed static-collision residency.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use holtburger_common::Guid;
use holtburger_common::position::{MAX_OUTDOOR_LANDBLOCK_AXIS, WorldPosition};
use holtburger_content::{LandblockCollisionAsset, normalize_landblock_id};
use holtburger_world::{CollisionScene, CollisionSceneUpdateError};
use thiserror::Error;

/// Deterministically ordered normalized collision-owner demand selected by application policy.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SimulationSceneInterest {
    owners: Vec<Guid>,
}

impl SimulationSceneInterest {
    /// Validates, sorts, and deduplicates a complete owner set.
    pub fn new(
        owners: impl IntoIterator<Item = Guid>,
    ) -> Result<Self, SimulationSceneResidencyError> {
        let mut normalized = BTreeSet::new();
        for owner in owners {
            if owner.0 != normalize_landblock_id(owner.0) {
                return Err(SimulationSceneResidencyError::InvalidOwner { owner });
            }
            normalized.insert(owner);
        }
        Ok(Self {
            owners: normalized.into_iter().collect(),
        })
    }

    /// Derives a bounded square prefetch neighborhood around one authoritative position.
    pub fn prefetch_neighborhood(position: WorldPosition, radius: i8) -> Option<Self> {
        if position.landblock_id == Guid::NULL || radius < 0 {
            return None;
        }
        let (x, y) = position.landblock_coords();
        let mut owners = Vec::new();
        for offset_x in -radius..=radius {
            for offset_y in -radius..=radius {
                let owner_x = i16::from(x) + i16::from(offset_x);
                let owner_y = i16::from(y) + i16::from(offset_y);
                if !(0..=i16::from(MAX_OUTDOOR_LANDBLOCK_AXIS)).contains(&owner_x)
                    || !(0..=i16::from(MAX_OUTDOOR_LANDBLOCK_AXIS)).contains(&owner_y)
                {
                    continue;
                }
                owners.push(Guid(
                    ((owner_x as u32) << 24) | ((owner_y as u32) << 16) | 0xffff,
                ));
            }
        }
        Some(Self::new(owners).expect("bounded prefetch owners are normalized by construction"))
    }

    /// Returns owners in deterministic ascending order.
    pub fn owners(&self) -> &[Guid] {
        &self.owners
    }
}

/// Current availability of one owner in the desired or installed collision revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SimulationSceneOwnerAvailability {
    /// A complete owner product is installed with this owner-scoped revision.
    Resident {
        /// Revision of the exact installed owner product.
        owner_revision: u64,
    },
    /// The owner is being resolved for this request revision.
    Pending {
        /// Exact request whose completion may replace this state.
        request_revision: u64,
    },
    /// The content source authoritatively contains no product for this owner.
    Absent,
    /// Loading or decoding the owner failed for the current content-source generation.
    Failed {
        /// Retained operational failure cause.
        cause: String,
    },
}

/// One owner operation required to complete a requested scene revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SimulationSceneOwnerRequest {
    /// Reuse the exact installed product without another source load.
    Retain {
        /// Normalized product owner.
        owner: Guid,
        /// Installed revision that the completion must echo.
        owner_revision: u64,
    },
    /// Resolve a complete product from the current content source.
    Load {
        /// Normalized product owner.
        owner: Guid,
    },
    /// Reuse an authoritative absence from the current content-source generation.
    RetainAbsent {
        /// Normalized product owner.
        owner: Guid,
    },
    /// Reuse a load/decode failure from the current content-source generation.
    RetainFailed {
        /// Normalized product owner.
        owner: Guid,
        /// Retained operational failure cause.
        cause: String,
    },
}

impl SimulationSceneOwnerRequest {
    /// Returns the normalized owner named by this operation.
    pub fn owner(&self) -> Guid {
        match self {
            Self::Retain { owner, .. }
            | Self::Load { owner }
            | Self::RetainAbsent { owner }
            | Self::RetainFailed { owner, .. } => *owner,
        }
    }
}

/// Exact desired revision handed to a composition-owned loader.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SimulationSceneRequest {
    /// Content-source lifetime under which terminal results remain stable.
    pub content_source_generation: u64,
    /// Monotonic desired request revision.
    pub request_revision: u64,
    /// Complete normalized interest selected by policy.
    pub interest: SimulationSceneInterest,
    /// One operation for every requested owner, in interest order.
    pub owners: Vec<SimulationSceneOwnerRequest>,
}

/// Source or retained outcome for one owner in a complete batch.
#[derive(Debug, Clone)]
pub enum SimulationSceneOwnerOutcome {
    /// Newly resolved complete collision product.
    Resident(LandblockCollisionAsset),
    /// Existing installed product retained without reloading.
    Retained {
        /// Normalized product owner.
        owner: Guid,
        /// Exact installed owner revision being retained.
        owner_revision: u64,
    },
    /// The current content source authoritatively has no product.
    Absent {
        /// Normalized product owner.
        owner: Guid,
    },
    /// The current content source failed to load or decode the product.
    Failed {
        /// Normalized product owner.
        owner: Guid,
        /// Retained operational failure cause.
        cause: String,
    },
}

impl SimulationSceneOwnerOutcome {
    fn owner(&self) -> Guid {
        match self {
            Self::Resident(asset) => Guid(normalize_landblock_id(asset.landblock_id)),
            Self::Retained { owner, .. } | Self::Absent { owner } | Self::Failed { owner, .. } => {
                *owner
            }
        }
    }
}

/// Complete composition-owned resolution of one desired request.
#[derive(Debug, Clone)]
pub struct SimulationSceneBatchCompletion {
    /// Content-source lifetime sampled by the loader.
    pub content_source_generation: u64,
    /// Desired request revision sampled by the loader.
    pub request_revision: u64,
    /// Exactly one outcome for every requested owner.
    pub outcomes: Vec<SimulationSceneOwnerOutcome>,
}

/// One immutable installed collision scene and its complete per-owner outcomes.
#[derive(Clone)]
pub struct SimulationSceneSnapshot {
    /// Monotonic installed scene revision.
    pub revision: u64,
    /// Content-source lifetime that supplied resident and terminal outcomes.
    pub content_source_generation: u64,
    /// Exact normalized owner demand represented by this snapshot.
    pub interest: SimulationSceneInterest,
    /// Complete outcomes indexed by requested owner.
    pub availability: BTreeMap<Guid, SimulationSceneOwnerAvailability>,
    /// Immutable collision topology containing exactly the resident outcomes.
    pub scene: Arc<CollisionScene>,
}

impl std::fmt::Debug for SimulationSceneSnapshot {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SimulationSceneSnapshot")
            .field("revision", &self.revision)
            .field("content_source_generation", &self.content_source_generation)
            .field("interest", &self.interest)
            .field("availability", &self.availability)
            .finish_non_exhaustive()
    }
}

/// Result of attempting to publish one asynchronous completion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimulationScenePublication {
    /// The exact current desired revision published atomically.
    Published { scene_revision: u64 },
    /// A newer desired revision or content source retired this completion.
    Stale,
}

/// Fully staged successor built away from composition-owned simulation locks.
pub struct StagedSimulationScenePublication {
    content_source_generation: u64,
    request_revision: u64,
    snapshot: Arc<SimulationSceneSnapshot>,
    availability: BTreeMap<Guid, SimulationSceneOwnerAvailability>,
    terminal: BTreeMap<Guid, SimulationSceneOwnerAvailability>,
}

/// Shared desired/pending/installed state; scheduling and locks remain composition-owned.
#[derive(Clone)]
pub struct SimulationSceneResidency {
    content_source_generation: u64,
    next_request_revision: u64,
    next_scene_revision: u64,
    desired: Option<SimulationSceneRequest>,
    availability: BTreeMap<Guid, SimulationSceneOwnerAvailability>,
    terminal: BTreeMap<Guid, SimulationSceneOwnerAvailability>,
    installed: Arc<SimulationSceneSnapshot>,
}

impl Default for SimulationSceneResidency {
    fn default() -> Self {
        let content_source_generation = 1;
        Self {
            content_source_generation,
            next_request_revision: 0,
            next_scene_revision: 0,
            desired: None,
            availability: BTreeMap::new(),
            terminal: BTreeMap::new(),
            installed: Arc::new(SimulationSceneSnapshot {
                revision: 0,
                content_source_generation,
                interest: SimulationSceneInterest::default(),
                availability: BTreeMap::new(),
                scene: Arc::new(CollisionScene::new()),
            }),
        }
    }
}

impl SimulationSceneResidency {
    /// Returns the immutable scene retained while newer interest is pending or fails to stage.
    pub fn snapshot(&self) -> Arc<SimulationSceneSnapshot> {
        Arc::clone(&self.installed)
    }

    /// Returns current desired-owner availability, including pending work.
    pub fn availability(&self) -> &BTreeMap<Guid, SimulationSceneOwnerAvailability> {
        &self.availability
    }

    /// Starts a new desired revision, or returns `None` when policy demand is unchanged.
    pub fn request_interest(
        &mut self,
        interest: SimulationSceneInterest,
    ) -> Option<SimulationSceneRequest> {
        if self
            .desired
            .as_ref()
            .is_some_and(|desired| desired.interest == interest)
        {
            return None;
        }
        self.next_request_revision = self
            .next_request_revision
            .checked_add(1)
            .expect("simulation-scene request revision exhausted");
        let request_revision = self.next_request_revision;
        let may_retain = self.installed.content_source_generation == self.content_source_generation;
        let owners = interest
            .owners()
            .iter()
            .map(|&owner| {
                if may_retain
                    && let Some(SimulationSceneOwnerAvailability::Resident { owner_revision }) =
                        self.installed.availability.get(&owner)
                {
                    SimulationSceneOwnerRequest::Retain {
                        owner,
                        owner_revision: *owner_revision,
                    }
                } else if let Some(SimulationSceneOwnerAvailability::Absent) =
                    self.terminal.get(&owner)
                {
                    SimulationSceneOwnerRequest::RetainAbsent { owner }
                } else if let Some(SimulationSceneOwnerAvailability::Failed { cause }) =
                    self.terminal.get(&owner)
                {
                    SimulationSceneOwnerRequest::RetainFailed {
                        owner,
                        cause: cause.clone(),
                    }
                } else {
                    SimulationSceneOwnerRequest::Load { owner }
                }
            })
            .collect::<Vec<_>>();
        self.availability = owners
            .iter()
            .map(|operation| match operation {
                SimulationSceneOwnerRequest::Retain {
                    owner,
                    owner_revision,
                } => (
                    *owner,
                    SimulationSceneOwnerAvailability::Resident {
                        owner_revision: *owner_revision,
                    },
                ),
                SimulationSceneOwnerRequest::Load { owner } => (
                    *owner,
                    SimulationSceneOwnerAvailability::Pending { request_revision },
                ),
                SimulationSceneOwnerRequest::RetainAbsent { owner } => {
                    (*owner, SimulationSceneOwnerAvailability::Absent)
                }
                SimulationSceneOwnerRequest::RetainFailed { owner, cause } => (
                    *owner,
                    SimulationSceneOwnerAvailability::Failed {
                        cause: cause.clone(),
                    },
                ),
            })
            .collect();
        let request = SimulationSceneRequest {
            content_source_generation: self.content_source_generation,
            request_revision,
            interest,
            owners,
        };
        self.desired = Some(request.clone());
        Some(request)
    }

    /// Builds a complete successor without mutating installed residency.
    pub fn stage(
        &self,
        completion: SimulationSceneBatchCompletion,
    ) -> Result<Option<StagedSimulationScenePublication>, SimulationSceneResidencyError> {
        let Some(request) = self.desired.as_ref() else {
            return Ok(None);
        };
        if completion.content_source_generation != self.content_source_generation
            || completion.content_source_generation != request.content_source_generation
            || completion.request_revision != request.request_revision
        {
            return Ok(None);
        }

        let mut outcomes = BTreeMap::new();
        for outcome in completion.outcomes {
            let owner = outcome.owner();
            if outcomes.insert(owner, outcome).is_some() {
                return Err(SimulationSceneResidencyError::DuplicateOutcome { owner });
            }
        }
        for &owner in request.interest.owners() {
            if !outcomes.contains_key(&owner) {
                return Err(SimulationSceneResidencyError::MissingOutcome { owner });
            }
        }
        if let Some(&owner) = outcomes
            .keys()
            .find(|owner| !request.interest.owners().contains(owner))
        {
            return Err(SimulationSceneResidencyError::UnexpectedOutcome { owner });
        }

        let mut insertions = Vec::new();
        let mut availability = BTreeMap::new();
        let mut resident = BTreeSet::new();
        for operation in &request.owners {
            let owner = operation.owner();
            let outcome = outcomes
                .remove(&owner)
                .expect("complete outcome set was prevalidated");
            match (operation, outcome) {
                (
                    SimulationSceneOwnerRequest::Retain {
                        owner,
                        owner_revision,
                    },
                    SimulationSceneOwnerOutcome::Retained {
                        owner: echoed_owner,
                        owner_revision: echoed_revision,
                    },
                ) if *owner == echoed_owner && *owner_revision == echoed_revision => {
                    resident.insert(*owner);
                    availability.insert(
                        *owner,
                        SimulationSceneOwnerAvailability::Resident {
                            owner_revision: *owner_revision,
                        },
                    );
                }
                (
                    SimulationSceneOwnerRequest::Load { owner },
                    SimulationSceneOwnerOutcome::Resident(asset),
                ) => {
                    let asset_owner = Guid(normalize_landblock_id(asset.landblock_id));
                    if asset_owner != *owner || asset.landblock_id != owner.0 {
                        return Err(SimulationSceneResidencyError::InvalidAssetOwner {
                            requested: *owner,
                            actual: Guid(asset.landblock_id),
                        });
                    }
                    resident.insert(*owner);
                    availability.insert(
                        *owner,
                        SimulationSceneOwnerAvailability::Resident { owner_revision: 0 },
                    );
                    insertions.push(asset);
                }
                (
                    SimulationSceneOwnerRequest::Load { owner },
                    SimulationSceneOwnerOutcome::Absent { owner: actual },
                ) if *owner == actual => {
                    availability.insert(*owner, SimulationSceneOwnerAvailability::Absent);
                }
                (
                    SimulationSceneOwnerRequest::Load { owner },
                    SimulationSceneOwnerOutcome::Failed {
                        owner: actual,
                        cause,
                    },
                ) if *owner == actual => {
                    availability.insert(*owner, SimulationSceneOwnerAvailability::Failed { cause });
                }
                (
                    SimulationSceneOwnerRequest::RetainAbsent { owner },
                    SimulationSceneOwnerOutcome::Absent { owner: actual },
                ) if *owner == actual => {
                    availability.insert(*owner, SimulationSceneOwnerAvailability::Absent);
                }
                (
                    SimulationSceneOwnerRequest::RetainFailed { owner, cause },
                    SimulationSceneOwnerOutcome::Failed {
                        owner: actual,
                        cause: actual_cause,
                    },
                ) if *owner == actual && *cause == actual_cause => {
                    availability.insert(
                        *owner,
                        SimulationSceneOwnerAvailability::Failed {
                            cause: actual_cause,
                        },
                    );
                }
                _ => return Err(SimulationSceneResidencyError::MismatchedOutcome { owner }),
            }
        }
        let removals = self
            .installed
            .availability
            .iter()
            .filter_map(|(&owner, status)| {
                matches!(status, SimulationSceneOwnerAvailability::Resident { .. }).then_some(owner)
            })
            .filter(|owner| !resident.contains(owner))
            .collect::<Vec<_>>();
        let next_scene = self
            .installed
            .scene
            .staged_residency_change(insertions, &removals)?;
        for &owner in &resident {
            let owner_revision = next_scene
                .owner_proof(owner)
                .expect("resident successor owner must expose its product proof")
                .revision();
            availability.insert(
                owner,
                SimulationSceneOwnerAvailability::Resident { owner_revision },
            );
        }
        let next_scene_revision = self
            .next_scene_revision
            .checked_add(1)
            .expect("simulation-scene revision exhausted");
        let snapshot = Arc::new(SimulationSceneSnapshot {
            revision: next_scene_revision,
            content_source_generation: self.content_source_generation,
            interest: request.interest.clone(),
            availability: availability.clone(),
            scene: Arc::new(next_scene),
        });
        let terminal = self
            .terminal
            .iter()
            .map(|(&owner, status)| (owner, status.clone()))
            .chain(
                availability
                    .iter()
                    .filter_map(|(&owner, status)| match status {
                        SimulationSceneOwnerAvailability::Absent
                        | SimulationSceneOwnerAvailability::Failed { .. } => {
                            Some((owner, status.clone()))
                        }
                        SimulationSceneOwnerAvailability::Resident { .. }
                        | SimulationSceneOwnerAvailability::Pending { .. } => None,
                    }),
            )
            .collect();
        Ok(Some(StagedSimulationScenePublication {
            content_source_generation: completion.content_source_generation,
            request_revision: completion.request_revision,
            snapshot,
            availability,
            terminal,
        }))
    }

    /// Publishes one staged successor only while its desired revision is still current.
    pub fn publish_staged(
        &mut self,
        staged: StagedSimulationScenePublication,
    ) -> SimulationScenePublication {
        let Some(request) = self.desired.as_ref() else {
            return SimulationScenePublication::Stale;
        };
        if staged.content_source_generation != self.content_source_generation
            || staged.content_source_generation != request.content_source_generation
            || staged.request_revision != request.request_revision
        {
            return SimulationScenePublication::Stale;
        }
        self.next_scene_revision = staged.snapshot.revision;
        self.availability = staged.availability;
        self.terminal = staged.terminal;
        self.installed = staged.snapshot;
        SimulationScenePublication::Published {
            scene_revision: self.next_scene_revision,
        }
    }

    /// Convenience transition for compositions that do not need split staging and publication.
    pub fn publish(
        &mut self,
        completion: SimulationSceneBatchCompletion,
    ) -> Result<SimulationScenePublication, SimulationSceneResidencyError> {
        let Some(staged) = self.stage(completion)? else {
            return Ok(SimulationScenePublication::Stale);
        };
        Ok(self.publish_staged(staged))
    }

    /// Retires pending desired work while preserving the last installed immutable snapshot.
    pub fn retire_pending(&mut self) {
        self.desired = None;
        self.availability = self.installed.availability.clone();
    }

    /// Starts a new source lifetime, permitting terminal owners to be requested again.
    pub fn replace_content_source(&mut self) -> u64 {
        self.content_source_generation = self
            .content_source_generation
            .checked_add(1)
            .expect("simulation-scene content-source generation exhausted");
        self.desired = None;
        self.availability.clear();
        self.terminal.clear();
        self.content_source_generation
    }
}

/// Invalid shared residency transition or malformed complete batch.
#[derive(Debug, Error)]
pub enum SimulationSceneResidencyError {
    #[error("simulation-scene owner {owner:?} is not a normalized 0xFFFF owner")]
    InvalidOwner { owner: Guid },
    #[error("simulation-scene completion contains duplicate owner {owner:?}")]
    DuplicateOutcome { owner: Guid },
    #[error("simulation-scene completion omits requested owner {owner:?}")]
    MissingOutcome { owner: Guid },
    #[error("simulation-scene completion contains unrequested owner {owner:?}")]
    UnexpectedOutcome { owner: Guid },
    #[error("simulation-scene completion outcome does not match request operation for {owner:?}")]
    MismatchedOutcome { owner: Guid },
    #[error(
        "collision asset owner {actual:?} does not exactly match requested owner {requested:?}"
    )]
    InvalidAssetOwner { requested: Guid, actual: Guid },
    #[error(transparent)]
    Scene(#[from] CollisionSceneUpdateError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::{LandblockColliders, TerrainCollisionSurface};

    fn asset(owner: Guid) -> LandblockCollisionAsset {
        LandblockCollisionAsset {
            landblock_id: owner.0,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders::default(),
        }
    }

    fn interest(owners: &[Guid]) -> SimulationSceneInterest {
        SimulationSceneInterest::new(owners.iter().copied()).unwrap()
    }

    fn completion(
        request: &SimulationSceneRequest,
        outcomes: Vec<SimulationSceneOwnerOutcome>,
    ) -> SimulationSceneBatchCompletion {
        SimulationSceneBatchCompletion {
            content_source_generation: request.content_source_generation,
            request_revision: request.request_revision,
            outcomes,
        }
    }

    #[test]
    fn interest_normalizes_order_and_rejects_non_owner_ids() {
        let low = Guid(0xda54_ffff);
        let high = Guid(0xda55_ffff);

        assert_eq!(interest(&[high, low, high]).owners(), &[low, high]);
        assert!(matches!(
            SimulationSceneInterest::new([Guid(0xda55_0100)]),
            Err(SimulationSceneResidencyError::InvalidOwner { .. })
        ));
    }

    #[test]
    fn pending_and_mixed_terminal_outcomes_publish_one_atomic_successor() {
        let old = Guid(0xda54_ffff);
        let resident = Guid(0xda55_ffff);
        let absent = Guid(0xda56_ffff);
        let mut residency = SimulationSceneResidency::default();
        let first = residency.request_interest(interest(&[old])).unwrap();
        residency
            .publish(completion(
                &first,
                vec![SimulationSceneOwnerOutcome::Resident(asset(old))],
            ))
            .unwrap();
        let installed = residency.snapshot();

        let next = residency
            .request_interest(interest(&[resident, absent]))
            .unwrap();
        assert!(Arc::ptr_eq(&installed, &residency.snapshot()));
        assert!(matches!(
            residency.availability().get(&resident),
            Some(SimulationSceneOwnerAvailability::Pending {
                request_revision
            }) if *request_revision == next.request_revision
        ));

        assert_eq!(
            residency
                .publish(completion(
                    &next,
                    vec![
                        SimulationSceneOwnerOutcome::Resident(asset(resident)),
                        SimulationSceneOwnerOutcome::Absent { owner: absent },
                    ],
                ))
                .unwrap(),
            SimulationScenePublication::Published { scene_revision: 2 }
        );
        let installed = residency.snapshot();
        assert!(!installed.scene.contains_landblock(old));
        assert!(installed.scene.contains_landblock(resident));
        assert!(!installed.scene.contains_landblock(absent));
        assert!(matches!(
            installed.availability.get(&absent),
            Some(SimulationSceneOwnerAvailability::Absent)
        ));
    }

    #[test]
    fn stale_completion_cannot_replace_newer_desired_revision() {
        let first_owner = Guid(0xda54_ffff);
        let second_owner = Guid(0xda55_ffff);
        let mut residency = SimulationSceneResidency::default();
        let first = residency
            .request_interest(interest(&[first_owner]))
            .unwrap();
        residency
            .request_interest(interest(&[second_owner]))
            .unwrap();

        assert_eq!(
            residency
                .publish(completion(
                    &first,
                    vec![SimulationSceneOwnerOutcome::Resident(asset(first_owner))],
                ))
                .unwrap(),
            SimulationScenePublication::Stale
        );
        assert_eq!(residency.snapshot().revision, 0);
    }

    #[test]
    fn terminal_outcomes_retry_only_after_content_source_replacement() {
        let terminal = Guid(0xda54_ffff);
        let detour = Guid(0xda55_ffff);
        let mut residency = SimulationSceneResidency::default();
        let failed = residency.request_interest(interest(&[terminal])).unwrap();
        residency
            .publish(completion(
                &failed,
                vec![SimulationSceneOwnerOutcome::Failed {
                    owner: terminal,
                    cause: "decode failed".to_owned(),
                }],
            ))
            .unwrap();
        let detour_request = residency.request_interest(interest(&[detour])).unwrap();
        residency
            .publish(completion(
                &detour_request,
                vec![SimulationSceneOwnerOutcome::Absent { owner: detour }],
            ))
            .unwrap();

        let retained = residency.request_interest(interest(&[terminal])).unwrap();
        assert!(matches!(
            retained.owners.as_slice(),
            [SimulationSceneOwnerRequest::RetainFailed { owner, cause }]
                if *owner == terminal && cause == "decode failed"
        ));

        residency.replace_content_source();
        let retried = residency.request_interest(interest(&[terminal])).unwrap();
        assert!(matches!(
            retried.owners.as_slice(),
            [SimulationSceneOwnerRequest::Load { owner }] if *owner == terminal
        ));
    }

    #[test]
    fn incomplete_batch_is_rejected_without_replacing_installed_snapshot() {
        let first = Guid(0xda54_ffff);
        let second = Guid(0xda55_ffff);
        let mut residency = SimulationSceneResidency::default();
        let request = residency
            .request_interest(interest(&[first, second]))
            .unwrap();
        let installed = residency.snapshot();

        assert!(matches!(
            residency.publish(completion(
                &request,
                vec![SimulationSceneOwnerOutcome::Resident(asset(first))],
            )),
            Err(SimulationSceneResidencyError::MissingOutcome { owner }) if owner == second
        ));
        assert!(Arc::ptr_eq(&installed, &residency.snapshot()));
    }
}

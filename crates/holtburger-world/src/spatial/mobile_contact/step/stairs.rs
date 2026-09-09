//! Grounded support queries and bounded, hard-swept stair/settle adjustments.

use super::{
    ContactBodyPath, ContactMotionSegment, ContactParticipant, HardMovement, HardTargets,
    MobileContactBody, PhysicalSphereSet, WorkingBody, accepted_prefix, sweep_body_motion,
    translated_spheres,
};
use crate::spatial::{
    CollisionQueryError, CollisionScene, GroundState, GroundSupport, GroundedConfig,
    SpatialMembership, SupportContact, SupportRequest, SupportSource, bsp_query::CONTACT_EPSILON,
};
use anyhow::Result;
use holtburger_common::{Guid, Vector3};

/// A completely proved alternative; no partial lift is published if later segments fail.
pub(super) struct StairManeuver {
    /// Final movement geometry after the supported settle.
    pub spheres: PhysicalSphereSet,
    /// Both movement spheres' domains with primary committed-cell ownership.
    pub membership: SpatialMembership,
    /// Current world or hard-entity support at the accepted pose.
    pub support: GroundSupport,
    /// Lift, timed forward travel, and optional settle in application order.
    pub motion: Vec<ContactMotionSegment>,
}

/// Geometry and membership of the private stair candidate, changed together after each segment.
struct StairCursor {
    /// Pair policy and current candidate membership.
    contact: ContactParticipant,
    /// Movement spheres at the candidate position.
    spheres: PhysicalSphereSet,
}

impl StairCursor {
    fn accept(&mut self, path: &ContactBodyPath) -> Result<()> {
        let displacement = path.primary().final_point().center() - self.spheres.primary().center;
        self.spheres = translated_spheres(self.spheres, displacement)?;
        self.contact.membership = path.membership().clone();
        Ok(())
    }
}

/// Bounded downward travel and normal admission for one landing/step-down probe.
struct DescentProbe {
    /// Maximum ordinary downward settle distance.
    maximum_drop: f32,
    /// Minimum authored support normal, selected by walking versus landing policy.
    normal_threshold: f32,
}

/// Proven support plus the optional geometric adjustment used to reach it.
struct SettledSupport {
    /// Selected support source, normal, and footprint feature.
    support: GroundSupport,
    /// Accepted adjustment; absent when the candidate is already tangent.
    path: Option<Box<ContactBodyPath>>,
}

/// Whether the bounded candidate established reachable standing support.
enum SettleOutcome {
    /// A complete supported candidate, including its optional vertical adjustment.
    Supported(SettledSupport),
    /// No accepted support; edge guidance belongs to the prior valid footing.
    Unsupported,
}

/// Footing result of a private navigation candidate, before route acceptance.
pub(super) enum NavigationFooting {
    /// Free flight or unavailable ordinary coverage preserves the incoming footing.
    Unchanged,
    /// The candidate did not establish support; edge policy decides whether to accept departure.
    Unsupported,
    /// Accepted contact response; a real landing may finish airborne after restitution.
    Settled(GroundState),
}

/// Last supported ordinary pose, saved only for creature edge protection.
pub(super) struct ProtectedFooting {
    /// Geometry and residency must be restored together when a walking candidate is rejected.
    cursor: StairCursor,
    /// Canonical root saved with the movement geometry.
    root: Vector3,
    /// Velocity before private route impacts; rejected paths cannot alter continuation.
    velocity: Vector3,
    /// Current proved support and authored grounded configuration.
    grounded: super::GroundedContactState,
    /// Index separating already accepted work from the ordinary candidate's private paths.
    motion_start: usize,
}

impl ProtectedFooting {
    pub(super) fn capture(body: &WorkingBody<'_>) -> Option<Self> {
        let grounded = body.grounded?;
        if grounded.config.edge_protection != crate::spatial::EdgeProtection::Creature
            || grounded.ground.walkable_support().is_none()
        {
            return None;
        }
        Some(Self {
            cursor: StairCursor {
                contact: body.contact.clone(),
                spheres: body.mobile.spheres,
            },
            grounded,
            velocity: body.mobile.velocity,
            root: body.root,
            motion_start: body.motion.len(),
        })
    }

    pub(super) fn restore(&self, body: &mut WorkingBody<'_>) {
        body.contact = self.cursor.contact.clone();
        body.mobile.spheres = self.cursor.spheres;
        body.root = self.root;
        body.mobile.velocity = self.velocity;
        body.grounded = Some(self.grounded);
        body.motion.truncate(self.motion_start);
    }
}

/// One optional tangent route from saved footing; the navigation owner restores rejection.
/// Retail restores its saved pose before the precipice slide (acclient.c:301354-301440).
pub(super) fn try_edge_slide(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
    start: &ProtectedFooting,
    movement: HardMovement,
) -> Result<NavigationFooting> {
    let requested = body.mobile.spheres.primary().center - start.cursor.spheres.primary().center;
    let inward_normal = start
        .grounded
        .ground
        .walkable_support()
        .and_then(|support| support.feature.inward_normal());
    start.restore(body);
    let Some(normal) = inward_normal else {
        return Ok(NavigationFooting::Unsupported);
    };
    let tangent = requested - normal * requested.dot(&normal);
    if tangent.length_squared() <= f32::EPSILON {
        return Ok(NavigationFooting::Unsupported);
    }
    let swept = match sweep_body_motion(
        collision,
        hard,
        anchor,
        &body.contact,
        body.mobile.spheres,
        tangent,
    ) {
        Ok(swept) => swept,
        // This is an optional route. Its absent coverage leaves the proved start intact.
        Err(CollisionQueryError::UnavailableOwner { .. }) => {
            return Ok(NavigationFooting::Unsupported);
        }
        Err(error) => return Err(error.into()),
    };
    let fraction = swept.hit.map_or(1.0, |hit| hit.contact().time_of_impact);
    if fraction == 0.0 {
        return Ok(NavigationFooting::Unsupported);
    }
    let path = accepted_prefix(swept.path, fraction)?;
    super::translate_to(body, &path)?;
    body.motion.push(ContactMotionSegment::Travel {
        path,
        supported: true,
        start_fraction: 0.0,
        end_fraction: fraction,
    });
    body.mobile.velocity = body.mobile.velocity - normal * body.mobile.velocity.dot(&normal);
    if let Some(hit) = swept.hit {
        body.mobile.velocity = movement.impact_velocity(body, hit.contact().normal, true);
    }
    settle_after_movement(collision, hard, anchor, body, movement)
}

/// Fan in world and pair-eligible hard shapes before choosing support.
fn support_candidates(
    collision: &CollisionScene,
    hard: &HardTargets,
    contact: &ContactParticipant,
    request: SupportRequest<'_>,
) -> std::result::Result<Vec<SupportContact>, CollisionQueryError> {
    let mut supports = collision.support_contacts(request)?;
    for target in hard
        .support_candidates(request.center, request.radius)
        .filter(|target| {
            contact.receives_response_from(&target.contact)
                && request
                    .placement
                    .intersects_reached(&target.contact.membership)
        })
    {
        for shape in &target.shapes {
            supports.extend(
                crate::spatial::volume_query::placed_shape_supports(
                    shape,
                    request.center,
                    request.radius,
                    request.maximum_drop,
                    request.maximum_rise,
                )
                .into_iter()
                .map(|support| SupportContact {
                    normal: support.normal,
                    height_delta: support.height_delta,
                    feature: support.feature,
                    source: SupportSource::Entity(target.contact.body_id),
                }),
            );
        }
    }
    Ok(supports)
}

pub(super) fn support_at(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    mobile: MobileContactBody,
    contact: &ContactParticipant,
    config: GroundedConfig,
) -> std::result::Result<GroundState, CollisionQueryError> {
    Ok(
        match standing_support_candidate(collision, hard, anchor, mobile, contact, config)? {
            Some(support)
                if support.height_delta.abs() <= CONTACT_EPSILON
                    && mobile.velocity.dot(&support.normal) <= CONTACT_EPSILON =>
            {
                classify_support(ground_support(support), config)
            }
            _ => GroundState::Airborne,
        },
    )
}

/// Select the highest admissible standing target before testing confirmation tolerance.
/// A near lower plane cannot hide a higher overlapping surface. Clearance belongs to
/// the caller that commits movement; this query alone never authorizes a correction.
/// Velocity admission also belongs to the caller: walking transfers between support
/// normals, while airborne acquisition must reject motion leaving the selected surface.
fn standing_support_candidate(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    mobile: MobileContactBody,
    contact: &ContactParticipant,
    config: GroundedConfig,
) -> std::result::Result<Option<SupportContact>, CollisionQueryError> {
    let primary = mobile.spheres.primary();
    Ok(support_candidates(
        collision,
        hard,
        contact,
        SupportRequest {
            anchor,
            center: primary.center,
            radius: primary.radius,
            maximum_drop: CONTACT_EPSILON,
            // Upward acquisition uses the authored step limit, independently of downward reach.
            maximum_rise: config.step_up_height,
            placement: &contact.membership,
        },
    )?
    .into_iter()
    .filter(|support| {
        support.normal.z
            >= if support.height_delta > CONTACT_EPSILON {
                config.walkable_normal_z
            } else {
                config.landing_normal_z
            }
    })
    .max_by(|a, b| a.height_delta.total_cmp(&b.height_delta)))
}

/// Acquire standing height before motor selection. Recovery is a swept geometric
/// adjustment; it consumes neither physical time nor a landing/restitution event.
/// RETAIL DIVERGENCE: terrain grounding uses the vertical sphere bottom in
/// `acclient.c:302787-302841`; our full-sphere clearance instead requires a higher
/// resting pose on slopes. Removing recovery while retaining that geometry strands
/// compatible authority poses airborne. Evidence: captured Old Bones terrain overlap
/// and synthetic slope, ceiling, step-cap, and cell-transit fixtures; no full terrain census.
pub(super) fn prepare_support(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
    config: GroundedConfig,
) -> Result<GroundState> {
    let Some(support) =
        standing_support_candidate(collision, hard, anchor, body.mobile, &body.contact, config)?
    else {
        return Ok(GroundState::Airborne);
    };
    if body.mobile.velocity.dot(&support.normal) > CONTACT_EPSILON {
        return Ok(GroundState::Airborne);
    }
    if support.height_delta.abs() <= CONTACT_EPSILON {
        return Ok(classify_support(ground_support(support), config));
    }
    let mut cursor = StairCursor {
        contact: body.contact.clone(),
        spheres: body.mobile.spheres,
    };
    let SettleOutcome::Supported(settled) =
        settle_support_candidate(collision, hard, anchor, &mut cursor, support)?
    else {
        return Ok(GroundState::Airborne);
    };
    body.root =
        body.root + (cursor.spheres.primary().center - body.mobile.spheres.primary().center);
    body.mobile.spheres = cursor.spheres;
    body.contact.membership = cursor.contact.membership;
    body.mobile.velocity =
        body.mobile.velocity - support.normal * body.mobile.velocity.dot(&support.normal);
    if let Some(path) = settled.path {
        body.motion.push(ContactMotionSegment::Adjustment {
            path: *path,
            fraction: 0.0,
        });
    }
    Ok(classify_support(settled.support, config))
}

fn ground_support(support: SupportContact) -> GroundSupport {
    GroundSupport {
        normal: support.normal,
        feature: support.feature,
        source: support.source,
    }
}

fn classify_support(support: GroundSupport, config: GroundedConfig) -> GroundState {
    if support.normal.z >= config.walkable_normal_z {
        GroundState::Supported(support)
    } else {
        GroundState::Sliding(support)
    }
}

/// Evaluate candidate settlement using the standing footprint and shared impact response.
/// Geometry stays private until navigation accepts the route; footing is returned explicitly.
pub(super) fn settle_after_movement(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
    movement: HardMovement,
) -> Result<NavigationFooting> {
    let Some(grounded) = body.grounded else {
        return Ok(NavigationFooting::Unchanged);
    };
    let walking = grounded.ground.walkable_support().is_some();
    // World-Z ascent is not departure from an uphill surface. Candidate admission
    // and the final normal check below own separation, including genuine launches.
    let config = grounded.config;
    let maximum_drop = if walking {
        config.step_down_height
    } else {
        config.airborne_step_down_height
    };
    let mut cursor = StairCursor {
        contact: body.contact.clone(),
        spheres: body.mobile.spheres,
    };
    let candidate = match standing_support_candidate(
        collision,
        hard,
        anchor,
        body.mobile,
        &body.contact,
        config,
    ) {
        Ok(support) => {
            support.filter(|support| !walking || support.normal.z >= config.walkable_normal_z)
        }
        Err(CollisionQueryError::UnavailableOwner { .. }) => {
            return Ok(NavigationFooting::Unsupported);
        }
        Err(error) => return Err(error.into()),
    };
    let settled = if let Some(support) = candidate {
        settle_support_candidate(collision, hard, anchor, &mut cursor, support)
    } else {
        settle_down(
            collision,
            hard,
            anchor,
            &mut cursor,
            DescentProbe {
                maximum_drop,
                normal_threshold: if walking {
                    config.walkable_normal_z
                } else {
                    config.landing_normal_z
                },
            },
        )
    };
    let settled = match settled {
        Ok(SettleOutcome::Supported(settled)) => settled,
        Ok(SettleOutcome::Unsupported) => return Ok(NavigationFooting::Unsupported),
        // An optional settle outside coverage does not invalidate already accepted movement.
        Err(error)
            if matches!(
                error.downcast_ref::<CollisionQueryError>(),
                Some(CollisionQueryError::UnavailableOwner { .. })
            ) =>
        {
            return Ok(NavigationFooting::Unsupported);
        }
        Err(error) => return Err(error),
    };
    let normal = settled.support.normal;
    let upward_recovery =
        cursor.spheres.primary().center.z > body.mobile.spheres.primary().center.z;
    if !walking && body.mobile.velocity.dot(&normal) > CONTACT_EPSILON {
        return Ok(NavigationFooting::Unsupported);
    }
    // A checked walking settle owns the new support plane. Remove the normal component
    // produced by sliding around an edge; a launch already left the walking state.
    if walking || upward_recovery {
        body.mobile.velocity = body.mobile.velocity - normal * body.mobile.velocity.dot(&normal);
    }
    body.root =
        body.root + (cursor.spheres.primary().center - body.mobile.spheres.primary().center);
    body.mobile.spheres = cursor.spheres;
    body.contact.membership = cursor.contact.membership;
    if !upward_recovery {
        body.mobile.velocity = movement.impact_velocity(body, normal, walking);
    }
    let ground = if body.mobile.velocity.dot(&normal) > CONTACT_EPSILON {
        GroundState::Airborne
    } else {
        classify_support(settled.support, config)
    };
    if let Some(path) = settled.path {
        body.motion.push(ContactMotionSegment::Adjustment {
            path: *path,
            fraction: 1.0,
        });
    }
    if !walking && !upward_recovery {
        // A descending settle is an accepted landing even when restitution immediately
        // makes the body airborne again. Preserve it before later ticks move the body.
        let contact = crate::spatial::StaticSphereSweepHit {
            time_of_impact: 1.0,
            normal,
        };
        let hit = match settled.support.source {
            SupportSource::World(_) => crate::spatial::HardSphereSweepHit::World(contact),
            SupportSource::Entity(body_id) => crate::spatial::HardSphereSweepHit::Entity {
                body_id,
                hit: contact,
            },
        };
        body.record_impact(hit, 1.0, anchor);
    }
    Ok(NavigationFooting::Settled(ground))
}

/// Restore nominal resting height without bypassing other hard obstacles. Exact represented
/// rest needs no movement query; a nearby support proof alone does not authorize a snap.
fn settle_support_candidate(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    cursor: &mut StairCursor,
    support: SupportContact,
) -> Result<SettleOutcome> {
    let primary = cursor.spheres.primary();
    let represented_height = primary.center.z + support.height_delta;
    let displacement = Vector3::new(0.0, 0.0, represented_height - primary.center.z);
    let path = if displacement.z == 0.0 {
        None
    } else {
        let swept = sweep_body_motion(
            collision,
            hard,
            anchor,
            &cursor.contact,
            cursor.spheres,
            displacement,
        )?;
        if swept
            .hit
            .is_some_and(|hit| hit.contact().time_of_impact < 1.0)
        {
            return Ok(SettleOutcome::Unsupported);
        }
        cursor.accept(&swept.path)?;
        Some(Box::new(swept.path))
    };
    Ok(SettleOutcome::Supported(SettledSupport {
        support: ground_support(support),
        path,
    }))
}

fn settle_down(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    cursor: &mut StairCursor,
    probe: DescentProbe,
) -> Result<SettleOutcome> {
    let down = sweep_body_motion(
        collision,
        hard,
        anchor,
        &cursor.contact,
        cursor.spheres,
        Vector3::new(0.0, 0.0, -probe.maximum_drop),
    )?;
    let domains = down.path.reached_membership();
    let primary = cursor.spheres.primary();
    let supports = support_candidates(
        collision,
        hard,
        &cursor.contact,
        SupportRequest {
            anchor,
            center: primary.center,
            radius: primary.radius,
            maximum_drop: probe.maximum_drop,
            maximum_rise: 0.0,
            placement: domains,
        },
    )?
    .into_iter()
    .filter(|support| support.normal.z >= probe.normal_threshold);
    let Some(SupportContact {
        normal,
        source,
        height_delta,
        feature,
    }) = supports.max_by(|a, b| a.height_delta.total_cmp(&b.height_delta))
    else {
        return Ok(SettleOutcome::Unsupported);
    };
    let path = if height_delta > 0.0 {
        // The shape query's tolerance can include a tiny positive height. Upward
        // acquisition is owned by the standing target path, not this downward sweep.
        return Ok(SettleOutcome::Unsupported);
    } else if height_delta < 0.0 {
        if probe.maximum_drop == 0.0 {
            return Ok(SettleOutcome::Unsupported);
        }
        let fraction = -height_delta / probe.maximum_drop;
        if fraction > 1.0 {
            return Ok(SettleOutcome::Unsupported);
        }
        // The sweep already owns the contact band. Advancing past its hit here would
        // grant a second penetration allowance, including against unrelated geometry.
        if down
            .hit
            .is_some_and(|hit| fraction > hit.contact().time_of_impact)
        {
            return Ok(SettleOutcome::Unsupported);
        }
        Some(Box::new(accepted_prefix(down.path, fraction)?))
    } else {
        None
    };
    if let Some(path) = &path {
        cursor.accept(path)?;
    }
    Ok(SettleOutcome::Supported(SettledSupport {
        support: GroundSupport {
            normal,
            source,
            feature,
        },
        path,
    }))
}

pub(super) fn try_stair_maneuver(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &WorkingBody<'_>,
    requested: Vector3,
    elapsed: f32,
    blocking_normal: Vector3,
) -> Result<Option<StairManeuver>> {
    let Some(grounded) = body.grounded else {
        return Ok(None);
    };
    let config = grounded.config;
    let Some(footing) = grounded.ground.walkable_support() else {
        return Ok(None);
    };
    if config.step_up_height <= 0.0
        || blocking_normal.z >= config.walkable_normal_z
        || requested.x * requested.x + requested.y * requested.y == 0.0
        || body.mobile.velocity.dot(&footing.normal) > CONTACT_EPSILON
    {
        return Ok(None);
    }
    let initial = body.mobile.spheres.primary();
    let mut cursor = StairCursor {
        contact: body.contact.clone(),
        spheres: body.mobile.spheres,
    };
    let up = sweep_body_motion(
        collision,
        hard,
        anchor,
        &cursor.contact,
        cursor.spheres,
        Vector3::new(0.0, 0.0, config.step_up_height),
    )?;
    let fraction = up.hit.map_or(1.0, |hit| hit.contact().time_of_impact);
    if fraction == 0.0 {
        return Ok(None);
    }
    let up = accepted_prefix(up.path, fraction)?;
    cursor.accept(&up)?;
    let rise = cursor.spheres.primary().center.z - initial.center.z;
    if rise <= CONTACT_EPSILON {
        return Ok(None);
    }
    let forward = sweep_body_motion(
        collision,
        hard,
        anchor,
        &cursor.contact,
        cursor.spheres,
        requested,
    )?;
    if forward.hit.is_some() {
        return Ok(None);
    }
    cursor.accept(&forward.path)?;

    let SettleOutcome::Supported(settled) = settle_down(
        collision,
        hard,
        anchor,
        &mut cursor,
        DescentProbe {
            maximum_drop: rise,
            normal_threshold: config.walkable_normal_z,
        },
    )?
    else {
        return Ok(None);
    };
    let final_rise = cursor.spheres.primary().center.z - initial.center.z;
    if final_rise <= config.separation_epsilon
        || final_rise > config.step_up_height + config.separation_epsilon
    {
        return Ok(None);
    }

    let mut motion = vec![
        ContactMotionSegment::Adjustment {
            path: up,
            fraction: elapsed,
        },
        ContactMotionSegment::Travel {
            path: forward.path,
            supported: true,
            start_fraction: elapsed,
            end_fraction: 1.0,
        },
    ];
    if let Some(path) = settled.path {
        motion.push(ContactMotionSegment::Adjustment {
            path: *path,
            fraction: 1.0,
        });
    }
    Ok(Some(StairManeuver {
        spheres: cursor.spheres,
        membership: cursor.contact.membership,
        support: settled.support,
        motion,
    }))
}

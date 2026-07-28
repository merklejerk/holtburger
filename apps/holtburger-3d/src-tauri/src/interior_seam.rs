use crate::polygon_geometry::{RenderAabb, RenderVec3};
use crate::portal_geometry::{
    AcceptedPlaneSide, PORTAL_PLANE_EPSILON, PortalAperture, RenderPlane, plane_distance,
};

/// Proof inputs for one reciprocal pair after both apertures reach landblock space.
pub struct IndoorSeamEvidence<'a> {
    pub reciprocal_identity_proven: bool,
    pub source_exact_match: bool,
    pub target_exact_match: bool,
    pub source_aperture: &'a PortalAperture,
    pub target_aperture: &'a PortalAperture,
    pub source_accepted_side: AcceptedPlaneSide,
    pub target_accepted_side: AcceptedPlaneSide,
    pub source_cell_bounds: Option<RenderAabb>,
    pub target_cell_bounds: Option<RenderAabb>,
}

/// Host-proven indoor spatial relationship; exterior transitions never enter this classifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndoorSeamClassification {
    DepthContinuous,
    TopologyBoundary(IndoorTopologyBoundaryReason),
}

/// Conservative proof failure retained for diagnostics and later mask scheduling.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndoorTopologyBoundaryReason {
    MissingReciprocalIdentity,
    SourceIsNotExactMatch,
    TargetIsNotExactMatch,
    AperturesDiffer,
    AcceptedSidesAreNotOpposed,
    MissingSourceCellBounds,
    MissingTargetCellBounds,
    SourceCellCrossesPortalPlane,
    TargetCellCrossesPortalPlane,
}

/// Classify only fully proven Euclidean seams as ordinary depth-continuous.
pub fn classify_indoor_seam(evidence: IndoorSeamEvidence<'_>) -> IndoorSeamClassification {
    use IndoorSeamClassification::{DepthContinuous, TopologyBoundary};
    use IndoorTopologyBoundaryReason::*;

    if !evidence.reciprocal_identity_proven {
        return TopologyBoundary(MissingReciprocalIdentity);
    }
    if !evidence.source_exact_match {
        return TopologyBoundary(SourceIsNotExactMatch);
    }
    if !evidence.target_exact_match {
        return TopologyBoundary(TargetIsNotExactMatch);
    }
    if !apertures_are_equivalent(evidence.source_aperture, evidence.target_aperture) {
        return TopologyBoundary(AperturesDiffer);
    }
    let source_accepted = accepted_halfspace(
        evidence.source_aperture.plane,
        evidence.source_accepted_side,
    );
    let target_accepted = accepted_halfspace(
        evidence.target_aperture.plane,
        evidence.target_accepted_side,
    );
    if !planes_are_opposed(source_accepted, target_accepted) {
        return TopologyBoundary(AcceptedSidesAreNotOpposed);
    }
    let Some(source_bounds) = evidence.source_cell_bounds else {
        return TopologyBoundary(MissingSourceCellBounds);
    };
    let Some(target_bounds) = evidence.target_cell_bounds else {
        return TopologyBoundary(MissingTargetCellBounds);
    };
    if !bounds_are_strictly_on_accepted_side(source_bounds, source_accepted) {
        return TopologyBoundary(SourceCellCrossesPortalPlane);
    }
    if !bounds_are_strictly_on_accepted_side(target_bounds, target_accepted) {
        return TopologyBoundary(TargetCellCrossesPortalPlane);
    }
    DepthContinuous
}

fn apertures_are_equivalent(source: &PortalAperture, target: &PortalAperture) -> bool {
    if source.positions.len() != target.positions.len()
        || source.triangle_indices.len() != target.triangle_indices.len()
    {
        return false;
    }
    let mut matched = vec![false; target.positions.len()];
    source.positions.iter().all(|source_position| {
        let Some((index, _)) =
            target
                .positions
                .iter()
                .enumerate()
                .find(|(index, target_position)| {
                    !matched[*index] && points_are_equivalent(**target_position, *source_position)
                })
        else {
            return false;
        };
        matched[index] = true;
        true
    })
}

fn accepted_halfspace(plane: RenderPlane, side: AcceptedPlaneSide) -> RenderPlane {
    match side {
        AcceptedPlaneSide::Positive => plane,
        AcceptedPlaneSide::Negative => RenderPlane {
            normal: RenderVec3 {
                x: -plane.normal.x,
                y: -plane.normal.y,
                z: -plane.normal.z,
            },
            d: -plane.d,
        },
    }
}

fn planes_are_opposed(source: RenderPlane, target: RenderPlane) -> bool {
    vector_length_squared(RenderVec3 {
        x: source.normal.x + target.normal.x,
        y: source.normal.y + target.normal.y,
        z: source.normal.z + target.normal.z,
    }) <= PORTAL_PLANE_EPSILON * PORTAL_PLANE_EPSILON
        && (source.d + target.d).abs() <= PORTAL_PLANE_EPSILON
}

fn bounds_are_strictly_on_accepted_side(bounds: RenderAabb, plane: RenderPlane) -> bool {
    let distances = aabb_corners(bounds).map(|corner| plane_distance(plane, corner));
    let mut has_strictly_inside_point = false;
    for distance in distances {
        if distance < -PORTAL_PLANE_EPSILON {
            return false;
        }
        has_strictly_inside_point |= distance > PORTAL_PLANE_EPSILON;
    }
    has_strictly_inside_point
}

fn aabb_corners(bounds: RenderAabb) -> impl Iterator<Item = RenderVec3> {
    [bounds.min.x, bounds.max.x].into_iter().flat_map(move |x| {
        [bounds.min.y, bounds.max.y].into_iter().flat_map(move |y| {
            [bounds.min.z, bounds.max.z]
                .into_iter()
                .map(move |z| RenderVec3 { x, y, z })
        })
    })
}

fn points_are_equivalent(left: RenderVec3, right: RenderVec3) -> bool {
    vector_length_squared(RenderVec3 {
        x: left.x - right.x,
        y: left.y - right.y,
        z: left.z - right.z,
    }) <= PORTAL_PLANE_EPSILON * PORTAL_PLANE_EPSILON
}

fn vector_length_squared(vector: RenderVec3) -> f32 {
    vector.x * vector.x + vector.y * vector.y + vector.z * vector.z
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proves_exact_reciprocal_separated_seam() {
        let aperture = aperture();

        let classification = classify_indoor_seam(IndoorSeamEvidence {
            reciprocal_identity_proven: true,
            source_exact_match: true,
            target_exact_match: true,
            source_aperture: &aperture,
            target_aperture: &aperture,
            source_accepted_side: AcceptedPlaneSide::Positive,
            target_accepted_side: AcceptedPlaneSide::Negative,
            source_cell_bounds: Some(bounds(0.0, 2.0)),
            target_cell_bounds: Some(bounds(-2.0, 0.0)),
        });

        assert_eq!(classification, IndoorSeamClassification::DepthContinuous);
    }

    #[test]
    fn rejects_non_exact_or_uncertain_reciprocal_as_topology_boundary() {
        let aperture = aperture();
        let mut evidence = exact_evidence(&aperture);
        evidence.source_exact_match = false;

        assert_eq!(
            classify_indoor_seam(evidence),
            IndoorSeamClassification::TopologyBoundary(
                IndoorTopologyBoundaryReason::SourceIsNotExactMatch
            )
        );
    }

    #[test]
    fn rejects_volume_that_crosses_other_side_of_portal() {
        let aperture = aperture();
        let mut evidence = exact_evidence(&aperture);
        evidence.target_cell_bounds = Some(bounds(-2.0, 0.5));

        assert_eq!(
            classify_indoor_seam(evidence),
            IndoorSeamClassification::TopologyBoundary(
                IndoorTopologyBoundaryReason::TargetCellCrossesPortalPlane
            )
        );
    }

    #[test]
    fn rejects_same_facing_accepted_halfspaces() {
        let aperture = aperture();
        let mut evidence = exact_evidence(&aperture);
        evidence.target_accepted_side = AcceptedPlaneSide::Positive;

        assert_eq!(
            classify_indoor_seam(evidence),
            IndoorSeamClassification::TopologyBoundary(
                IndoorTopologyBoundaryReason::AcceptedSidesAreNotOpposed
            )
        );
    }

    fn exact_evidence(aperture: &PortalAperture) -> IndoorSeamEvidence<'_> {
        IndoorSeamEvidence {
            reciprocal_identity_proven: true,
            source_exact_match: true,
            target_exact_match: true,
            source_aperture: aperture,
            target_aperture: aperture,
            source_accepted_side: AcceptedPlaneSide::Positive,
            target_accepted_side: AcceptedPlaneSide::Negative,
            source_cell_bounds: Some(bounds(0.0, 2.0)),
            target_cell_bounds: Some(bounds(-2.0, 0.0)),
        }
    }

    fn aperture() -> PortalAperture {
        PortalAperture {
            positions: vec![
                RenderVec3 {
                    x: 0.0,
                    y: -1.0,
                    z: -1.0,
                },
                RenderVec3 {
                    x: 0.0,
                    y: 1.0,
                    z: -1.0,
                },
                RenderVec3 {
                    x: 0.0,
                    y: 1.0,
                    z: 1.0,
                },
                RenderVec3 {
                    x: 0.0,
                    y: -1.0,
                    z: 1.0,
                },
            ],
            triangle_indices: vec![0, 1, 2, 0, 2, 3],
            plane: RenderPlane {
                normal: RenderVec3 {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                },
                d: 0.0,
            },
            bounds: RenderAabb {
                min: RenderVec3 {
                    x: 0.0,
                    y: -1.0,
                    z: -1.0,
                },
                max: RenderVec3 {
                    x: 0.0,
                    y: 1.0,
                    z: 1.0,
                },
            },
        }
    }

    fn bounds(minimum_x: f32, maximum_x: f32) -> RenderAabb {
        RenderAabb {
            min: RenderVec3 {
                x: minimum_x,
                y: -2.0,
                z: -2.0,
            },
            max: RenderVec3 {
                x: maximum_x,
                y: 2.0,
                z: 2.0,
            },
        }
    }
}

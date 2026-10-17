use anyhow::{Result, ensure};
use geo::{Area, BooleanOps, Coord, LineString, Polygon, TriangulateEarcut};

use crate::polygon_geometry::RenderVec3;
use crate::portal_geometry::{
    PORTAL_PLANE_EPSILON, PortalAperture, RenderPlane, bounds_for_positions, plane_distance,
};

/// Host-only tolerance for projecting validated non-exact reciprocals onto one visibility plane.
pub const NON_EXACT_APERTURE_COPLANAR_EPSILON: f32 = 0.001;

/// Cosine deviation below which two junction-candidate plane normals count as parallel.
pub const JUNCTION_NORMAL_ALIGNMENT_EPSILON: f32 = 1.0e-3;
/// Offset, in landblock units, below which two parallel junction-candidate planes coincide.
pub const JUNCTION_PLANE_OFFSET_EPSILON: f32 = 0.05;
/// Minimum shared interior area, in squared landblock units, for a junction overlap.
///
/// Adjacent doorways in one wall share a plane and often an edge; an edge has no area, so this
/// floor keeps touching apertures out of junction groups.
pub const JUNCTION_OVERLAP_AREA_MINIMUM: f64 = 1.0e-4;

/// Archive-backed lower bound for the absolute dot product of reciprocal portal normals.
const NON_EXACT_APERTURE_NORMAL_ALIGNMENT_MINIMUM: f32 = 0.999_99;

/// Evidence retained with one successfully synthesized reciprocal visibility aperture.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VisibilityApertureIntersectionEvidence {
    /// Largest two-way authored vertex distance from the opposite supporting plane.
    pub maximum_plane_deviation: f32,
    /// Absolute dot product of the two authored unit plane normals.
    pub absolute_normal_dot: f32,
    /// Number of disconnected polygons produced by the planar intersection.
    pub component_count: usize,
}

/// One immutable visibility aperture synthesized from two authored reciprocal apertures.
#[derive(Debug, Clone, PartialEq)]
pub struct VisibilityApertureIntersection {
    pub aperture: PortalAperture,
    pub evidence: VisibilityApertureIntersectionEvidence,
}

/// Intersect two validated reciprocal apertures on the source aperture's supporting plane.
///
/// Authored geometry is never modified. Target vertices within the named coplanarity tolerance are
/// orthogonally projected into a stable source-plane basis; every resulting polygon component and
/// hole is triangulated before the geometry is lifted back onto that exact source plane.
pub fn intersect_visibility_apertures(
    source: &PortalAperture,
    target: &PortalAperture,
) -> Result<VisibilityApertureIntersection> {
    let maximum_plane_deviation = reciprocal_plane_deviation(source, target);
    ensure!(
        maximum_plane_deviation <= NON_EXACT_APERTURE_COPLANAR_EPSILON,
        "reciprocal aperture maximum plane deviation {maximum_plane_deviation} exceeds {}",
        NON_EXACT_APERTURE_COPLANAR_EPSILON
    );
    let absolute_normal_dot = normalized_absolute_dot(source.plane.normal, target.plane.normal)?;
    ensure!(
        absolute_normal_dot >= NON_EXACT_APERTURE_NORMAL_ALIGNMENT_MINIMUM,
        "reciprocal aperture absolute normal dot {absolute_normal_dot} is below {NON_EXACT_APERTURE_NORMAL_ALIGNMENT_MINIMUM}"
    );

    let basis = PlaneBasis::from_plane(source.plane)?;
    let source_polygon = project_polygon(source, basis)?;
    let target_polygon = project_polygon(target, basis)?;
    let intersection = source_polygon.intersection(&target_polygon);
    ensure!(
        !intersection.0.is_empty(),
        "reciprocal aperture intersection is empty"
    );

    let mut positions = Vec::new();
    let mut triangle_indices = Vec::new();
    for component in &intersection.0 {
        let triangulation = component.earcut_triangles_raw();
        ensure!(
            !triangulation.triangle_indices.is_empty(),
            "reciprocal aperture intersection component did not triangulate"
        );
        let vertex_offset = u32::try_from(positions.len())?;
        positions.extend(
            triangulation
                .vertices
                .iter()
                .map(|coordinates| basis.lift(coordinates[0], coordinates[1])),
        );
        triangle_indices.extend(
            triangulation
                .triangle_indices
                .iter()
                .map(|index| Ok(vertex_offset + u32::try_from(*index)?))
                .collect::<Result<Vec<_>>>()?,
        );
    }
    ensure!(
        positions.iter().all(|position| {
            plane_distance(source.plane, *position).abs() <= PORTAL_PLANE_EPSILON
        }),
        "lifted visibility aperture escaped its selected source plane"
    );
    let bounds = bounds_for_positions(&positions)
        .expect("a non-empty triangulation must contain at least three positions");
    Ok(VisibilityApertureIntersection {
        aperture: PortalAperture {
            positions,
            triangle_indices,
            plane: source.plane,
            bounds,
        },
        evidence: VisibilityApertureIntersectionEvidence {
            maximum_plane_deviation,
            absolute_normal_dot,
            component_count: intersection.0.len(),
        },
    })
}

/// Whether two crossing apertures are coplanar and share interior area.
///
/// Establish footprint connectivity for a possible coincident junction. Orientation is ignored
/// because reciprocal crossings can have opposed normals. This predicate is retained for
/// offline geometry diagnostics; resident-scene junction assignment belongs to the frontend.
pub fn apertures_form_junction(left: &PortalAperture, right: &PortalAperture) -> Result<bool> {
    Ok(junction_overlap_area(left, right)? > JUNCTION_OVERLAP_AREA_MINIMUM)
}

/// Compute overlap once; grouping tolerates tiny contact while ambiguity must retain it.
fn junction_overlap_area(left: &PortalAperture, right: &PortalAperture) -> Result<f64> {
    if !planes_coincide(left.plane, right.plane)? || !bounds_overlap_with_slack(left, right) {
        return Ok(0.0);
    }
    let basis = PlaneBasis::from_plane(left.plane)?;
    let left_polygon = project_polygon(left, basis)?;
    let right_polygon = project_polygon(right, basis)?;
    Ok(left_polygon.intersection(&right_polygon).unsigned_area())
}

/// Whether two supporting planes are parallel and co-located within junction tolerances.
fn planes_coincide(left: RenderPlane, right: RenderPlane) -> Result<bool> {
    let alignment = normalized_absolute_dot(left.normal, right.normal)?;
    if 1.0 - alignment > JUNCTION_NORMAL_ALIGNMENT_EPSILON {
        return Ok(false);
    }
    // Opposed normals negate `d`; compare offsets on the shared orientation.
    let signed_alignment = dot(left.normal, right.normal);
    let offset = if signed_alignment >= 0.0 {
        left.d - right.d
    } else {
        left.d + right.d
    };
    Ok(offset.abs() <= JUNCTION_PLANE_OFFSET_EPSILON)
}

fn bounds_overlap_with_slack(left: &PortalAperture, right: &PortalAperture) -> bool {
    let a = left.bounds;
    let b = right.bounds;
    let slack = JUNCTION_PLANE_OFFSET_EPSILON;
    a.min.x <= b.max.x + slack
        && b.min.x <= a.max.x + slack
        && a.min.y <= b.max.y + slack
        && b.min.y <= a.max.y + slack
        && a.min.z <= b.max.z + slack
        && b.min.z <= a.max.z + slack
}

fn reciprocal_plane_deviation(source: &PortalAperture, target: &PortalAperture) -> f32 {
    source
        .positions
        .iter()
        .map(|position| plane_distance(target.plane, *position).abs())
        .chain(
            target
                .positions
                .iter()
                .map(|position| plane_distance(source.plane, *position).abs()),
        )
        .fold(0.0, f32::max)
}

fn normalized_absolute_dot(left: RenderVec3, right: RenderVec3) -> Result<f32> {
    let left = [f64::from(left.x), f64::from(left.y), f64::from(left.z)];
    let right = [f64::from(right.x), f64::from(right.y), f64::from(right.z)];
    let left_length = left.iter().map(|value| value * value).sum::<f64>().sqrt();
    let right_length = right.iter().map(|value| value * value).sum::<f64>().sqrt();
    ensure!(
        left_length.is_finite()
            && right_length.is_finite()
            && left_length > 0.0
            && right_length > 0.0,
        "reciprocal aperture contains a degenerate plane normal"
    );
    let cosine = left
        .iter()
        .zip(right)
        .map(|(left, right)| left * right)
        .sum::<f64>()
        / (left_length * right_length);
    Ok(cosine.abs().min(1.0) as f32)
}

fn project_polygon(aperture: &PortalAperture, basis: PlaneBasis) -> Result<Polygon<f64>> {
    ensure!(
        aperture.positions.len() >= 3,
        "portal aperture has fewer than three boundary positions"
    );
    let mut coordinates = aperture
        .positions
        .iter()
        .map(|position| basis.project(*position))
        .collect::<Vec<_>>();
    if coordinates.first() != coordinates.last() {
        coordinates.push(coordinates[0]);
    }
    Ok(Polygon::new(LineString::new(coordinates), Vec::new()))
}

#[derive(Debug, Clone, Copy)]
struct PlaneBasis {
    origin: RenderVec3,
    horizontal: RenderVec3,
    vertical: RenderVec3,
}

impl PlaneBasis {
    fn from_plane(plane: RenderPlane) -> Result<Self> {
        let normal_length = dot(plane.normal, plane.normal).sqrt();
        ensure!(
            normal_length.is_finite() && (normal_length - 1.0).abs() <= 0.000_01,
            "visibility aperture source plane normal is not normalized"
        );
        let unit_normal = scale(plane.normal, normal_length.recip());
        let reference = least_aligned_axis(unit_normal);
        let horizontal = normalize(cross(reference, unit_normal))?;
        let vertical = cross(unit_normal, horizontal);
        Ok(Self {
            origin: scale(plane.normal, -plane.d / dot(plane.normal, plane.normal)),
            horizontal,
            vertical,
        })
    }

    fn project(self, point: RenderVec3) -> Coord<f64> {
        let relative = subtract(point, self.origin);
        Coord {
            x: f64::from(dot(relative, self.horizontal)),
            y: f64::from(dot(relative, self.vertical)),
        }
    }

    fn lift(self, horizontal: f64, vertical: f64) -> RenderVec3 {
        add(
            self.origin,
            add(
                scale(self.horizontal, horizontal as f32),
                scale(self.vertical, vertical as f32),
            ),
        )
    }
}

fn least_aligned_axis(normal: RenderVec3) -> RenderVec3 {
    let [x, y, z] = [normal.x.abs(), normal.y.abs(), normal.z.abs()];
    if x <= y && x <= z {
        RenderVec3 {
            x: 1.0,
            y: 0.0,
            z: 0.0,
        }
    } else if y <= z {
        RenderVec3 {
            x: 0.0,
            y: 1.0,
            z: 0.0,
        }
    } else {
        RenderVec3 {
            x: 0.0,
            y: 0.0,
            z: 1.0,
        }
    }
}

fn normalize(vector: RenderVec3) -> Result<RenderVec3> {
    let length = dot(vector, vector).sqrt();
    ensure!(
        length.is_finite() && length > 0.0,
        "cannot normalize degenerate visibility-aperture basis"
    );
    Ok(scale(vector, length.recip()))
}

fn dot(left: RenderVec3, right: RenderVec3) -> f32 {
    left.x * right.x + left.y * right.y + left.z * right.z
}

fn cross(left: RenderVec3, right: RenderVec3) -> RenderVec3 {
    RenderVec3 {
        x: left.y * right.z - left.z * right.y,
        y: left.z * right.x - left.x * right.z,
        z: left.x * right.y - left.y * right.x,
    }
}

fn add(left: RenderVec3, right: RenderVec3) -> RenderVec3 {
    RenderVec3 {
        x: left.x + right.x,
        y: left.y + right.y,
        z: left.z + right.z,
    }
}

fn subtract(left: RenderVec3, right: RenderVec3) -> RenderVec3 {
    RenderVec3 {
        x: left.x - right.x,
        y: left.y - right.y,
        z: left.z - right.z,
    }
}

fn scale(vector: RenderVec3, scalar: f32) -> RenderVec3 {
    RenderVec3 {
        x: vector.x * scalar,
        y: vector.y * scalar,
        z: vector.z * scalar,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intersects_identical_and_opposite_winding_apertures() {
        let source = aperture(&[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)], 0.0);
        let target = aperture(&[(0.0, 4.0), (4.0, 4.0), (4.0, 0.0), (0.0, 0.0)], 0.0);

        let intersection = intersect_visibility_apertures(&source, &target).unwrap();

        assert_eq!(intersection.evidence.component_count, 1);
        assert_area(&intersection.aperture, 16.0);
    }

    #[test]
    fn retains_contained_and_partially_overlapping_regions() {
        let source = aperture(&[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)], 0.0);
        let contained = aperture(&[(1.0, 1.0), (3.0, 1.0), (3.0, 3.0), (1.0, 3.0)], 0.0);
        let overlapping = aperture(&[(2.0, -1.0), (5.0, -1.0), (5.0, 2.0), (2.0, 2.0)], 0.0);

        assert_area(
            &intersect_visibility_apertures(&source, &contained)
                .unwrap()
                .aperture,
            4.0,
        );
        assert_area(
            &intersect_visibility_apertures(&source, &overlapping)
                .unwrap()
                .aperture,
            4.0,
        );
    }

    #[test]
    fn triangulates_concave_and_multipart_intersections() {
        let u_shape = aperture(
            &[
                (0.0, 0.0),
                (4.0, 0.0),
                (4.0, 4.0),
                (3.0, 4.0),
                (3.0, 1.0),
                (1.0, 1.0),
                (1.0, 4.0),
                (0.0, 4.0),
            ],
            0.0,
        );
        let strip = aperture(&[(-1.0, 2.0), (5.0, 2.0), (5.0, 3.0), (-1.0, 3.0)], 0.0);

        let intersection = intersect_visibility_apertures(&u_shape, &strip).unwrap();

        assert_eq!(intersection.evidence.component_count, 2);
        assert_area(&intersection.aperture, 2.0);
    }

    #[test]
    fn rejects_empty_intersections() {
        let source = aperture(&[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)], 0.0);
        let target = aperture(&[(2.0, 0.0), (3.0, 0.0), (3.0, 1.0), (2.0, 1.0)], 0.0);

        let error = intersect_visibility_apertures(&source, &target).unwrap_err();

        assert!(error.to_string().contains("intersection is empty"));
    }

    #[test]
    fn projects_near_coplanar_geometry_onto_the_source_plane() {
        let source = aperture(&[(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)], 0.0);
        let target = aperture(&[(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)], 0.000_9);

        let intersection = intersect_visibility_apertures(&source, &target).unwrap();

        assert_eq!(intersection.evidence.maximum_plane_deviation, 0.000_9);
        assert!(
            intersection
                .aperture
                .positions
                .iter()
                .all(|position| position.z == 0.0)
        );
    }

    #[test]
    fn rejects_over_threshold_reciprocal_planes() {
        let source = aperture(&[(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)], 0.0);
        let target = aperture(&[(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)], 0.002);

        let error = intersect_visibility_apertures(&source, &target).unwrap_err();

        assert!(error.to_string().contains("maximum plane deviation"));
    }

    #[test]
    fn junction_predicate_discriminates_overlap_from_adjacency() {
        let base = aperture(&[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)], 0.0);
        let coincident = opposed(&aperture(
            &[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)],
            0.0,
        ));
        let partial = aperture(&[(3.0, 0.0), (7.0, 0.0), (7.0, 4.0), (3.0, 4.0)], 0.0);
        let adjacent = aperture(&[(4.0, 0.0), (8.0, 0.0), (8.0, 4.0), (4.0, 4.0)], 0.0);
        let near_plane = aperture(&[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)], 0.04);
        let off_plane = aperture(&[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)], 0.2);

        assert!(apertures_form_junction(&base, &coincident).unwrap());
        assert!(apertures_form_junction(&base, &partial).unwrap());
        assert!(!apertures_form_junction(&base, &adjacent).unwrap());
        assert!(apertures_form_junction(&base, &near_plane).unwrap());
        assert!(!apertures_form_junction(&base, &off_plane).unwrap());
    }

    /// Same geometry with a flipped supporting plane, as a reciprocal building portal authors it.
    fn opposed(source: &PortalAperture) -> PortalAperture {
        PortalAperture {
            positions: source.positions.clone(),
            triangle_indices: source.triangle_indices.clone(),
            plane: RenderPlane {
                normal: RenderVec3 {
                    x: -source.plane.normal.x,
                    y: -source.plane.normal.y,
                    z: -source.plane.normal.z,
                },
                d: -source.plane.d,
            },
            bounds: source.bounds,
        }
    }

    fn aperture(boundary: &[(f32, f32)], z: f32) -> PortalAperture {
        let positions = boundary
            .iter()
            .map(|(x, y)| RenderVec3 { x: *x, y: *y, z })
            .collect::<Vec<_>>();
        PortalAperture {
            bounds: bounds_for_positions(&positions).unwrap(),
            positions,
            triangle_indices: vec![0, 1, 2],
            plane: RenderPlane {
                normal: RenderVec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                },
                d: -z,
            },
        }
    }

    fn assert_area(aperture: &PortalAperture, expected: f32) {
        let area = aperture
            .triangle_indices
            .as_chunks::<3>()
            .0
            .iter()
            .map(|triangle| {
                let a = aperture.positions[triangle[0] as usize];
                let b = aperture.positions[triangle[1] as usize];
                let c = aperture.positions[triangle[2] as usize];
                ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).abs() * 0.5
            })
            .sum::<f32>();
        assert!((area - expected).abs() <= 0.000_01, "{area} != {expected}");
    }
}

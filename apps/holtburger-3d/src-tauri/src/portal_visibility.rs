use anyhow::{Result, ensure};
use geo::{BooleanOps, Coord, LineString, Polygon, TriangulateEarcut};

use crate::polygon_geometry::RenderVec3;
use crate::portal_geometry::{
    PORTAL_PLANE_EPSILON, PortalAperture, RenderPlane, bounds_for_positions, plane_distance,
};

/// Host-only tolerance for projecting validated non-exact reciprocals onto one visibility plane.
pub const NON_EXACT_APERTURE_COPLANAR_EPSILON: f32 = 0.001;

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
            .chunks_exact(3)
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

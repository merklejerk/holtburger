use binrw::{BinRead, BinWrite};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, BinRead, BinWrite, PartialEq, Default)]
#[br(little)]
#[bw(little)]
pub struct Vector3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vector3 {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    pub fn zero() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        }
    }

    pub fn dot(&self, other: &Self) -> f32 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    pub fn cross(&self, other: &Self) -> Self {
        Self {
            x: self.y * other.z - self.z * other.y,
            y: self.z * other.x - self.x * other.z,
            z: self.x * other.y - self.y * other.x,
        }
    }

    pub fn length_squared(&self) -> f32 {
        self.dot(self)
    }

    pub fn length(&self) -> f32 {
        self.length_squared().sqrt()
    }

    pub fn distance(&self, other: &Self) -> f32 {
        (*self - *other).length()
    }

    pub fn normalize(&self) -> Self {
        let len = self.length();
        if len > 0.0 { *self / len } else { *self }
    }

    /// Calculates the AC heading (radians) required to face from this position to a target.
    /// AC heading convention: 0 is West, 90 is North, 180 is East, 270 is South.
    pub fn heading_to(&self, target: &Vector3) -> f32 {
        let diff = *target - *self;
        if diff.length_squared() < 1e-6 {
            return 0.0;
        }
        // math_rad = atan2(-dx, dy) where math 0 = North
        let math_rad = f32::atan2(-diff.x, diff.y);
        let mut heading_deg = 450.0 - math_rad.to_degrees();
        heading_deg %= 360.0;
        if heading_deg < 0.0 {
            heading_deg += 360.0;
        }
        heading_deg.to_radians()
    }
}

impl std::ops::Add for Vector3 {
    type Output = Self;
    fn add(self, other: Self) -> Self {
        Self {
            x: self.x + other.x,
            y: self.y + other.y,
            z: self.z + other.z,
        }
    }
}

impl std::ops::Sub for Vector3 {
    type Output = Self;
    fn sub(self, other: Self) -> Self {
        Self {
            x: self.x - other.x,
            y: self.y - other.y,
            z: self.z - other.z,
        }
    }
}

impl std::ops::Mul<f32> for Vector3 {
    type Output = Self;
    fn mul(self, rhs: f32) -> Self {
        Self {
            x: self.x * rhs,
            y: self.y * rhs,
            z: self.z * rhs,
        }
    }
}

impl std::ops::Div<f32> for Vector3 {
    type Output = Self;
    fn div(self, rhs: f32) -> Self {
        Self {
            x: self.x / rhs,
            y: self.y / rhs,
            z: self.z / rhs,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, BinRead, BinWrite, PartialEq, Default)]
#[br(little)]
#[bw(little)]
pub struct Quaternion {
    pub w: f32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Quaternion {
    pub fn identity() -> Self {
        Self {
            w: 1.0,
            x: 0.0,
            y: 0.0,
            z: 0.0,
        }
    }

    /// Builds a unit rotation from one finite nonzero axis and a finite angle in radians.
    pub fn from_axis_angle(axis: Vector3, angle: f32) -> Option<Self> {
        let axis_length = axis.length();
        if !axis_length.is_finite() || axis_length <= f32::EPSILON || !angle.is_finite() {
            return None;
        }
        let unit = axis / axis_length;
        let half = angle * 0.5;
        let sin = half.sin();
        Some(Self {
            w: half.cos(),
            x: unit.x * sin,
            y: unit.y * sin,
            z: unit.z * sin,
        })
    }

    /// Converts a quaternion to a heading (yaw) in radians.
    /// AC heading matches the official client: 0 at West, 90 at North, 180 at East, 270 at South.
    pub fn to_heading(&self) -> f32 {
        // M21 = 2wz, M22 = 1 - 2z^2 (for yaw-only quat)
        let sin_theta = 2.0 * self.w * self.z;
        let cos_theta = 1.0 - 2.0 * self.z * self.z;

        // We use Atan2(sin, cos) to get the internal theta.
        // With this 450 offset:
        // Identity Quat (theta=0) results in Heading 90 (North).
        // 90 deg CCW Rot (theta=90) results in Heading 0 (West).
        // This matches the official AC client convention where 0 is West.
        let rad = f32::atan2(sin_theta, cos_theta);
        let mut deg = 450.0 - rad.to_degrees();

        deg %= 360.0;
        if deg < 0.0 {
            deg += 360.0;
        }

        deg.to_radians()
    }

    pub fn from_heading(heading_rad: f32) -> Self {
        let heading_deg = heading_rad.to_degrees();

        // rad = 450 - deg
        let rad = (450.0 - heading_deg).to_radians();

        let half_theta = rad * 0.5;

        let mut w = f32::cos(half_theta);
        let mut z = f32::sin(half_theta);

        // Canonicalize (w must be non-negative to prevent flips)
        if w < 0.0 {
            w = -w;
            z = -z;
        }

        Self {
            w,
            x: 0.0,
            y: 0.0,
            z,
        }
    }

    /// Returns the inverse rotation for a unit quaternion.
    pub fn conjugate(&self) -> Self {
        Self {
            w: self.w,
            x: -self.x,
            y: -self.y,
            z: -self.z,
        }
    }

    /// Rotates one vector without allocating a matrix.
    pub fn rotate_vector(&self, vector: Vector3) -> Vector3 {
        let axis = Vector3::new(self.x, self.y, self.z);
        let first = axis.cross(&vector);
        let second = axis.cross(&first);
        Vector3::new(
            vector.x + 2.0 * (self.w * first.x + second.x),
            vector.y + 2.0 * (self.w * first.y + second.y),
            vector.z + 2.0 * (self.w * first.z + second.z),
        )
    }

    /// Composes rotations so the result applies `other` first, then `self`.
    pub fn multiply(&self, other: &Self) -> Self {
        Self {
            w: self.w * other.w - self.x * other.x - self.y * other.y - self.z * other.z,
            x: self.w * other.x + self.x * other.w + self.y * other.z - self.z * other.y,
            y: self.w * other.y - self.x * other.z + self.y * other.w + self.z * other.x,
            z: self.w * other.z + self.x * other.y - self.y * other.x + self.z * other.w,
        }
    }
}

/// A local rigid transform: a translation paired with a rotation.
///
/// This is retail's `Frame` (`acclient.c:307767-307793`) as a math primitive rather than a wire
/// type. Authored root motion is expressed as ordered rigid transforms, and one tick's authored
/// contribution composes down to exactly one of them, so the same primitive serves the content
/// projection and the solver input.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RigidTransform {
    pub translation: Vector3,
    pub rotation: Quaternion,
}

impl RigidTransform {
    /// The transform that moves and rotates nothing.
    pub fn identity() -> Self {
        Self {
            translation: Vector3::zero(),
            rotation: Quaternion::identity(),
        }
    }

    /// Composes `local`, expressed in this transform's frame, onto this one.
    ///
    /// This is retail's `Frame::combine` verbatim: `origin = f1.origin + f1.rot x f2.origin` and
    /// `rot = f1.rot * f2.rot` (`acclient.c:307767-307793`). Composition is exact, which is why an
    /// ordered program of authored offsets collapses to a single transform with no error to bound.
    pub fn combine(&self, local: &Self) -> Self {
        Self {
            translation: self.translation + self.rotation.rotate_vector(local.translation),
            rotation: self.rotation.multiply(&local.rotation),
        }
    }

    /// Removes a transform previously composed with `combine`, retail's `Frame::subtract1`
    /// (`acclient.c:342540-342579`).
    ///
    /// Retail computes the new rotation first and then subtracts the translation through the
    /// *new* rotation, which is what makes this the exact inverse of `combine` rather than an
    /// approximation of it. ACE's `AFrame.Subtract` uses the operand's own orientation instead and
    /// is not equivalent; the retail form is authoritative for client behavior.
    pub fn subtract(&self, local: &Self) -> Self {
        let rotation = self.rotation.multiply(&local.rotation.conjugate());
        Self {
            translation: self.translation - rotation.rotate_vector(local.translation),
            rotation,
        }
    }

    /// Rotates about an axis expressed in this transform's own frame, retail's `Frame::rotate`
    /// (`acclient.c:137544-137557`).
    ///
    /// The vector's direction is the axis and its magnitude is the angle in radians. Retail maps
    /// the axis into global space through the frame's cached matrix and then left-multiplies
    /// (`Frame::grotate`, `acclient.c:342628-342659`); because that matrix *is* this rotation,
    /// `R(M·w) * q` and `q * R(w)` are the same rotation, so the local right-multiply below is the
    /// same operation without materialising a matrix.
    ///
    /// Rotations below retail's threshold are dropped rather than normalised through a
    /// near-zero magnitude.
    pub fn rotate(&self, axis_angle: Vector3) -> Self {
        if axis_angle.length_squared() < ROTATION_EPSILON * ROTATION_EPSILON {
            return *self;
        }
        let Some(delta) = Quaternion::from_axis_angle(axis_angle, axis_angle.length()) else {
            return *self;
        };
        Self {
            translation: self.translation,
            rotation: self.rotation.multiply(&delta),
        }
    }
}

/// Smallest rotation magnitude retail acts on; `Frame::grotate` ignores anything below it.
pub const ROTATION_EPSILON: f32 = 0.000_2;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, BinRead, BinWrite)]
#[br(little)]
#[bw(little)]
pub struct Plane {
    pub normal: Vector3,
    pub d: f32,
}

impl Plane {
    /// Calculate the signed distance from a point to the plane.
    pub fn distance_to_point(&self, point: &Vector3) -> f32 {
        self.normal.dot(point) + self.d
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, BinRead, BinWrite)]
#[br(little)]
#[bw(little)]
pub struct Sphere {
    pub center: Vector3,
    pub radius: f32,
}

impl Sphere {
    pub fn intersects(&self, point: &Vector3, radius: f32) -> bool {
        let diff = self.center - *point;
        let dist_sq = diff.length_squared();
        let r_sum = self.radius + radius;
        dist_sq <= r_sum * r_sum
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `subtract` must undo `combine` exactly, including for a rotating offset: it is what lets
    /// reverse playback walk back out of an accumulated offset without drift.
    #[test]
    fn rigid_subtract_inverts_combine_under_rotation() {
        let base = RigidTransform {
            translation: Vector3::new(1.0, -2.0, 0.5),
            rotation: Quaternion::from_heading(0.7),
        };
        let local = RigidTransform {
            translation: Vector3::new(0.25, 0.5, -0.75),
            rotation: Quaternion::from_heading(1.9),
        };

        let restored = base.combine(&local).subtract(&local);

        assert!((restored.translation - base.translation).length() < 1e-5);
        assert!((restored.rotation.w - base.rotation.w).abs() < 1e-5);
        assert!((restored.rotation.z - base.rotation.z).abs() < 1e-5);
    }

    /// A local rotation must turn about the transform's own axis, so composing it is the same as
    /// combining a pure rotation.
    #[test]
    fn rigid_rotate_is_a_local_composition() {
        let base = RigidTransform {
            translation: Vector3::new(3.0, 0.0, 0.0),
            rotation: Quaternion::from_heading(0.4),
        };
        let quarter_turn = std::f32::consts::FRAC_PI_2;

        let rotated = base.rotate(Vector3::new(0.0, 0.0, quarter_turn));
        let combined = base.combine(&RigidTransform {
            translation: Vector3::zero(),
            rotation: Quaternion::from_axis_angle(Vector3::new(0.0, 0.0, 1.0), quarter_turn)
                .expect("a unit axis and finite angle build a rotation"),
        });

        assert_eq!(rotated.translation, base.translation);
        assert!((rotated.rotation.w - combined.rotation.w).abs() < 1e-5);
        assert!((rotated.rotation.z - combined.rotation.z).abs() < 1e-5);
    }

    #[test]
    fn rigid_rotate_ignores_rotations_below_the_retail_threshold() {
        let base = RigidTransform::identity();
        let below = ROTATION_EPSILON * 0.5;

        assert_eq!(base.rotate(Vector3::new(0.0, 0.0, below)), base);
    }

    #[test]
    fn test_heading_roundtrip() {
        let test_angles: [f32; 8] = [0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0];
        for deg in test_angles {
            let rad = deg.to_radians();
            let q = Quaternion::from_heading(rad);
            let result_rad = q.to_heading();
            let result_deg = result_rad.to_degrees();

            // Normalize result to 0-360 for comparison
            let normalized_result = (result_deg + 360.0) % 360.0;
            assert!(
                (normalized_result - deg).abs() < 1e-4,
                "Failed at {} deg: got {} deg",
                deg,
                normalized_result
            );
        }
    }

    #[test]
    fn test_cardinal_directions() {
        // West
        let q_w = Quaternion::from_heading(0.0);
        assert!((q_w.to_heading().to_degrees() - 0.0).abs() < 1e-4);

        // North
        let q_n = Quaternion::from_heading(90.0f32.to_radians());
        assert!((q_n.to_heading().to_degrees() - 90.0).abs() < 1e-4);

        // East
        let q_e = Quaternion::from_heading(180.0f32.to_radians());
        assert!((q_e.to_heading().to_degrees() - 180.0).abs() < 1e-4);

        // South
        let q_s = Quaternion::from_heading(270.0f32.to_radians());
        assert!((q_s.to_heading().to_degrees() - 270.0).abs() < 1e-4);
    }

    #[test]
    fn test_to_heading_default() {
        let q = Quaternion::default();
        let h = q.to_heading();
        assert!(
            !h.is_nan(),
            "Heading for default quaternion should not be NaN"
        );
    }

    #[test]
    fn test_to_heading_nan_input() {
        let q = Quaternion {
            w: f32::NAN,
            x: 0.0,
            y: 0.0,
            z: 0.0,
        };
        let h = q.to_heading();
        assert!(h.is_nan());
    }
}

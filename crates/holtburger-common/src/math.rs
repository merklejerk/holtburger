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
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, BinRead, BinWrite)]
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

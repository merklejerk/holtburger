use crate::guid::Guid;
use crate::math::{Quaternion, Vector3};
use serde::{Deserialize, Serialize};
use std::fmt;

pub const METERS_PER_LANDBLOCK: f32 = 192.0;
pub const METERS_PER_MAP_DEGREE: f32 = 240.0;
/// Highest authored outdoor landblock coordinate on either axis (2,040 terrain cells / 8).
pub const MAX_OUTDOOR_LANDBLOCK_AXIS: u8 = 0xfe;

/// Returns the authored outdoor owner containing one anchor-local point.
///
/// Non-finite points and points beyond AC's finite landscape have no canonical owner. The
/// saturating intermediate arithmetic keeps this primitive total even for extreme finite inputs.
pub fn outdoor_landblock_owner_at(anchor: Guid, local_point: Vector3) -> Option<Guid> {
    if !local_point.x.is_finite() || !local_point.y.is_finite() {
        return None;
    }
    let anchor_x = i64::from((anchor.0 >> 24) & 0xff);
    let anchor_y = i64::from((anchor.0 >> 16) & 0xff);
    let x = anchor_x.saturating_add((local_point.x / METERS_PER_LANDBLOCK).floor() as i64);
    let y = anchor_y.saturating_add((local_point.y / METERS_PER_LANDBLOCK).floor() as i64);
    let range = 0..=i64::from(MAX_OUTDOOR_LANDBLOCK_AXIS);
    (range.contains(&x) && range.contains(&y))
        .then_some(Guid(((x as u32) << 24) | ((y as u32) << 16) | 0xffff))
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorldPosition {
    pub landblock_id: Guid,
    pub coords: Vector3,
    pub rotation: Quaternion,
}

/// Invalid target supplied to exact landblock reanchoring.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorldPositionReanchorError {
    /// A null source has no meaningful outdoor landblock frame.
    NullSource,
    /// Outdoor normalization was requested while the position still names an EnvCell.
    IndoorSource(Guid),
    /// The target must identify a normalized `0xFFFF` landblock owner.
    InvalidTargetOwner(Guid),
}

impl fmt::Display for WorldPositionReanchorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NullSource => formatter.write_str("cannot reanchor a null world position"),
            Self::IndoorSource(cell) => write!(
                formatter,
                "cannot normalize indoor world position 0x{:08X} as an outdoor landblock",
                cell.0
            ),
            Self::InvalidTargetOwner(owner) => write!(
                formatter,
                "world-position reanchor target 0x{:08X} is not a normalized landblock owner",
                owner.0
            ),
        }
    }
}

impl std::error::Error for WorldPositionReanchorError {}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum WorldCoordinates {
    Indoor {
        landblock: u16,
    },
    Outdoor {
        lat: f32, // North is positive, South is negative
        lon: f32, // East is positive, West is negative
        alt: f32,
    },
}

impl WorldCoordinates {
    pub fn to_string_with_precision(&self, precision: usize) -> String {
        match self {
            WorldCoordinates::Indoor { landblock } => format!("Indoors [{:04X}]", landblock),
            WorldCoordinates::Outdoor { lat, lon, alt } => {
                let ns = if *lat >= 0.0 { "N" } else { "S" };
                let ew = if *lon >= 0.0 { "E" } else { "W" };

                // ACE uses a 0.05 nudge when formatting to 1 decimal place to round down .X5 to .X
                let display_lat = if precision == 1 {
                    lat.abs() - 0.05
                } else {
                    lat.abs()
                };
                let display_lon = if precision == 1 {
                    lon.abs() - 0.05
                } else {
                    lon.abs()
                };

                format!(
                    "{:.*}{}, {:.*}{}, {:.1}Z",
                    precision, display_lat, ns, precision, display_lon, ew, alt
                )
            }
        }
    }
}

impl std::fmt::Display for WorldCoordinates {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_string_with_precision(1))
    }
}

impl WorldPosition {
    /// Expresses the exact same world point in one normalized outdoor landblock frame.
    ///
    /// This is coordinate representation only: it neither reads collision content nor selects an
    /// EnvCell. Callers retain and validate interior placement as separate topology state.
    pub fn reanchor_to_landblock_owner(
        self,
        target_owner: Guid,
    ) -> Result<Self, WorldPositionReanchorError> {
        if self.landblock_id == Guid::NULL {
            return Err(WorldPositionReanchorError::NullSource);
        }
        if target_owner.0 & 0xffff != 0xffff {
            return Err(WorldPositionReanchorError::InvalidTargetOwner(target_owner));
        }

        let (source_x, source_y) = self.landblock_coords();
        let target_x = ((target_owner.0 >> 24) & 0xff) as u8;
        let target_y = ((target_owner.0 >> 16) & 0xff) as u8;
        Ok(Self {
            landblock_id: Guid(target_owner.0 & 0xffff_0000),
            coords: Vector3::new(
                self.coords.x
                    + (i32::from(source_x) - i32::from(target_x)) as f32 * METERS_PER_LANDBLOCK,
                self.coords.y
                    + (i32::from(source_y) - i32::from(target_y)) as f32 * METERS_PER_LANDBLOCK,
                self.coords.z,
            ),
            rotation: self.rotation,
        }
        .normalize_outdoor_cell())
    }

    /// Reanchors into the authored outdoor owner containing this point when one exists.
    ///
    /// Outside AC's finite landscape the last valid owner remains the coordinate anchor and local
    /// X/Y are intentionally noncanonical. Calling this again after motion returns to the authored
    /// lattice recanonicalizes the same world point without a snap.
    pub fn normalize_outdoor_landblock_frame(self) -> Result<Self, WorldPositionReanchorError> {
        if self.landblock_id == Guid::NULL {
            return Err(WorldPositionReanchorError::NullSource);
        }
        // `0xXXYYFFFF` is the authored landblock-owner frame used for coordinate-only math; it
        // is not an indoor EnvCell selector even though its low word is numerically above 0x100.
        if self.is_indoors() && self.landblock_id.0 & 0xffff != 0xffff {
            return Err(WorldPositionReanchorError::IndoorSource(self.landblock_id));
        }
        let Some(target) = outdoor_landblock_owner_at(self.landblock_id, self.coords) else {
            return Ok(self);
        };
        self.reanchor_to_landblock_owner(target)
    }

    pub fn global_coords(&self) -> Vector3 {
        let (landblock_x, landblock_y) = self.landblock_coords();

        Vector3::new(
            (landblock_x as f32 * METERS_PER_LANDBLOCK) + self.coords.x,
            (landblock_y as f32 * METERS_PER_LANDBLOCK) + self.coords.y,
            self.coords.z,
        )
    }

    pub fn is_indoors(&self) -> bool {
        // In Asheron's Call, the low 16 bits of the landblock ID contain the cell.
        // Cell IDs 0x0000 - 0x003F are used for the 64 outdoor cells in a landblock.
        // Cell IDs 0x0100 and above are used for indoor/dungeon cells.
        (self.landblock_id & 0xFFFF) >= 0x0100
    }

    pub fn landblock_coords(&self) -> (u8, u8) {
        // X = Longitude byte, Y = Latitude byte (high word of Landblock ID)
        let x = ((self.landblock_id >> 24) & 0xFF) as u8;
        let y = ((self.landblock_id >> 16) & 0xFF) as u8;
        (x, y)
    }

    pub fn derived_outdoor_cell_id(&self) -> Option<u32> {
        if self.landblock_id == Guid::NULL || self.is_indoors() {
            return None;
        }

        // ACE derives outdoor cell ids from the local 0-192 block coordinates.
        let max_local = METERS_PER_LANDBLOCK - 1e-4;
        let local_x = self.coords.x.clamp(0.0, max_local);
        let local_y = self.coords.y.clamp(0.0, max_local);
        let cell_length = METERS_PER_LANDBLOCK / 8.0;
        let cell_x = (local_x / cell_length) as u32;
        let cell_y = (local_y / cell_length) as u32;

        Some((cell_x * 8) + cell_y + 1)
    }

    pub fn normalize_outdoor_cell(mut self) -> Self {
        let Some(cell_id) = self.derived_outdoor_cell_id() else {
            return self;
        };

        self.landblock_id = Guid((self.landblock_id.0 & 0xFFFF_0000) | cell_id);
        self
    }

    pub fn landblock_chebyshev_distance_to(&self, other: &Self) -> Option<u8> {
        if self.landblock_id == Guid::NULL || other.landblock_id == Guid::NULL {
            return None;
        }

        let (self_x, self_y) = self.landblock_coords();
        let (other_x, other_y) = other.landblock_coords();

        Some(self_x.abs_diff(other_x).max(self_y.abs_diff(other_y)))
    }

    pub fn cell_coords(&self) -> (u8, u8) {
        if self.is_indoors() {
            return (0, 0); // Indoor cells don't have a 2d grid layout in the same way
        }
        let cell_id = (self.landblock_id & 0xFFFF) as i32;
        let cell_index = cell_id - 1;
        if !(0..64).contains(&cell_index) {
            // For block-only landblocks (low word 0xFFFF), x/y is 0
            return (0, 0);
        }
        let cx = ((cell_index >> 3) & 0x7) as u8;
        let cy = (cell_index & 0x7) as u8;
        (cx, cy)
    }

    pub fn to_world_coords(&self) -> WorldCoordinates {
        if self.is_indoors() {
            return WorldCoordinates::Indoor {
                landblock: (self.landblock_id & 0xFFFF) as u16,
            };
        }

        let (lb_x, lb_y) = self.landblock_coords();

        // 1 landblock = 192 meters = 0.8 degrees.
        // 1 degree = 240 meters.
        // The local coords (self.coords.x/y) in an outdoor WorldPosition are 0-192.
        // They are relative to the landblock origin, NOT the cell origin.

        let total_x_meters = (lb_x as f32 * METERS_PER_LANDBLOCK) + self.coords.x;
        let total_y_meters = (lb_y as f32 * METERS_PER_LANDBLOCK) + self.coords.y;

        // Formula from ACE (PositionExtensions.GetMapCoords):
        // 1 map unit = 240 meters
        // mapCoords = globalPos / 240.0
        // mapCoords -= 102.0
        let lon = (total_x_meters / METERS_PER_MAP_DEGREE) - 102.0;
        let lat = (total_y_meters / METERS_PER_MAP_DEGREE) - 102.0;

        WorldCoordinates::Outdoor {
            lat,
            lon,
            alt: self.coords.z,
        }
    }

    pub fn distance_to(&self, other: &Self) -> f32 {
        if self.landblock_id == other.landblock_id {
            return self.coords.distance(&other.coords);
        }

        // Global-space distance in meters.
        // Mirrors ACE Position.DistanceTo semantics, which use landblock offsets for
        // both outdoor and indoor cells.
        let delta = self.global_coords() - other.global_coords();

        delta.length()
    }

    pub fn heading_to(&self, other: &Self) -> f32 {
        if self.landblock_id == other.landblock_id {
            return self.coords.heading_to(&other.coords);
        }

        self.global_coords().heading_to(&other.global_coords())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn landblock_reanchoring_preserves_the_exact_world_point_without_content() {
        let original = WorldPosition {
            landblock_id: Guid(0xda55_010a),
            coords: Vector3::new(193.25, -0.5, 17.0),
            rotation: Quaternion::from_heading(1.0),
        };

        let reanchored = original
            .reanchor_to_landblock_owner(Guid(0xdb54_ffff))
            .unwrap();

        assert_eq!(reanchored.global_coords(), original.global_coords());
        assert_eq!(reanchored.coords, Vector3::new(1.25, 191.5, 17.0));
        assert_eq!(reanchored.rotation, original.rotation);
        assert!(!reanchored.is_indoors());
    }

    #[test]
    fn landblock_reanchoring_rejects_non_owner_targets() {
        let position = WorldPosition {
            landblock_id: Guid(0xda55_0020),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        assert_eq!(
            position.reanchor_to_landblock_owner(Guid(0xdb55_0100)),
            Err(WorldPositionReanchorError::InvalidTargetOwner(Guid(
                0xdb55_0100
            )))
        );
    }

    #[test]
    fn outdoor_frame_normalization_tracks_the_body_reference_across_a_seam() {
        let original = WorldPosition {
            landblock_id: Guid(0xda55_0020),
            coords: Vector3::new(192.25, -0.25, 4.0),
            rotation: Quaternion::identity(),
        };

        let normalized = original.normalize_outdoor_landblock_frame().unwrap();

        assert_eq!(normalized.global_coords(), original.global_coords());
        assert_eq!(normalized.landblock_coords(), (0xdb, 0x54));
        assert_eq!(normalized.coords, Vector3::new(0.25, 191.75, 4.0));
    }

    #[test]
    fn outdoor_frame_normalization_rejects_an_indoor_source() {
        let indoor = WorldPosition {
            landblock_id: Guid(0x0007_0100),
            coords: Vector3::new(944.5, -1595.0, -12.0),
            rotation: Quaternion::identity(),
        };

        assert_eq!(
            indoor.normalize_outdoor_landblock_frame(),
            Err(WorldPositionReanchorError::IndoorSource(Guid(0x0007_0100)))
        );
    }

    #[test]
    fn outdoor_frame_normalization_accepts_an_owner_sentinel_source() {
        let owner_frame = WorldPosition {
            landblock_id: Guid(0x0007_ffff),
            coords: Vector3::new(200.0, -40.0, -12.0),
            rotation: Quaternion::identity(),
        };

        let normalized = owner_frame
            .normalize_outdoor_landblock_frame()
            .expect("owner sentinel is a valid coordinate-only source");
        assert!(!normalized.is_indoors());
        assert_eq!(normalized.global_coords(), owner_frame.global_coords());
    }

    #[test]
    fn outdoor_frame_normalization_retains_each_landscape_edge_and_recanonicalizes_on_return() {
        let cases = [
            (
                Guid(0x0055_0020),
                Vector3::new(-0.25, 96.0, 4.0),
                Vector3::new(0.25, 96.0, 4.0),
            ),
            (
                Guid(0xfe55_0020),
                Vector3::new(192.25, 96.0, 4.0),
                Vector3::new(191.75, 96.0, 4.0),
            ),
            (
                Guid(0x5500_0020),
                Vector3::new(96.0, -0.25, 4.0),
                Vector3::new(96.0, 0.25, 4.0),
            ),
            (
                Guid(0x55fe_0020),
                Vector3::new(96.0, 192.25, 4.0),
                Vector3::new(96.0, 191.75, 4.0),
            ),
        ];

        for (anchor, outside_coords, returned_coords) in cases {
            let outside = WorldPosition {
                landblock_id: anchor,
                coords: outside_coords,
                rotation: Quaternion::identity(),
            };
            assert_eq!(
                outside.normalize_outdoor_landblock_frame().unwrap(),
                outside
            );

            let returned = WorldPosition {
                coords: returned_coords,
                ..outside
            };
            let normalized = returned.normalize_outdoor_landblock_frame().unwrap();
            assert_eq!(
                normalized.landblock_id.0 & 0xffff_0000,
                anchor.0 & 0xffff_0000
            );
            assert_eq!(normalized.coords, returned_coords);
            assert_eq!(normalized.global_coords(), returned.global_coords());
        }
    }

    #[test]
    fn outdoor_owner_lookup_is_total_for_invalid_and_extreme_points() {
        let anchor = Guid(0x7f7f_ffff);
        assert_eq!(
            outdoor_landblock_owner_at(anchor, Vector3::new(191.0, 0.0, 0.0)),
            Some(anchor)
        );
        assert_eq!(
            outdoor_landblock_owner_at(anchor, Vector3::new(f32::NAN, 0.0, 0.0)),
            None
        );
        assert_eq!(
            outdoor_landblock_owner_at(anchor, Vector3::new(f32::MAX, f32::MAX, 0.0)),
            None
        );
        assert_eq!(
            outdoor_landblock_owner_at(anchor, Vector3::new(f32::MIN, f32::MIN, 0.0)),
            None
        );
    }

    #[test]
    fn test_indoor_format() {
        let pos = WorldPosition {
            landblock_id: Guid(0x00000100),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        assert!(pos.is_indoors());
        assert_eq!(
            pos.to_world_coords(),
            WorldCoordinates::Indoor { landblock: 0x0100 }
        );
        assert_eq!(pos.to_world_coords().to_string(), "Indoors [0100]");
    }

    #[test]
    fn test_outdoor_format_known() {
        // Construct landblock bytes x=218 (0xDA), y=85 (0x55)
        // Global Y = 85 * 192 + 108 = 16428. Lat = 16428/240 - 102 = -33.55 (33.55S)
        // Global X = 218 * 192 + 84 = 41940. Lon = 41940/240 - 102 = 72.75 (72.75E)
        let landblock_id = (218u32 << 24) | (85u32 << 16);
        let pos = WorldPosition {
            landblock_id: Guid(landblock_id),
            coords: Vector3::new(84.0, 108.0, 0.0),
            rotation: Quaternion::identity(),
        };
        assert!(!pos.is_indoors());

        let coords = pos.to_world_coords();
        if let WorldCoordinates::Outdoor { lat, lon, alt: _ } = coords {
            assert!((lat - (-33.55)).abs() < 1e-4, "Lat was {}", lat);
            assert!((lon - 72.75).abs() < 1e-4, "Lon was {}", lon);
        } else {
            panic!("Expected outdoor coordinates");
        }
        // With precision 2, should be:
        assert_eq!(coords.to_string_with_precision(2), "33.55S, 72.75E, 0.0Z");
    }

    #[test]
    fn test_distance_between_adjacent_cells() {
        let lb = (0xDAu32 << 24) | (0x55u32 << 16);
        // Cell 0x1C (index 27): X=3, Y=3.
        let pos1 = WorldPosition {
            landblock_id: Guid(lb | 0x1C),
            coords: Vector3::new(84.0, 84.0, 0.0), // Abs X = 218*192 + 84
            rotation: Quaternion::identity(),
        };
        // Cell 0x1D (index 28): X=3, Y=4.
        let pos2 = WorldPosition {
            landblock_id: Guid(lb | 0x1D),
            coords: Vector3::new(84.0, 100.0, 0.0), // Abs X = 218*192 + 84, Y = 218*192 + 100
            rotation: Quaternion::identity(),
        };

        // Distance should be exactly 16m (difference in Y coordinates)
        let dist = pos1.distance_to(&pos2);
        assert!((dist - 16.0).abs() < 1e-4, "Distance was {}", dist);
    }

    #[test]
    fn test_distance_same_and_adjacent() {
        let lb = (1u32 << 24) | (2u32 << 16);
        let p1 = WorldPosition {
            landblock_id: Guid(lb),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let p2 = WorldPosition {
            landblock_id: Guid(lb),
            coords: Vector3::new(3.0, 4.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let d = p1.distance_to(&p2);
        assert!((d - 5.0).abs() < 1e-6);

        let p3 = WorldPosition {
            landblock_id: Guid(1u32 << 24),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let p4 = WorldPosition {
            landblock_id: Guid(0u32),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let d2 = p3.distance_to(&p4);
        assert!((d2 - 192.0).abs() < 1e-6);
    }

    #[test]
    fn test_landblock_chebyshev_distance_to_adjacent_block() {
        let p1 = WorldPosition {
            landblock_id: Guid(0x01010000),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let p2 = WorldPosition {
            landblock_id: Guid(0x02020000),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        assert_eq!(p1.landblock_chebyshev_distance_to(&p2), Some(1));
    }

    #[test]
    fn test_landblock_chebyshev_distance_to_two_blocks_away() {
        let p1 = WorldPosition {
            landblock_id: Guid(0x01010000),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let p2 = WorldPosition {
            landblock_id: Guid(0x03010000),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        assert_eq!(p1.landblock_chebyshev_distance_to(&p2), Some(2));
    }

    #[test]
    fn test_landblock_chebyshev_distance_to_returns_none_for_null_landblock() {
        let p1 = WorldPosition {
            landblock_id: Guid::NULL,
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let p2 = WorldPosition {
            landblock_id: Guid(0x01010000),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        assert_eq!(p1.landblock_chebyshev_distance_to(&p2), None);
    }

    #[test]
    fn test_normalize_outdoor_cell_recomputes_low_word_from_local_coords() {
        let pos = WorldPosition {
            landblock_id: Guid(0x3419_0039),
            coords: Vector3::new(0.3076172, 58.299316, 13.145146),
            rotation: Quaternion::identity(),
        };

        assert_eq!(pos.derived_outdoor_cell_id(), Some(0x0003));
        assert_eq!(pos.normalize_outdoor_cell().landblock_id, Guid(0x3419_0003));
    }

    #[test]
    fn test_normalize_outdoor_cell_leaves_indoor_positions_unchanged() {
        let pos = WorldPosition {
            landblock_id: Guid(0x016C_0155),
            coords: Vector3::new(12.0, -60.0, 0.0),
            rotation: Quaternion::identity(),
        };

        assert_eq!(pos.normalize_outdoor_cell(), pos);
    }

    #[test]
    fn test_distance_indoor_uses_global_space() {
        let indoor = WorldPosition {
            landblock_id: Guid(0x01000100),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let outdoor = WorldPosition {
            landblock_id: Guid(0u32),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let d = indoor.distance_to(&outdoor);
        assert!((d - 192.0).abs() < 1e-6, "Distance was {}", d);
    }

    #[test]
    fn test_heading_uses_global_space_across_landblocks() {
        let player = WorldPosition {
            landblock_id: Guid(0u32),
            coords: Vector3::new(10.0, 10.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let target = WorldPosition {
            landblock_id: Guid(1u32 << 24),
            coords: Vector3::new(10.0, 10.0, 0.0),
            rotation: Quaternion::identity(),
        };

        let heading = player.heading_to(&target);
        assert!(
            (heading - std::f32::consts::PI).abs() < 1e-6,
            "Heading was {}",
            heading
        );
    }
}

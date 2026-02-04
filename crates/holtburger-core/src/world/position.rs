use crate::math::{Quaternion, Vector3};
use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::world::properties::UpdatePositionFlag;
use byteorder::{ByteOrder, LittleEndian};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct WorldPosition {
    pub landblock_id: u32,
    pub coords: Vector3,
    pub rotation: Quaternion,
}

impl MessagePack for WorldPosition {
    fn pack(&self, writer: &mut Vec<u8>) {
        self.write_raw(writer);
    }
}

impl MessageUnpack for WorldPosition {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 32 > data.len() {
            return None;
        }
        Some(Self::read_raw(data, offset))
    }
}

impl WorldPosition {
    pub fn write_raw(&self, writer: &mut Vec<u8>) {
        use byteorder::{LittleEndian, WriteBytesExt};
        writer.write_u32::<LittleEndian>(self.landblock_id).unwrap();
        writer.write_f32::<LittleEndian>(self.coords.x).unwrap();
        writer.write_f32::<LittleEndian>(self.coords.y).unwrap();
        writer.write_f32::<LittleEndian>(self.coords.z).unwrap();
        writer.write_f32::<LittleEndian>(self.rotation.w).unwrap();
        writer.write_f32::<LittleEndian>(self.rotation.x).unwrap();
        writer.write_f32::<LittleEndian>(self.rotation.y).unwrap();
        writer.write_f32::<LittleEndian>(self.rotation.z).unwrap();
    }
}

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
                format!(
                    "{:.*}{}, {:.*}{}, {:.1}Z",
                    precision,
                    lat.abs(),
                    ns,
                    precision,
                    lon.abs(),
                    ew,
                    alt
                )
            }
        }
    }
}

impl std::fmt::Display for WorldCoordinates {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_string_with_precision(2))
    }
}

impl WorldPosition {
    pub fn is_indoors(&self) -> bool {
        (self.landblock_id & 0xFFFF) >= 0x0100
    }

    pub fn landblock_coords(&self) -> (u8, u8) {
        let x = ((self.landblock_id >> 24) & 0xFF) as u8;
        let y = ((self.landblock_id >> 16) & 0xFF) as u8;
        (x, y)
    }

    pub fn to_world_coords(&self) -> WorldCoordinates {
        if self.is_indoors() {
            return WorldCoordinates::Indoor {
                landblock: (self.landblock_id & 0xFFFF) as u16,
            };
        }

        let lb_x = ((self.landblock_id >> 24) & 0xFF) as f32;
        let lb_y = ((self.landblock_id >> 16) & 0xFF) as f32;

        // In Asheron's Call, outdoor coordinates are relative to the landblock, not the cell.
        // The world is 256x256 landblocks.
        // 1 landblock = 192 meters = 0.8 degrees.
        // 1 degree = 1.25 landblocks = 240 meters.
        // The coordinate system is centered such that 0.0, 0.0 is at an offset of 101.95 degrees.

        let total_x = lb_x * 0.8 + (self.coords.x / 240.0);
        let total_y = lb_y * 0.8 + (self.coords.y / 240.0);

        let lon = total_x - 101.95;
        let lat = total_y - 101.95;

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

        if self.is_indoors() || other.is_indoors() {
            // Different indoor landblocks/cells - can't compute distance easily without map data
            return 999.9;
        }

        // Outdoor distance calculation in meters
        let (x1, y1) = self.landblock_coords();
        let (x2, y2) = other.landblock_coords();

        let wx1 = (x1 as f32 * 192.0) + self.coords.x;
        let wy1 = (y1 as f32 * 192.0) + self.coords.y;
        let wx2 = (x2 as f32 * 192.0) + other.coords.x;
        let wy2 = (y2 as f32 * 192.0) + other.coords.y;

        let dx = wx1 - wx2;
        let dy = wy1 - wy2;
        let dz = self.coords.z - other.coords.z;

        (dx * dx + dy * dy + dz * dz).sqrt()
    }

    pub fn read_raw(data: &[u8], offset: &mut usize) -> Self {
        if data.len() < *offset + 32 {
            return Self::default();
        }
        let landblock_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let x = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let y = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let z = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        let qw = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let qx = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let qy = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        let qz = LittleEndian::read_f32(&data[*offset + 12..*offset + 16]);
        *offset += 16;

        Self {
            landblock_id,
            coords: Vector3 { x, y, z },
            rotation: Quaternion {
                w: qw,
                x: qx,
                y: qy,
                z: qz,
            },
        }
    }

    pub fn read(data: &[u8], offset: &mut usize) -> Self {
        if data.len() < *offset + 8 {
            return Self::default();
        }
        let raw_flags = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let flags = UpdatePositionFlag::from_bits_retain(raw_flags);
        *offset += 4;
        let landblock_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        // Origin position (always present in PositionPack)
        let x = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let y = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let z = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;

        let mut qw = 0.0;
        let mut qx = 0.0;
        let mut qy = 0.0;
        let mut qz = 0.0;

        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_W) {
            qw = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }
        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_X) {
            qx = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }
        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_Y) {
            qy = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }
        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_Z) {
            qz = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }

        // Handle the rest of the PositionPack (Velocity, Placement, Sequences)
        if flags.contains(UpdatePositionFlag::HAS_VELOCITY) {
            *offset += 12; // Skip velocity
        }
        if flags.contains(UpdatePositionFlag::HAS_PLACEMENT_ID) {
            *offset += 4; // Skip placement id
        }

        // Fixed sequences at the end of every PositionPack
        *offset += 8;

        Self {
            landblock_id,
            coords: Vector3 { x, y, z },
            rotation: Quaternion {
                w: qw,
                x: qx,
                y: qy,
                z: qz,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_indoor_format() {
        let pos = WorldPosition {
            landblock_id: 0x00000100,
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
        // Construct landblock bytes x=218 (0xDA), y=85 (0x55) to reproduce 33.50S, 72.80E, 0.0Z
        let landblock_id = (218u32 << 24) | (85u32 << 16);
        let pos = WorldPosition {
            landblock_id,
            coords: Vector3::new(84.0, 108.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let coords = pos.to_world_coords();
        if let WorldCoordinates::Outdoor { lat, lon, alt: _ } = coords {
            assert!((lat - (-33.5)).abs() < 1e-4);
            assert!((lon - 72.8).abs() < 1e-4);
        } else {
            panic!("Expected outdoor coordinates");
        }
        assert_eq!(coords.to_string(), "33.50S, 72.80E, 0.0Z");
    }

    #[test]
    fn test_distance_same_and_adjacent() {
        let lb = (1u32 << 24) | (2u32 << 16);
        let p1 = WorldPosition {
            landblock_id: lb,
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let p2 = WorldPosition {
            landblock_id: lb,
            coords: Vector3::new(3.0, 4.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let d = p1.distance_to(&p2);
        assert!((d - 5.0).abs() < 1e-6);

        let p3 = WorldPosition {
            landblock_id: (1u32 << 24),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let p4 = WorldPosition {
            landblock_id: 0u32,
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let d2 = p3.distance_to(&p4);
        assert!((d2 - 192.0).abs() < 1e-6);
    }

    #[test]
    fn test_distance_indoors_returns_large() {
        let indoor = WorldPosition {
            landblock_id: 0x00000100,
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let outdoor = WorldPosition {
            landblock_id: 0u32,
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let d = indoor.distance_to(&outdoor);
        assert!((d - 999.9).abs() < 1e-6);
    }

    #[test]
    fn test_read_raw_and_read() {
        let landblock_id = (218u32 << 24) | (85u32 << 16);
        let mut data = Vec::new();
        data.extend_from_slice(&landblock_id.to_le_bytes());
        data.extend_from_slice(&84.0f32.to_le_bytes());
        data.extend_from_slice(&108.0f32.to_le_bytes());
        data.extend_from_slice(&1.5f32.to_le_bytes()); // z
        data.extend_from_slice(&1.0f32.to_le_bytes()); // qw
        data.extend_from_slice(&0.0f32.to_le_bytes());
        data.extend_from_slice(&0.0f32.to_le_bytes());
        data.extend_from_slice(&0.0f32.to_le_bytes());

        let mut offset = 0usize;
        let p = WorldPosition::read_raw(&data, &mut offset);
        assert_eq!(offset, 32);
        assert_eq!(p.landblock_id, landblock_id);
        assert!((p.coords.x - 84.0).abs() < 1e-6);
        assert!((p.coords.y - 108.0).abs() < 1e-6);
        assert!((p.coords.z - 1.5).abs() < 1e-6);

        // Test read with position flags (PositionPack format)
        let mut data2 = Vec::new();
        // Pack: Flags(4), Landblock(4), X(4), Y(4), Z(4), Rotation(masked), Sequences(8)
        let flags: u32 = 0x00; // All rotation components present (no bits 0x08-0x40 set)
        data2.extend_from_slice(&flags.to_le_bytes());
        data2.extend_from_slice(&landblock_id.to_le_bytes());
        data2.extend_from_slice(&84.0f32.to_le_bytes());
        data2.extend_from_slice(&108.0f32.to_le_bytes());
        data2.extend_from_slice(&1.5f32.to_le_bytes());
        data2.extend_from_slice(&1.0f32.to_le_bytes()); // qw
        data2.extend_from_slice(&0.1f32.to_le_bytes());
        data2.extend_from_slice(&0.2f32.to_le_bytes());
        data2.extend_from_slice(&0.3f32.to_le_bytes());
        data2.extend_from_slice(&[0u8; 8]); // Sequences

        let mut offset2 = 0usize;
        let p2 = WorldPosition::read(&data2, &mut offset2);
        assert_eq!(p2.landblock_id, landblock_id);
        assert!((p2.coords.x - 84.0).abs() < 1e-6);
        assert!((p2.coords.y - 108.0).abs() < 1e-6);
        assert!((p2.coords.z - 1.5).abs() < 1e-6);
        assert!((p2.rotation.w - 1.0).abs() < 1e-6);
        assert!((p2.rotation.x - 0.1).abs() < 1e-6);
        assert_eq!(offset2, data2.len());
    }

    #[test]
    fn test_read_with_missing_rotation_components() {
        let mut data = Vec::new();
        // Flag 0x38 = 0x08 (NoW) | 0x10 (NoX) | 0x20 (NoY)
        // Should only read QZ
        let flags: u32 = 0x08 | 0x10 | 0x20;
        data.extend_from_slice(&flags.to_le_bytes());
        data.extend_from_slice(&0xDA55001Fu32.to_le_bytes()); // Landblock
        data.extend_from_slice(&1.0f32.to_le_bytes()); // X
        data.extend_from_slice(&2.0f32.to_le_bytes()); // Y
        data.extend_from_slice(&3.0f32.to_le_bytes()); // Z
        data.extend_from_slice(&0.9f32.to_le_bytes()); // QZ
        data.extend_from_slice(&[0u8; 8]); // Sequences

        let mut offset = 0usize;
        let p = WorldPosition::read(&data, &mut offset);
        assert_eq!(p.rotation.w, 0.0);
        assert_eq!(p.rotation.x, 0.0);
        assert_eq!(p.rotation.y, 0.0);
        assert_eq!(p.rotation.z, 0.9);
        assert_eq!(offset, data.len());
    }

    #[test]
    fn test_read_with_insufficient_data_returns_default() {
        let data: [u8; 4] = [0, 0, 0, 0];
        let mut offset = 0usize;
        let p = WorldPosition::read_raw(&data, &mut offset);
        assert_eq!(p, WorldPosition::default());
    }
}

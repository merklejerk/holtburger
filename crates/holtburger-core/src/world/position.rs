use crate::math::{Quaternion, Vector3};
use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::world::properties::UpdatePositionFlag;
use crate::world::Guid;
use byteorder::{ByteOrder, LittleEndian};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct WorldPosition {
    pub landblock_id: Guid,
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
        if data.len() < *offset + 32 {
            return None;
        }
        let landblock_id = LittleEndian::read_u32(&data[*offset..*offset + 4]).into();
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

        Some(Self {
            landblock_id,
            coords: Vector3 { x, y, z },
            rotation: Quaternion {
                w: qw,
                x: qx,
                y: qy,
                z: qz,
            },
        })
    }
}

/// A variable-length position structure used in movement updates (PositionPack in ACE)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct PositionPack {
    pub flags: UpdatePositionFlag,
    pub pos: WorldPosition,
    pub velocity: Option<Vector3>,
    pub placement_id: Option<u32>,
    pub instance_sequence: u16,
    pub position_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
}

impl MessageUnpack for PositionPack {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if data.len() < *offset + 8 {
            return None;
        }
        let raw_flags = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let flags = UpdatePositionFlag::from_bits_retain(raw_flags);
        *offset += 4;
        let landblock_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        // Origin position (always present)
        if data.len() < *offset + 12 {
            return None;
        }
        let x = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let y = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let z = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;

        let mut qw = 0.0;
        let mut qx = 0.0;
        let mut qy = 0.0;
        let mut qz = 0.0;

        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_W) {
            if *offset + 4 > data.len() {
                return None;
            }
            qw = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }
        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_X) {
            if *offset + 4 > data.len() {
                return None;
            }
            qx = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }
        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_Y) {
            if *offset + 4 > data.len() {
                return None;
            }
            qy = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }
        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_Z) {
            if *offset + 4 > data.len() {
                return None;
            }
            qz = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }

        let mut velocity = None;
        if flags.contains(UpdatePositionFlag::HAS_VELOCITY) {
            if *offset + 12 > data.len() {
                return None;
            }
            let vx = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            let vy = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
            let vz = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
            *offset += 12;
            velocity = Some(Vector3 {
                x: vx,
                y: vy,
                z: vz,
            });
        }

        let mut placement_id = None;
        if flags.contains(UpdatePositionFlag::HAS_PLACEMENT_ID) {
            if *offset + 4 > data.len() {
                return None;
            }
            placement_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        if *offset + 8 > data.len() {
            return None;
        }
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let position_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let teleport_sequence = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let force_position_sequence = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        *offset += 8;

        Some(Self {
            flags,
            pos: WorldPosition {
                landblock_id: Guid(landblock_id),
                coords: Vector3 { x, y, z },
                rotation: Quaternion {
                    w: qw,
                    x: qx,
                    y: qy,
                    z: qz,
                },
            },
            velocity,
            placement_id,
            instance_sequence,
            position_sequence,
            teleport_sequence,
            force_position_sequence,
        })
    }
}

impl MessagePack for PositionPack {
    fn pack(&self, writer: &mut Vec<u8>) {
        // For now, we always write a full orientation (no flags set)
        // or we use the flags we already have.
        // To be safe and simple: just write them as is.
        use byteorder::{LittleEndian, WriteBytesExt};
        writer.write_u32::<LittleEndian>(self.flags.bits()).unwrap();
        writer
            .write_u32::<LittleEndian>(self.pos.landblock_id.into())
            .unwrap();
        writer.write_f32::<LittleEndian>(self.pos.coords.x).unwrap();
        writer.write_f32::<LittleEndian>(self.pos.coords.y).unwrap();
        writer.write_f32::<LittleEndian>(self.pos.coords.z).unwrap();

        if !self
            .flags
            .contains(UpdatePositionFlag::ORIENTATION_HAS_NO_W)
        {
            writer
                .write_f32::<LittleEndian>(self.pos.rotation.w)
                .unwrap();
        }
        if !self
            .flags
            .contains(UpdatePositionFlag::ORIENTATION_HAS_NO_X)
        {
            writer
                .write_f32::<LittleEndian>(self.pos.rotation.x)
                .unwrap();
        }
        if !self
            .flags
            .contains(UpdatePositionFlag::ORIENTATION_HAS_NO_Y)
        {
            writer
                .write_f32::<LittleEndian>(self.pos.rotation.y)
                .unwrap();
        }
        if !self
            .flags
            .contains(UpdatePositionFlag::ORIENTATION_HAS_NO_Z)
        {
            writer
                .write_f32::<LittleEndian>(self.pos.rotation.z)
                .unwrap();
        }

        if let Some(v) = self.velocity {
            writer.write_f32::<LittleEndian>(v.x).unwrap();
            writer.write_f32::<LittleEndian>(v.y).unwrap();
            writer.write_f32::<LittleEndian>(v.z).unwrap();
        }
        if let Some(pid) = self.placement_id {
            writer.write_u32::<LittleEndian>(pid).unwrap();
        }

        writer
            .write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        writer
            .write_u16::<LittleEndian>(self.position_sequence)
            .unwrap();
        writer
            .write_u16::<LittleEndian>(self.teleport_sequence)
            .unwrap();
        writer
            .write_u16::<LittleEndian>(self.force_position_sequence)
            .unwrap();
    }
}

impl WorldPosition {
    pub fn write_raw(&self, writer: &mut Vec<u8>) {
        use byteorder::{LittleEndian, WriteBytesExt};
        writer.write_u32::<LittleEndian>(self.landblock_id.into()).unwrap();
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

        let total_x_meters = (lb_x as f32 * 192.0) + self.coords.x;
        let total_y_meters = (lb_y as f32 * 192.0) + self.coords.y;

        // Formula from ACE (PositionExtensions.GetMapCoords):
        // 1 map unit = 240 meters
        // mapCoords = globalPos / 240.0
        // mapCoords -= 102.0
        let lon = (total_x_meters / 240.0) - 102.0;
        let lat = (total_y_meters / 240.0) - 102.0;

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
            // Different indoor landblocks/cells - can't compute distance easily without map data.
            // If they are the same dungeon cell, it would have caught in the same-id check above.
            return 999.9;
        }

        // Outdoor distance calculation in meters
        let (lb_x1, lb_y1) = self.landblock_coords();
        let (lb_x2, lb_y2) = other.landblock_coords();

        // Coordinates are 0-192 relative to the landblock.
        let wx1 = (lb_x1 as f32 * 192.0) + self.coords.x;
        let wy1 = (lb_y1 as f32 * 192.0) + self.coords.y;
        let wx2 = (lb_x2 as f32 * 192.0) + other.coords.x;
        let wy2 = (lb_y2 as f32 * 192.0) + other.coords.y;

        let dx = wx1 - wx2;
        let dy = wy1 - wy2;
        let dz = self.coords.z - other.coords.z;

        (dx * dx + dy * dy + dz * dz).sqrt()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_distance_indoors_returns_large() {
        let indoor = WorldPosition {
            landblock_id: Guid(0x00000100),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let outdoor = WorldPosition {
            landblock_id: Guid(0u32),
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
        let p = WorldPosition::unpack(&data, &mut offset).unwrap();
        assert_eq!(offset, 32);
        assert_eq!(p.landblock_id, Guid(landblock_id));
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
        let p2 = PositionPack::unpack(&data2, &mut offset2).unwrap();
        assert_eq!(p2.pos.landblock_id, Guid(landblock_id));
        assert!((p2.pos.coords.x - 84.0).abs() < 1e-6);
        assert!((p2.pos.coords.y - 108.0).abs() < 1e-6);
        assert!((p2.pos.coords.z - 1.5).abs() < 1e-6);
        assert!((p2.pos.rotation.w - 1.0).abs() < 1e-6);
        assert!((p2.pos.rotation.x - 0.1).abs() < 1e-6);
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
        let p = PositionPack::unpack(&data, &mut offset).unwrap();
        assert_eq!(p.pos.rotation.w, 0.0);
        assert_eq!(p.pos.rotation.x, 0.0);
        assert_eq!(p.pos.rotation.y, 0.0);
        assert_eq!(p.pos.rotation.z, 0.9);
        assert_eq!(offset, data.len());
    }

    #[test]
    fn test_read_with_insufficient_data() {
        let data: [u8; 4] = [0, 0, 0, 0];
        let mut offset = 0usize;
        let p = WorldPosition::unpack(&data, &mut offset);
        assert!(p.is_none());
    }
}

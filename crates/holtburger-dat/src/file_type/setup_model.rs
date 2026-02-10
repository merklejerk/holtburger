use crate::graphics::Frame;
use crate::utils::{read_compressed_u32, write_compressed_u32};
use binrw::{
    BinRead, BinResult, BinWrite,
    io::{Read, Seek, Write},
};
use holtburger_common::{Sphere, Vector3};
use std::collections::HashMap;

#[derive(Debug, Clone, BinRead, BinWrite)]
#[br(little)]
#[bw(little)]
pub struct CylSphere {
    pub origin: Vector3,
    pub radius: f32,
    pub height: f32,
}

#[derive(Debug, Clone, BinRead, BinWrite)]
#[br(little)]
#[bw(little)]
pub struct LocationType {
    pub part_id: i32,
    pub frame: Frame,
}

#[derive(Debug, Clone, BinRead, BinWrite)]
#[br(little)]
#[bw(little)]
pub struct LightInfo {
    pub viewer_space_location: Frame,
    pub color: u32,
    pub intensity: f32,
    pub falloff: f32,
    pub cone_angle: f32,
}

#[derive(Debug, Clone)]
pub struct AnimationHook {
    pub hook_type: u32,
    pub direction: i32,
    pub data: Vec<u8>,
}

impl AnimationHook {
    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let hook_type = u32::read_le(reader)?;
        let direction = i32::read_le(reader)?;

        let payload_size = match hook_type {
            0 => 0,   // NoOp
            1 => 4,   // Sound (Id)
            2 => 4,   // SoundTable (SoundType)
            3 => 28,  // Attack (AttackCone)
            4 => 0,   // AnimationDone
            5 => 6,   // ReplaceObject (PartIndex: u16, PartID: u32)
            6 => 4,   // Ethereal (Ethereal: i32)
            7 => 16,  // TransparentPart (Part, Start, End, Time)
            8 => 12,  // Luminous (Start, End, Time)
            9 => 16,  // LuminousPart (Part, Start, End, Time)
            10 => 12, // Diffuse (Start, End, Time)
            11 => 16, // DiffusePart (Part, Start, End, Time)
            12 => 8,  // Scale (End, Time)
            13 => 40, // CreateParticle (EmitterInfoId, PartIndex, Offset: Frame, EmitterId)
            14 => 4,  // DestroyParticle (EmitterId)
            15 => 4,  // StopParticle (EmitterId)
            16 => 4,  // NoDraw (NoDraw: u32)
            17 => 0,  // DefaultScript
            18 => 4,  // DefaultScriptPart (PartIndex)
            19 => 8,  // CallPES (PES: u32, Pause: f32)
            20 => 12, // Transparent (Start, End, Time)
            21 => 16, // SoundTweaked (SoundID, Priority, Probability, Volume)
            22 => 12, // SetOmega (Axis: Vector3)
            23 => 8,  // TextureVelocity (USpeed, VSpeed)
            24 => 12, // TextureVelocityPart (PartIndex, USpeed, VSpeed)
            25 => 4,  // SetLight (LightsOn: i32)
            26 => 40, // CreateBlockingParticle (Inherits from CreateParticle)
            _ => {
                return Err(binrw::Error::Custom {
                    pos: reader.stream_position()?,
                    err: Box::new(format!(
                        "Unsupported AnimationHook type: 0x{:08X}",
                        hook_type
                    )),
                });
            }
        };

        let mut data = vec![0u8; payload_size];
        if payload_size > 0 {
            reader.read_exact(&mut data)?;
        }

        Ok(Self {
            hook_type,
            direction,
            data,
        })
    }

    pub fn write<W: Write + Seek>(&self, writer: &mut W) -> BinResult<()> {
        self.hook_type.write_le(writer)?;
        self.direction.write_le(writer)?;
        writer.write_all(&self.data)?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct AnimationFrame {
    pub frames: Vec<Frame>,
    pub hooks: Vec<AnimationHook>,
}

impl AnimationFrame {
    pub fn read<R: Read + Seek>(reader: &mut R, num_parts: u32) -> BinResult<Self> {
        let mut frames = Vec::with_capacity(num_parts as usize);
        for _ in 0..num_parts {
            frames.push(Frame::read_le(reader)?);
        }

        let num_hooks = u32::read_le(reader)?;
        let mut hooks = Vec::with_capacity(num_hooks as usize);
        for _ in 0..num_hooks {
            hooks.push(AnimationHook::read(reader)?);
        }

        Ok(Self { frames, hooks })
    }

    pub fn write<W: Write + Seek>(&self, writer: &mut W) -> BinResult<()> {
        for frame in &self.frames {
            frame.write_le(writer)?;
        }
        (self.hooks.len() as u32).write_le(writer)?;
        for hook in &self.hooks {
            hook.write(writer)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct PlacementType {
    pub anim_frame: AnimationFrame,
}

impl PlacementType {
    pub fn read<R: Read + Seek>(reader: &mut R, num_parts: u32) -> BinResult<Self> {
        Ok(Self {
            anim_frame: AnimationFrame::read(reader, num_parts)?,
        })
    }

    pub fn write<W: Write + Seek>(&self, writer: &mut W) -> BinResult<()> {
        self.anim_frame.write(writer)
    }
}

#[derive(Debug, Clone)]
pub struct SetupModel {
    pub id: u32,
    pub flags: u32,
    pub parts: Vec<u32>,
    pub parent_index: Vec<u32>,
    pub default_scale: Vec<Vector3>,
    pub holding_locations: HashMap<i32, LocationType>,
    pub connection_points: HashMap<i32, LocationType>,
    pub placement_frames: HashMap<i32, PlacementType>,
    pub cyl_spheres: Vec<CylSphere>,
    pub spheres: Vec<Sphere>,
    pub height: f32,
    pub radius: f32,
    pub step_up: f32,
    pub step_down: f32,
    pub sorting_sphere: Sphere,
    pub selection_sphere: Sphere,
    pub lights: HashMap<i32, LightInfo>,
    pub default_animation: Option<u32>,
    pub default_script: Option<u32>,
    pub default_motion_table: Option<u32>,
    pub default_sound_table: Option<u32>,
    pub default_script_table: Option<u32>,
}

impl SetupModel {
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let flags = u32::read_le(reader)?;

        let num_parts = u32::read_le(reader)?;
        let mut parts = Vec::with_capacity(num_parts as usize);
        for _ in 0..num_parts {
            parts.push(u32::read_le(reader)?);
        }

        let mut parent_index = Vec::new();
        if (flags & 0x01) != 0 {
            // HasParent
            for _ in 0..num_parts {
                parent_index.push(u32::read_le(reader)?);
            }
        }

        let mut default_scale = Vec::new();
        if (flags & 0x02) != 0 {
            // HasDefaultScale
            for _ in 0..num_parts {
                default_scale.push(Vector3::read_le(reader)?);
            }
        }

        // HoldingLocations (Dict)
        let num_holding = u32::read_le(reader)?;
        let mut holding_locations = HashMap::new();
        for _ in 0..num_holding {
            let key = i32::read_le(reader)?;
            holding_locations.insert(key, LocationType::read_le(reader)?);
        }

        // ConnectionPoints (Dict)
        let num_conn = u32::read_le(reader)?;
        let mut connection_points = HashMap::new();
        for _ in 0..num_conn {
            let key = i32::read_le(reader)?;
            connection_points.insert(key, LocationType::read_le(reader)?);
        }

        // PlacementFrames (Dict)
        let num_placements = u32::read_le(reader)?;
        let mut placement_frames = HashMap::new();
        for _ in 0..num_placements {
            let key = i32::read_le(reader)?;
            placement_frames.insert(key, PlacementType::read(reader, num_parts)?);
        }

        // CylSpheres (SmartArray)
        let num_cyl = read_compressed_u32(reader)?;
        let mut cyl_spheres = Vec::with_capacity(num_cyl as usize);
        for _ in 0..num_cyl {
            cyl_spheres.push(CylSphere::read_le(reader)?);
        }

        // Spheres (SmartArray)
        let num_sph = read_compressed_u32(reader)?;
        let mut spheres = Vec::with_capacity(num_sph as usize);
        for _ in 0..num_sph {
            spheres.push(Sphere::read_le(reader)?);
        }

        let height = f32::read_le(reader)?;
        let radius = f32::read_le(reader)?;
        let step_up = f32::read_le(reader)?;
        let step_down = f32::read_le(reader)?;

        let sorting_sphere = Sphere::read_le(reader)?;
        let selection_sphere = Sphere::read_le(reader)?;

        // Lights (Dict)
        let num_lights = u32::read_le(reader)?;
        let mut lights = HashMap::new();
        for _ in 0..num_lights {
            let key = i32::read_le(reader)?;
            lights.insert(key, LightInfo::read_le(reader)?);
        }

        // Optional trailers
        let mut default_animation = None;
        let mut default_script = None;
        let mut default_motion_table = None;
        let mut default_sound_table = None;
        let mut default_script_table = None;

        let current_pos = reader.stream_position()?;
        let end_pos = reader.seek(std::io::SeekFrom::End(0))?;
        reader.seek(std::io::SeekFrom::Start(current_pos))?;

        if current_pos + 4 <= end_pos {
            default_animation = Some(u32::read_le(reader)?);
        }
        if current_pos + 8 <= end_pos {
            default_script = Some(u32::read_le(reader)?);
        }
        if current_pos + 12 <= end_pos {
            default_motion_table = Some(u32::read_le(reader)?);
        }
        if current_pos + 16 <= end_pos {
            default_sound_table = Some(u32::read_le(reader)?);
        }
        if current_pos + 20 <= end_pos {
            default_script_table = Some(u32::read_le(reader)?);
        }

        Ok(SetupModel {
            id,
            flags,
            parts,
            parent_index,
            default_scale,
            holding_locations,
            connection_points,
            placement_frames,
            cyl_spheres,
            spheres,
            height,
            radius,
            step_up,
            step_down,
            sorting_sphere,
            selection_sphere,
            lights,
            default_animation,
            default_script,
            default_motion_table,
            default_sound_table,
            default_script_table,
        })
    }

    pub fn pack<W: Write + Seek>(&self, writer: &mut W) -> BinResult<()> {
        self.id.write_le(writer)?;
        self.flags.write_le(writer)?;

        (self.parts.len() as u32).write_le(writer)?;
        for &part in &self.parts {
            part.write_le(writer)?;
        }

        if (self.flags & 0x01) != 0 {
            for &idx in &self.parent_index {
                idx.write_le(writer)?;
            }
        }

        if (self.flags & 0x02) != 0 {
            for scale in &self.default_scale {
                scale.write_le(writer)?;
            }
        }

        (self.holding_locations.len() as u32).write_le(writer)?;
        let mut hold_keys: Vec<_> = self.holding_locations.keys().collect();
        hold_keys.sort();
        for &k in hold_keys {
            k.write_le(writer)?;
            self.holding_locations.get(&k).unwrap().write_le(writer)?;
        }

        (self.connection_points.len() as u32).write_le(writer)?;
        let mut conn_keys: Vec<_> = self.connection_points.keys().collect();
        conn_keys.sort();
        for &k in conn_keys {
            k.write_le(writer)?;
            self.connection_points.get(&k).unwrap().write_le(writer)?;
        }

        (self.placement_frames.len() as u32).write_le(writer)?;
        let mut place_keys: Vec<_> = self.placement_frames.keys().collect();
        place_keys.sort();
        for &k in place_keys {
            k.write_le(writer)?;
            self.placement_frames.get(&k).unwrap().write(writer)?;
        }

        write_compressed_u32(writer, self.cyl_spheres.len() as u32)?;
        for cyl in &self.cyl_spheres {
            cyl.write_le(writer)?;
        }

        write_compressed_u32(writer, self.spheres.len() as u32)?;
        for sph in &self.spheres {
            sph.write_le(writer)?;
        }

        self.height.write_le(writer)?;
        self.radius.write_le(writer)?;
        self.step_up.write_le(writer)?;
        self.step_down.write_le(writer)?;

        self.sorting_sphere.write_le(writer)?;
        self.selection_sphere.write_le(writer)?;

        (self.lights.len() as u32).write_le(writer)?;
        let mut light_keys: Vec<_> = self.lights.keys().collect();
        light_keys.sort();
        for &k in light_keys {
            k.write_le(writer)?;
            self.lights.get(&k).unwrap().write_le(writer)?;
        }

        if let Some(v) = self.default_animation {
            v.write_le(writer)?;
        }
        if let Some(v) = self.default_script {
            v.write_le(writer)?;
        }
        if let Some(v) = self.default_motion_table {
            v.write_le(writer)?;
        }
        if let Some(v) = self.default_sound_table {
            v.write_le(writer)?;
        }
        if let Some(v) = self.default_script_table {
            v.write_le(writer)?;
        }

        Ok(())
    }

    pub fn prune(&mut self) {
        // Drain the lamp oil
        self.lights.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_setup_model_prune() {
        let mut setup = SetupModel {
            id: 0x02000001,
            flags: 0,
            parts: vec![0, 1],
            parent_index: vec![],
            default_scale: vec![],
            holding_locations: HashMap::new(),
            connection_points: HashMap::new(),
            placement_frames: HashMap::new(),
            cyl_spheres: vec![],
            spheres: vec![],
            height: 1.0,
            radius: 1.0,
            step_up: 0.1,
            step_down: 0.1,
            sorting_sphere: Sphere {
                center: Vector3::zero(),
                radius: 1.0,
            },
            selection_sphere: Sphere {
                center: Vector3::zero(),
                radius: 1.0,
            },
            lights: HashMap::new(),
            default_animation: None,
            default_script: None,
            default_motion_table: None,
            default_sound_table: None,
            default_script_table: None,
        };

        setup.lights.insert(
            1,
            LightInfo {
                viewer_space_location: Frame::default(),
                color: 0xFFFFFFFF,
                intensity: 1.0,
                falloff: 1.0,
                cone_angle: 1.0,
            },
        );

        assert_eq!(setup.lights.len(), 1);
        setup.prune();
        assert_eq!(setup.lights.len(), 0);

        let mut data = Vec::new();
        let mut writer = Cursor::new(&mut data);
        setup.pack(&mut writer).unwrap();

        let mut reader = Cursor::new(data);
        let unpacked = SetupModel::unpack(&mut reader).unwrap();
        assert_eq!(unpacked.lights.len(), 0);
        assert_eq!(unpacked.parts.len(), 2);
    }
}

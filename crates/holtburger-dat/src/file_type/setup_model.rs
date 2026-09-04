use crate::graphics::Frame;
use binrw::{
    BinRead, BinResult, BinWrite,
    io::{Read, Seek, Write},
};
use holtburger_common::{ParentLocation, Placement, Sphere, Vector3};
use std::collections::HashMap;

/// Report a decode rejection at the reader's current position without losing the seek failure.
fn decode_error<R: Seek>(reader: &mut R, message: String) -> binrw::Error {
    match reader.stream_position() {
        Ok(pos) => binrw::Error::Custom {
            pos,
            err: Box::new(message),
        },
        Err(error) => binrw::Error::Io(error),
    }
}

/// `AnimationDone` carries no payload, so it is identified by hook type rather than by variant.
const ANIMATION_DONE_HOOK_TYPE: u32 = 4;

/// `GfxObj` file-id space that replace-object hooks encode relative to.
const GFX_OBJ_KNOWN_TYPE: u32 = 0x0100_0000;

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
/// One attach point: which part of the owning setup carries it, and the offset frame on that part.
///
/// `part_index` indexes the setup's part array. Retail bounds-checks it against `num_parts` in
/// `CPhysicsObj::UpdateChild` (`acclient.c:308302`) and falls back to the object frame when it is
/// out of range, which is what makes it an index rather than an identifier.
pub struct LocationType {
    pub part_index: i32,
    pub frame: Frame,
}

#[derive(Debug, Clone, BinRead, BinWrite)]
#[br(little)]
#[bw(little)]
pub struct LightInfo {
    /// Retail `LIGHTINFO::LightType`: 0 = point, 1 = distant, 2 = spot. Every observed
    /// EoR asset authors 0; retail `CSetup::UnPack` reads this dword into the type field
    /// (acclient.c:322738), so it is not a dictionary key.
    pub light_type: i32,
    pub viewer_space_location: Frame,
    pub color: u32,
    pub intensity: f32,
    pub falloff: f32,
    /// Uninitialized in every observed EoR asset (0xCDCDCDCD bit pattern); only
    /// meaningful for spot lights, which no asset authors.
    pub cone_angle: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnimationHook {
    pub hook_type: u32,
    pub direction: i32,
    pub payload: AnimationHookPayload,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AnimationHookPayload {
    NoPayload,
    Raw(Vec<u8>),
    Attack(AttackConeHookPayload),
    Ethereal(EtherealHookPayload),
    ReplaceObject(ReplaceObjectHookPayload),
    SetOmega(SetOmegaHookPayload),
    TransparentPart(TransparentPartHookPayload),
    TextureVelocity(TextureVelocityHookPayload),
    TextureVelocityPart(TextureVelocityPartHookPayload),
    SoundTable(SoundTableHookPayload),
    Scale(ScaleHookPayload),
    CreateParticle(CreateParticleHookPayload),
    DestroyParticle(ParticleEmitterHookPayload),
    StopParticle(ParticleEmitterHookPayload),
    CallPes(CallPesHookPayload),
    SoundTweaked(SoundTweakedHookPayload),
}

/// Melee attack volume the animation arms for the frames this hook spans.
///
/// Field order proven from ACE `AttackCone::Unpack`; the left and right terms are 2D directions in
/// the attacking part's frame. Carried for a future combat system; nothing consumes it today.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AttackConeHookPayload {
    /// Setup part the cone is anchored to; `-1` addresses the whole object.
    ///
    /// Signed because retail passes it straight to `AttackManager::NewAttack`
    /// (`acclient.c:308215`) and ACE types it `int`. The sentinel is the common case: 675 of the
    /// 1,047 attack hooks in referenced content use it.
    pub part_index: i32,
    pub left_x: f32,
    pub left_y: f32,
    pub right_x: f32,
    pub right_y: f32,
    pub radius: f32,
    pub height: f32,
}

/// Collision-state toggle retail applies with `CPhysicsObj::set_ethereal`
/// (`acclient.c:328623-328626`).
///
/// Stored on the wire as `i32`; every hook in retail content stores exactly 0 or 1, so the decoded
/// form is a bool and any other value is a decode error rather than a silent truncation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EtherealHookPayload {
    pub ethereal: bool,
}

/// Swaps one setup part's graphics object mid-animation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReplaceObjectHookPayload {
    /// Index of the setup part whose graphics object is replaced.
    pub part_index: u16,
    /// Full `GfxObj` file id, unpacked from the wire's known-type-relative encoding.
    pub gfx_obj_id: u32,
}

/// Sound-type key resolved against the owning object's installed `SoundTable`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SoundTableHookPayload {
    /// Retail `SoundType` key; selection semantics live in the sound table, not here.
    pub sound_type: u32,
}

/// Whole-object uniform scale target and the authored time to reach it.
///
/// Field order is `end` then `time`, proven from retail `ScaleHook::UnPack`
/// (acclient.c:328805-328816); retail interpolates linearly from the object's current scale.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScaleHookPayload {
    /// Uniform scale the object reaches when the ramp completes.
    pub end: f32,
    /// Ramp duration in seconds; retail treats very small values as immediate.
    pub duration_seconds: f32,
}

/// One authored particle-emitter creation request.
#[derive(Debug, Clone, PartialEq)]
pub struct CreateParticleHookPayload {
    /// 0x32 `ParticleEmitterInfo` DID describing the emitter to instantiate.
    pub emitter_info_id: u32,
    /// Owning part index, or `-1` for the whole object's frame.
    ///
    /// Signed deliberately: retail branches on `part_index == -1` and the archive authors it.
    /// ACE reads this as unsigned, which hides the sentinel.
    pub part_index: i32,
    /// Spawn offset applied to the parent frame's origin.
    ///
    /// Retail never applies this frame's rotation, so the quaternion is retained for losslessness
    /// but has no consumer.
    pub offset: Frame,
    /// Emitter identity; `0` requests an auto-assigned id, nonzero replaces any same-id emitter.
    pub emitter_id: u32,
}

/// Identity of an existing particle emitter addressed by a stop or destroy hook.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParticleEmitterHookPayload {
    /// Emitter slot previously authored by `CreateParticle`.
    pub emitter_id: u32,
}

/// A chained physics-script activation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CallPesHookPayload {
    /// 0x33 `PhysicsScript` DID to activate.
    pub script_id: u32,
    /// Upper bound of a uniform random activation delay, not a fixed delay.
    ///
    /// Retail rolls `RollDice(0, pause)` and defers; values below `0.0002` start synchronously
    /// (`CPhysicsObj::CallPES`, acclient.c:307316-307345).
    pub pause_seconds: f32,
}

/// A directly addressed sound with authored playback parameters.
///
/// RETAIL QUIRK: field names follow retail's proven use, not ACE's labels. Retail's `Execute` rolls against the
/// **first** float after the sound id and discards the second entirely
/// (acclient.c:329412-329431, 366790-366812). The archive corroborates this — every representative
/// record authors `probability = 1.0, unused = 0.0`, which under ACE's naming would give every
/// authored ambient sound a zero chance of ever playing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SoundTweakedHookPayload {
    /// 0x0A `Wave` DID played directly, bypassing the object's sound table.
    pub sound_id: u32,
    /// Play chance in [0, 1] rolled at trigger time.
    pub probability: f32,
    /// Parsed for losslessness; retail reads and discards it.
    pub unused: f32,
    /// Linear gain applied before distance attenuation.
    pub volume: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SetOmegaHookPayload {
    /// Authored angular velocity in AC coordinates.
    pub omega: Vector3,
}

/// Part-local translucency endpoints and authored ramp duration.
///
/// The exact `u32 + f32 + f32 + f32` layout is proven by ACE's
/// `TransparentPartHook.Unpack` and retail `TransparentPartHook::UnPack`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TransparentPartHookPayload {
    /// Zero-based setup part-array index.
    pub part_index: u32,
    /// Translucency at the start of the authored effect.
    pub start: f32,
    /// Translucency at the end of the authored effect.
    pub end: f32,
    /// Authored effect duration in seconds; retail treats very small values as immediate.
    pub duration_seconds: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextureVelocityHookPayload {
    pub u_speed: f32,
    pub v_speed: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextureVelocityPartHookPayload {
    pub part_index: u32,
    pub u_speed: f32,
    pub v_speed: f32,
}

impl AnimationHook {
    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let hook_type = u32::read_le(reader)?;
        let direction = i32::read_le(reader)?;

        let payload = match hook_type {
            0 => AnimationHookPayload::NoPayload, // NoOp
            1 => AnimationHookPayload::Raw(read_exact_payload(reader, 4)?), // Sound (Id)
            2 => AnimationHookPayload::SoundTable(SoundTableHookPayload {
                sound_type: u32::read_le(reader)?,
            }),
            3 => AnimationHookPayload::Attack(read_attack_cone_payload(reader)?),
            4 => AnimationHookPayload::NoPayload, // AnimationDone
            5 => AnimationHookPayload::ReplaceObject(read_replace_object_payload(reader)?),
            6 => AnimationHookPayload::Ethereal(read_ethereal_payload(reader)?),
            7 => AnimationHookPayload::TransparentPart(read_transparent_part_payload(reader)?),
            8 => AnimationHookPayload::Raw(read_exact_payload(reader, 12)?), // Luminous
            9 => AnimationHookPayload::Raw(read_exact_payload(reader, 16)?), // LuminousPart
            10 => AnimationHookPayload::Raw(read_exact_payload(reader, 12)?), // Diffuse
            11 => AnimationHookPayload::Raw(read_exact_payload(reader, 16)?), // DiffusePart
            12 => AnimationHookPayload::Scale(read_scale_payload(reader)?),
            13 => AnimationHookPayload::CreateParticle(read_create_particle_payload(reader)?),
            14 => AnimationHookPayload::DestroyParticle(ParticleEmitterHookPayload {
                emitter_id: u32::read_le(reader)?,
            }),
            15 => AnimationHookPayload::StopParticle(ParticleEmitterHookPayload {
                emitter_id: u32::read_le(reader)?,
            }),
            16 => AnimationHookPayload::Raw(read_exact_payload(reader, 4)?), // NoDraw
            17 => AnimationHookPayload::NoPayload,                           // DefaultScript
            18 => AnimationHookPayload::Raw(read_exact_payload(reader, 4)?), // DefaultScriptPart
            19 => AnimationHookPayload::CallPes(read_call_pes_payload(reader)?),
            20 => AnimationHookPayload::Raw(read_exact_payload(reader, 12)?), // Transparent
            21 => AnimationHookPayload::SoundTweaked(read_sound_tweaked_payload(reader)?),
            22 => AnimationHookPayload::SetOmega(read_set_omega_payload(reader)?),
            23 => AnimationHookPayload::TextureVelocity(TextureVelocityHookPayload {
                u_speed: f32::read_le(reader)?,
                v_speed: f32::read_le(reader)?,
            }),
            24 => AnimationHookPayload::TextureVelocityPart(TextureVelocityPartHookPayload {
                part_index: u32::read_le(reader)?,
                u_speed: f32::read_le(reader)?,
                v_speed: f32::read_le(reader)?,
            }),
            25 => AnimationHookPayload::Raw(read_exact_payload(reader, 4)?), // SetLight
            26 => AnimationHookPayload::Raw(read_exact_payload(reader, 40)?), // CreateBlockingParticle
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

        Ok(Self {
            hook_type,
            direction,
            payload,
        })
    }

    /// Whether a host simulation reads this hook, as opposed to a renderer.
    ///
    /// The simulation set is the one ACE walks server-side: attack cones, animation completion,
    /// object replacement, ethereal toggles, scale ramps, and omega changes. Everything else —
    /// sound, particles, lighting, translucency, texture velocity, PES scripts — is presentation.
    pub fn is_simulation_relevant(&self) -> bool {
        matches!(
            self.payload,
            AnimationHookPayload::Attack(_)
                | AnimationHookPayload::Ethereal(_)
                | AnimationHookPayload::ReplaceObject(_)
                | AnimationHookPayload::Scale(_)
                | AnimationHookPayload::SetOmega(_)
        ) || self.hook_type == ANIMATION_DONE_HOOK_TYPE
    }

    pub fn write<W: Write + Seek>(&self, writer: &mut W) -> BinResult<()> {
        self.hook_type.write_le(writer)?;
        self.direction.write_le(writer)?;
        self.payload.write(writer)?;
        Ok(())
    }
}

impl AnimationHookPayload {
    fn write<W: Write + Seek>(&self, writer: &mut W) -> BinResult<()> {
        match self {
            Self::NoPayload => Ok(()),
            Self::Raw(data) => {
                writer.write_all(data)?;
                Ok(())
            }
            Self::Attack(payload) => {
                payload.part_index.write_le(writer)?;
                payload.left_x.write_le(writer)?;
                payload.left_y.write_le(writer)?;
                payload.right_x.write_le(writer)?;
                payload.right_y.write_le(writer)?;
                payload.radius.write_le(writer)?;
                payload.height.write_le(writer)
            }
            Self::Ethereal(payload) => i32::from(payload.ethereal).write_le(writer),
            Self::ReplaceObject(payload) => {
                payload.part_index.write_le(writer)?;
                write_known_type_data_id(writer, payload.gfx_obj_id, GFX_OBJ_KNOWN_TYPE)
            }
            Self::SetOmega(payload) => {
                payload.omega.x.write_le(writer)?;
                payload.omega.y.write_le(writer)?;
                payload.omega.z.write_le(writer)
            }
            Self::TransparentPart(payload) => {
                payload.part_index.write_le(writer)?;
                payload.start.write_le(writer)?;
                payload.end.write_le(writer)?;
                payload.duration_seconds.write_le(writer)
            }
            Self::TextureVelocity(payload) => {
                payload.u_speed.write_le(writer)?;
                payload.v_speed.write_le(writer)
            }
            Self::TextureVelocityPart(payload) => {
                payload.part_index.write_le(writer)?;
                payload.u_speed.write_le(writer)?;
                payload.v_speed.write_le(writer)
            }
            Self::SoundTable(payload) => payload.sound_type.write_le(writer),
            Self::Scale(payload) => {
                payload.end.write_le(writer)?;
                payload.duration_seconds.write_le(writer)
            }
            Self::CreateParticle(payload) => {
                payload.emitter_info_id.write_le(writer)?;
                payload.part_index.write_le(writer)?;
                payload.offset.write_le(writer)?;
                payload.emitter_id.write_le(writer)
            }
            Self::DestroyParticle(payload) | Self::StopParticle(payload) => {
                payload.emitter_id.write_le(writer)
            }
            Self::CallPes(payload) => {
                payload.script_id.write_le(writer)?;
                payload.pause_seconds.write_le(writer)
            }
            Self::SoundTweaked(payload) => {
                payload.sound_id.write_le(writer)?;
                payload.probability.write_le(writer)?;
                payload.unused.write_le(writer)?;
                payload.volume.write_le(writer)
            }
        }
    }
}

fn read_exact_payload<R: Read + Seek>(reader: &mut R, payload_size: usize) -> BinResult<Vec<u8>> {
    let mut data = vec![0u8; payload_size];
    if payload_size > 0 {
        reader.read_exact(&mut data)?;
    }
    Ok(data)
}

fn read_set_omega_payload<R: Read + Seek>(reader: &mut R) -> BinResult<SetOmegaHookPayload> {
    Ok(SetOmegaHookPayload {
        omega: Vector3 {
            x: f32::read_le(reader)?,
            y: f32::read_le(reader)?,
            z: f32::read_le(reader)?,
        },
    })
}

fn read_transparent_part_payload<R: Read + Seek>(
    reader: &mut R,
) -> BinResult<TransparentPartHookPayload> {
    let payload = TransparentPartHookPayload {
        part_index: u32::read_le(reader)?,
        start: f32::read_le(reader)?,
        end: f32::read_le(reader)?,
        duration_seconds: f32::read_le(reader)?,
    };
    if !payload.start.is_finite()
        || !payload.end.is_finite()
        || !payload.duration_seconds.is_finite()
    {
        return Err(decode_error(
            reader,
            "TransparentPart payload contains a non-finite value".to_owned(),
        ));
    }
    Ok(payload)
}

fn read_scale_payload<R: Read + Seek>(reader: &mut R) -> BinResult<ScaleHookPayload> {
    let payload = ScaleHookPayload {
        end: f32::read_le(reader)?,
        duration_seconds: f32::read_le(reader)?,
    };
    if !payload.end.is_finite() || !payload.duration_seconds.is_finite() {
        return Err(decode_error(
            reader,
            "Scale payload contains a non-finite value".to_owned(),
        ));
    }
    Ok(payload)
}

fn read_create_particle_payload<R: Read + Seek>(
    reader: &mut R,
) -> BinResult<CreateParticleHookPayload> {
    let payload = CreateParticleHookPayload {
        emitter_info_id: u32::read_le(reader)?,
        part_index: i32::read_le(reader)?,
        offset: Frame::read_le(reader)?,
        emitter_id: u32::read_le(reader)?,
    };
    if payload.part_index < -1 {
        return Err(decode_error(
            reader,
            format!(
                "CreateParticle part index {} is neither a part nor the -1 whole-object sentinel",
                payload.part_index
            ),
        ));
    }
    Ok(payload)
}

fn read_call_pes_payload<R: Read + Seek>(reader: &mut R) -> BinResult<CallPesHookPayload> {
    let payload = CallPesHookPayload {
        script_id: u32::read_le(reader)?,
        pause_seconds: f32::read_le(reader)?,
    };
    if !payload.pause_seconds.is_finite() || payload.pause_seconds < 0.0 {
        return Err(decode_error(
            reader,
            format!(
                "CallPES pause {} is not a usable random-delay bound",
                payload.pause_seconds
            ),
        ));
    }
    Ok(payload)
}

fn read_sound_tweaked_payload<R: Read + Seek>(
    reader: &mut R,
) -> BinResult<SoundTweakedHookPayload> {
    let payload = SoundTweakedHookPayload {
        sound_id: u32::read_le(reader)?,
        probability: f32::read_le(reader)?,
        unused: f32::read_le(reader)?,
        volume: f32::read_le(reader)?,
    };
    if !payload.probability.is_finite() || !payload.volume.is_finite() {
        return Err(decode_error(
            reader,
            "SoundTweaked payload contains a non-finite value".to_owned(),
        ));
    }
    Ok(payload)
}

fn read_attack_cone_payload<R: Read + Seek>(reader: &mut R) -> BinResult<AttackConeHookPayload> {
    let payload = AttackConeHookPayload {
        part_index: i32::read_le(reader)?,
        left_x: f32::read_le(reader)?,
        left_y: f32::read_le(reader)?,
        right_x: f32::read_le(reader)?,
        right_y: f32::read_le(reader)?,
        radius: f32::read_le(reader)?,
        height: f32::read_le(reader)?,
    };
    let finite = [
        payload.left_x,
        payload.left_y,
        payload.right_x,
        payload.right_y,
        payload.radius,
        payload.height,
    ]
    .iter()
    .all(|value| value.is_finite());
    if !finite {
        return Err(decode_error(
            reader,
            "Attack payload contains a non-finite value".to_owned(),
        ));
    }
    Ok(payload)
}

fn read_ethereal_payload<R: Read + Seek>(reader: &mut R) -> BinResult<EtherealHookPayload> {
    match i32::read_le(reader)? {
        0 => Ok(EtherealHookPayload { ethereal: false }),
        1 => Ok(EtherealHookPayload { ethereal: true }),
        other => Err(decode_error(
            reader,
            format!("Ethereal payload is neither 0 nor 1: {other}"),
        )),
    }
}

fn read_replace_object_payload<R: Read + Seek>(
    reader: &mut R,
) -> BinResult<ReplaceObjectHookPayload> {
    Ok(ReplaceObjectHookPayload {
        part_index: u16::read_le(reader)?,
        gfx_obj_id: read_known_type_data_id(reader, GFX_OBJ_KNOWN_TYPE)?,
    })
}

/// Reads the wire's known-type-relative data id: a bare 15-bit offset, or a 30-bit offset split
/// across two words when the high bit of the first word is set.
///
/// Mirrors ACE `BinaryReaderExtensions.ReadAsDataIDOfKnownType`.
fn read_known_type_data_id<R: Read + Seek>(reader: &mut R, known_type: u32) -> BinResult<u32> {
    let upper = u16::read_le(reader)?;
    if upper & 0x8000 == 0 {
        return Ok(known_type + u32::from(upper));
    }
    let lower = u16::read_le(reader)?;
    Ok(known_type + ((u32::from(upper & 0x3FFF) << 16) | u32::from(lower)))
}

/// Inverse of `read_known_type_data_id`, choosing the same encoding width the reader accepts.
fn write_known_type_data_id<W: Write + Seek>(
    writer: &mut W,
    data_id: u32,
    known_type: u32,
) -> BinResult<()> {
    let relative = data_id.wrapping_sub(known_type);
    if relative < 0x8000 {
        return (relative as u16).write_le(writer);
    }
    (((relative >> 16) as u16) | 0x8000).write_le(writer)?;
    (relative as u16).write_le(writer)
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
    /// Attach points this setup offers to child objects, keyed by the name a server sends.
    pub holding_locations: HashMap<ParentLocation, LocationType>,
    /// Authored in the file format but present in no setup in the retail archive.
    pub connection_points: HashMap<i32, LocationType>,
    /// Authored poses, keyed by the name the server sends in the physics description.
    pub placement_frames: HashMap<Placement, PlacementType>,
    pub cyl_spheres: Vec<CylSphere>,
    pub spheres: Vec<Sphere>,
    pub height: f32,
    pub radius: f32,
    pub step_up: f32,
    pub step_down: f32,
    pub sorting_sphere: Sphere,
    pub selection_sphere: Sphere,
    pub lights: Vec<LightInfo>,
    pub default_animation: Option<u32>,
    /// Direct 0x33 `PhysicsScript` DID started by retail during setup initialization.
    pub default_script_did: Option<u32>,
    pub default_motion_table: Option<u32>,
    pub default_sound_table: Option<u32>,
    pub default_script_table: Option<u32>,
}

impl SetupModel {
    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Self::unpack(reader)
    }

    fn decode_optional_resource_id(raw: u32) -> Option<u32> {
        (raw != 0).then_some(raw)
    }

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
            let location = u32::try_from(key)
                .ok()
                .and_then(ParentLocation::from_key)
                .ok_or_else(|| {
                    decode_error(
                        reader,
                        format!("SetupModel 0x{id:08X} holds an unknown attach point {key}"),
                    )
                })?;
            holding_locations.insert(location, LocationType::read_le(reader)?);
        }

        // ConnectionPoints (Dict)
        let num_conn = u32::read_le(reader)?;
        let mut connection_points = HashMap::new();
        for _ in 0..num_conn {
            let key = i32::read_le(reader)?;
            connection_points.insert(key, LocationType::read_le(reader)?);
        }

        // PlacementFrames (Dict)
        let num_placements = i32::read_le(reader)?;
        if num_placements < 0 {
            return Err(binrw::Error::Custom {
                pos: reader.stream_position()?,
                err: Box::new(format!(
                    "SetupModel 0x{id:08X} declared negative placement count {num_placements}"
                )),
            });
        }
        let mut placement_frames = HashMap::with_capacity(num_placements as usize);
        for _ in 0..num_placements as usize {
            let key = i32::read_le(reader)?;
            let placement = u32::try_from(key)
                .ok()
                .and_then(Placement::from_key)
                .ok_or_else(|| {
                    decode_error(
                        reader,
                        format!("SetupModel 0x{id:08X} authors an unknown placement {key}"),
                    )
                })?;
            placement_frames.insert(placement, PlacementType::read(reader, num_parts)?);
        }

        // CylSpheres (ACE uses a standard u32 count here, not a compressed array count)
        let num_cyl = u32::read_le(reader)?;
        let mut cyl_spheres = Vec::with_capacity(num_cyl as usize);
        for _ in 0..num_cyl {
            cyl_spheres.push(CylSphere::read_le(reader)?);
        }

        // Spheres (ACE uses a standard u32 count here, not a compressed array count)
        let num_sph = u32::read_le(reader)?;
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

        let num_lights = u32::read_le(reader)?;
        let mut lights = Vec::with_capacity(num_lights as usize);
        for _ in 0..num_lights {
            lights.push(LightInfo::read_le(reader)?);
        }

        let default_animation = Self::decode_optional_resource_id(u32::read_le(reader)?);
        let default_script_did = Self::decode_optional_resource_id(u32::read_le(reader)?);
        let default_motion_table = Self::decode_optional_resource_id(u32::read_le(reader)?);
        let default_sound_table = Self::decode_optional_resource_id(u32::read_le(reader)?);
        let default_script_table = Self::decode_optional_resource_id(u32::read_le(reader)?);

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
            default_script_did,
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
        let mut hold_keys: Vec<_> = self.holding_locations.keys().copied().collect();
        hold_keys.sort();
        for key in hold_keys {
            (key as i32).write_le(writer)?;
            self.holding_locations.get(&key).unwrap().write_le(writer)?;
        }

        (self.connection_points.len() as u32).write_le(writer)?;
        let mut conn_keys: Vec<_> = self.connection_points.keys().collect();
        conn_keys.sort();
        for &k in conn_keys {
            k.write_le(writer)?;
            self.connection_points.get(&k).unwrap().write_le(writer)?;
        }

        (self.placement_frames.len() as i32).write_le(writer)?;
        let mut place_keys: Vec<_> = self.placement_frames.keys().copied().collect();
        place_keys.sort();
        for key in place_keys {
            (key as i32).write_le(writer)?;
            self.placement_frames.get(&key).unwrap().write(writer)?;
        }

        (self.cyl_spheres.len() as u32).write_le(writer)?;
        for cyl in &self.cyl_spheres {
            cyl.write_le(writer)?;
        }

        (self.spheres.len() as u32).write_le(writer)?;
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
        for light in &self.lights {
            light.write_le(writer)?;
        }

        let trailer = [
            self.default_animation,
            self.default_script_did,
            self.default_motion_table,
            self.default_sound_table,
            self.default_script_table,
        ];
        for value in trailer {
            value.unwrap_or(0).write_le(writer)?;
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
            lights: Vec::new(),
            default_animation: None,
            default_script_did: None,
            default_motion_table: None,
            default_sound_table: None,
            default_script_table: None,
        };

        setup.lights.push(LightInfo {
            light_type: 0,
            viewer_space_location: Frame::default(),
            color: 0xFFFFFFFF,
            intensity: 1.0,
            falloff: 1.0,
            cone_angle: 1.0,
        });

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

    #[test]
    fn test_setup_model_sparse_trailer_placeholders_round_trip_as_none() {
        let setup = SetupModel {
            id: 0x02000002,
            flags: 0,
            parts: vec![0],
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
            lights: Vec::new(),
            default_animation: None,
            default_script_did: None,
            default_motion_table: None,
            default_sound_table: None,
            default_script_table: Some(0x0E00_0123),
        };

        let mut data = Vec::new();
        let mut writer = Cursor::new(&mut data);
        setup.pack(&mut writer).unwrap();

        let mut reader = Cursor::new(data);
        let unpacked = SetupModel::unpack(&mut reader).unwrap();

        assert_eq!(unpacked.default_animation, None);
        assert_eq!(unpacked.default_script_did, None);
        assert_eq!(unpacked.default_motion_table, None);
        assert_eq!(unpacked.default_sound_table, None);
        assert_eq!(unpacked.default_script_table, Some(0x0E00_0123));
    }

    /// Reads a hook and re-emits it, so payload decoding and encoding are proven against the same
    /// bytes rather than against each other.
    fn round_trip_hook(bytes: Vec<u8>, expectation: &'static str) -> AnimationHook {
        let hook = AnimationHook::read(&mut Cursor::new(bytes.clone())).expect(expectation);

        let mut written = Vec::new();
        hook.write(&mut Cursor::new(&mut written))
            .expect("hook should re-emit");
        assert_eq!(written, bytes, "{expectation}: re-emitted bytes differ");

        hook
    }

    #[test]
    fn animation_hook_replace_object_reads_compact_known_type_payload_without_desync() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&5u32.to_le_bytes());
        bytes.extend_from_slice(&0i32.to_le_bytes());
        bytes.extend_from_slice(&7u16.to_le_bytes());
        bytes.extend_from_slice(&0x1234u16.to_le_bytes());

        let hook = round_trip_hook(
            bytes,
            "replace-object hook with compact part id should parse",
        );

        assert_eq!(hook.hook_type, 5);
        assert_eq!(hook.direction, 0);
        assert_eq!(
            hook.payload,
            AnimationHookPayload::ReplaceObject(ReplaceObjectHookPayload {
                part_index: 7,
                gfx_obj_id: 0x0100_1234,
            })
        );
    }

    #[test]
    fn animation_hook_replace_object_reads_extended_known_type_payload_without_desync() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&5u32.to_le_bytes());
        bytes.extend_from_slice(&1i32.to_le_bytes());
        bytes.extend_from_slice(&9u16.to_le_bytes());
        bytes.extend_from_slice(&0x8001u16.to_le_bytes());
        bytes.extend_from_slice(&0x2345u16.to_le_bytes());

        let hook = round_trip_hook(
            bytes,
            "replace-object hook with extended part id should parse",
        );

        assert_eq!(hook.hook_type, 5);
        assert_eq!(hook.direction, 1);
        assert_eq!(
            hook.payload,
            AnimationHookPayload::ReplaceObject(ReplaceObjectHookPayload {
                part_index: 9,
                gfx_obj_id: 0x0101_2345,
            })
        );
    }

    #[test]
    fn animation_hook_attack_reads_typed_cone_with_the_whole_object_sentinel() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&3u32.to_le_bytes());
        bytes.extend_from_slice(&0i32.to_le_bytes());
        bytes.extend_from_slice(&(-1i32).to_le_bytes());
        for value in [-0.5f32, 0.25, 0.75, -0.125, 1.5, 2.25] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }

        let hook = round_trip_hook(bytes, "attack hook should parse");

        assert_eq!(
            hook.payload,
            AnimationHookPayload::Attack(AttackConeHookPayload {
                part_index: -1,
                left_x: -0.5,
                left_y: 0.25,
                right_x: 0.75,
                right_y: -0.125,
                radius: 1.5,
                height: 2.25,
            })
        );
    }

    #[test]
    fn animation_hook_ethereal_reads_boolean_payload() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&6u32.to_le_bytes());
        bytes.extend_from_slice(&(-1i32).to_le_bytes());
        bytes.extend_from_slice(&1i32.to_le_bytes());

        let hook = round_trip_hook(bytes, "ethereal hook should parse");

        assert_eq!(hook.direction, -1);
        assert_eq!(
            hook.payload,
            AnimationHookPayload::Ethereal(EtherealHookPayload { ethereal: true })
        );
    }

    #[test]
    fn animation_hook_ethereal_rejects_values_outside_the_boolean_range() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&6u32.to_le_bytes());
        bytes.extend_from_slice(&0i32.to_le_bytes());
        bytes.extend_from_slice(&2i32.to_le_bytes());

        AnimationHook::read(&mut Cursor::new(bytes))
            .expect_err("an ethereal payload of 2 should not decode as a bool");
    }

    #[test]
    fn animation_hook_texture_velocity_reads_typed_payload() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&23u32.to_le_bytes());
        bytes.extend_from_slice(&0i32.to_le_bytes());
        bytes.extend_from_slice(&1.25f32.to_le_bytes());
        bytes.extend_from_slice(&(-0.5f32).to_le_bytes());

        let hook =
            AnimationHook::read(&mut Cursor::new(bytes)).expect("texture velocity should parse");

        assert_eq!(hook.hook_type, 23);
        assert_eq!(
            hook.payload,
            AnimationHookPayload::TextureVelocity(TextureVelocityHookPayload {
                u_speed: 1.25,
                v_speed: -0.5
            })
        );
    }

    #[test]
    fn animation_hook_set_omega_reads_typed_payload() {
        let raw_payload_bytes = [0, 0, 0, 0, 0, 0, 0, 0, 0x72, 0x20, 0x1d, 0xbd];
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&22u32.to_le_bytes());
        bytes.extend_from_slice(&0i32.to_le_bytes());
        bytes.extend_from_slice(&raw_payload_bytes);

        let hook = AnimationHook::read(&mut Cursor::new(bytes)).expect("SetOmega should parse");

        assert_eq!(hook.hook_type, 22);
        assert_eq!(hook.direction, 0);
        assert_eq!(
            hook.payload,
            AnimationHookPayload::SetOmega(SetOmegaHookPayload {
                omega: Vector3 {
                    x: 0.0,
                    y: 0.0,
                    z: f32::from_le_bytes([0x72, 0x20, 0x1d, 0xbd]),
                },
            })
        );
    }

    #[test]
    fn animation_hook_transparent_part_reads_and_writes_exact_typed_payload() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&7u32.to_le_bytes());
        bytes.extend_from_slice(&(-1i32).to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0.25f32.to_le_bytes());
        bytes.extend_from_slice(&1.0f32.to_le_bytes());
        bytes.extend_from_slice(&0.75f32.to_le_bytes());

        let hook = AnimationHook::read(&mut Cursor::new(bytes.clone()))
            .expect("TransparentPart should parse");

        assert_eq!(hook.hook_type, 7);
        assert_eq!(hook.direction, -1);
        assert_eq!(
            hook.payload,
            AnimationHookPayload::TransparentPart(TransparentPartHookPayload {
                part_index: 2,
                start: 0.25,
                end: 1.0,
                duration_seconds: 0.75,
            })
        );
        let mut written = Cursor::new(Vec::new());
        hook.write(&mut written)
            .expect("TransparentPart should write");
        assert_eq!(written.into_inner(), bytes);
    }

    #[test]
    fn animation_hook_transparent_part_rejects_incomplete_and_non_finite_payloads() {
        let mut incomplete = Vec::new();
        incomplete.extend_from_slice(&7u32.to_le_bytes());
        incomplete.extend_from_slice(&0i32.to_le_bytes());
        incomplete.extend_from_slice(&1u32.to_le_bytes());
        incomplete.extend_from_slice(&0.0f32.to_le_bytes());
        assert!(AnimationHook::read(&mut Cursor::new(incomplete)).is_err());

        let mut non_finite = Vec::new();
        non_finite.extend_from_slice(&7u32.to_le_bytes());
        non_finite.extend_from_slice(&0i32.to_le_bytes());
        non_finite.extend_from_slice(&1u32.to_le_bytes());
        non_finite.extend_from_slice(&f32::NAN.to_le_bytes());
        non_finite.extend_from_slice(&1.0f32.to_le_bytes());
        non_finite.extend_from_slice(&0.5f32.to_le_bytes());
        let error = AnimationHook::read(&mut Cursor::new(non_finite))
            .expect_err("TransparentPart NaN should fail");
        assert!(error.to_string().contains("non-finite"));
    }

    #[test]
    fn animation_hook_texture_velocity_part_reads_typed_payload() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&24u32.to_le_bytes());
        bytes.extend_from_slice(&0i32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0.125f32.to_le_bytes());
        bytes.extend_from_slice(&0.25f32.to_le_bytes());

        let hook = AnimationHook::read(&mut Cursor::new(bytes))
            .expect("texture velocity part should parse");

        assert_eq!(hook.hook_type, 24);
        assert_eq!(
            hook.payload,
            AnimationHookPayload::TextureVelocityPart(TextureVelocityPartHookPayload {
                part_index: 2,
                u_speed: 0.125,
                v_speed: 0.25
            })
        );
    }
}

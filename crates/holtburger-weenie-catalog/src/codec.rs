use std::fmt;

use crate::{
    AnimPartChange, PhysicsBoolOverrides, SubPalette, TemplateAppearance, TemplatePhysics,
    TextureChange, WeenieTemplate, WieldEntry,
};

pub(crate) const MAGIC: [u8; 8] = *b"HBWCAT\0\x1a";
pub(crate) const HEADER_LENGTH: usize = 64;
pub(crate) const INDEX_ENTRY_LENGTH: usize = 16;
pub(crate) const MAX_STRING_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_COLLECTION_ENTRIES: usize = 1024 * 1024;
pub(crate) const MAX_CATALOG_RECORDS: usize = 1024 * 1024;
pub(crate) const MAX_RECORD_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CodecError {
    message: String,
}

impl CodecError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for CodecError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CodecError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Header {
    pub(crate) version: u32,
    pub(crate) record_count: u32,
    pub(crate) payload_offset: u64,
    pub(crate) payload_length: u64,
    pub(crate) index_offset: u64,
    pub(crate) index_length: u64,
}

impl Header {
    pub(crate) fn encode(self) -> [u8; HEADER_LENGTH] {
        let mut bytes = [0_u8; HEADER_LENGTH];
        bytes[0..8].copy_from_slice(&MAGIC);
        bytes[8..12].copy_from_slice(&self.version.to_le_bytes());
        bytes[12..16].copy_from_slice(&(HEADER_LENGTH as u32).to_le_bytes());
        bytes[16..20].copy_from_slice(&self.record_count.to_le_bytes());
        bytes[24..32].copy_from_slice(&self.payload_offset.to_le_bytes());
        bytes[32..40].copy_from_slice(&self.payload_length.to_le_bytes());
        bytes[40..48].copy_from_slice(&self.index_offset.to_le_bytes());
        bytes[48..56].copy_from_slice(&self.index_length.to_le_bytes());
        bytes
    }

    pub(crate) fn decode(bytes: &[u8; HEADER_LENGTH]) -> Result<Self, CodecError> {
        if bytes[0..8] != MAGIC {
            return Err(CodecError::new("invalid catalog magic"));
        }
        let header_length = read_u32_array(bytes, 12)?;
        if header_length as usize != HEADER_LENGTH {
            return Err(CodecError::new(format!(
                "header length {header_length} does not equal {HEADER_LENGTH}"
            )));
        }
        // 20..24 pads record_count out to the u64 alignment the offset fields assume.
        if bytes[20..24] != [0_u8; 4] || bytes[56..64] != [0_u8; 8] {
            return Err(CodecError::new("reserved header bytes are nonzero"));
        }
        Ok(Self {
            version: read_u32_array(bytes, 8)?,
            record_count: read_u32_array(bytes, 16)?,
            payload_offset: read_u64_array(bytes, 24)?,
            payload_length: read_u64_array(bytes, 32)?,
            index_offset: read_u64_array(bytes, 40)?,
            index_length: read_u64_array(bytes, 48)?,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct IndexEntry {
    pub(crate) wcid: u32,
    pub(crate) payload_offset: u64,
    pub(crate) payload_length: u32,
}

impl IndexEntry {
    pub(crate) fn encode(self) -> [u8; INDEX_ENTRY_LENGTH] {
        let mut bytes = [0_u8; INDEX_ENTRY_LENGTH];
        bytes[0..4].copy_from_slice(&self.wcid.to_le_bytes());
        bytes[4..12].copy_from_slice(&self.payload_offset.to_le_bytes());
        bytes[12..16].copy_from_slice(&self.payload_length.to_le_bytes());
        bytes
    }

    pub(crate) fn decode(bytes: &[u8]) -> Result<Self, CodecError> {
        if bytes.len() != INDEX_ENTRY_LENGTH {
            return Err(CodecError::new(format!(
                "index entry length {} does not equal {INDEX_ENTRY_LENGTH}",
                bytes.len()
            )));
        }
        Ok(Self {
            wcid: read_u32(bytes, 0)?,
            payload_offset: read_u64(bytes, 4)?,
            payload_length: read_u32(bytes, 12)?,
        })
    }
}

pub(crate) fn encode_template(template: &WeenieTemplate) -> Result<Vec<u8>, CodecError> {
    validate_template(template)?;
    let mut encoder = Encoder::default();
    encoder.u32(template.wcid);
    encoder.i32(template.weenie_type);
    encoder.string(&template.class_name)?;
    encoder.optional_string(template.name.as_deref())?;
    encoder.optional_i32(template.level);
    encoder.optional_u32(template.setup_did);
    encoder.optional_u32(template.motion_table_did);
    encoder.optional_u32(template.sound_table_did);
    encoder.optional_u32(template.physics_effect_table_did);
    encoder.optional_u32(template.palette_base_did);
    encoder.optional_f64(template.default_scale, "default_scale")?;
    encoder.optional_f64(template.friction, "friction")?;
    encoder.optional_f64(template.elasticity, "elasticity")?;
    encoder.optional_f64(template.maximum_velocity, "maximum_velocity")?;
    encoder.optional_f64(template.rotation_speed, "rotation_speed")?;
    encoder.optional_i32(template.radar_blip_color);
    encoder.optional_i32(template.radar_behavior);
    encoder.optional_f64(template.obvious_radar_range, "obvious_radar_range")?;
    encoder.optional_bool(template.attackable);
    encoder.optional_u32(template.physics.base_mask);
    encode_overrides(&mut encoder, &template.physics.overrides);
    encode_appearance(&mut encoder, &template.appearance)?;

    encoder.count(template.wielded.len(), "wielded")?;
    for entry in &template.wielded {
        encoder.u32(entry.wcid);
        encoder.i32(entry.destination_type);
        encoder.u32(entry.palette_template);
        encoder.f64_finite(entry.shade, "wielded.shade")?;
    }
    encoder.count(template.sub_palettes.len(), "sub_palettes")?;
    for palette in &template.sub_palettes {
        encoder.u32(palette.sub_palette_did);
        encoder.u16(palette.offset);
        encoder.u16(palette.length);
    }
    encoder.count(template.texture_changes.len(), "texture_changes")?;
    for texture in &template.texture_changes {
        encoder.u8(texture.part_index);
        encoder.u32(texture.old_texture_did);
        encoder.u32(texture.new_texture_did);
    }
    encoder.count(template.anim_part_changes.len(), "anim_part_changes")?;
    for part in &template.anim_part_changes {
        encoder.u8(part.part_index);
        encoder.u32(part.animation_part_did);
    }
    Ok(encoder.finish())
}

pub(crate) fn decode_template(bytes: &[u8]) -> Result<WeenieTemplate, CodecError> {
    let mut decoder = Decoder::new(bytes);
    let (identity, weenie_type) = decode_template_identity_fields(&mut decoder)?;
    let level = decoder.optional_i32("level")?;
    let setup_did = decoder.optional_u32("setup_did")?;
    let motion_table_did = decoder.optional_u32("motion_table_did")?;
    let sound_table_did = decoder.optional_u32("sound_table_did")?;
    let physics_effect_table_did = decoder.optional_u32("physics_effect_table_did")?;
    let palette_base_did = decoder.optional_u32("palette_base_did")?;
    let default_scale = decoder.optional_f64("default_scale")?;
    let friction = decoder.optional_f64("friction")?;
    let elasticity = decoder.optional_f64("elasticity")?;
    let maximum_velocity = decoder.optional_f64("maximum_velocity")?;
    let rotation_speed = decoder.optional_f64("rotation_speed")?;
    let radar_blip_color = decoder.optional_i32("radar_blip_color")?;
    let radar_behavior = decoder.optional_i32("radar_behavior")?;
    let obvious_radar_range = decoder.optional_f64("obvious_radar_range")?;
    let attackable = decoder.optional_bool("attackable")?;
    let base_mask = decoder.optional_u32("physics.base_mask")?;
    let overrides = decode_overrides(&mut decoder)?;
    let appearance = decode_appearance(&mut decoder)?;

    let wielded_count = decoder.count("wielded")?;
    let mut wielded = Vec::with_capacity(wielded_count);
    for _ in 0..wielded_count {
        wielded.push(WieldEntry {
            wcid: decoder.u32()?,
            destination_type: decoder.i32()?,
            palette_template: decoder.u32()?,
            shade: decoder.f64()?,
        });
    }
    let sub_palette_count = decoder.count("sub_palettes")?;
    let mut sub_palettes = Vec::with_capacity(sub_palette_count);
    for _ in 0..sub_palette_count {
        sub_palettes.push(SubPalette {
            sub_palette_did: decoder.u32()?,
            offset: decoder.u16()?,
            length: decoder.u16()?,
        });
    }
    let texture_count = decoder.count("texture_changes")?;
    let mut texture_changes = Vec::with_capacity(texture_count);
    for _ in 0..texture_count {
        texture_changes.push(TextureChange {
            part_index: decoder.u8()?,
            old_texture_did: decoder.u32()?,
            new_texture_did: decoder.u32()?,
        });
    }
    let anim_part_count = decoder.count("anim_part_changes")?;
    let mut anim_part_changes = Vec::with_capacity(anim_part_count);
    for _ in 0..anim_part_count {
        anim_part_changes.push(AnimPartChange {
            part_index: decoder.u8()?,
            animation_part_did: decoder.u32()?,
        });
    }
    decoder.finish()?;

    let template = WeenieTemplate {
        wcid: identity.wcid,
        class_name: identity.class_name,
        weenie_type,
        name: identity.name,
        level,
        setup_did,
        motion_table_did,
        sound_table_did,
        physics_effect_table_did,
        palette_base_did,
        default_scale,
        friction,
        elasticity,
        maximum_velocity,
        rotation_speed,
        radar_blip_color,
        radar_behavior,
        obvious_radar_range,
        attackable,
        physics: TemplatePhysics {
            base_mask,
            overrides,
        },
        appearance,
        wielded,
        sub_palettes,
        texture_changes,
        anim_part_changes,
    };
    validate_template(&template)?;
    Ok(template)
}

/// Decodes only the stable identity prefix; the remaining payload is intentionally untouched.
pub(crate) fn decode_template_identity(
    bytes: &[u8],
) -> Result<crate::WeenieTemplateIdentity, CodecError> {
    let mut decoder = Decoder::new(bytes);
    decode_template_identity_fields(&mut decoder).map(|(identity, _weenie_type)| identity)
}

fn decode_template_identity_fields(
    decoder: &mut Decoder<'_>,
) -> Result<(crate::WeenieTemplateIdentity, i32), CodecError> {
    let wcid = decoder.u32()?;
    let weenie_type = decoder.i32()?;
    let class_name = decoder.string("class_name")?;
    let name = decoder.optional_string("name")?;
    Ok((
        crate::WeenieTemplateIdentity {
            wcid,
            class_name,
            name,
        },
        weenie_type,
    ))
}

fn validate_template(template: &WeenieTemplate) -> Result<(), CodecError> {
    validate_string(&template.class_name, "class_name")?;
    if let Some(name) = &template.name {
        validate_string(name, "name")?;
    }
    for (field, value) in [
        ("default_scale", template.default_scale),
        ("friction", template.friction),
        ("elasticity", template.elasticity),
        ("maximum_velocity", template.maximum_velocity),
        ("rotation_speed", template.rotation_speed),
    ] {
        if value.is_some_and(|value| !value.is_finite()) {
            return Err(CodecError::new(format!(
                "WCID {} field {field} must be finite",
                template.wcid
            )));
        }
    }
    if let Some(value) = &template.appearance.heritage_group_name {
        validate_string(value, "appearance.heritage_group_name")?;
    }
    if let Some(value) = &template.appearance.sex {
        validate_string(value, "appearance.sex")?;
    }
    for entry in &template.wielded {
        if !entry.shade.is_finite() {
            return Err(CodecError::new(format!(
                "WCID {} field wielded.shade must be finite",
                template.wcid
            )));
        }
    }
    validate_count(template.wielded.len(), "wielded")?;
    validate_count(template.sub_palettes.len(), "sub_palettes")?;
    validate_count(template.texture_changes.len(), "texture_changes")?;
    validate_count(template.anim_part_changes.len(), "anim_part_changes")?;
    validate_canonical(template)?;
    Ok(())
}

fn validate_canonical(template: &WeenieTemplate) -> Result<(), CodecError> {
    if !template
        .sub_palettes
        .is_sorted_by_key(|entry| (entry.offset, entry.length, entry.sub_palette_did))
    {
        return Err(CodecError::new(format!(
            "WCID {} sub_palettes are not in canonical order",
            template.wcid
        )));
    }
    if template
        .sub_palettes
        .windows(2)
        .any(|pair| pair[0] == pair[1])
    {
        return Err(CodecError::new(format!(
            "WCID {} sub_palettes contain a duplicate key",
            template.wcid
        )));
    }
    if !template.texture_changes.is_sorted_by_key(|entry| {
        (
            entry.part_index,
            entry.old_texture_did,
            entry.new_texture_did,
        )
    }) {
        return Err(CodecError::new(format!(
            "WCID {} texture_changes are not in canonical order",
            template.wcid
        )));
    }
    if template.texture_changes.windows(2).any(|pair| {
        pair[0].part_index == pair[1].part_index
            && pair[0].old_texture_did == pair[1].old_texture_did
    }) {
        return Err(CodecError::new(format!(
            "WCID {} texture_changes contain a duplicate (part index, old DID) key",
            template.wcid
        )));
    }
    if !template
        .anim_part_changes
        .is_sorted_by_key(|entry| entry.part_index)
    {
        return Err(CodecError::new(format!(
            "WCID {} anim_part_changes are not in canonical order",
            template.wcid
        )));
    }
    if template
        .anim_part_changes
        .windows(2)
        .any(|pair| pair[0].part_index == pair[1].part_index)
    {
        return Err(CodecError::new(format!(
            "WCID {} anim_part_changes contain a duplicate part index",
            template.wcid
        )));
    }
    Ok(())
}

fn validate_string(value: &str, field: &str) -> Result<(), CodecError> {
    if value.len() > MAX_STRING_BYTES {
        return Err(CodecError::new(format!(
            "field {field} encoded length {} exceeds limit {MAX_STRING_BYTES}",
            value.len()
        )));
    }
    Ok(())
}

fn validate_count(value: usize, field: &str) -> Result<(), CodecError> {
    if value > MAX_COLLECTION_ENTRIES {
        return Err(CodecError::new(format!(
            "collection {field} count {value} exceeds limit {MAX_COLLECTION_ENTRIES}"
        )));
    }
    Ok(())
}

fn encode_overrides(encoder: &mut Encoder, overrides: &PhysicsBoolOverrides) {
    for value in [
        overrides.ethereal,
        overrides.report_collisions,
        overrides.ignore_collisions,
        overrides.no_draw,
        overrides.gravity,
        overrides.lighting,
        overrides.scripted_collision,
        overrides.inelastic,
        overrides.report_collisions_as_environment,
        overrides.allow_edge_slide,
        overrides.frozen,
    ] {
        encoder.optional_bool(value);
    }
}

fn decode_overrides(decoder: &mut Decoder<'_>) -> Result<PhysicsBoolOverrides, CodecError> {
    Ok(PhysicsBoolOverrides {
        ethereal: decoder.optional_bool("physics.ethereal")?,
        report_collisions: decoder.optional_bool("physics.report_collisions")?,
        ignore_collisions: decoder.optional_bool("physics.ignore_collisions")?,
        no_draw: decoder.optional_bool("physics.no_draw")?,
        gravity: decoder.optional_bool("physics.gravity")?,
        lighting: decoder.optional_bool("physics.lighting")?,
        scripted_collision: decoder.optional_bool("physics.scripted_collision")?,
        inelastic: decoder.optional_bool("physics.inelastic")?,
        report_collisions_as_environment: decoder
            .optional_bool("physics.report_collisions_as_environment")?,
        allow_edge_slide: decoder.optional_bool("physics.allow_edge_slide")?,
        frozen: decoder.optional_bool("physics.frozen")?,
    })
}

fn encode_appearance(
    encoder: &mut Encoder,
    appearance: &TemplateAppearance,
) -> Result<(), CodecError> {
    for value in [
        appearance.clothing_base_did,
        appearance.head_object_did,
        appearance.skin_palette_did,
        appearance.hair_palette_did,
        appearance.eyes_palette_did,
        appearance.eyes_texture_did,
        appearance.default_eyes_texture_did,
        appearance.nose_texture_did,
        appearance.default_nose_texture_did,
        appearance.mouth_texture_did,
        appearance.default_mouth_texture_did,
    ] {
        encoder.optional_u32(value);
    }
    encoder.optional_i32(appearance.heritage_group);
    encoder.optional_i32(appearance.gender);
    encoder.optional_string(appearance.heritage_group_name.as_deref())?;
    encoder.optional_string(appearance.sex.as_deref())?;
    encoder.optional_i32(appearance.item_type);
    encoder.optional_i32(appearance.default_combat_style);
    encoder.optional_i32(appearance.clothing_priority);
    encoder.optional_i32(appearance.valid_locations);
    encoder.optional_u32(appearance.palette_template);
    encoder.optional_f64(appearance.shade, "appearance.shade")?;
    Ok(())
}

fn decode_appearance(decoder: &mut Decoder<'_>) -> Result<TemplateAppearance, CodecError> {
    Ok(TemplateAppearance {
        clothing_base_did: decoder.optional_u32("appearance.clothing_base_did")?,
        head_object_did: decoder.optional_u32("appearance.head_object_did")?,
        skin_palette_did: decoder.optional_u32("appearance.skin_palette_did")?,
        hair_palette_did: decoder.optional_u32("appearance.hair_palette_did")?,
        eyes_palette_did: decoder.optional_u32("appearance.eyes_palette_did")?,
        eyes_texture_did: decoder.optional_u32("appearance.eyes_texture_did")?,
        default_eyes_texture_did: decoder.optional_u32("appearance.default_eyes_texture_did")?,
        nose_texture_did: decoder.optional_u32("appearance.nose_texture_did")?,
        default_nose_texture_did: decoder.optional_u32("appearance.default_nose_texture_did")?,
        mouth_texture_did: decoder.optional_u32("appearance.mouth_texture_did")?,
        default_mouth_texture_did: decoder.optional_u32("appearance.default_mouth_texture_did")?,
        heritage_group: decoder.optional_i32("appearance.heritage_group")?,
        gender: decoder.optional_i32("appearance.gender")?,
        heritage_group_name: decoder.optional_string("appearance.heritage_group_name")?,
        sex: decoder.optional_string("appearance.sex")?,
        item_type: decoder.optional_i32("appearance.item_type")?,
        default_combat_style: decoder.optional_i32("appearance.default_combat_style")?,
        clothing_priority: decoder.optional_i32("appearance.clothing_priority")?,
        valid_locations: decoder.optional_i32("appearance.valid_locations")?,
        palette_template: decoder.optional_u32("appearance.palette_template")?,
        shade: decoder.optional_f64("appearance.shade")?,
    })
}

#[derive(Default)]
struct Encoder {
    bytes: Vec<u8>,
}

impl Encoder {
    fn finish(self) -> Vec<u8> {
        self.bytes
    }

    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn u16(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn i32(&mut self, value: i32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn f64(&mut self, value: f64) {
        self.bytes.extend_from_slice(&value.to_bits().to_le_bytes());
    }

    fn string(&mut self, value: &str) -> Result<(), CodecError> {
        validate_string(value, "string")?;
        let length = u32::try_from(value.len())
            .map_err(|_| CodecError::new("string length does not fit u32"))?;
        self.u32(length);
        self.bytes.extend_from_slice(value.as_bytes());
        Ok(())
    }

    fn optional_string(&mut self, value: Option<&str>) -> Result<(), CodecError> {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.string(value)?;
            }
        }
        Ok(())
    }

    fn optional_u32(&mut self, value: Option<u32>) {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.u32(value);
            }
        }
    }

    fn optional_i32(&mut self, value: Option<i32>) {
        match value {
            None => self.u8(0),
            Some(value) => {
                self.u8(1);
                self.i32(value);
            }
        }
    }

    fn f64_finite(&mut self, value: f64, field: &str) -> Result<(), CodecError> {
        if !value.is_finite() {
            return Err(CodecError::new(format!("field {field} must be finite")));
        }
        self.f64(value);
        Ok(())
    }

    fn optional_f64(&mut self, value: Option<f64>, field: &str) -> Result<(), CodecError> {
        match value {
            None => self.u8(0),
            Some(value) if value.is_finite() => {
                self.u8(1);
                self.f64(value);
            }
            Some(_) => return Err(CodecError::new(format!("field {field} must be finite"))),
        }
        Ok(())
    }

    fn optional_bool(&mut self, value: Option<bool>) {
        self.u8(match value {
            None => 0,
            Some(false) => 1,
            Some(true) => 2,
        });
    }

    fn count(&mut self, value: usize, field: &str) -> Result<(), CodecError> {
        validate_count(value, field)?;
        self.u32(
            u32::try_from(value).map_err(|_| {
                CodecError::new(format!("collection {field} count does not fit u32"))
            })?,
        );
        Ok(())
    }
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn finish(self) -> Result<(), CodecError> {
        if self.offset != self.bytes.len() {
            return Err(CodecError::new(format!(
                "record has {} trailing bytes",
                self.bytes.len() - self.offset
            )));
        }
        Ok(())
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], CodecError> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| CodecError::new("record offset overflow"))?;
        let value = self.bytes.get(self.offset..end).ok_or_else(|| {
            CodecError::new(format!(
                "record ended at byte {} while reading {length} bytes",
                self.offset
            ))
        })?;
        self.offset = end;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, CodecError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, CodecError> {
        let bytes = self.take(2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn u32(&mut self) -> Result<u32, CodecError> {
        let bytes = self.take(4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn i32(&mut self) -> Result<i32, CodecError> {
        let bytes = self.take(4)?;
        Ok(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn f64(&mut self) -> Result<f64, CodecError> {
        let bytes = self.take(8)?;
        let value = f64::from_bits(u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]));
        if !value.is_finite() {
            return Err(CodecError::new("floating value must be finite"));
        }
        Ok(value)
    }

    fn string(&mut self, field: &str) -> Result<String, CodecError> {
        let length = usize::try_from(self.u32()?)
            .map_err(|_| CodecError::new(format!("field {field} length does not fit usize")))?;
        if length > MAX_STRING_BYTES {
            return Err(CodecError::new(format!(
                "field {field} encoded length {length} exceeds limit {MAX_STRING_BYTES}"
            )));
        }
        let bytes = self.take(length)?;
        String::from_utf8(bytes.to_vec())
            .map_err(|error| CodecError::new(format!("field {field} is not UTF-8: {error}")))
    }

    fn optional_string(&mut self, field: &str) -> Result<Option<String>, CodecError> {
        match self.u8()? {
            0 => Ok(None),
            1 => self.string(field).map(Some),
            tag => Err(CodecError::new(format!(
                "field {field} has invalid option tag {tag}"
            ))),
        }
    }

    fn optional_u32(&mut self, field: &str) -> Result<Option<u32>, CodecError> {
        match self.u8()? {
            0 => Ok(None),
            1 => self.u32().map(Some),
            tag => Err(CodecError::new(format!(
                "field {field} has invalid option tag {tag}"
            ))),
        }
    }

    fn optional_i32(&mut self, field: &str) -> Result<Option<i32>, CodecError> {
        match self.u8()? {
            0 => Ok(None),
            1 => self.i32().map(Some),
            tag => Err(CodecError::new(format!(
                "field {field} has invalid option tag {tag}"
            ))),
        }
    }

    fn optional_f64(&mut self, field: &str) -> Result<Option<f64>, CodecError> {
        match self.u8()? {
            0 => Ok(None),
            1 => self.f64().map(Some),
            tag => Err(CodecError::new(format!(
                "field {field} has invalid option tag {tag}"
            ))),
        }
    }

    fn optional_bool(&mut self, field: &str) -> Result<Option<bool>, CodecError> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(false)),
            2 => Ok(Some(true)),
            tag => Err(CodecError::new(format!(
                "field {field} has invalid nullable-bool tag {tag}"
            ))),
        }
    }

    fn count(&mut self, field: &str) -> Result<usize, CodecError> {
        let count = usize::try_from(self.u32()?)
            .map_err(|_| CodecError::new(format!("collection {field} count does not fit usize")))?;
        if count > MAX_COLLECTION_ENTRIES {
            return Err(CodecError::new(format!(
                "collection {field} count {count} exceeds limit {MAX_COLLECTION_ENTRIES}"
            )));
        }
        Ok(count)
    }
}

fn read_u32_array<const N: usize>(bytes: &[u8; N], offset: usize) -> Result<u32, CodecError> {
    read_u32(bytes, offset)
}

fn read_u64_array<const N: usize>(bytes: &[u8; N], offset: usize) -> Result<u64, CodecError> {
    read_u64(bytes, offset)
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, CodecError> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| CodecError::new("unexpected end while reading u32"))?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, CodecError> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| CodecError::new("unexpected end while reading u64"))?;
    Ok(u64::from_le_bytes([
        value[0], value[1], value[2], value[3], value[4], value[5], value[6], value[7],
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_string_and_collection_limits_have_reachable_rejections() {
        let string_error = validate_string(&"x".repeat(MAX_STRING_BYTES + 1), "class_name")
            .expect_err("oversized source string must fail");
        assert!(string_error.to_string().contains("field class_name"));

        let count_error = validate_count(MAX_COLLECTION_ENTRIES + 1, "texture_changes")
            .expect_err("oversized source collection must fail");
        assert!(
            count_error
                .to_string()
                .contains("collection texture_changes")
        );
    }
}

use crate::Result;
use binrw::{BinRead, binread, io::Cursor};
use holtburger_common::{Quaternion, Vector3};

#[binread]
#[derive(Debug, Clone)]
#[br(little)]
pub struct Scene {
    pub id: u32,
    #[br(temp)]
    object_count: u32,
    #[br(count = object_count)]
    pub object_templates: Vec<SceneObjectTemplate>,
}

impl Scene {
    pub fn unpack(data: &[u8]) -> Result<Self> {
        let mut cursor = Cursor::new(data);
        Ok(Self::read(&mut cursor)?)
    }
}

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SceneObjectTemplate {
    pub object_id: u32,
    pub base_frame: SceneFrame,
    pub frequency: f32,
    pub displace_x: f32,
    pub displace_y: f32,
    pub min_scale: f32,
    pub max_scale: f32,
    pub max_rotation_degrees: f32,
    pub min_slope: f32,
    pub max_slope: f32,
    pub align: u32,
    pub orient: u32,
    pub weenie_object_id: u32,
}

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SceneFrame {
    pub origin: Vector3,
    pub orientation: Quaternion,
}

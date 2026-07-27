use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_dat::file_type::{GfxObj, Scene, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::ContentDecodeCache;
use crate::ContentRepository;

#[derive(Debug)]
pub(crate) struct ContentSourceReader<'a> {
    content: &'a ContentRepository,
    decode_cache: Option<&'a ContentDecodeCache>,
    scenes: HashMap<u32, Arc<Scene>>,
    setup_models: HashMap<u32, Arc<SetupModel>>,
    gfx_objs: HashMap<u32, Arc<GfxObj>>,
}

impl<'a> ContentSourceReader<'a> {
    pub(crate) fn new(content: &'a ContentRepository) -> Self {
        Self {
            content,
            decode_cache: None,
            scenes: HashMap::new(),
            setup_models: HashMap::new(),
            gfx_objs: HashMap::new(),
        }
    }

    pub(crate) fn with_decode_cache(
        content: &'a ContentRepository,
        decode_cache: &'a ContentDecodeCache,
    ) -> Self {
        Self {
            decode_cache: Some(decode_cache),
            ..Self::new(content)
        }
    }

    pub(crate) fn resource_exists(&self, namespace: &'static str, file_id: u32) -> bool {
        self.content
            .resource_metadata(ResourceKey::new(namespace, file_id))
            .is_some()
    }

    pub(crate) fn scene(&mut self, scene_id: u32) -> Result<Arc<Scene>> {
        if let Some(scene) = self.scenes.get(&scene_id) {
            return Ok(scene.clone());
        }

        let scene = match self.decode_cache {
            Some(cache) => cache.scene(self.content, scene_id)?,
            None => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, scene_id))
                    .with_context(|| {
                        format!(
                            "Could not read {}:0x{scene_id:08X} from content repository",
                            EOR_PORTAL_NAMESPACE
                        )
                    })?;
                Arc::new(
                    Scene::unpack(&resource.bytes)
                        .with_context(|| format!("Could not decode Scene 0x{scene_id:08X}"))?,
                )
            }
        };
        self.scenes.insert(scene_id, scene.clone());
        Ok(scene)
    }

    pub(crate) fn setup_model(&mut self, setup_model_id: u32) -> Result<Arc<SetupModel>> {
        if let Some(setup_model) = self.setup_models.get(&setup_model_id) {
            return Ok(setup_model.clone());
        }

        let setup_model = match self.decode_cache {
            Some(cache) => cache.setup_model(self.content, setup_model_id)?,
            None => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, setup_model_id))
                    .with_context(|| {
                        format!(
                            "Could not read {}:0x{setup_model_id:08X} from content repository",
                            EOR_PORTAL_NAMESPACE
                        )
                    })?;
                Arc::new(
                    SetupModel::unpack(&mut Cursor::new(resource.bytes)).with_context(|| {
                        format!("Could not decode SetupModel 0x{setup_model_id:08X}")
                    })?,
                )
            }
        };
        self.setup_models
            .insert(setup_model_id, setup_model.clone());
        Ok(setup_model)
    }

    pub(crate) fn gfx_obj(&mut self, gfx_obj_id: u32) -> Result<Arc<GfxObj>> {
        if let Some(gfx_obj) = self.gfx_objs.get(&gfx_obj_id) {
            return Ok(gfx_obj.clone());
        }

        let gfx_obj = match self.decode_cache {
            Some(cache) => cache.gfx_obj(self.content, gfx_obj_id)?,
            None => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_obj_id))
                    .with_context(|| {
                        format!(
                            "Could not read {}:0x{gfx_obj_id:08X} from content repository",
                            EOR_PORTAL_NAMESPACE
                        )
                    })?;
                Arc::new(
                    GfxObj::unpack(&mut Cursor::new(resource.bytes))
                        .with_context(|| format!("Could not decode GfxObj 0x{gfx_obj_id:08X}"))?,
                )
            }
        };
        self.gfx_objs.insert(gfx_obj_id, gfx_obj.clone());
        Ok(gfx_obj)
    }
}

use std::collections::HashMap;
use std::io::Cursor;

use anyhow::{Context, Result};
use holtburger_dat::file_type::{
    EnvCell, Environment, GfxObj, REGION_DESC_FILE_ID, RegionDesc, Scene, SetupModel,
};
use holtburger_dat::landblock::{CellLandblock, LandblockInfo};
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::ContentDecodeCache;
use crate::ContentRepository;

#[derive(Debug)]
pub(crate) struct ContentSourceReader<'a> {
    content: &'a ContentRepository,
    decode_cache: Option<&'a ContentDecodeCache>,
    cell_landblocks: HashMap<u32, CellLandblock>,
    landblock_infos: HashMap<u32, LandblockInfo>,
    env_cells: HashMap<u32, EnvCell>,
    environments: HashMap<u32, Environment>,
    region_desc: Option<RegionDesc>,
    scenes: HashMap<u32, Scene>,
    setup_models: HashMap<u32, SetupModel>,
    gfx_objs: HashMap<u32, GfxObj>,
}

impl<'a> ContentSourceReader<'a> {
    pub(crate) fn new(content: &'a ContentRepository) -> Self {
        Self {
            content,
            decode_cache: None,
            cell_landblocks: HashMap::new(),
            landblock_infos: HashMap::new(),
            env_cells: HashMap::new(),
            environments: HashMap::new(),
            region_desc: None,
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

    pub(crate) fn cell_landblock(&mut self, landblock_id: u32) -> Result<CellLandblock> {
        if let Some(landblock) = self.cell_landblocks.get(&landblock_id) {
            return Ok(landblock.clone());
        }

        let landblock = match self.decode_cache {
            Some(cache) => cache.cell_landblock(self.content, landblock_id)?,
            None => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_id))
                    .with_context(|| {
                        format!(
                            "Could not read {}:0x{landblock_id:08X} from content repository",
                            EOR_CELL_NAMESPACE
                        )
                    })?;
                CellLandblock::unpack(&resource.bytes).with_context(|| {
                    format!("Could not decode CellLandblock 0x{landblock_id:08X}")
                })?
            }
        };
        self.cell_landblocks.insert(landblock_id, landblock.clone());
        Ok(landblock)
    }

    pub(crate) fn landblock_info(&mut self, landblock_info_id: u32) -> Result<LandblockInfo> {
        if let Some(info) = self.landblock_infos.get(&landblock_info_id) {
            return Ok(info.clone());
        }

        let info = match self.decode_cache {
            Some(cache) => cache.landblock_info(self.content, landblock_info_id)?,
            None => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_info_id))
                    .with_context(|| {
                        format!(
                            "Could not read {}:0x{landblock_info_id:08X} from content repository",
                            EOR_CELL_NAMESPACE
                        )
                    })?;
                LandblockInfo::unpack(&resource.bytes).with_context(|| {
                    format!("Could not decode LandblockInfo 0x{landblock_info_id:08X}")
                })?
            }
        };
        self.landblock_infos.insert(landblock_info_id, info.clone());
        Ok(info)
    }

    pub(crate) fn env_cell(&mut self, env_cell_id: u32) -> Result<EnvCell> {
        if let Some(env_cell) = self.env_cells.get(&env_cell_id) {
            return Ok(env_cell.clone());
        }

        let env_cell = match self.decode_cache {
            Some(cache) => cache.env_cell(self.content, env_cell_id)?,
            None => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, env_cell_id))
                    .with_context(|| {
                        format!(
                            "Could not read {}:0x{env_cell_id:08X} from content repository",
                            EOR_CELL_NAMESPACE
                        )
                    })?;
                EnvCell::unpack(&mut Cursor::new(resource.bytes))
                    .with_context(|| format!("Could not decode EnvCell 0x{env_cell_id:08X}"))?
            }
        };
        self.env_cells.insert(env_cell_id, env_cell.clone());
        Ok(env_cell)
    }

    pub(crate) fn environment(&mut self, environment_id: u32) -> Result<Environment> {
        if let Some(environment) = self.environments.get(&environment_id) {
            return Ok(environment.clone());
        }

        let environment = match self.decode_cache {
            Some(cache) => cache.environment(self.content, environment_id)?,
            None => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, environment_id))
                    .with_context(|| {
                        format!(
                            "Could not read {}:0x{environment_id:08X} from content repository",
                            EOR_PORTAL_NAMESPACE
                        )
                    })?;
                Environment::unpack(&mut Cursor::new(resource.bytes)).with_context(|| {
                    format!("Could not decode Environment 0x{environment_id:08X}")
                })?
            }
        };
        self.environments
            .insert(environment_id, environment.clone());
        Ok(environment)
    }

    pub(crate) fn region_desc(&mut self) -> Result<RegionDesc> {
        if let Some(region) = &self.region_desc {
            return Ok(region.clone());
        }

        let region = match self.decode_cache {
            Some(cache) => cache.region_desc(self.content)?,
            None => {
                let resource = self
                    .content
                    .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, REGION_DESC_FILE_ID))
                    .with_context(|| {
                        format!(
                            "Could not read {}:0x{REGION_DESC_FILE_ID:08X} from content repository",
                            EOR_PORTAL_NAMESPACE
                        )
                    })?;
                RegionDesc::unpack(&resource.bytes).with_context(|| {
                    format!("Could not decode RegionDesc 0x{REGION_DESC_FILE_ID:08X}")
                })?
            }
        };
        self.region_desc = Some(region.clone());
        Ok(region)
    }

    pub(crate) fn scene(&mut self, scene_id: u32) -> Result<Scene> {
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
                Scene::unpack(&resource.bytes)
                    .with_context(|| format!("Could not decode Scene 0x{scene_id:08X}"))?
            }
        };
        self.scenes.insert(scene_id, scene.clone());
        Ok(scene)
    }

    pub(crate) fn setup_model(&mut self, setup_model_id: u32) -> Result<SetupModel> {
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
                SetupModel::unpack(&mut Cursor::new(resource.bytes)).with_context(|| {
                    format!("Could not decode SetupModel 0x{setup_model_id:08X}")
                })?
            }
        };
        self.setup_models
            .insert(setup_model_id, setup_model.clone());
        Ok(setup_model)
    }

    pub(crate) fn gfx_obj(&mut self, gfx_obj_id: u32) -> Result<GfxObj> {
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
                GfxObj::unpack(&mut Cursor::new(resource.bytes))
                    .with_context(|| format!("Could not decode GfxObj 0x{gfx_obj_id:08X}"))?
            }
        };
        self.gfx_objs.insert(gfx_obj_id, gfx_obj.clone());
        Ok(gfx_obj)
    }
}

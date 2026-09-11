//! Provenance of private player properties, without a second copy of their values.

use std::collections::HashSet;

use holtburger_common::properties::{PropertyUpdate, WorldObjectProperties};

/// Keys received through the private player feed survive public object recreation.
/// Values remain authoritative on the player's Entity; public-only keys are not retained.
#[derive(Debug, Clone, Default)]
pub(crate) struct PlayerPropertyRetention {
    ints: HashSet<u32>,
    int64s: HashSet<u32>,
    bools: HashSet<u32>,
    floats: HashSet<u32>,
    strings: HashSet<u32>,
    dids: HashSet<u32>,
    iids: HashSet<u32>,
}

impl PlayerPropertyRetention {
    /// A new PlayerDescription starts a fresh character baseline and retires prior provenance.
    pub(crate) fn from_description(properties: &WorldObjectProperties) -> Self {
        Self {
            ints: properties.ints.0.keys().map(|key| *key as u32).collect(),
            int64s: properties.int64s.0.keys().map(|key| *key as u32).collect(),
            bools: properties.bools.0.keys().map(|key| *key as u32).collect(),
            floats: properties.floats.0.keys().map(|key| *key as u32).collect(),
            strings: properties.strings.0.keys().map(|key| *key as u32).collect(),
            dids: properties.dids.0.keys().map(|key| *key as u32).collect(),
            iids: properties.iids.0.keys().map(|key| *key as u32).collect(),
        }
    }

    /// Updates may introduce private keys that were absent from the login baseline.
    pub(crate) fn observe(&mut self, update: &PropertyUpdate) {
        let (keys, key) = match update {
            PropertyUpdate::Int(key, _) => (&mut self.ints, *key as u32),
            PropertyUpdate::Int64(key, _) => (&mut self.int64s, *key as u32),
            PropertyUpdate::Bool(key, _) => (&mut self.bools, *key as u32),
            PropertyUpdate::Float(key, _) => (&mut self.floats, *key as u32),
            PropertyUpdate::String(key, _) => (&mut self.strings, *key as u32),
            PropertyUpdate::DataId(key, _) => (&mut self.dids, *key as u32),
            PropertyUpdate::InstanceId(key, _) => (&mut self.iids, *key as u32),
            PropertyUpdate::UnknownInt(key, _) => (&mut self.ints, *key),
            PropertyUpdate::UnknownInt64(key, _) => (&mut self.int64s, *key),
            PropertyUpdate::UnknownBool(key, _) => (&mut self.bools, *key),
            PropertyUpdate::UnknownFloat(key, _) => (&mut self.floats, *key),
            PropertyUpdate::UnknownString(key, _) => (&mut self.strings, *key),
            PropertyUpdate::UnknownDataId(key, _) => (&mut self.dids, *key),
            PropertyUpdate::UnknownInstanceId(key, _) => (&mut self.iids, *key),
        };
        keys.insert(key);
    }

    /// Keep currently present private values omitted by the public description. Explicit
    /// removals stay removed; values actually supplied by the newer public description win.
    pub(crate) fn retain_into(
        &self,
        current: &WorldObjectProperties,
        incoming: &mut WorldObjectProperties,
    ) {
        macro_rules! retain {
            ($($field:ident),+ $(,)?) => { $(
                for (key, value) in &current.$field.0 {
                    if self.$field.contains(&(*key as u32)) {
                        incoming.$field.0.entry(*key).or_insert_with(|| value.clone());
                    }
                }
            )+ };
        }
        retain!(ints, int64s, bools, floats, strings, dids, iids);
    }
}

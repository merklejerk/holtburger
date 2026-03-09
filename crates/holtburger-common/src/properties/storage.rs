use crate::Guid;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::{
    PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt, PropertyInt64,
    PropertyString,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PropertyValue {
    Int(i32),
    Int64(i64),
    Bool(bool),
    Float(f64),
    String(String),
    DID(Guid),
    IID(Guid),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PropertyUpdate {
    Int(PropertyInt, i32),
    Int64(PropertyInt64, i64),
    Bool(PropertyBool, bool),
    Float(PropertyFloat, f64),
    String(PropertyString, String),
    DataId(PropertyDataId, Guid),
    InstanceId(PropertyInstanceId, Guid),

    UnknownInt(u32, i32),
    UnknownInt64(u32, i64),
    UnknownBool(u32, bool),
    UnknownFloat(u32, f64),
    UnknownString(u32, String),
    UnknownDataId(u32, Guid),
    UnknownInstanceId(u32, Guid),
}

impl PropertyUpdate {
    pub fn try_from_raw_int(id: u32, value: i32) -> Self {
        match PropertyInt::from_repr(id) {
            Some(property) => Self::Int(property, value),
            None => Self::UnknownInt(id, value),
        }
    }

    pub fn try_from_raw_int64(id: u32, value: i64) -> Self {
        match PropertyInt64::from_repr(id) {
            Some(property) => Self::Int64(property, value),
            None => Self::UnknownInt64(id, value),
        }
    }

    pub fn try_from_raw_bool(id: u32, value: bool) -> Self {
        match PropertyBool::from_repr(id) {
            Some(property) => Self::Bool(property, value),
            None => Self::UnknownBool(id, value),
        }
    }

    pub fn try_from_raw_float(id: u32, value: f64) -> Self {
        match PropertyFloat::from_repr(id) {
            Some(property) => Self::Float(property, value),
            None => Self::UnknownFloat(id, value),
        }
    }

    pub fn try_from_raw_string(id: u32, value: String) -> Self {
        match PropertyString::from_repr(id) {
            Some(property) => Self::String(property, value),
            None => Self::UnknownString(id, value),
        }
    }

    pub fn try_from_raw_did(id: u32, value: Guid) -> Self {
        match PropertyDataId::from_repr(id) {
            Some(property) => Self::DataId(property, value),
            None => Self::UnknownDataId(id, value),
        }
    }

    pub fn try_from_raw_iid(id: u32, value: Guid) -> Self {
        match PropertyInstanceId::from_repr(id) {
            Some(property) => Self::InstanceId(property, value),
            None => Self::UnknownInstanceId(id, value),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertyMap<K, V>(pub BTreeMap<K, V>)
where
    K: Ord;

impl<K: Ord, V> Default for PropertyMap<K, V> {
    fn default() -> Self {
        Self(BTreeMap::new())
    }
}

impl<K: Ord, V> PropertyMap<K, V> {
    pub fn new() -> Self {
        Self(BTreeMap::new())
    }

    pub fn insert(&mut self, key: K, value: V) {
        self.0.insert(key, value);
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.0.get(key)
    }

    pub fn iter(&self) -> std::collections::btree_map::Iter<'_, K, V> {
        self.0.iter()
    }

    pub fn raw(&self) -> &BTreeMap<K, V> {
        &self.0
    }

    pub fn extend(&mut self, other: BTreeMap<K, V>) {
        self.0.extend(other);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct WorldObjectProperties {
    pub ints: PropertyMap<PropertyInt, i32>,
    pub floats: PropertyMap<PropertyFloat, f64>,
    pub strings: PropertyMap<PropertyString, String>,
    pub dids: PropertyMap<PropertyDataId, Guid>,
    pub iids: PropertyMap<PropertyInstanceId, Guid>,
    pub bools: PropertyMap<PropertyBool, bool>,
    pub int64s: PropertyMap<PropertyInt64, i64>,
}

impl WorldObjectProperties {
    pub fn apply(&mut self, update: PropertyUpdate) {
        match update {
            PropertyUpdate::Int(property, value) => self.ints.insert(property, value),
            PropertyUpdate::Int64(property, value) => self.int64s.insert(property, value),
            PropertyUpdate::Bool(property, value) => self.bools.insert(property, value),
            PropertyUpdate::Float(property, value) => self.floats.insert(property, value),
            PropertyUpdate::String(property, value) => {
                if value.is_empty() {
                    self.strings.0.remove(&property);
                } else {
                    self.strings.insert(property, value);
                }
            }
            PropertyUpdate::DataId(property, value) => {
                if value.is_null() {
                    self.dids.0.remove(&property);
                } else {
                    self.dids.insert(property, value);
                }
            }
            PropertyUpdate::InstanceId(property, value) => {
                if value.is_null() {
                    self.iids.0.remove(&property);
                } else {
                    self.iids.insert(property, value);
                }
            }
            PropertyUpdate::UnknownInt(id, value) => {
                if let Some(property) = PropertyInt::from_repr(id) {
                    self.ints.insert(property, value);
                }
            }
            PropertyUpdate::UnknownInt64(id, value) => {
                if let Some(property) = PropertyInt64::from_repr(id) {
                    self.int64s.insert(property, value);
                }
            }
            PropertyUpdate::UnknownBool(id, value) => {
                if let Some(property) = PropertyBool::from_repr(id) {
                    self.bools.insert(property, value);
                }
            }
            PropertyUpdate::UnknownFloat(id, value) => {
                if let Some(property) = PropertyFloat::from_repr(id) {
                    self.floats.insert(property, value);
                }
            }
            PropertyUpdate::UnknownString(id, value) => {
                if let Some(property) = PropertyString::from_repr(id) {
                    self.apply(PropertyUpdate::String(property, value));
                }
            }
            PropertyUpdate::UnknownDataId(id, value) => {
                if let Some(property) = PropertyDataId::from_repr(id) {
                    self.apply(PropertyUpdate::DataId(property, value));
                }
            }
            PropertyUpdate::UnknownInstanceId(id, value) => {
                if let Some(property) = PropertyInstanceId::from_repr(id) {
                    self.apply(PropertyUpdate::InstanceId(property, value));
                }
            }
        }
    }

    pub fn merge(&mut self, other: WorldObjectProperties) {
        self.ints.0.extend(other.ints.0);
        self.int64s.0.extend(other.int64s.0);
        self.bools.0.extend(other.bools.0);
        self.floats.0.extend(other.floats.0);
        self.strings.0.extend(other.strings.0);
        self.dids.0.extend(other.dids.0);
        self.iids.0.extend(other.iids.0);
    }

    pub fn apply_raw_int(&mut self, id: u32, value: i32) {
        self.apply(PropertyUpdate::try_from_raw_int(id, value));
    }

    pub fn apply_raw_int64(&mut self, id: u32, value: i64) {
        self.apply(PropertyUpdate::try_from_raw_int64(id, value));
    }

    pub fn apply_raw_bool(&mut self, id: u32, value: bool) {
        self.apply(PropertyUpdate::try_from_raw_bool(id, value));
    }

    pub fn apply_raw_float(&mut self, id: u32, value: f64) {
        self.apply(PropertyUpdate::try_from_raw_float(id, value));
    }

    pub fn apply_raw_string(&mut self, id: u32, value: String) {
        self.apply(PropertyUpdate::try_from_raw_string(id, value));
    }

    pub fn apply_raw_did(&mut self, id: u32, value: Guid) {
        self.apply(PropertyUpdate::try_from_raw_did(id, value));
    }

    pub fn apply_raw_iid(&mut self, id: u32, value: Guid) {
        self.apply(PropertyUpdate::try_from_raw_iid(id, value));
    }
}

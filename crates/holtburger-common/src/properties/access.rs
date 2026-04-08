use crate::Guid;

use super::{
    PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt, PropertyInt64,
    PropertyString, PropertyUpdate, WorldObjectProperties,
};

pub trait HasProperties {
    fn properties(&self) -> &WorldObjectProperties;
}

pub trait HasPropertiesMut: HasProperties {
    fn properties_mut(&mut self) -> &mut WorldObjectProperties;
}

pub trait WorldObjectPropertyAccessors: HasProperties {
    fn get_bool_prop(&self, prop: PropertyBool) -> bool {
        self.properties().bools.get(&prop).copied().unwrap_or(false)
    }

    fn get_bool_prop_opt(&self, prop: PropertyBool) -> Option<bool> {
        self.properties().bools.get(&prop).copied()
    }

    fn get_int_prop(&self, prop: PropertyInt) -> Option<i32> {
        self.properties().ints.get(&prop).copied()
    }

    fn get_instance_prop(&self, prop: PropertyInstanceId) -> Option<Guid> {
        self.properties()
            .iids
            .get(&prop)
            .copied()
            .filter(|guid| !guid.is_null())
    }

    fn get_data_prop(&self, prop: PropertyDataId) -> Option<Guid> {
        self.properties()
            .dids
            .get(&prop)
            .copied()
            .filter(|guid| !guid.is_null())
    }

    fn get_float_prop(&self, prop: PropertyFloat) -> Option<f64> {
        self.properties().floats.get(&prop).copied()
    }

    fn get_string_prop(&self, prop: PropertyString) -> Option<&str> {
        self.properties().strings.get(&prop).map(String::as_str)
    }

    fn get_int64_prop(&self, prop: PropertyInt64) -> Option<i64> {
        self.properties().int64s.get(&prop).copied()
    }
}

pub trait WorldObjectPropertyAccessorsMut: HasPropertiesMut {
    fn set_int_prop(&mut self, prop: PropertyInt, value: i32) {
        self.properties_mut()
            .apply(PropertyUpdate::Int(prop, value));
    }

    fn set_bool_prop(&mut self, prop: PropertyBool, value: bool) {
        self.properties_mut()
            .apply(PropertyUpdate::Bool(prop, value));
    }

    fn set_iid_prop(&mut self, prop: PropertyInstanceId, value: Guid) {
        self.properties_mut()
            .apply(PropertyUpdate::InstanceId(prop, value));
    }

    fn set_did_prop(&mut self, prop: PropertyDataId, value: Guid) {
        self.properties_mut()
            .apply(PropertyUpdate::DataId(prop, value));
    }

    fn set_float_prop(&mut self, prop: PropertyFloat, value: f64) {
        self.properties_mut()
            .apply(PropertyUpdate::Float(prop, value));
    }

    fn set_string_prop(&mut self, prop: PropertyString, value: String) {
        self.properties_mut()
            .apply(PropertyUpdate::String(prop, value));
    }

    fn set_int64_prop(&mut self, prop: PropertyInt64, value: i64) {
        self.properties_mut()
            .apply(PropertyUpdate::Int64(prop, value));
    }
}

impl<T: HasProperties> WorldObjectPropertyAccessors for T {}
impl<T: HasPropertiesMut> WorldObjectPropertyAccessorsMut for T {}

impl HasProperties for WorldObjectProperties {
    fn properties(&self) -> &WorldObjectProperties {
        self
    }
}

impl HasPropertiesMut for WorldObjectProperties {
    fn properties_mut(&mut self) -> &mut WorldObjectProperties {
        self
    }
}

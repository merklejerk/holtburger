mod access;
mod flags;
mod ids;
mod map;
mod object_ext;

pub use access::{
    HasProperties, HasPropertiesMut, WorldObjectPropertyAccessors,
    WorldObjectPropertyAccessorsMut,
};
pub use flags::{
    CombatUse, EnchantmentTypeFlags, EquipMask, GfxObjFlags, IdentifyResponseFlags,
    ImbuedEffectType, ItemType, ObjectDescriptionFlag, PhysicsDescriptionFlag, PhysicsState,
    PseudoEquipMask, RadarBehavior, RadarColor, Usable, WeenieHeaderFlag, WeenieHeaderFlag2,
    WeenieType,
};
pub use ids::{
    AttunedStatus, DamageType, MaterialType, PropertyBool, PropertyDataId,
    PropertyFloat, PropertyInstanceId, PropertyInt, PropertyInt64, PropertyString, WeaponType,
};
pub use map::{PropertyMap, PropertyUpdate, PropertyValue, WorldObjectProperties};
pub use object_ext::WorldObjectExt;

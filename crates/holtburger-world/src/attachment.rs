//! Object-to-object attachment as one world fact.
//!
//! Retail attaches a child `CPhysicsObj` to a named point on a parent object, resolving that name
//! through the parent setup's holding-location table into a part index and offset frame
//! (`CPhysicsObj::add_child`, `acclient.c:310340`). The child keeps its own pose while attached.
//!
//! World stores the relationship and nothing about its geometry. Resolving a location to a part
//! node and transform belongs to whichever frontend is rendering the parent.

use holtburger_common::{Guid, ParentLocation, Placement};

/// An entity whose position is owned by another object.
///
/// The three facts travel together because none of them is meaningful alone: a parent GUID without
/// a location names no attach point, and a location without a parent names nothing at all. ACE only
/// sends the parent link when both are present (`WorldObject_Networking.cs:488`), so a partial
/// attachment is not a state the wire can express either.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhysicsAttachment {
    /// The object whose part frame positions this entity.
    pub parent: Guid,
    /// Which of the parent's attach points carries it.
    pub location: ParentLocation,
    /// Which authored pose this entity itself adopts while attached. Independent of `location`:
    /// a non-armor item in the shield slot is placed `RightHandNonCombat` at `LeftWeapon`
    /// (`Creature_Equipment.cs:515-556`).
    pub placement: Placement,
}

/// One reason a wire attachment could not be resolved. Never a reason to substitute a default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AttachmentError {
    #[error("attach point {0} is not a known parent location")]
    UnknownLocation(u32),
    #[error("placement {0} is not a known placement")]
    UnknownPlacement(u32),
}

impl PhysicsAttachment {
    /// Resolve a wire attachment, rejecting keys outside either enum.
    ///
    /// An unrecognized key is a real protocol gap. Surfacing it beats hanging the object off an
    /// attach point it was never authored for.
    pub fn from_wire(parent: Guid, location: u32, placement: u32) -> Result<Self, AttachmentError> {
        Ok(Self {
            parent,
            location: ParentLocation::from_key(location)
                .ok_or(AttachmentError::UnknownLocation(location))?,
            placement: Placement::from_key(placement)
                .ok_or(AttachmentError::UnknownPlacement(placement))?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{AttachmentError, PhysicsAttachment};
    use holtburger_common::{Guid, ParentLocation, Placement};

    #[test]
    fn resolves_a_wire_attachment_into_named_facts() {
        assert_eq!(
            PhysicsAttachment::from_wire(Guid(0x5000_0001), 8, 2),
            Ok(PhysicsAttachment {
                parent: Guid(0x5000_0001),
                location: ParentLocation::LeftWeapon,
                placement: Placement::RightHandNonCombat,
            })
        );
    }

    #[test]
    fn rejects_wire_keys_outside_either_enum_without_substituting_a_default() {
        assert_eq!(
            PhysicsAttachment::from_wire(Guid(0x5000_0001), 42, 2),
            Err(AttachmentError::UnknownLocation(42))
        );
        assert_eq!(
            PhysicsAttachment::from_wire(Guid(0x5000_0001), 8, 9),
            Err(AttachmentError::UnknownPlacement(9))
        );
    }
}

//! Asset-free oracle for retail's client correction ordering.
//!
//! These fixtures describe evidence for the playable-client adapter before production correction
//! state exists. They intentionally do not provide reusable runtime helpers.

use holtburger_common::Vector3;

/// Retail replaces the authored tick translation when interpolation supplies a correction.
///
/// `CPhysicsObj::UpdatePositionInternal` assigns the interpolation manager's adjusted frame into
/// the tick offset after motion interpretation (`acclient.c:372004-372094`).
fn select_tick_translation(
    authored_translation: Vector3,
    interpolation_translation: Option<Vector3>,
) -> Vector3 {
    interpolation_translation.unwrap_or(authored_translation)
}

/// Retail damps translation against accumulated constraint distance, then accumulates the result.
///
/// This is `ConstraintManager::adjust_offset` branch-for-branch
/// (`acclient.c:372268-372296`). Rotation is deliberately absent because retail only scales or
/// clears `offset.m_fOrigin` here.
fn damp_constraint_translation(
    mut translation: Vector3,
    accumulated_distance: f32,
    start_distance: f32,
    maximum_distance: f32,
) -> (Vector3, f32) {
    if accumulated_distance < maximum_distance {
        if accumulated_distance > start_distance {
            let scale =
                (maximum_distance - accumulated_distance) / (maximum_distance - start_distance);
            translation = translation * scale;
        }
    } else {
        translation = Vector3::zero();
    }

    (translation, accumulated_distance + translation.length())
}

#[test]
fn interpolation_replaces_authored_translation_instead_of_adding_to_it() {
    let authored = Vector3::new(1.0, 2.0, 0.0);
    let correction = Vector3::new(-0.25, 0.5, 0.0);

    assert_eq!(select_tick_translation(authored, None), authored);
    assert_eq!(
        select_tick_translation(authored, Some(correction)),
        correction
    );
    assert_ne!(
        select_tick_translation(authored, Some(correction)),
        authored + correction
    );
}

#[test]
fn constraint_damping_uses_the_retail_start_and_maximum_edges() {
    let translation = Vector3::new(2.0, 0.0, 0.0);
    let start = 3.0;
    let maximum = 7.0;

    assert_eq!(
        damp_constraint_translation(translation, start, start, maximum),
        (translation, 5.0)
    );
    assert_eq!(
        damp_constraint_translation(translation, 5.0, start, maximum),
        (Vector3::new(1.0, 0.0, 0.0), 6.0)
    );
    assert_eq!(
        damp_constraint_translation(translation, maximum, start, maximum),
        (Vector3::zero(), maximum)
    );
}

#[test]
fn constraint_distance_accumulates_the_damped_translation_magnitude() {
    let translation = Vector3::new(3.0, 4.0, 0.0);
    let (damped, accumulated) = damp_constraint_translation(translation, 4.0, 2.0, 6.0);

    assert_eq!(damped, Vector3::new(1.5, 2.0, 0.0));
    assert_eq!(accumulated, 6.5);
}

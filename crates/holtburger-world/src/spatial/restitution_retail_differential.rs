//! Asset-free oracle for retail static-contact and sledding response.
//!
//! This reconstructs `CPhysicsObj::handle_all_collisions` (`acclient.c:309982-310068`) without
//! borrowing current host collision behavior. It consumes the tangent motion produced by
//! `CTransition::adjust_offset` and also reconstructs `calc_acceleration`, `calc_friction`, and
//! velocity-facing (`acclient.c:300589-300730,304541-304619,306180-306209,310875-310897`). Phase 2
//! compares production response to this oracle.

use holtburger_common::Vector3;

/// Retail's constructor default (`acclient.c:307850`, `acclient.c:318427`).
const DEFAULT_ELASTICITY: f32 = 0.05;
/// Retail's upper bound in `CPhysicsObj::set_elasticity` (`acclient.c:305519`).
const MAXIMUM_ELASTICITY: f32 = 0.1;
/// Last stationary-fall stage that still reaches ordinary restitution.
const MAXIMUM_BOUNCE_STATIONARY_FALL_FRAMES: u8 = 1;
/// Sledding below 1.25 units/second stops instead of asymptotically drifting.
const SLEDDING_STOP_SPEED_SQUARED: f32 = 1.5625;
/// Sledding at or above 2.5 units/second can use retail's reduced slope friction.
const SLEDDING_FAST_SPEED_SQUARED: f32 = 6.25;
/// Surfaces steeper than ten degrees use reduced high-speed sledding friction.
const SLEDDING_SLOPE_NORMAL_Z: f32 = 0.984_807_7;
/// Retail's hard-coded high-speed slope friction.
const SLEDDING_SLOPE_FRICTION: f32 = 0.2;

/// Body-level response selected before collision resolution.
#[derive(Debug, Clone, Copy)]
enum RetailRestitution {
    /// Reflect only the incoming normal component using this bounded coefficient.
    Elastic(f32),
    /// Zero the complete velocity on an eligible impact.
    Inelastic,
}

/// Collision facts read by retail's restitution branch.
#[derive(Debug, Clone, Copy)]
struct RetailCollision {
    /// Whether the preceding tick had walkable support.
    previously_walkable: bool,
    /// Current walkable support normal, when the solve found support.
    support_normal: Option<Vector3>,
    /// Retail physics-state bit `0x0080_0000`, which opts support into bounce.
    sledding: bool,
    /// Collision normal when transition resolution produced one.
    collision_normal: Option<Vector3>,
    /// Three-frame stationary-fall escalation state from `CTransition::validate_transition`.
    stationary_fall_frames: u8,
}

/// Coupled velocity and support result reconstructed from retail collision handling.
#[derive(Debug, Clone, Copy, PartialEq)]
struct RetailCollisionResponse {
    /// Canonical velocity after supported-contact or restitution handling.
    velocity: Vector3,
    /// Whether the response deliberately carries the body away from current support.
    separates_from_support: bool,
}

/// Mirrors retail's public elasticity setter rather than silently trusting callers.
fn bounded_elasticity(elasticity: f32) -> f32 {
    elasticity.clamp(0.0, MAXIMUM_ELASTICITY)
}

/// Returns the velocity and support consequence after retail's static-contact response branches.
fn collision_response(
    incoming: Vector3,
    achieved_velocity: Vector3,
    response: RetailRestitution,
    collision: RetailCollision,
) -> RetailCollisionResponse {
    if collision.stationary_fall_frames > MAXIMUM_BOUNCE_STATIONARY_FALL_FRAMES {
        return RetailCollisionResponse {
            velocity: Vector3::zero(),
            separates_from_support: false,
        };
    }
    let continuous_support = collision.previously_walkable && collision.support_normal.is_some();
    if continuous_support && !collision.sledding {
        return RetailCollisionResponse {
            velocity: achieved_velocity,
            separates_from_support: false,
        };
    }
    let velocity = if let Some(normal) = collision.collision_normal {
        match response {
            RetailRestitution::Inelastic => Vector3::zero(),
            RetailRestitution::Elastic(elasticity) => {
                let impact_speed = incoming.dot(&normal);
                if impact_speed >= 0.0 {
                    incoming
                } else {
                    incoming + normal * -(impact_speed * (bounded_elasticity(elasticity) + 1.0))
                }
            }
        }
    } else {
        incoming
    };
    RetailCollisionResponse {
        velocity,
        separates_from_support: collision
            .support_normal
            .is_some_and(|normal| velocity.dot(&normal) > 0.0),
    }
}

/// Applies retail's supported-surface projection and quantum-scaled friction.
fn surface_friction(
    incoming: Vector3,
    normal: Vector3,
    authored_friction: f32,
    quantum: f32,
    sledding: bool,
) -> Vector3 {
    let normal_speed = incoming.dot(&normal);
    if normal_speed >= 0.25 {
        return incoming;
    }

    let projected = incoming - normal * normal_speed;
    let speed_squared = incoming.length_squared();
    let friction = if !sledding {
        authored_friction
    } else if speed_squared < SLEDDING_STOP_SPEED_SQUARED {
        1.0
    } else if speed_squared >= SLEDDING_FAST_SPEED_SQUARED && normal.z < SLEDDING_SLOPE_NORMAL_Z {
        SLEDDING_SLOPE_FRICTION
    } else {
        authored_friction
    };

    projected * (1.0 - friction).powf(quantum)
}

/// Returns retail's acceleration after supported-contact state is considered.
fn supported_acceleration(
    gravity: Vector3,
    has_contact: bool,
    on_walkable: bool,
    sledding: bool,
) -> Vector3 {
    if has_contact && on_walkable && !sledding {
        Vector3::zero()
    } else {
        gravity
    }
}

/// Selects retail's automatic facing source, leaving ordinary bodies unchanged.
fn automatic_facing(
    current_heading: f32,
    displacement: Vector3,
    velocity: Vector3,
    align_path: bool,
    sledding: bool,
) -> f32 {
    if align_path && displacement.length_squared() > 0.0 {
        Vector3::zero().heading_to(&displacement)
    } else if sledding && velocity.length_squared() > 0.0 {
        Vector3::zero().heading_to(&velocity)
    } else {
        current_heading
    }
}

fn unsupported_collision(collision_normal: Option<Vector3>) -> RetailCollision {
    RetailCollision {
        previously_walkable: false,
        support_normal: None,
        sledding: false,
        collision_normal,
        stationary_fall_frames: 0,
    }
}

fn assert_close(actual: f32, expected: f32) {
    const TOLERANCE: f32 = 0.000_01;
    assert!(
        (actual - expected).abs() <= TOLERANCE,
        "expected {expected}, got {actual}"
    );
}

fn assert_vector_close(actual: Vector3, expected: Vector3) {
    assert_close(actual.x, expected.x);
    assert_close(actual.y, expected.y);
    assert_close(actual.z, expected.z);
}

#[test]
fn default_elasticity_reflects_only_the_incoming_normal_component() {
    let incoming = Vector3::new(2.0, 3.0, -10.0);
    let result = collision_response(
        incoming,
        incoming,
        RetailRestitution::Elastic(DEFAULT_ELASTICITY),
        unsupported_collision(Some(Vector3::new(0.0, 0.0, 1.0))),
    );

    assert_vector_close(result.velocity, Vector3::new(2.0, 3.0, 0.5));
}

#[test]
fn maximum_elasticity_preserves_glancing_tangent() {
    let incoming = Vector3::new(-4.0, 3.0, 0.0);
    let result = collision_response(
        incoming,
        incoming,
        RetailRestitution::Elastic(MAXIMUM_ELASTICITY),
        unsupported_collision(Some(Vector3::new(1.0, 0.0, 0.0))),
    );

    assert_vector_close(result.velocity, Vector3::new(0.4, 3.0, 0.0));
}

#[test]
fn elasticity_is_bounded_and_zero_elasticity_is_not_inelastic() {
    assert_close(bounded_elasticity(-1.0), 0.0);
    assert_close(bounded_elasticity(1.0), MAXIMUM_ELASTICITY);

    let result = collision_response(
        Vector3::new(-4.0, 3.0, 0.0),
        Vector3::new(-4.0, 3.0, 0.0),
        RetailRestitution::Elastic(0.0),
        unsupported_collision(Some(Vector3::new(1.0, 0.0, 0.0))),
    );
    assert_vector_close(result.velocity, Vector3::new(0.0, 3.0, 0.0));
}

#[test]
fn separating_and_normal_less_contacts_do_not_change_velocity() {
    let separating = Vector3::new(0.0, 0.0, 2.0);
    assert_eq!(
        collision_response(
            separating,
            separating,
            RetailRestitution::Elastic(DEFAULT_ELASTICITY),
            unsupported_collision(Some(Vector3::new(0.0, 0.0, 1.0))),
        )
        .velocity,
        separating,
    );

    let incoming = Vector3::new(1.0, 2.0, -3.0);
    assert_eq!(
        collision_response(
            incoming,
            incoming,
            RetailRestitution::Elastic(DEFAULT_ELASTICITY),
            unsupported_collision(None),
        )
        .velocity,
        incoming,
    );
}

#[test]
fn continuous_walkable_support_suppresses_bounce_unless_sledding() {
    let incoming = Vector3::new(1.0, 0.0, -2.0);
    let achieved = Vector3::new(0.8, 0.0, -0.2);
    let supported = RetailCollision {
        previously_walkable: true,
        support_normal: Some(Vector3::new(0.0, 0.0, 1.0)),
        sledding: false,
        collision_normal: Some(Vector3::new(0.0, 0.0, 1.0)),
        stationary_fall_frames: 0,
    };
    let stable = collision_response(
        incoming,
        achieved,
        RetailRestitution::Elastic(DEFAULT_ELASTICITY),
        supported,
    );
    assert_eq!(stable.velocity, achieved);
    assert!(!stable.separates_from_support);

    let sledding = RetailCollision {
        sledding: true,
        ..supported
    };
    let result = collision_response(
        incoming,
        achieved,
        RetailRestitution::Elastic(DEFAULT_ELASTICITY),
        sledding,
    );
    assert_vector_close(result.velocity, Vector3::new(1.0, 0.0, 0.1));
    assert!(result.separates_from_support);
}

#[test]
fn inelastic_and_stationary_fall_stops_are_distinct_zero_velocity_paths() {
    let incoming = Vector3::new(2.0, 3.0, -4.0);
    assert_eq!(
        collision_response(
            incoming,
            incoming,
            RetailRestitution::Inelastic,
            unsupported_collision(Some(Vector3::new(0.0, 0.0, 1.0))),
        )
        .velocity,
        Vector3::zero(),
    );

    let stationary_stop = RetailCollision {
        stationary_fall_frames: 2,
        collision_normal: None,
        ..unsupported_collision(None)
    };
    assert_eq!(
        collision_response(
            incoming,
            incoming,
            RetailRestitution::Elastic(DEFAULT_ELASTICITY),
            stationary_stop,
        )
        .velocity,
        Vector3::zero(),
    );
}

#[test]
fn stable_surface_uses_authored_friction_after_normal_projection() {
    let result = surface_friction(
        Vector3::new(2.0, 0.0, -1.0),
        Vector3::new(0.0, 0.0, 1.0),
        0.75,
        1.0,
        false,
    );

    assert_vector_close(result, Vector3::new(0.5, 0.0, 0.0));
    assert_vector_close(
        surface_friction(
            Vector3::new(2.0, 0.0, -1.0),
            Vector3::new(0.0, 0.0, 1.0),
            0.75,
            0.5,
            false,
        ),
        Vector3::new(1.0, 0.0, 0.0),
    );
}

#[test]
fn sledding_friction_stops_slow_motion_and_uses_authored_mid_speed_friction() {
    let normal = Vector3::new(0.0, 0.0, 1.0);
    assert_eq!(
        surface_friction(Vector3::new(1.0, 0.0, 0.0), normal, 0.75, 1.0, true),
        Vector3::zero()
    );
    assert_vector_close(
        surface_friction(Vector3::new(2.0, 0.0, 0.0), normal, 0.75, 1.0, true),
        Vector3::new(0.5, 0.0, 0.0),
    );
}

#[test]
fn fast_sledding_uses_reduced_friction_only_on_slopes_steeper_than_ten_degrees() {
    let velocity = Vector3::new(3.0, 0.0, 0.0);
    let flat = Vector3::new(0.0, 0.0, 1.0);
    let steep = Vector3::new(0.0, 0.5, 0.866_025_4);

    assert_vector_close(
        surface_friction(velocity, flat, 0.75, 1.0, true),
        Vector3::new(0.75, 0.0, 0.0),
    );
    assert_vector_close(
        surface_friction(velocity, steep, 0.75, 1.0, true),
        Vector3::new(2.4, 0.0, 0.0),
    );
}

#[test]
fn outward_normal_motion_skips_projection_and_friction() {
    let incoming = Vector3::new(2.0, 0.0, 0.25);
    assert_eq!(
        surface_friction(incoming, Vector3::new(0.0, 0.0, 1.0), 0.95, 1.0, true,),
        incoming
    );
}

#[test]
fn stable_support_suppresses_gravity_while_sledding_support_retains_it() {
    let gravity = Vector3::new(0.0, 0.0, -9.8);
    assert_eq!(
        supported_acceleration(gravity, true, true, false),
        Vector3::zero()
    );
    assert_eq!(supported_acceleration(gravity, true, true, true), gravity);
    assert_eq!(
        supported_acceleration(gravity, false, false, false),
        gravity
    );
}

#[test]
fn align_path_precedes_sledding_velocity_facing() {
    let current = 0.75;
    let path_heading = automatic_facing(
        current,
        Vector3::new(0.0, 2.0, 0.0),
        Vector3::new(-2.0, 0.0, 0.0),
        true,
        true,
    );
    let velocity_heading = automatic_facing(
        current,
        Vector3::zero(),
        Vector3::new(-2.0, 0.0, 0.0),
        false,
        true,
    );

    assert_close(path_heading, 90.0_f32.to_radians());
    assert_close(velocity_heading, 0.0);
    assert_eq!(
        automatic_facing(current, Vector3::zero(), Vector3::zero(), false, true,),
        current
    );
}

#[test]
fn production_collision_response_matches_retail_oracle_matrix() {
    use super::{PhysicalElasticity, PhysicalRestitution, PhysicalSurfaceMotion};

    let normal = Vector3::new(0.0, 0.0, 1.0);
    let cases = [
        (
            Vector3::new(2.0, 3.0, -10.0),
            PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
            false,
            false,
            PhysicalSurfaceMotion::Stable,
            0,
        ),
        (
            Vector3::new(2.0, 3.0, -10.0),
            PhysicalRestitution::Elastic(PhysicalElasticity::MAXIMUM),
            true,
            true,
            PhysicalSurfaceMotion::Stable,
            0,
        ),
        (
            Vector3::new(2.0, 3.0, -10.0),
            PhysicalRestitution::Elastic(PhysicalElasticity::ZERO),
            true,
            true,
            PhysicalSurfaceMotion::Sledding,
            0,
        ),
        (
            Vector3::new(2.0, 3.0, -10.0),
            PhysicalRestitution::Inelastic,
            false,
            false,
            PhysicalSurfaceMotion::Stable,
            0,
        ),
        (
            Vector3::new(2.0, 3.0, -10.0),
            PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
            false,
            false,
            PhysicalSurfaceMotion::Stable,
            2,
        ),
    ];

    for (incoming, production_restitution, prior, current, motion, stationary) in cases {
        let oracle_restitution = match production_restitution {
            PhysicalRestitution::Elastic(value) => RetailRestitution::Elastic(value.get()),
            PhysicalRestitution::Inelastic => RetailRestitution::Inelastic,
        };
        let expected = collision_response(
            incoming,
            incoming,
            oracle_restitution,
            RetailCollision {
                previously_walkable: prior,
                support_normal: current.then_some(normal),
                sledding: motion == PhysicalSurfaceMotion::Sledding,
                collision_normal: Some(normal),
                stationary_fall_frames: stationary,
            },
        );
        let actual = super::collision_response(super::CollisionResponseInput {
            incoming,
            achieved_velocity: incoming,
            restitution: production_restitution,
            collision_normal: Some(normal),
            previously_walkable: prior,
            current_support_normal: current.then_some(normal),
            surface_motion: motion,
            stationary_fall_frames: stationary,
        });
        assert_vector_close(actual.velocity, expected.velocity);
        assert_eq!(
            actual.separates_from_support,
            expected.separates_from_support
        );
    }
}

#[test]
fn production_stable_support_commits_achieved_slope_motion_without_takeoff() {
    use super::{PhysicalElasticity, PhysicalRestitution, PhysicalSurfaceMotion};

    let normal = Vector3::new(0.6, 0.0, 0.8);
    let cases = [
        // Downhill horizontal drive points outward from the plane before the solver redirects it.
        (Vector3::new(4.0, 0.0, 0.0), Vector3::new(2.56, 0.0, -1.92)),
        // Uphill and cross-slope drive must use the same continuous-support policy.
        (Vector3::new(-4.0, 0.0, 0.0), Vector3::new(-2.56, 0.0, 1.92)),
        (Vector3::new(0.0, 4.0, 0.0), Vector3::new(0.0, 4.0, 0.0)),
    ];

    for (incoming, achieved) in cases {
        let collision = RetailCollision {
            previously_walkable: true,
            support_normal: Some(normal),
            sledding: false,
            collision_normal: Some(normal),
            stationary_fall_frames: 0,
        };
        let expected = collision_response(
            incoming,
            achieved,
            RetailRestitution::Elastic(DEFAULT_ELASTICITY),
            collision,
        );
        let actual = super::collision_response(super::CollisionResponseInput {
            incoming,
            achieved_velocity: achieved,
            restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
            collision_normal: collision.collision_normal,
            previously_walkable: collision.previously_walkable,
            current_support_normal: collision.support_normal,
            surface_motion: PhysicalSurfaceMotion::Stable,
            stationary_fall_frames: collision.stationary_fall_frames,
        });

        assert_vector_close(actual.velocity, expected.velocity);
        assert_eq!(
            actual.separates_from_support,
            expected.separates_from_support
        );
        assert!(!actual.separates_from_support);
    }
}

#[test]
fn production_surface_friction_matches_retail_oracle_matrix() {
    use super::{PhysicalFriction, PhysicalSurfaceMotion};

    let friction = PhysicalFriction::new(0.75).unwrap();
    let cases = [
        (
            Vector3::new(2.0, 0.0, -1.0),
            Vector3::new(0.0, 0.0, 1.0),
            0.5,
            PhysicalSurfaceMotion::Stable,
        ),
        (
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
            1.0,
            PhysicalSurfaceMotion::Sledding,
        ),
        (
            Vector3::new(2.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
            1.0,
            PhysicalSurfaceMotion::Sledding,
        ),
        (
            Vector3::new(3.0, 0.0, 0.0),
            Vector3::new(0.0, 0.5, 0.866_025_4),
            1.0,
            PhysicalSurfaceMotion::Sledding,
        ),
    ];
    for (incoming, normal, quantum, motion) in cases {
        let expected = surface_friction(
            incoming,
            normal,
            friction.get(),
            quantum,
            motion == PhysicalSurfaceMotion::Sledding,
        );
        let actual = super::surface_friction(incoming, normal, friction, quantum, motion);
        assert_vector_close(actual, expected);
    }
}

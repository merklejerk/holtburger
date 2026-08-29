//! Independent retail oracle for one physics-object motion update.
//!
//! This module deliberately does not call production actuation, reconciliation, or collision
//! helpers. It preserves the distinction that the current runtime model lacks: authored/position-
//! manager offset, retained `m_velocityVector`, and post-transition `cached_velocity` are three
//! different facts (`acclient.c:306094-306172,308262-308298,310862-310927`).

use holtburger_common::Vector3;

const EPSILON: f32 = 0.000_2;

#[derive(Debug, Clone, Copy)]
struct OracleMotionInput {
    /// One-tick sequence offset before position-manager replacement.
    authored_translation: Vector3,
    /// Position-manager interpolation replacement, when an active node assigns translation.
    interpolation_translation: Option<Vector3>,
    /// Retail `CPhysicsObj::m_velocityVector` at tick start.
    physical_velocity: Vector3,
    /// Retail `CPhysicsObj::m_accelerationVector` at tick start.
    physical_acceleration: Vector3,
    /// Accepted fraction of the combined candidate path after transition.
    accepted_fraction: f32,
    /// Optional collision normal applied to the mover's own physical velocity.
    collision_normal: Option<Vector3>,
    /// `INELASTIC_PS` zeros retained physical velocity on accepted response.
    inelastic: bool,
    quantum: f32,
}

#[derive(Debug, Clone, Copy)]
struct OracleMotionOutput {
    accepted_translation: Vector3,
    /// Retail `cached_velocity`: accepted displacement divided by quantum.
    cached_velocity: Vector3,
    /// Retained `m_velocityVector` after acceleration and collision response.
    physical_velocity: Vector3,
}

/// Reproduces the relevant ordering without importing Holtburger's collapsed velocity model.
fn oracle_motion_tick(input: OracleMotionInput) -> OracleMotionOutput {
    assert!(input.quantum.is_finite() && input.quantum > 0.0);
    assert!(input.accepted_fraction.is_finite());
    let accepted_fraction = input.accepted_fraction.clamp(0.0, 1.0);
    let positioned_translation = input
        .interpolation_translation
        .unwrap_or(input.authored_translation);
    let physical_translation = input.physical_velocity * input.quantum
        + input.physical_acceleration * (0.5 * input.quantum * input.quantum);
    let accepted_translation = (positioned_translation + physical_translation) * accepted_fraction;

    let mut physical_velocity =
        input.physical_velocity + input.physical_acceleration * input.quantum;
    if let Some(normal) = input.collision_normal {
        if input.inelastic {
            physical_velocity = Vector3::zero();
        } else {
            let impact_speed = physical_velocity.dot(&normal);
            if impact_speed < 0.0 {
                // Retail caps elasticity at 0.1. Zero is sufficient to prove that response uses
                // only the mover's retained physical vector; peer velocity is not an operand.
                physical_velocity = physical_velocity + normal * -impact_speed;
            }
        }
    }

    OracleMotionOutput {
        accepted_translation,
        cached_velocity: accepted_translation / input.quantum,
        physical_velocity,
    }
}

fn input() -> OracleMotionInput {
    OracleMotionInput {
        authored_translation: Vector3::zero(),
        interpolation_translation: None,
        physical_velocity: Vector3::zero(),
        physical_acceleration: Vector3::zero(),
        accepted_fraction: 1.0,
        collision_normal: None,
        inelastic: false,
        quantum: 0.03,
    }
}

fn assert_close(actual: Vector3, expected: Vector3) {
    assert!(
        (actual - expected).length() < EPSILON,
        "actual {actual:?}, expected {expected:?}"
    );
}

#[test]
fn accepted_authored_path_does_not_become_next_tick_physical_momentum() {
    let first = oracle_motion_tick(OracleMotionInput {
        authored_translation: Vector3::new(0.3, 0.0, 0.0),
        ..input()
    });
    assert_close(first.accepted_translation, Vector3::new(0.3, 0.0, 0.0));
    assert_close(first.cached_velocity, Vector3::new(10.0, 0.0, 0.0));
    assert_close(first.physical_velocity, Vector3::zero());

    let second = oracle_motion_tick(OracleMotionInput {
        physical_velocity: first.physical_velocity,
        ..input()
    });
    assert_close(second.accepted_translation, Vector3::zero());
    assert_close(second.cached_velocity, Vector3::zero());
}

#[test]
fn interpolation_replaces_authored_translation_but_not_physical_displacement() {
    let result = oracle_motion_tick(OracleMotionInput {
        authored_translation: Vector3::new(9.0, 0.0, 0.0),
        interpolation_translation: Some(Vector3::new(0.3, 0.0, 0.0)),
        physical_velocity: Vector3::new(2.0, 0.0, 0.0),
        ..input()
    });
    assert_close(result.accepted_translation, Vector3::new(0.36, 0.0, 0.0));
    assert_close(result.cached_velocity, Vector3::new(12.0, 0.0, 0.0));
    assert_close(result.physical_velocity, Vector3::new(2.0, 0.0, 0.0));
}

#[test]
fn path_clipping_changes_cached_velocity_without_changing_physical_momentum() {
    let result = oracle_motion_tick(OracleMotionInput {
        authored_translation: Vector3::new(0.3, 0.0, 0.0),
        accepted_fraction: 0.25,
        ..input()
    });
    assert_close(result.accepted_translation, Vector3::new(0.075, 0.0, 0.0));
    assert_close(result.cached_velocity, Vector3::new(2.5, 0.0, 0.0));
    assert_close(result.physical_velocity, Vector3::zero());
}

#[test]
fn moving_peer_velocity_is_not_an_input_to_stationary_mover_response() {
    let result = oracle_motion_tick(OracleMotionInput {
        // A collision exists, but retail response has no peer-velocity operand. A stationary
        // mover therefore remains stationary regardless of how the contacted peer was moving.
        collision_normal: Some(Vector3::new(-1.0, 0.0, 0.0)),
        ..input()
    });
    assert_close(result.physical_velocity, Vector3::zero());
}

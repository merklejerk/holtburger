//! Tick-local resistance to walking into mobile characters, independent of overlap recovery.

use super::{Envelope, MOBILE_PUSH_THROUGH_SPEED, WorkingBody, envelope_pairs, limited};
use holtburger_common::{Sphere, Vector3};

/// One horizontal half-plane containing zero: existing penetration never requests a retreat.
#[derive(Clone, Copy)]
struct MovementLimit {
    /// Unit horizontal direction into the neighbor.
    normal: Vector3,
    /// Free inward travel before contact, including the neighbor's intended escape.
    distance: f32,
}

/// Reduces prepared supported character velocity before its single ordinary hard-navigation pass.
/// Neighbor intentions remain immutable here; hard-blocked neighbors can leave residual overlap
/// for the existing bounded separation pass, rather than triggering a crowd convergence solve.
pub(super) fn admit_character_movement(bodies: &mut [WorkingBody<'_>], seconds: f32) {
    let participants = bodies
        .iter()
        .enumerate()
        .filter_map(|(index, body)| {
            if body.mobile.response_mobility.is_none()
                || body.unavailable_owner.is_some()
                || !body.source.physical.has_direct_character_drive()
            {
                return None;
            }
            let support = body.ground().walkable_support()?;
            let travel = if body.integrate_ordinary {
                body.mobile.velocity * seconds
            } else {
                Vector3::zero()
            };
            Some((index, travel, support.normal))
        })
        .collect::<Vec<_>>();
    let envelopes = participants
        .iter()
        .enumerate()
        .map(|(index, (body_index, travel, _))| {
            Envelope::new(index, bodies[*body_index].mobile.spheres, *travel, 0.0)
        })
        .collect();
    let mut constraints = vec![Vec::new(); participants.len()];
    for (first, second) in envelope_pairs(envelopes) {
        let (first_index, first_travel, _) = participants[first];
        let (second_index, second_travel, _) = participants[second];
        let first_body = &bodies[first_index];
        let second_body = &bodies[second_index];
        if !first_body
            .contact
            .membership
            .intersects_reached(&second_body.contact.membership)
        {
            continue;
        }
        let first_responds = first_body
            .contact
            .receives_response_from(&second_body.contact);
        let second_responds = second_body
            .contact
            .receives_response_from(&first_body.contact);
        if !first_responds && !second_responds {
            continue;
        }
        for a in first_body.mobile.spheres.iter() {
            for b in second_body.mobile.spheres.iter() {
                let a = Sphere {
                    center: a.center,
                    radius: a.radius,
                };
                let b = Sphere {
                    center: b.center,
                    radius: b.radius,
                };
                let Some((normal, time)) = contact_entry(a, first_travel, b, second_travel) else {
                    continue;
                };
                if first_responds
                    && let Some(limit) = movement_limit(normal, time, first_travel, second_travel)
                {
                    constraints[first].push(limit);
                }
                if second_responds
                    && let Some(limit) =
                        movement_limit(normal * -1.0, time, second_travel, first_travel)
                {
                    constraints[second].push(limit);
                }
            }
        }
    }
    for ((index, travel, support_normal), limits) in participants.into_iter().zip(&mut constraints)
    {
        if limits.is_empty() {
            continue;
        }
        let admitted = admit_horizontal(travel, limits, MOBILE_PUSH_THROUGH_SPEED * seconds);
        let body = &mut bodies[index];
        let change = (admitted - horizontal(travel)) / seconds;
        body.mobile.velocity =
            restrict_supported_velocity(body.mobile.velocity, support_normal, change);
    }
}

/// Keep admission tangent to the floor without accelerating uphill when clipping rotates travel.
/// The independent normal component belongs to support/force integration and is preserved.
fn restrict_supported_velocity(velocity: Vector3, normal: Vector3, change: Vector3) -> Vector3 {
    let normal_velocity = normal * velocity.dot(&normal);
    let tangent = velocity - normal_velocity;
    let candidate = tangent
        + Vector3::new(
            change.x,
            change.y,
            -(change.x * normal.x + change.y * normal.y) / normal.z,
        );
    normal_velocity + limited(candidate, tangent.length())
}

fn horizontal(vector: Vector3) -> Vector3 {
    Vector3::new(vector.x, vector.y, 0.0)
}

/// First relative sphere entry supplies a local contact plane; subsequent redirected crossings
/// remain approximate, matching the existing non-exhaustive mobile-contact concession.
fn contact_entry(
    first: Sphere,
    travel: Vector3,
    second: Sphere,
    peer_travel: Vector3,
) -> Option<(Vector3, f32)> {
    let delta = second.center - first.center;
    let relative = travel - peer_travel;
    let radius = first.radius + second.radius;
    let c = delta.length_squared() - radius * radius;
    let approach = delta.dot(&relative);
    let speed_squared = relative.length_squared();
    let time = if c <= 0.0 {
        0.0
    } else {
        if approach <= 0.0 || speed_squared <= f32::EPSILON {
            return None;
        }
        let discriminant = approach * approach - speed_squared * c;
        if discriminant < 0.0 {
            return None;
        }
        let time = c / (approach + discriminant.sqrt());
        if time > 1.0 {
            return None;
        }
        time
    };
    let offset = horizontal(delta - relative * time);
    // At vertically aligned/coincident centers no horizontal direction is more inward.
    // Permit escape and let the existing overlap recovery choose its separation normal.
    if offset.length_squared() <= f32::EPSILON {
        return None;
    }
    Some((offset / offset.length(), time))
}

/// Each recipient brakes only its own approach; a peer never supplies a backward command.
fn movement_limit(
    normal: Vector3,
    time: f32,
    travel: Vector3,
    peer_travel: Vector3,
) -> Option<MovementLimit> {
    let relative = travel - peer_travel;
    let inward = travel.dot(&normal);
    if inward <= 0.0 || relative.dot(&normal) <= 0.0 {
        return None;
    }
    Some(MovementLimit {
        normal,
        distance: inward * time + peer_travel.dot(&normal).max(0.0) * (1.0 - time),
    })
}

/// One projection pass retains single-contact sliding. A final uniform contraction satisfies
/// every plane, including those a later projection disturbed. All bounds are nonnegative, so
/// contraction toward zero is feasible. This deliberately sacrifices optimal crowd progress.
fn admit_horizontal(travel: Vector3, limits: &mut [MovementLimit], allowance: f32) -> Vector3 {
    let requested = horizontal(travel);
    // Geometry order, not entity identity, controls conservative multi-contact projection.
    limits.sort_unstable_by(|a, b| {
        a.normal
            .x
            .total_cmp(&b.normal.x)
            .then(a.normal.y.total_cmp(&b.normal.y))
            .then(a.distance.total_cmp(&b.distance))
    });
    let mut free = requested;
    for limit in limits.iter() {
        free = free - limit.normal * (free.dot(&limit.normal) - limit.distance).max(0.0);
    }
    let scale = limits.iter().fold(1.0_f32, |scale, limit| {
        let inward = free.dot(&limit.normal);
        if inward > limit.distance {
            scale.min(limit.distance / inward)
        } else {
            scale
        }
    });
    free = free * scale;
    if free.dot(&requested) < 0.0 {
        free = Vector3::zero();
    }
    // One vector allowance, not one allowance per plane or relaxation pass.
    free + limited(requested - free, allowance)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contact_limit(
        first: Sphere,
        travel: Vector3,
        second: Sphere,
        peer_travel: Vector3,
    ) -> Option<MovementLimit> {
        let (normal, time) = contact_entry(first, travel, second, peer_travel)?;
        movement_limit(normal, time, travel, peer_travel)
    }

    fn sphere(x: f32, y: f32) -> Sphere {
        Sphere {
            center: Vector3::new(x, y, 0.0),
            radius: 0.5,
        }
    }

    #[test]
    fn first_entry_following_and_escape() {
        let travel = Vector3::new(0.2, 0.0, 0.0);
        let limit =
            contact_limit(sphere(0.0, 0.0), travel, sphere(1.1, 0.0), Vector3::zero()).unwrap();
        assert!((limit.distance - 0.1).abs() < 1e-6);
        assert!(contact_limit(sphere(0.0, 0.0), travel, sphere(0.9, 0.0), travel).is_none());
        assert!(
            contact_limit(
                sphere(0.0, 0.0),
                travel * -1.0,
                sphere(0.9, 0.0),
                Vector3::zero()
            )
            .is_none()
        );
        let following =
            contact_limit(sphere(0.0, 0.0), travel, sphere(1.0, 0.0), travel * 0.5).unwrap();
        assert!((following.distance - 0.1).abs() < 1e-6);
    }

    #[test]
    fn allowance_is_shared_and_tangential_escape_survives() {
        let allowance = MOBILE_PUSH_THROUGH_SPEED / 30.0;
        let wall = MovementLimit {
            normal: Vector3::new(1.0, 0.0, 0.0),
            distance: 0.0,
        };
        let request = Vector3::new(0.1, 0.2, 0.0);
        let admitted = admit_horizontal(request, &mut [wall], allowance);
        assert!((admitted.x - allowance).abs() < 1e-6);
        assert_eq!(admitted.y, request.y);
        let corner = MovementLimit {
            normal: Vector3::new(0.0, 1.0, 0.0),
            distance: 0.0,
        };
        let crowded = admit_horizontal(request, &mut [wall, corner, wall, corner], allowance);
        assert!((crowded.length() - allowance).abs() < 1e-6);
        assert_eq!(
            admit_horizontal(Vector3::zero(), &mut [wall], allowance),
            Vector3::zero()
        );
        let away = Vector3::new(-0.1, 0.0, 0.0);
        assert_eq!(admit_horizontal(away, &mut [wall], allowance), away);
    }

    #[test]
    fn crowded_projection_is_order_independent_and_cannot_multiply_creep() {
        let allowance = MOBILE_PUSH_THROUGH_SPEED / 60.0;
        for heading in 0..36 {
            let angle = heading as f32 * std::f32::consts::TAU / 36.0;
            let request = Vector3::new(angle.cos(), angle.sin(), 0.0) * 0.2;
            for contacts in 2..12 {
                let mut limits = (0..contacts)
                    .map(|index| {
                        let angle = index as f32 * 2.4;
                        MovementLimit {
                            normal: Vector3::new(angle.cos(), angle.sin(), 0.0),
                            distance: 0.0,
                        }
                    })
                    .collect::<Vec<_>>();
                let admitted = admit_horizontal(request, &mut limits, allowance);
                limits.reverse();
                assert!(
                    (admitted - admit_horizontal(request, &mut limits, allowance)).length() < 1e-6
                );
                assert!(admitted.length() <= request.length() + 1e-6);
                assert!(admitted.dot(&request) >= -1e-6);
                // With zero free inward travel, no contact can receive more than the
                // single body allowance, even when oblique projections interfere.
                for limit in &limits {
                    assert!(admitted.dot(&limit.normal) <= allowance + 1e-6);
                }
            }
        }
    }

    #[test]
    fn opposing_walkers_share_free_gap_and_coincident_bodies_can_escape() {
        let a = sphere(0.0, 0.0);
        let b = sphere(1.1, 0.0);
        let travel = Vector3::new(0.2, 0.0, 0.0);
        let first = contact_limit(a, travel, b, travel * -1.0).unwrap();
        let second = contact_limit(b, travel * -1.0, a, travel).unwrap();
        assert!((first.distance + second.distance - 0.1).abs() < 1e-6);
        assert!(contact_limit(a, travel, a, Vector3::zero()).is_none());
        let mut above = a;
        above.center.z = 2.0;
        assert!(contact_limit(a, travel, above, Vector3::zero()).is_none());
    }

    #[test]
    fn slope_admission_preserves_normal_motion_without_adding_speed() {
        let normal = Vector3::new(-0.6, 0.0, 0.8);
        let velocity = Vector3::new(0.0, 2.0, 0.0) + normal * 0.1;
        let result = restrict_supported_velocity(velocity, normal, Vector3::new(2.0, -2.0, 0.0));
        assert!((result.dot(&normal) - velocity.dot(&normal)).abs() < 1e-6);
        assert!(result.length() <= velocity.length() + 1e-6);
    }
}

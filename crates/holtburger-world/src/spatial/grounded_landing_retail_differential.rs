//! Narrow differential oracle for retail's two-threshold walkable model.
//!
//! Transliterates the landing/walking threshold selection, post-transition transient-state
//! derivation, and the slide-state gravity/friction gates directly from the decompile. It
//! deliberately shares no code with the production grounded solver, so a mistake ported into
//! production cannot manufacture parity here.

use holtburger_common::Vector3;

use super::{RETAIL_LANDING_NORMAL_Z, RETAIL_WALKABLE_NORMAL_Z};

/// Retail's airborne landing allowance, `0.0871557` (cos 85°), written wherever a body without
/// `OnWalkable` prepares a step-down (`acclient.c:301469-301474`, `:301563-301569`, `:302009`).
const ORACLE_LANDING_ALLOWANCE: f32 = 0.087_155_7;

/// Retail's walking threshold, `PhysicsGlobals::floor_z`, derived independently from the same
/// initialization expression production cites (`acclient.c:765983-765986`).
fn oracle_floor_z() -> f32 {
    (3_437.746_770_784_939_f64).cos() as f32
}

/// Retail's airborne step-down distance (`acclient.c:301468`, `:301562`: `0.039999999`).
const ORACLE_AIRBORNE_STEP_DOWN: f32 = 0.04;

/// The per-transition walkable allowance retail selects by `OBJECTINFO` state bit 2
/// (`OnWalkable`), transliterated from `CTransition` (`acclient.c:301469-301474`).
fn oracle_walkable_allowance(on_walkable: bool) -> f32 {
    if on_walkable {
        oracle_floor_z()
    } else {
        ORACLE_LANDING_ALLOWANCE
    }
}

/// Whether a step-down contact at this plane-normal z lands, per the allowance consumption sites
/// (`acclient.c:343578`: `zval > walkable_allowance`).
fn oracle_landing_accepts(normal_z: f32, on_walkable: bool) -> bool {
    normal_z > oracle_walkable_allowance(on_walkable)
}

/// Post-transition transient classification, transliterated from
/// `CPhysicsObj::SetPositionInternal` (`acclient.c:310624-310760`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OracleTransients {
    contact: bool,
    on_walkable: bool,
}

fn oracle_transients(contact_plane_normal: Option<Vector3>) -> OracleTransients {
    match contact_plane_normal {
        Some(normal) => OracleTransients {
            contact: true,
            // `OnWalkable` = contact plane normal z against the walking floor threshold,
            // regardless of which allowance admitted the landing (`acclient.c:310712-310717`).
            on_walkable: normal.z >= oracle_floor_z(),
        },
        None => OracleTransients {
            contact: false,
            on_walkable: false,
        },
    }
}

/// Whether gravity accelerates the body, per `CPhysicsObj::calc_acceleration`
/// (`acclient.c:306176`): zeroed only for `Contact && OnWalkable`.
fn oracle_gravity_applies(transients: OracleTransients) -> bool {
    !(transients.contact && transients.on_walkable)
}

/// Whether surface friction runs, per `CPhysicsObj::calc_friction` (`acclient.c:304541`):
/// gated on `OnWalkable` alone.
fn oracle_friction_applies(transients: OracleTransients) -> bool {
    transients.on_walkable
}

/// The production ground state retail's transients correspond to.
fn oracle_ground_state(contact_plane_normal: Option<Vector3>) -> &'static str {
    let transients = oracle_transients(contact_plane_normal);
    match (transients.contact, transients.on_walkable) {
        (true, true) => "supported",
        (true, false) => "sliding",
        (false, _) => "airborne",
    }
}

// --- Oracle self-tests: every expectation cited ---

/// The production landing threshold constant must be retail's airborne allowance.
#[test]
fn production_landing_threshold_is_the_retail_airborne_allowance() {
    assert_eq!(RETAIL_LANDING_NORMAL_Z, ORACLE_LANDING_ALLOWANCE);
}

/// The production walking threshold must equal the independently derived `floor_z`.
#[test]
fn production_walking_threshold_is_the_retail_floor_z() {
    assert!((RETAIL_WALKABLE_NORMAL_Z - oracle_floor_z()).abs() < 1e-7);
}

/// The shared retail fixture config carries both retail constants and the 0.04m airborne reach.
#[test]
fn config_defaults_carry_the_retail_threshold_pair() {
    let config = crate::spatial::differential_fixtures::retail_creature_config();
    assert!(oracle_landing_accepts(
        config.landing_normal_z + 1e-4,
        false
    ));
    assert!(!oracle_landing_accepts(
        config.landing_normal_z - 1e-4,
        false
    ));
    assert_eq!(config.airborne_step_down_height, ORACLE_AIRBORNE_STEP_DOWN);
}

/// A face normal between the two thresholds: steep enough to refuse walking, shallow enough to
/// land leniently.
fn between_threshold_face() -> Vector3 {
    Vector3::new(0.0, 0.954, 0.3).normalize()
}

/// Flat ground lands under either allowance and classifies walkable.
#[test]
fn flat_landing_accepts_and_classifies_supported() {
    assert!(oracle_landing_accepts(1.0, false));
    assert!(oracle_landing_accepts(1.0, true));
    assert_eq!(
        oracle_ground_state(Some(Vector3::new(0.0, 0.0, 1.0))),
        "supported"
    );
}

/// A steep face between the thresholds lands only for a body without `OnWalkable`, and the
/// landing classifies as contact-slide.
#[test]
fn between_threshold_landing_is_airborne_only_and_classifies_sliding() {
    let steep = between_threshold_face();
    assert!(oracle_landing_accepts(steep.z, false));
    assert!(!oracle_landing_accepts(steep.z, true));
    assert_eq!(oracle_ground_state(Some(steep)), "sliding");
}

/// A near-vertical face rejects even the lenient airborne allowance.
#[test]
fn near_vertical_landing_rejects_under_both_allowances() {
    assert!(!oracle_landing_accepts(0.05, false));
    assert!(!oracle_landing_accepts(0.05, true));
    assert_eq!(oracle_ground_state(None), "airborne");
}

/// Slide state keeps gravity and never runs friction; walkable support does the opposite.
#[test]
fn slide_state_keeps_gravity_and_skips_friction() {
    let sliding = oracle_transients(Some(between_threshold_face()));
    assert!(oracle_gravity_applies(sliding));
    assert!(!oracle_friction_applies(sliding));

    let supported = oracle_transients(Some(Vector3::new(0.0, 0.0, 1.0)));
    assert!(!oracle_gravity_applies(supported));
    assert!(oracle_friction_applies(supported));

    let airborne = oracle_transients(None);
    assert!(oracle_gravity_applies(airborne));
    assert!(!oracle_friction_applies(airborne));
}

// --- Production solver scenarios over a steep terrain ramp ---

mod scenarios {
    use holtburger_common::position::WorldPosition;
    use holtburger_common::{Guid, Quaternion, Vector3};
    use holtburger_content::{
        LandblockColliders, LandblockCollisionAsset, LandblockTerrain, TerrainCollisionSurface,
    };

    use crate::spatial::collision::CollisionScene;
    use crate::{
        GroundState, GroundedBody, GroundedBodySpheres, GroundedConfig, GroundedOutcome,
        GroundedRequest, PhysicalCollisionFilter, RETAIL_LANDING_NORMAL_Z,
        RETAIL_WALKABLE_NORMAL_Z, solve_grounded,
    };

    const LANDBLOCK: u32 = 0xe63e_ffff;

    /// A west plateau at `plateau_z` descending eastward by `drop_per_column` from column 4,
    /// clamped at zero: crest at x = 96, steep face beyond it.
    fn ramp_scene(plateau_z: f32, drop_per_column: f32) -> CollisionScene {
        ramp_scene_with(plateau_z, drop_per_column, Vec::new())
    }

    /// `ramp_scene` with placed static colliders in the same landblock.
    fn ramp_scene_with(
        plateau_z: f32,
        drop_per_column: f32,
        colliders: Vec<holtburger_content::PlacedCollider>,
    ) -> CollisionScene {
        // Terrain heights are row-major (`index / 9` is the Y row); use the X column so the
        // ramp descends eastward and the crest sits at x = 96.
        let heights: Vec<f32> = (0..81)
            .map(|index| {
                let column = (index % 9) as f32;
                (plateau_z - (column - 4.0).max(0.0) * drop_per_column).max(0.0)
            })
            .collect();
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: LANDBLOCK,
                terrain: TerrainCollisionSurface::from_terrain(&LandblockTerrain {
                    grid_size: 9,
                    tile_size: 24.0,
                    height_indices: vec![0; 81],
                    heights,
                    terrain_samples: vec![0; 81],
                    cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(
                        LANDBLOCK,
                    ),
                })
                .unwrap(),
                static_geometry: LandblockColliders::new(colliders, Vec::new()),
            })
            .unwrap();
        scene
    }

    use crate::spatial::differential_fixtures::{retail_creature_config, retail_creature_pair};

    fn config() -> GroundedConfig {
        retail_creature_config()
    }

    fn spheres() -> GroundedBodySpheres {
        retail_creature_pair()
    }

    fn body(start: Vector3, velocity: Vector3, ground: GroundState) -> GroundedBody {
        GroundedBody {
            pose: WorldPosition {
                landblock_id: Guid(LANDBLOCK),
                coords: start,
                rotation: Quaternion::identity(),
            }
            .normalize_outdoor_cell(),
            cell: None,
            velocity,
            ground,
        }
    }

    fn tick(
        scene: &CollisionScene,
        body_state: GroundedBody,
        supported_velocity: Vector3,
    ) -> GroundedBody {
        let settle = body_state.ground.settle_permission();
        let outcome = solve_grounded(
            scene,
            config(),
            GroundedRequest {
                settle,
                body: body_state,
                spheres: spheres(),
                supported_velocity,
                retain_supported_gravity: false,
                delta_seconds: 1.0 / 30.0,
                filter: PhysicalCollisionFilter::ALL,
            },
        )
        .unwrap();
        let GroundedOutcome::Solved { body, .. } = outcome else {
            panic!("scenario solve failed: {outcome:?}");
        };
        body
    }

    /// The ramp's steep-face normal sits between the two thresholds, so every scenario below
    /// exercises the land-leniently/walk-strictly split on real terrain geometry.
    fn steep_face_normal_z(drop_per_column: f32) -> f32 {
        24.0 / (24.0f32 * 24.0 + drop_per_column * drop_per_column).sqrt()
    }

    /// Airborne landings classify by the contact plane exactly as retail's transient derivation:
    /// plateau → supported, steep face → sliding, near-vertical cliff → no landing at all.
    #[test]
    fn airborne_landing_classifies_by_the_contact_plane() {
        let face_z = steep_face_normal_z(30.0);
        assert!(face_z > RETAIL_LANDING_NORMAL_Z && face_z < RETAIL_WALKABLE_NORMAL_Z);
        let scene = ramp_scene(60.0, 30.0);

        // Drop onto the plateau: walkable landing.
        let mut falling = body(
            Vector3::new(48.0, 48.0, 60.3),
            Vector3::zero(),
            GroundState::Airborne,
        );
        for _ in 0..30 {
            falling = tick(&scene, falling, Vector3::zero());
        }
        assert!(
            matches!(falling.ground, GroundState::Supported(_)),
            "plateau landing did not classify supported: {:?}",
            falling.ground
        );

        // Drop onto the mid-face of the steep descent (x 108 is one half-column past the crest).
        let mut falling = body(
            Vector3::new(108.0, 48.0, 50.0),
            Vector3::zero(),
            GroundState::Airborne,
        );
        let mut slid = false;
        for _ in 0..60 {
            falling = tick(&scene, falling, Vector3::zero());
            if let GroundState::Sliding(plane) = falling.ground {
                assert!(
                    (plane.normal.z - face_z).abs() < 0.01,
                    "slide plane is not the authored face: {:?}",
                    plane.normal
                );
                slid = true;
                break;
            }
        }
        assert!(slid, "steep-face landing never classified sliding");
    }

    /// A cliff steeper than the landing allowance rejects the lenient probe entirely.
    #[test]
    fn near_vertical_face_rejects_the_lenient_landing() {
        let cliff_z = steep_face_normal_z(300.0);
        assert!(cliff_z < RETAIL_LANDING_NORMAL_Z);
        let scene = ramp_scene(300.0, 300.0);
        // A body just off the cliff face, moving down along it.
        let mut falling = body(
            Vector3::new(100.0, 48.0, 250.0),
            Vector3::new(0.0, 0.0, -2.0),
            GroundState::Airborne,
        );
        for _ in 0..10 {
            falling = tick(&scene, falling, Vector3::zero());
            assert!(
                matches!(falling.ground, GroundState::Airborne),
                "sub-allowance face must not land: {:?}",
                falling.ground
            );
        }
    }

    /// A slide is ballistic: gravity keeps integrating and no friction damps the descent, so
    /// successive slide ticks keep the plane and keep accelerating downhill.
    #[test]
    fn slide_ticks_keep_the_plane_and_accelerate_under_gravity() {
        let scene = ramp_scene(60.0, 30.0);
        let mut falling = body(
            Vector3::new(108.0, 48.0, 50.0),
            Vector3::zero(),
            GroundState::Airborne,
        );
        // Acquire the slide.
        for _ in 0..60 {
            falling = tick(&scene, falling, Vector3::zero());
            if matches!(falling.ground, GroundState::Sliding(_)) {
                break;
            }
        }
        assert!(matches!(falling.ground, GroundState::Sliding(_)));
        let mut previous_z = falling.pose.coords.z;
        let mut descents = Vec::new();
        for _ in 0..12 {
            falling = tick(&scene, falling, Vector3::zero());
            assert!(
                matches!(falling.ground, GroundState::Sliding(_)),
                "slide lost its plane mid-face: {:?}",
                falling.ground
            );
            descents.push(previous_z - falling.pose.coords.z);
            previous_z = falling.pose.coords.z;
        }
        // Frictionless gravity along the face: per-tick descent must grow monotonically apart
        // from float noise.
        assert!(
            descents.windows(2).all(|pair| pair[1] > pair[0] - 1e-4),
            "slide descent decelerated as if friction applied: {descents:?}"
        );
    }

    /// Walking off the crest transitions walkable → airborne → sliding: retail clears contact
    /// when the walking probe fails (allowance is chosen at transition entry,
    /// `acclient.c:310697-310719`), and the next transitions' lenient landing acquires the face
    /// once gravity closes the 0.04m reach — a brief, bounded airborne gap, with no bespoke
    /// crest mechanism.
    #[test]
    fn crest_walk_off_transitions_supported_to_sliding_through_a_bounded_airborne_gap() {
        let scene = ramp_scene(60.0, 30.0);
        // Settle onto the plateau first.
        let mut walker = body(
            Vector3::new(90.0, 48.0, 60.2),
            Vector3::zero(),
            GroundState::Airborne,
        );
        for _ in 0..30 {
            walker = tick(&scene, walker, Vector3::zero());
        }
        assert!(matches!(walker.ground, GroundState::Supported(_)));

        // Walk east over the crest at x = 96.
        let mut airborne_gap = 0usize;
        let mut left_plateau = false;
        for _ in 0..90 {
            walker = tick(&scene, walker, Vector3::new(4.0, 0.0, 0.0));
            match walker.ground {
                GroundState::Airborne => {
                    left_plateau = true;
                    airborne_gap += 1;
                }
                GroundState::Sliding(_) => break,
                GroundState::Supported(_) => assert!(
                    !left_plateau,
                    "walker re-acquired walkable support after leaving the crest"
                ),
            }
        }
        assert!(
            matches!(walker.ground, GroundState::Sliding(_)),
            "walker never entered the slide past the crest"
        );
        // The gap is real and geometry-dependent: the ballistic body keeps its 4 m/s walk
        // velocity, and the face recedes at slope 30/24 per meter east, so gravity overtakes at
        // t ≈ 2·v·slope/g ≈ 1.0s (~31 ticks at 30 Hz). Retail's ballistics are identical; the
        // bound only guards against the slide never acquiring or acquiring implausibly early.
        assert!(
            (25..=40).contains(&airborne_gap),
            "crest airborne gap outside the ballistic catch-up bound: {airborne_gap} ticks"
        );
    }

    /// A ball flank between the thresholds lands as a slide with the radial contact plane — the
    /// case the volume-collider plan documented as its walkable-allowance gap — and the body
    /// ultimately reaches walkable ground below.
    #[test]
    fn ball_flank_lands_sliding_and_descends_to_walkable_ground() {
        use holtburger_content::{
            ColliderScale, CollisionBall, CollisionShape, LandblockPlacement, PlacedCollider,
            StaticColliderPlacement,
        };
        use std::sync::Arc;

        let ball_radius = 2.299;
        let collider = PlacedCollider::new(
            Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::new(0.0, 0.0, ball_radius),
                radius: ball_radius,
            })),
            LandblockPlacement {
                origin: Vector3::new(96.0, 96.0, 0.0),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorGenerated { source_index: 0 },
        )
        .unwrap();
        let scene_with_ball = ramp_scene_with(0.0, 0.0, vec![collider]);

        // Drop offset from the apex: rest normal z = sqrt(1 - (2.2 / 2.779)^2) ≈ 0.61 — between
        // the landing and walking thresholds.
        let mut falling = body(
            Vector3::new(96.0 + 2.2, 96.0, 4.0),
            Vector3::zero(),
            GroundState::Airborne,
        );
        let mut slid_on_flank = false;
        let mut supported_low = false;
        for _ in 0..300 {
            falling = tick(&scene_with_ball, falling, Vector3::zero());
            match falling.ground {
                GroundState::Sliding(plane) => {
                    assert!(
                        plane.normal.z > RETAIL_LANDING_NORMAL_Z
                            && plane.normal.z < RETAIL_WALKABLE_NORMAL_Z,
                        "flank plane outside the between-threshold band: {:?}",
                        plane.normal
                    );
                    slid_on_flank = true;
                }
                GroundState::Supported(_) => {
                    supported_low = true;
                    break;
                }
                GroundState::Airborne => {}
            }
        }
        assert!(slid_on_flank, "ball flank never classified sliding");
        assert!(
            supported_low,
            "body never reached walkable ground below the ball"
        );
        assert!(
            falling.pose.coords.z < 0.1,
            "walkable support arrived off the terrain: z {}",
            falling.pose.coords.z
        );
    }

    /// The slide settles to walkable support where the face meets the flat run-out.
    #[test]
    fn slide_settles_supported_at_the_face_bottom() {
        let scene = ramp_scene(60.0, 30.0);
        let mut falling = body(
            Vector3::new(108.0, 48.0, 50.0),
            Vector3::zero(),
            GroundState::Airborne,
        );
        let mut supported_at = None;
        for tick_index in 0..600 {
            falling = tick(&scene, falling, Vector3::zero());
            if matches!(falling.ground, GroundState::Supported(_)) {
                supported_at = Some(tick_index);
                break;
            }
        }
        assert!(
            supported_at.is_some(),
            "slide never reached walkable support: {:?} at {:?}",
            falling.ground,
            falling.pose.coords
        );
        assert!(
            falling.pose.coords.z < 15.0,
            "support arrived before the run-out: z {}",
            falling.pose.coords.z
        );
    }
}

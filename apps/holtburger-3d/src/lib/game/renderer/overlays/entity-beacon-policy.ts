import type { NormalizedRgbaColor } from "../../../frontend-color";
import { transformAffineAABB3 } from "../../math/matrices";
import { AABB3, type Mat4, Vec3 } from "../../math/types";
import { validateNormalizedColor } from "./nameplate-policy";

/** Runtime-adjustable styling for depth-tested, portal-scoped 3D hollow cylinder beacons. */
export interface EntityBeaconSettings {
	/** Resolved theme color for the hollow cylinder and base ring; null until theme observation runs. */
	readonly color: NormalizedRgbaColor | null;
	/** Resolved theme color for rising cylinder sparkles; null until theme observation runs. */
	readonly sparkleColor: NormalizedRgbaColor | null;
	/** Default cylinder height in meters for outdoor entities. */
	readonly outdoorHeightMeters: number;
	/** Compact cylinder height in meters for entities occupying indoor env-cell scopes. */
	readonly indoorHeightMeters: number;
	/** Minimum clearance above the entity's posed rigid top so tall entities never swallow the cylinder. */
	readonly entityHeadClearanceMeters: number;
	/** Multiplier applied to the entity's horizontal half-extent so the hollow cylinder hugs its footprint. */
	readonly radiusScale: number;
	/** Minimum world-space cylinder radius in meters so small floor items remain readable. */
	readonly minimumRadiusMeters: number;
	/** Minimum projected cylinder radius in CSS pixels to prevent distant sub-pixel flicker. */
	readonly minimumRadiusCssPixels: number;
	/** Small vertical lift above `rigidBounds.min.y` in meters to avoid flat-floor z-fighting. */
	readonly baseLiftMeters: number;
	/** Upward shimmer cycle rate in cycles per second; zero disables animation. */
	readonly shimmerCyclesPerSecond: number;
}

/** Resolved anchor-relative geometry for one in-scene 3D cylinder beacon instance. */
interface ResolvedEntityBeaconGeometry {
	/** Anchor-relative entity base center, lifted slightly above `rigidBounds.min.y`. */
	readonly base: Vec3;
	/** Final cylinder height in meters after indoor/outdoor and tall-entity floor rules. */
	readonly height: number;
	/** Horizontal cylinder and base-disc radius in meters fitted to the entity bounds. */
	readonly radius: number;
	/** Squared camera distance for deterministic back-to-front blend sorting. */
	readonly distanceSquared: number;
}

const POSED_BOUNDS_SCRATCH = AABB3.zero();

/** Reject malformed beacon policy before it reaches shader uniforms. */
export function validateEntityBeaconSettings(
	settings: EntityBeaconSettings,
): void {
	if (settings.color !== null) {
		validateNormalizedColor(settings.color, "Entity beacon");
	}
	if (settings.sparkleColor !== null) {
		validateNormalizedColor(settings.sparkleColor, "Entity beacon sparkle");
	}
	validatePositive(settings.outdoorHeightMeters, "outdoorHeightMeters");
	validatePositive(settings.indoorHeightMeters, "indoorHeightMeters");
	validateNonnegative(
		settings.entityHeadClearanceMeters,
		"entityHeadClearanceMeters",
	);
	validatePositive(settings.radiusScale, "radiusScale");
	validatePositive(settings.minimumRadiusMeters, "minimumRadiusMeters");
	validatePositive(settings.minimumRadiusCssPixels, "minimumRadiusCssPixels");
	validateNonnegative(settings.baseLiftMeters, "baseLiftMeters");
	validateNonnegative(
		settings.shimmerCyclesPerSecond,
		"shimmerCyclesPerSecond",
	);
}

/**
 * Resolve one entity's 3D beacon base, height, and entity-fitted radius directly from its posed rigid bounds.
 *
 * No floor raycasting or surface projection is performed; the cylinder and horizontal base face
 * sit directly on the entity's rigid-bounds base (`min.y + baseLiftMeters`).
 */
export function resolveEntityBeaconGeometry(
	rigidBounds: AABB3,
	localToLandblock: Mat4,
	landblockOffset: Vec3,
	cameraPosition: Vec3,
	isIndoor: boolean,
	settings: EntityBeaconSettings,
): ResolvedEntityBeaconGeometry {
	const posed = transformAffineAABB3(
		localToLandblock,
		rigidBounds,
		POSED_BOUNDS_SCRATCH,
	);
	const base = new Vec3(
		(posed.min.x + posed.max.x) * 0.5 + landblockOffset.x,
		posed.min.y + landblockOffset.y + settings.baseLiftMeters,
		(posed.min.z + posed.max.z) * 0.5 + landblockOffset.z,
	);
	const entityHalfX = Math.max(0, (posed.max.x - posed.min.x) * 0.5);
	const entityHalfZ = Math.max(0, (posed.max.z - posed.min.z) * 0.5);
	const radius = Math.max(
		Math.max(entityHalfX, entityHalfZ) * settings.radiusScale,
		settings.minimumRadiusMeters,
	);
	const entityHeight = Math.max(0, posed.max.y - posed.min.y);
	const scenarioHeight = isIndoor
		? settings.indoorHeightMeters
		: settings.outdoorHeightMeters;
	const height = Math.max(
		entityHeight + settings.entityHeadClearanceMeters,
		scenarioHeight,
	);
	return {
		base,
		height,
		radius,
		distanceSquared: base.distanceSquaredTo(cameraPosition),
	};
}

function validatePositive(value: number, label: string): void {
	if (!Number.isFinite(value) || value <= 0)
		throw new Error(`Entity beacon ${label} must be finite and positive.`);
}

function validateNonnegative(value: number, label: string): void {
	if (!Number.isFinite(value) || value < 0)
		throw new Error(`Entity beacon ${label} must be finite and nonnegative.`);
}

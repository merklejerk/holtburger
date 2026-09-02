import { createCameraLookAtAngles } from "../math/camera-orientation";
import { type Mat4, Vec3 } from "../math/types";
import type { SceneResidency } from "../scene";
import {
	MAP_MAXIMUM_VIEW_DIAMETER,
	MAP_MINIMUM_VIEW_DIAMETER,
} from "./map-appearance";

/**
 * The subject context every map decision reads.
 *
 * There is deliberately no notion of "the player": the Explorer has a free camera and no player at
 * all, so whatever the app shell nominates — a possessed entity's pose, or the camera — is the
 * anchor. Residency selects the map environment and seeds the subject's interior component.
 */
export interface MapAnchor {
	/** World-space subject position the map follows whenever its viewed centre is anchored. */
	readonly worldX: number;
	readonly worldZ: number;
	/** World height, which the terrain contours and interior depth rule measure against. */
	readonly worldY: number;
	/**
	 * Bearing the anchor faces, clockwise from north in radians, which the map always puts up.
	 *
	 * Whatever the anchor *is*, its own forward points up: the free camera's look direction when
	 * nothing is possessed, and the possessed character's own facing when something is. The boom
	 * camera does not enter into it while possessed — it orbits a character that is the subject of
	 * the map, and orienting by the orbit would turn the map every time the operator looked around
	 * a character that had not moved.
	 */
	readonly headingRadians: number;
	/**
	 * Where the anchor is, which selects the map's mode and seeds the interior flood.
	 *
	 * Null while residency is unknown, which the map treats as outdoors rather than guessing.
	 */
	readonly residency: SceneResidency | null;
}

/** Geometry and elevation scale selected by the map anchor's residency. */
export type MapEnvironment = "indoor" | "outdoor";

/** Resolve the geometry mode selected by an anchor, treating absent knowledge as outdoors. */
export function mapEnvironment(anchor: MapAnchor | null): MapEnvironment {
	return anchor?.residency?.envCellId != null ? "indoor" : "outdoor";
}

/** World-space horizontal point shown at the centre of the map. */
export interface MapCenter {
	/** East-west world coordinate. */
	readonly worldX: number;
	/** South-north world coordinate. */
	readonly worldZ: number;
}

/** Everything that decides what the map draws this frame, beyond the geometry itself. */
export interface MapViewParameters {
	/** Subject context controlling orientation, elevation treatment, and interior selection. */
	readonly anchor: MapAnchor;
	/** Viewed position, separate from the subject while the user pans the map. */
	readonly center: MapCenter;
	/**
	 * World-metre diameter across the map's visible circle.
	 *
	 * Resolution-independent by construction: resizing the panel changes pixel density, never how
	 * much world is shown.
	 */
	readonly viewDiameter: number;
}

/** Clamp a requested zoom into the tunable bounds. */
export function clampMapViewDiameter(viewDiameter: number): number {
	if (!Number.isFinite(viewDiameter)) return MAP_MINIMUM_VIEW_DIAMETER;
	return Math.min(
		MAP_MAXIMUM_VIEW_DIAMETER,
		Math.max(MAP_MINIMUM_VIEW_DIAMETER, viewDiameter),
	);
}

/**
 * The 2x2 mapping from world-space horizontal offsets to clip space.
 *
 * Named rather than positional because a bare four-float array invites transposition bugs that
 * only show up as a mirrored map.
 */
export interface MapWorldToClip {
	/** Clip x per world east metre. */
	readonly m00: number;
	/** Clip y per world east metre. */
	readonly m10: number;
	/** Clip x per world south metre. */
	readonly m01: number;
	/** Clip y per world south metre. */
	readonly m11: number;
}

/** One view paired with the canvas-specific projection derived from it. */
export interface ProjectedMapView {
	/** Semantic subject, viewed centre, and zoom. */
	readonly view: MapViewParameters;
	/** World-to-clip mapping derived from this exact view. */
	readonly worldToClip: MapWorldToClip;
}

/**
 * Build the mapping from world-space horizontal offsets to clip space.
 *
 * Zoom, rotation, canvas aspect, and the world-to-screen axis flip all fold into this one matrix so
 * the shader holds no orientation policy. The visible circle spans `viewDiameter` across the
 * *smaller* canvas axis, so a wide panel reveals more world sideways rather than silently zooming.
 *
 * North is world -Z and screens are +Y up, hence the flip; the world then rotates by the anchor's
 * bearing so its facing direction points up the screen.
 */
export function computeMapWorldToClip(
	view: MapViewParameters,
	canvasWidth: number,
	canvasHeight: number,
): MapWorldToClip {
	if (canvasWidth <= 0 || canvasHeight <= 0) {
		throw new Error("Map canvas must have a positive extent to project onto.");
	}
	const radius = clampMapViewDiameter(view.viewDiameter) / 2;
	const minorAxis = Math.min(canvasWidth, canvasHeight);
	const scaleX = minorAxis / (radius * canvasWidth);
	const scaleY = minorAxis / (radius * canvasHeight);
	const cos = Math.cos(view.anchor.headingRadians);
	const sin = Math.sin(view.anchor.headingRadians);
	// Screen-right is the anchor's right and screen-up is its forward, always: the viewer faces up
	// the map and the compass ring turns instead, which is how retail's radar read and how anyone
	// holding a paper map turns it. North therefore moves; the ring is what says where it went.
	return {
		m00: scaleX * cos,
		m01: scaleX * sin,
		m10: scaleY * sin,
		m11: -scaleY * cos,
	};
}

/** Bind one map view to its canvas projection so consumers cannot accidentally mix snapshots. */
export function projectMapView(
	view: MapViewParameters,
	canvasWidth: number,
	canvasHeight: number,
): ProjectedMapView {
	return {
		view,
		worldToClip: computeMapWorldToClip(view, canvasWidth, canvasHeight),
	};
}

/** Write one mapping into a caller-owned column-major buffer for `uniformMatrix2fv`. */
export function writeMapWorldToClip(
	matrix: MapWorldToClip,
	target: Float32Array,
): Float32Array {
	if (target.length !== 4) {
		throw new Error("A map clip matrix target must hold exactly four floats.");
	}
	target[0] = matrix.m00;
	target[1] = matrix.m10;
	target[2] = matrix.m01;
	target[3] = matrix.m11;
	return target;
}

/** Project one world point to clip space with the same mapping the shader applies. */
export function projectMapWorldPoint(
	matrix: MapWorldToClip,
	view: MapViewParameters,
	worldX: number,
	worldZ: number,
): readonly [number, number] {
	const offsetX = worldX - view.center.worldX;
	const offsetZ = worldZ - view.center.worldZ;
	return [
		matrix.m00 * offsetX + matrix.m01 * offsetZ,
		matrix.m10 * offsetX + matrix.m11 * offsetZ,
	];
}

/**
 * Move the viewed centre opposite one pointer drag so the map behaves like paper under the hand.
 *
 * Pointer deltas use canvas coordinates (+Y down), while the projection uses clip coordinates
 * (+Y up). Inverting the existing world-to-clip matrix keeps panning exactly aligned with every
 * heading and aspect ratio instead of maintaining a second rotation convention.
 */
export function mapCenterAfterCanvasDrag(
	view: MapViewParameters,
	canvasWidth: number,
	canvasHeight: number,
	deltaX: number,
	deltaY: number,
): MapCenter {
	if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
		throw new Error("Map pointer displacement must be finite.");
	}
	const matrix = computeMapWorldToClip(view, canvasWidth, canvasHeight);
	const clipX = (2 * deltaX) / canvasWidth;
	const clipY = (-2 * deltaY) / canvasHeight;
	const determinant = matrix.m00 * matrix.m11 - matrix.m01 * matrix.m10;
	if (!Number.isFinite(determinant) || determinant === 0) {
		throw new Error("Map projection must be invertible while panning.");
	}
	const worldX = (matrix.m11 * clipX - matrix.m01 * clipY) / determinant;
	const worldZ = (-matrix.m10 * clipX + matrix.m00 * clipY) / determinant;
	return {
		worldX: view.center.worldX - worldX,
		worldZ: view.center.worldZ - worldZ,
	};
}

/**
 * The compass bearing an entity faces, read from its scene-space transform.
 *
 * An entity's forward is +Y in AC's authored axes, which `acVectorToRender` maps to scene -Z, so
 * world forward is the negated third column of its transform. Retail agrees on both the axis and
 * the sense: `Frame::get_heading` reads the image of local +Y and yields degrees clockwise from
 * north (acclient.c:342616-342625).
 *
 * The bearing itself is deliberately not computed here. `createCameraLookAtAngles` is the app's one
 * definition of yaw, and the camera already reports its heading through it; a second hand-rolled
 * `atan2` beside it would be free to drift, which is exactly how a map and its compass end up
 * disagreeing by a sign nobody can find.
 */
export function mapHeadingFromSceneTransform(transform: Mat4): number {
	const forward = new Vec3(-transform.m31, -transform.m32, -transform.m33);
	return createCameraLookAtAngles(Vec3.zero(), forward).yawRadians;
}

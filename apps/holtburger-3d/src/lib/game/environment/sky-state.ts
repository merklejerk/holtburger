import { bracketKeyframes } from "./keyframe-bracket";
import type { ActiveRegionSource } from "../../assets/active-region-source";

/** One authored day group from the active region's sky descriptor. */
type SkyDayGroup = NonNullable<
	ActiveRegionSource["data"]["sky"]
>["dayGroups"][number];

/**
 * Retail's authored-brightness scale: sky material values are authored 0-100 and applied at
 * hundredths (`GameSky::UseTime`, acclient.c:297760-297782).
 */
export const SKY_BRIGHTNESS_SCALE = 0.01;

/**
 * `Frame::grotate` ignores a rotation whose axis vector is shorter than this (acclient.c:342645),
 * which for the sky's `(0, -rotation_radians, 0)` axis is the smallest pitch that has any effect.
 */
const MINIMUM_GROTATE_RADIANS = 0.00019999999;

/** `properties` bit marking a viewer-pinned weather object rather than a celestial one (bit 4). */
const WEATHER_PROPERTY_BIT = 4;

/** `properties` bit moving an object into the after-landscape pass (bit 1). */
const AFTER_LANDSCAPE_PROPERTY_BIT = 1;

/** `properties` bit suppressing the viewer pin's height clamp, so the object tracks the viewer (bit 8). */
const PIN_TRACKS_VIEWER_HEIGHT_PROPERTY_BIT = 8;

/**
 * The height retail clamps an unclamped-bit weather object to (`GameSky::UpdatePosition`,
 * acclient.c:297333).
 *
 * An absolute cell-frame height, not an offset: the object follows the viewer in XY while its
 * height stays 120 units below sea level however high the viewer climbs.
 */
export const WEATHER_PIN_HEIGHT = -120;

/** Which of retail's two sky passes draws an object. */
export type SkyDrawPass = "before-world" | "after-landscape";

/**
 * Which pass draws a sky object, and how it is pinned to the viewer.
 *
 * One composite rather than three loose flags because the facts are not independently meaningful:
 * only a weather object is viewer-pinned, only a weather object is gated on the weather toggle, and
 * only a weather object without bit 8 is height-clamped. Derived once here so the renderer reads a
 * decision instead of re-deriving it from raw `properties` bits at draw time.
 */
export type SkyPlacement =
	| { readonly kind: "celestial"; readonly pass: SkyDrawPass }
	| {
			readonly kind: "weather";
			readonly pass: SkyDrawPass;
			/**
			 * Absolute AC-frame height the pin clamps to, or null when the object instead tracks the
			 * viewer's own height. 76 of the 92 shipped weather objects set bit 8 and so track.
			 */
			readonly clampedHeight: number | null;
	  };

/** A viewer-pinned object sits exactly at the viewer, which is the sky pass's own origin. */
const AT_VIEWER: readonly [number, number, number] = [0, 0, 0];

/**
 * The AC-frame origin one sky object draws at, measured from the viewer.
 *
 * Retail assigns a weather object the viewer's full origin on every position update and then forces
 * its height when bit 8 is clear (`GameSky::UpdatePosition`, acclient.c:297325-297334). Expressed
 * relative to the viewer because the sky pass draws through a view matrix with its translation
 * stripped, so a viewer-pinned object is at the origin by construction and only the clamped ones
 * need an offset at all.
 *
 * Celestial objects keep retail's own behavior of staying where they are — retail interpolates
 * their origin against the viewer frame at ratio zero, which is a no-op.
 */
export function skyObjectOrigin(
	placement: SkyPlacement,
	viewerHeight: number,
): readonly [number, number, number] {
	if (placement.kind === "celestial" || placement.clampedHeight === null) {
		return AT_VIEWER;
	}
	return [0, 0, placement.clampedHeight - viewerHeight];
}

/** Derive the composite placement from one object's raw `properties` bits. */
function resolvePlacement(properties: number): SkyPlacement {
	const pass: SkyDrawPass =
		(properties & AFTER_LANDSCAPE_PROPERTY_BIT) === 0
			? "before-world"
			: "after-landscape";
	if ((properties & WEATHER_PROPERTY_BIT) === 0) return { kind: "celestial", pass };
	return {
		kind: "weather",
		pass,
		clampedHeight:
			(properties & PIN_TRACKS_VIEWER_HEIGHT_PROPERTY_BIT) === 0
				? WEATHER_PIN_HEIGHT
				: null,
	};
}

/**
 * Instant per-tick material values, already scaled out of their authored 0-100 range.
 *
 * `null` means the day group authored no replacement for that channel, which retail represents
 * with a -1 sentinel and skips writing entirely (`GameSky::UseTime`, acclient.c:297764). Consumers
 * must fall back to the object's own authored material rather than to zero.
 */
interface ResolvedSkyMaterial {
	/** Emissive term, from the authored `luminosity` replacement. */
	readonly luminosity: number | null;
	/** Diffuse term, from the authored `max_bright` replacement. */
	readonly diffuse: number | null;
	/** Translucency, from the authored `transparent` replacement. */
	readonly translucency: number | null;
}

/** One sky object resolved for the current day group and day fraction. */
interface ResolvedSkyObject {
	/**
	 * The object's position in its day group's authored list.
	 *
	 * Carried because the resolved list drops objects outside their window, so a resolved array
	 * index is not stable across ticks while this is. Anything that must recognise the same sky
	 * object from one sky tick to the next — a running script clock, above all — keys on this.
	 */
	readonly authoredIndex: number;
	/**
	 * The object to draw. Usually a `GfxObj` (`0x01`), but celestial scope also includes the
	 * Setup-family `0x02000714` that every shipped day group authors.
	 */
	readonly gfxObjectId: string;
	/**
	 * Authored physics-script id, carried through unexecuted. The authored-effects runtime is its
	 * eventual consumer; see the sky pass plan's sequencing note.
	 */
	readonly particleEffectId: string;
	/**
	 * Raw `properties` bits, retained losslessly for environment-override work.
	 *
	 * Bits 1, 4 and 8 are all consumed through {@link placement}. Bit 2 — which hides the object
	 * while an environment override is active with fog on — is the one an `AdminEnvirons` override
	 * will need, and twenty shipped objects set it, one per day group. See the override seam note on
	 * `ResolvedSceneEnvironment`.
	 */
	readonly properties: number;
	/**
	 * Which pass draws this object and how it is pinned to the viewer, derived from `properties`.
	 *
	 * Weather objects stay in the resolved list alongside celestial ones because retail resolves a
	 * single array and filters at draw time.
	 */
	readonly placement: SkyPlacement;
	/**
	 * Orientation as an AC-authored frame quaternion `[w, x, y, z]`, ready for `acFrameTransform`.
	 * No origin rides alongside it: every sky object's origin follows the viewer, so it is derived
	 * per frame by {@link skyObjectOrigin} rather than resolved here. Retail makes celestial objects
	 * distant purely through the sky pass's extended far plane.
	 */
	readonly orientation: readonly [number, number, number, number];
	/** Authored UV scroll rate in units per second, `[x, y]`; retail never uses the z component. */
	readonly textureVelocity: readonly [number, number];
	readonly material: ResolvedSkyMaterial;
}

/** The active day group's celestial state, resolved for one day fraction. */
export interface ResolvedSkyState {
	readonly dayGroupIndex: number;
	readonly dayGroupName: string;
	/** Every object retail would have resolved, in authored order. */
	readonly objects: readonly ResolvedSkyObject[];
}

/**
 * Resolve one day group's sky objects at a day fraction, reproducing `SkyDesc::GetSky`
 * (acclient.c:292328) followed by the material writes in `GameSky::UseTime` (acclient.c:297724).
 *
 * Objects outside their authored begin/end window resolve absent, matching retail's invalid-gfx-id
 * marker and `GameSky::MakeObject`'s refusal to build an object for it. A gfx replacement is
 * applied before that filter because retail applies it unconditionally, so a replacement can bring
 * an object back inside a window it would otherwise sit outside.
 */
export function resolveSkyState(
	dayGroup: SkyDayGroup,
	dayGroupIndex: number,
	dayFraction: number,
): ResolvedSkyState {
	const positions = dayGroup.skyObjects.map((object, authoredIndex) =>
		resolveCelestialPosition(dayFraction, object, authoredIndex),
	);
	if (dayGroup.skyTimes.length > 0) {
		applyReplacements(
			positions,
			bracketKeyframes(dayGroup.skyTimes, dayFraction),
		);
	}
	return {
		dayGroupIndex,
		dayGroupName: dayGroup.dayName,
		objects: positions.filter(isVisible).map(toResolvedSkyObject),
	};
}

/**
 * One entry of retail's `CelestialPosition` array (acclient.h:17241) while it is still mutable.
 *
 * Kept separate from `ResolvedSkyObject` because replacements write into it by authored index
 * before the invisible entries are dropped, so it cannot be built in its final shape in one pass.
 */
interface CelestialPosition {
	readonly authoredIndex: number;
	gfxObjectId: string;
	readonly particleEffectId: string;
	readonly properties: number;
	/** Degrees; zero unless a replacement authors a `rotate` value. */
	heading: number;
	/** Degrees; the authored begin/end angle interpolated across the object's window. */
	readonly rotation: number;
	readonly textureVelocity: readonly [number, number];
	luminosity: number | null;
	diffuse: number | null;
	translucency: number | null;
}

/** A dat id of all zeroes is retail's invalid-id marker for a sky object outside its window. */
const INVALID_DAT_ID = "0x00000000";

function resolveCelestialPosition(
	dayFraction: number,
	object: SkyDayGroup["skyObjects"][number],
	authoredIndex: number,
): CelestialPosition {
	const alwaysVisible = object.beginTime === object.endTime;
	const visible =
		alwaysVisible ||
		(dayFraction > object.beginTime && dayFraction < object.endTime);
	return {
		authoredIndex,
		gfxObjectId: visible ? object.defaultGfxObjectId : INVALID_DAT_ID,
		particleEffectId: object.defaultParticleEffectId,
		properties: object.properties,
		heading: 0,
		rotation: alwaysVisible
			? object.beginAngle
			: object.beginAngle +
				((object.endAngle - object.beginAngle) *
					(dayFraction - object.beginTime)) /
					(object.endTime - object.beginTime),
		textureVelocity: [object.textureVelocityX, object.textureVelocityY],
		luminosity: null,
		diffuse: null,
		translucency: null,
	};
}

/**
 * Apply the bracketing keyframes' `SkyObjectReplace` entries, keyed by their authored
 * `object_index`.
 *
 * Retail matches replacements to objects by pointer identity, but binds that pointer from the
 * authored index at load (`DayGroup::UnPack`, acclient.c:292183). The distinction matters: 433 of
 * the shipped replacements sit at a list position that differs from their `object_index`.
 *
 * A brightness or translucency channel interpolates only when both keyframes author a usable value
 * for the same object; otherwise it stays unset and the object keeps its own material.
 */
function applyReplacements(
	positions: readonly CelestialPosition[],
	keyframes: {
		readonly before: SkyDayGroup["skyTimes"][number];
		readonly after: SkyDayGroup["skyTimes"][number];
		readonly ratio: number;
	},
): void {
	for (const replacement of keyframes.before.skyObjectReplacements) {
		const position = positions[replacement.objectIndex];
		if (position === undefined) {
			throw new Error(
				`Sky replacement targets object index ${replacement.objectIndex}, which the day group does not author.`,
			);
		}
		if (replacement.gfxObjectId !== INVALID_DAT_ID) {
			position.gfxObjectId = replacement.gfxObjectId;
		}
		if (replacement.rotate !== 0) position.heading = replacement.rotate;
		const after = keyframes.after.skyObjectReplacements.find(
			(candidate) => candidate.objectIndex === replacement.objectIndex,
		);
		if (after === undefined) continue;
		position.luminosity = interpolateBrightness(
			replacement.luminosity,
			after.luminosity,
			keyframes.ratio,
		);
		position.diffuse = interpolateBrightness(
			replacement.maxBrightness,
			after.maxBrightness,
			keyframes.ratio,
		);
		position.translucency = interpolateTranslucency(
			replacement.transparent,
			after.transparent,
			keyframes.ratio,
		);
	}
}

/** Brightness channels are only authored when strictly positive (acclient.c:292489). */
function interpolateBrightness(
	before: number,
	after: number,
	ratio: number,
): number | null {
	if (!(before > 0 && after > 0)) return null;
	return (before + (after - before) * ratio) * SKY_BRIGHTNESS_SCALE;
}

/** Translucency is authored at zero as well, so its sentinel test is `>= 0` (acclient.c:292497). */
function interpolateTranslucency(
	before: number,
	after: number,
	ratio: number,
): number | null {
	if (!(before >= 0 && after >= 0)) return null;
	return (before + (after - before) * ratio) * SKY_BRIGHTNESS_SCALE;
}

function isVisible(position: CelestialPosition): boolean {
	return position.gfxObjectId !== INVALID_DAT_ID;
}

function toResolvedSkyObject(position: CelestialPosition): ResolvedSkyObject {
	return {
		authoredIndex: position.authoredIndex,
		gfxObjectId: position.gfxObjectId,
		particleEffectId: position.particleEffectId,
		properties: position.properties,
		placement: resolvePlacement(position.properties),
		orientation: celestialOrientation(position.heading, position.rotation),
		textureVelocity: position.textureVelocity,
		material: {
			luminosity: position.luminosity,
			diffuse: position.diffuse,
			translucency: position.translucency,
		},
	};
}

/**
 * Build the orientation `GameSky::CalcFrame` produces (acclient.c:297365) from an identity frame.
 *
 * `Frame::set_heading` resolves to a rotation of `-heading` about AC's up axis (+Z): it feeds
 * `set_vector_heading` the vector `(sin h, cos h, 0)`, which reduces to a single `-h` Euler term
 * about Z (acclient.c:342873, 342796). `Frame::grotate` then left-multiplies a rotation of
 * `-rotation` about AC's north axis (+Y) — a global-axis rotation, since `Frame::rotate`
 * (acclient.c:137544) is the local variant that maps its axis through the frame first.
 */
function celestialOrientation(
	headingDegrees: number,
	rotationDegrees: number,
): readonly [number, number, number, number] {
	const heading = degreesToRadians(headingDegrees);
	const rotation = degreesToRadians(rotationDegrees);
	// Retail guards each step, and the guards are observable: a zero heading must not overwrite
	// the identity frame, and a sub-threshold pitch is discarded outright.
	const yaw: readonly [number, number, number, number] =
		headingDegrees === 0
			? [1, 0, 0, 0]
			: [Math.cos(heading / 2), 0, 0, -Math.sin(heading / 2)];
	if (Math.abs(rotation) < MINIMUM_GROTATE_RADIANS) return yaw;
	const pitch: readonly [number, number, number, number] = [
		Math.cos(rotation / 2),
		0,
		-Math.sin(rotation / 2),
		0,
	];
	return multiplyQuaternions(pitch, yaw);
}

function multiplyQuaternions(
	left: readonly [number, number, number, number],
	right: readonly [number, number, number, number],
): readonly [number, number, number, number] {
	const [lw, lx, ly, lz] = left;
	const [rw, rx, ry, rz] = right;
	return [
		lw * rw - lx * rx - ly * ry - lz * rz,
		lw * rx + lx * rw + ly * rz - lz * ry,
		lw * ry - lx * rz + ly * rw + lz * rx,
		lw * rz + lx * ry - ly * rx + lz * rw,
	];
}

function degreesToRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

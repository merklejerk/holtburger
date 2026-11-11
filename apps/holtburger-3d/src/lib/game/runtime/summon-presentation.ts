import type { Vec3 } from "../math/types";
import type { SceneVec3 } from "../../assets/ac-frame";

/** App-authored model flicker, independent of authoritative translucency and lifetime. */
export interface SummonFlickerTuning {
	/** Estimated seconds before expiration at which hard flicker begins. */
	readonly leadInSeconds: number;
	/** Frequency at the beginning of the window. */
	readonly initialHertz: number;
	/** Frequency at and after the estimated deadline. */
	readonly finalHertz: number;
	/** Visible fraction of each cycle, within the open unit interval. */
	readonly dutyCycle: number;
}

/** Core RGB and opacity for one app-colored ownership leash. */
export type SummonLeashColor = readonly [number, number, number, number];

/** Geometry scale and glow for one reusable procedural leash. */
export interface SummonLeashTuning {
	/** Half-length of one oval link in metres. */
	readonly linkRadius: number;
	/** Approximate centre spacing; alternating rings overlap. */
	readonly linkSpacing: number;
	/** Sag as a fraction of endpoint distance. */
	readonly sagFraction: number;
	/** Lateral idle sway in metres; zero disables motion. */
	readonly swayAmplitude: number;
	/** Idle sway cycles per second. */
	readonly swayHertz: number;
	/** Traveling glow cycles per second; travels from owner (end) to summon (start). */
	readonly pulseHertz: number;
	/** Distance between glow crests in metres. */
	readonly pulseWavelength: number;
	/** Additional brightness at a glow crest; zero disables the pulse. */
	readonly pulseStrength: number;
	/** Fade curve exponent inside body bounds; larger values hide more interior chain. */
	readonly endpointFadePower: number;
	/** Maximum displayed endpoint separation in metres. */
	readonly maximumDistance: number;
	/** Fade range immediately before the maximum separation. */
	readonly fadeDistance: number;
	/** Wider additive shell scale. */
	readonly glowScale: number;
	/** Shell opacity as a fraction of core opacity. */
	readonly glowOpacity: number;
}

/** Cold app-local relationship level, projected from accepted world summon facts. */
export interface SummonVisualLevel {
	/** Summon identity used to find its installed visual. */
	readonly guid: number;
	/** Exact server incarnation, rejecting stale visual levels. */
	readonly generation: number;
	/** Absent until appearance resolves; model flicker remains independent of leash readiness. */
	readonly leash: {
		/** Owning character whose current posed visual supplies the other endpoint. */
		readonly owner: number;
		/** App-selected color; the runtime does not classify ownership relative to a player. */
		readonly color: SummonLeashColor;
	} | null;
	/** Browser monotonic deadline derived using the existing synchronized session clock. */
	readonly expiresAtSeconds: number | null;
}

/** Current posed endpoints, prepared once per frame and reused for every view. */
export interface SummonLeashInput {
	/** Canonical posed body anchor of the summon. */
	readonly start: SceneVec3;
	/** Canonical posed body anchor of its owner. */
	readonly end: SceneVec3;
	/** Half sizes of the current posed bodies' scene-axis bounds, excluding particle reach. */
	readonly startHalfExtents: Vec3;
	readonly endHalfExtents: Vec3;
	/** Shared monotonic animation time, prepared once for every view. */
	readonly timeSeconds: number;
	/** Per-relationship core RGB and opacity, shared by every view. */
	readonly color: SummonLeashColor;
	/** Cold artistic settings shared by every relationship. */
	readonly tuning: SummonLeashTuning;
}

/** Binary opacity avoids overwriting retail alpha or introducing a new blend classification. */
export function summonOpacityAt(
	now: number,
	deadline: number | null,
	tuning: SummonFlickerTuning,
): 0 | 1 {
	if (deadline === null) return 1;
	const elapsed = now - (deadline - tuning.leadInSeconds);
	if (elapsed <= 0) return 1;
	const rampTime = Math.min(elapsed, tuning.leadInSeconds);
	// Integrate the frequency ramp so changing frequency does not restart the cycle phase.
	const cycles =
		tuning.initialHertz * rampTime +
		((tuning.finalHertz - tuning.initialHertz) * rampTime * rampTime) /
			(2 * tuning.leadInSeconds) +
		Math.max(0, elapsed - tuning.leadInSeconds) * tuning.finalHertz;
	return cycles % 1 < tuning.dutyCycle ? 1 : 0;
}

/** Invalid artistic tuning must fail before entering frame-hot preparation. */
export function validateSummonPresentation(
	levels: readonly SummonVisualLevel[],
	leash: SummonLeashTuning,
	flicker: SummonFlickerTuning,
): void {
	for (const [name, value] of Object.entries({
		linkRadius: leash.linkRadius,
		linkSpacing: leash.linkSpacing,
		maximumDistance: leash.maximumDistance,
		fadeDistance: leash.fadeDistance,
		pulseWavelength: leash.pulseWavelength,
		endpointFadePower: leash.endpointFadePower,
		leadInSeconds: flicker.leadInSeconds,
		initialHertz: flicker.initialHertz,
		finalHertz: flicker.finalHertz,
	})) {
		if (!Number.isFinite(value) || value <= 0)
			throw new Error(`Summon ${name} must be finite and positive.`);
	}
	for (const [name, value] of Object.entries({
		swayAmplitude: leash.swayAmplitude,
		swayHertz: leash.swayHertz,
		pulseHertz: leash.pulseHertz,
		pulseStrength: leash.pulseStrength,
	})) {
		if (!Number.isFinite(value) || value < 0)
			throw new Error(`Summon ${name} must be finite and nonnegative.`);
	}
	if (leash.fadeDistance > leash.maximumDistance)
		throw new Error("Summon leash fade exceeds maximum distance.");
	if (!Number.isFinite(leash.sagFraction) || leash.sagFraction < 0)
		throw new Error("Summon leash sag must be finite and nonnegative.");
	if (!Number.isFinite(leash.glowScale) || leash.glowScale < 1)
		throw new Error("Summon leash glow scale must be finite and at least one.");
	if (
		!Number.isFinite(leash.glowOpacity) ||
		leash.glowOpacity < 0 ||
		leash.glowOpacity > 1
	)
		throw new Error("Summon leash glow opacity must be between zero and one.");
	for (const level of levels) {
		if (
			level.leash !== null &&
			level.leash.color.some(
				(value) => !Number.isFinite(value) || value < 0 || value > 1,
			)
		)
			throw new Error(
				"Summon leash color channels must be between zero and one.",
			);
	}
	if (flicker.finalHertz < flicker.initialHertz)
		throw new Error(
			"Summon flicker frequency must not decrease toward expiration.",
		);
	if (
		!Number.isFinite(flicker.dutyCycle) ||
		flicker.dutyCycle <= 0 ||
		flicker.dutyCycle >= 1
	)
		throw new Error(
			"Summon flicker duty cycle must be strictly between zero and one.",
		);
}

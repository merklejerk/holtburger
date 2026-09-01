const RETAIL_PORTAL_FRAMES_PER_SECOND = 40;
const SEGMENT_DURATIONS_SECONDS = [0.6, 1.2, 1.8] as const;
const SEGMENT_DURATIONS_FRAMES = SEGMENT_DURATIONS_SECONDS.map(
	(seconds) => seconds * RETAIL_PORTAL_FRAMES_PER_SECOND,
);
const CYCLE_FRAMES = SEGMENT_DURATIONS_FRAMES.reduce(
	(total, duration) => total + duration,
	0,
);

/**
 * Deterministic analogue of retail's random axial portal-camera targets.
 *
 * Retail selects a 0–360 degree target every 0.6–1.8 seconds and eases between them
 * (acclient.c:252679-252717). Generation-keyed targets retain that motion without making captures
 * nondeterministic.
 */
export function portalTunnelRollRadians(
	generation: number,
	animationFramePosition: number,
): number {
	if (!Number.isSafeInteger(generation) || generation < 0) {
		throw new Error(
			"Portal roll generation must be a non-negative safe integer.",
		);
	}
	if (!Number.isFinite(animationFramePosition) || animationFramePosition < 0) {
		throw new Error(
			"Portal roll frame position must be finite and non-negative.",
		);
	}
	const cycle = Math.floor(animationFramePosition / CYCLE_FRAMES);
	let withinCycle = animationFramePosition - cycle * CYCLE_FRAMES;
	let segmentInCycle = 0;
	for (const duration of SEGMENT_DURATIONS_FRAMES) {
		if (withinCycle < duration) break;
		withinCycle -= duration;
		segmentInCycle += 1;
	}
	const segment = cycle * SEGMENT_DURATIONS_FRAMES.length + segmentInCycle;
	const duration =
		SEGMENT_DURATIONS_FRAMES[
			Math.min(segmentInCycle, SEGMENT_DURATIONS_FRAMES.length - 1)
		] ?? SEGMENT_DURATIONS_FRAMES[0];
	const progress = smoothstep(withinCycle / duration);
	const from = rollTarget(generation, segment);
	const to = rollTarget(generation, segment + 1);
	return from + shortestAngleDelta(from, to) * progress;
}

function rollTarget(generation: number, segment: number): number {
	let hash = (generation ^ Math.imul(segment + 1, 0x9e37_79b1)) >>> 0;
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x7feb_352d) >>> 0;
	hash ^= hash >>> 15;
	return (hash / 0x1_0000_0000) * Math.PI * 2 - Math.PI;
}

function shortestAngleDelta(from: number, to: number): number {
	return (
		((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI
	);
}

function smoothstep(progress: number): number {
	const clamped = Math.max(0, Math.min(1, progress));
	return clamped * clamped * (3 - 2 * clamped);
}

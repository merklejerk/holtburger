import { PortalTransitionController } from "../../client/portal-transition-controller";
import type { PortalTransitionPresentationPlan } from "../../client/portal-transition-presentation";
import { enrichPortalTransitionFrame } from "../runtime/portal-transition-frame";
import { DEFAULT_COLOR_GRADE_PARAMETERS } from "./color-grade-policy";
import { resolvePortalTransitionComposition } from "./portal-transition-composition";
import type { PortalWarpDriveTuning } from "./portal-warp-drive-tuning";
import { WebGL2FlatScenePresentation } from "./webgl2-flat-scene-presentation";
import { DEFAULT_ENTITY_SELECTION_OUTLINE_SETTINGS } from "./entity-selection-outline-policy";
import { WebGL2FlatSceneTarget } from "./webgl2-flat-scene-target";

const FIXTURE_EXTENT = 17;
const FIXTURE_PIXEL_COUNT = FIXTURE_EXTENT * FIXTURE_EXTENT;
const FULL_CHANNEL_SUM = FIXTURE_PIXEL_COUNT * 255;

/** Direct framebuffer census for one controller-produced presentation plan. */
interface PortalTransitionPixelSample {
	readonly blue: number;
	readonly green: number;
	readonly kind: PortalTransitionPresentationPlan["kind"];
	readonly progress: number | null;
	readonly red: number;
}

/** Spatial samples and reverse-playback proof for the shared warp-drive transform. */
interface PortalWarpDriveSample {
	readonly centerRed: number;
	readonly leftRed: number;
	readonly reverseMatches: boolean;
	readonly rightRed: number;
}

/** Deterministic controller-to-pixels evidence produced without DAT or world-scene dependencies. */
export interface PortalTransitionPresentationFixtureResult {
	readonly entryStart: PortalTransitionPixelSample;
	readonly entryMidpoint: PortalTransitionPixelSample;
	readonly warpDrive: PortalWarpDriveSample;
	readonly waiting: PortalTransitionPixelSample;
	readonly exit: readonly PortalTransitionPixelSample[];
	readonly revealGeneration: number;
}

/**
 * Exercise the real transition controller, plan enrichment, resource resolver, and GPU presenter.
 *
 * Solid primary colors keep each source attributable. Assertions are semantic channel censuses,
 * not platform-sensitive whole-frame hashes or aesthetic snapshots.
 */
export function runPortalTransitionPresentationFixture(
	portalWarpDriveTuning: PortalWarpDriveTuning,
): PortalTransitionPresentationFixtureResult {
	const canvas = document.createElement("canvas");
	canvas.width = FIXTURE_EXTENT;
	canvas.height = FIXTURE_EXTENT;
	const gl = canvas.getContext("webgl2", {
		alpha: false,
		antialias: false,
		preserveDrawingBuffer: true,
	});
	if (gl === null)
		throw new Error("Portal transition fixture requires WebGL2.");
	const targetOwner = new WebGL2FlatSceneTarget(gl);
	const presenter = new WebGL2FlatScenePresentation(gl, portalWarpDriveTuning);
	const target = targetOwner.resizeDimensions(FIXTURE_EXTENT, FIXTURE_EXTENT);
	const origin = createSolidTexture(gl, [255, 0, 0, 255]);
	const tunnel = createSolidTexture(gl, [0, 255, 0, 255]);
	uploadSolidTexture(gl, target.color, [0, 0, 255, 255]);
	const controller = new PortalTransitionController({
		enterDurationMs: 1_000,
		exitDurationMs: 1_000,
	});
	controller.begin(41, { kind: "capture-last-world" });
	const render = (plan: PortalTransitionPresentationPlan) => {
		const tunnelSample =
			plan.kind === "destination-only-awaiting-handoff"
				? null
				: { animationFramePosition: 1, axialRollFramePosition: 0 };
		presenter.present(
			target,
			{ enabled: false, parameters: DEFAULT_COLOR_GRADE_PARAMETERS },
			resolvePortalTransitionComposition(
				enrichPortalTransitionFrame(plan, tunnelSample),
				{ origin, tunnel },
			),
			DEFAULT_ENTITY_SELECTION_OUTLINE_SETTINGS,
			1,
		);
		gl.finish();
		return readPixelCensus(gl, plan);
	};
	try {
		const entryStart = render(
			controller.advance({ destinationReady: false, nowMs: 0 }).plan,
		);
		const entryMidpoint = render(
			controller.advance({ destinationReady: false, nowMs: 500 }).plan,
		);
		const waitingPlan = controller.advance({
			destinationReady: false,
			nowMs: 1_000,
		}).plan;
		const waiting = render(waitingPlan);
		const warpDrive = sampleWarpDrive(
			gl,
			presenter,
			target,
			origin,
			tunnel,
			portalWarpDriveTuning,
		);
		uploadSolidTexture(gl, tunnel, [0, 255, 0, 255]);
		uploadSolidTexture(gl, target.color, [0, 0, 255, 255]);
		controller.acknowledgePresented({ generation: 41, kind: "tunnel-only" });
		const exit = [1_000, 1_250, 1_500, 1_750, 2_000].map((nowMs) =>
			render(controller.advance({ destinationReady: true, nowMs }).plan),
		);
		const final = exit.at(-1);
		if (final === undefined)
			throw new Error("Portal exit fixture produced no frames.");
		const reveal = controller.acknowledgePresented({
			generation: 41,
			kind: "destination-only-awaiting-handoff",
		});
		assertPixelFixture(entryStart, entryMidpoint, waiting, exit);
		if (reveal?.generation !== 41) {
			throw new Error(
				"Neutral destination pixels did not produce the reveal receipt.",
			);
		}
		return {
			entryMidpoint,
			entryStart,
			exit,
			revealGeneration: reveal.generation,
			waiting,
			warpDrive,
		};
	} finally {
		presenter.destroy();
		targetOwner.destroy();
		gl.deleteTexture(origin);
		gl.deleteTexture(tunnel);
	}
}

function sampleWarpDrive(
	gl: WebGL2RenderingContext,
	presenter: WebGL2FlatScenePresentation,
	target: ReturnType<WebGL2FlatSceneTarget["resizeDimensions"]>,
	origin: WebGLTexture,
	tunnel: WebGLTexture,
	portalWarpDriveTuning: PortalWarpDriveTuning,
): PortalWarpDriveSample {
	uploadHorizontalRedGradient(gl, origin);
	uploadHorizontalRedGradient(gl, target.color);
	uploadSolidTexture(gl, tunnel, [0, 0, 0, 255]);
	const render = (plan: PortalTransitionPresentationPlan) => {
		presenter.present(
			target,
			{ enabled: false, parameters: DEFAULT_COLOR_GRADE_PARAMETERS },
			resolvePortalTransitionComposition(
				enrichPortalTransitionFrame(plan, {
					animationFramePosition: 1,
					axialRollFramePosition: 0,
				}),
				{ origin, tunnel },
			),
			DEFAULT_ENTITY_SELECTION_OUTLINE_SETTINGS,
			1,
		);
		gl.finish();
		const pixels = new Uint8Array(FIXTURE_PIXEL_COUNT * 4);
		gl.readPixels(
			0,
			0,
			FIXTURE_EXTENT,
			FIXTURE_EXTENT,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			pixels,
		);
		return pixels;
	};
	const entryPixels = render({
		generation: 42,
		kind: "origin-to-tunnel",
		progress: 0.25,
	});
	const reversePixels = render({
		generation: 42,
		kind: "tunnel-to-destination",
		progress: 0.75,
	});
	const reverseMatches = entryPixels.every(
		(value, index) => reversePixels[index] === value,
	);
	const redAt = (x: number) => entryPixels[(8 * FIXTURE_EXTENT + x) * 4] ?? -1;
	const sample = {
		centerRed: redAt(8),
		leftRed: redAt(0),
		reverseMatches,
		rightRed: redAt(16),
	};
	const easedAcceleration = 0.25 ** 2 * (3 - 2 * 0.25);
	const motion =
		easedAcceleration ** portalWarpDriveTuning.accelerationExponent;
	const expectedStableCenter = Math.round(
		128 * (1 - motion ** portalWarpDriveTuning.worldOpacityExponent),
	);
	if (Math.abs(sample.centerRed - expectedStableCenter) > 1) {
		throw new Error("Portal warp drive moved its vanishing-point pixel.");
	}
	if (sample.leftRed <= 0 || sample.rightRed >= 250) {
		throw new Error("Portal warp drive did not move both peripheral edges.");
	}
	if (!sample.reverseMatches) {
		throw new Error("Portal exit is not the exact temporal reverse of entry.");
	}
	return sample;
}

function assertPixelFixture(
	entryStart: PortalTransitionPixelSample,
	entryMidpoint: PortalTransitionPixelSample,
	waiting: PortalTransitionPixelSample,
	exit: readonly PortalTransitionPixelSample[],
): void {
	if (entryStart.red !== FULL_CHANNEL_SUM) {
		throw new Error("Portal entry did not begin with exact origin pixels.");
	}
	if (entryMidpoint.red === 0 || entryMidpoint.green === 0) {
		throw new Error(
			"Portal entry midpoint does not contain both origin and tunnel pixels.",
		);
	}
	if (waiting.green !== FULL_CHANNEL_SUM) {
		throw new Error("Portal waiting did not present exact tunnel pixels.");
	}
	const destinationContributions = exit.map(({ blue }) => blue);
	let previousContribution = -1;
	for (const [index, contribution] of destinationContributions.entries()) {
		if (index > 0 && contribution <= previousContribution) {
			throw new Error(
				`Portal exit destination contribution did not increase at sample ${index}.`,
			);
		}
		previousContribution = contribution;
	}
	const midpoint = exit[2];
	if (midpoint === undefined || midpoint.blue === 0 || midpoint.green === 0) {
		throw new Error(
			"Portal exit midpoint does not contain tunnel and destination pixels.",
		);
	}
	const final = exit.at(-1);
	if (
		final?.blue !== FULL_CHANNEL_SUM ||
		final.red !== 0 ||
		final.green !== 0
	) {
		throw new Error(
			"Portal exit did not end with exact neutral destination pixels.",
		);
	}
}

function readPixelCensus(
	gl: WebGL2RenderingContext,
	plan: PortalTransitionPresentationPlan,
): PortalTransitionPixelSample {
	const pixels = new Uint8Array(FIXTURE_PIXEL_COUNT * 4);
	gl.readPixels(
		0,
		0,
		FIXTURE_EXTENT,
		FIXTURE_EXTENT,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		pixels,
	);
	const channelSum = (channel: 0 | 1 | 2) =>
		pixels.reduce(
			(sum, value, index) => (index % 4 === channel ? sum + value : sum),
			0,
		);
	return {
		blue: channelSum(2),
		green: channelSum(1),
		kind: plan.kind,
		progress: "progress" in plan ? plan.progress : null,
		red: channelSum(0),
	};
}

function createSolidTexture(
	gl: WebGL2RenderingContext,
	color: readonly [number, number, number, number],
): WebGLTexture {
	const texture = gl.createTexture();
	if (texture === null) throw new Error("Failed to allocate fixture texture.");
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, FIXTURE_EXTENT, FIXTURE_EXTENT);
	uploadSolidTexture(gl, texture, color);
	return texture;
}

function uploadSolidTexture(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
	color: readonly [number, number, number, number],
): void {
	const pixels = new Uint8Array(FIXTURE_PIXEL_COUNT * 4);
	for (let offset = 0; offset < pixels.length; offset += 4)
		pixels.set(color, offset);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texSubImage2D(
		gl.TEXTURE_2D,
		0,
		0,
		0,
		FIXTURE_EXTENT,
		FIXTURE_EXTENT,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		pixels,
	);
}

function uploadHorizontalRedGradient(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
): void {
	const pixels = new Uint8Array(FIXTURE_PIXEL_COUNT * 4);
	for (let y = 0; y < FIXTURE_EXTENT; y += 1) {
		for (let x = 0; x < FIXTURE_EXTENT; x += 1) {
			const offset = (y * FIXTURE_EXTENT + x) * 4;
			pixels.set([x * 16, 0, 0, 255], offset);
		}
	}
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texSubImage2D(
		gl.TEXTURE_2D,
		0,
		0,
		0,
		FIXTURE_EXTENT,
		FIXTURE_EXTENT,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		pixels,
	);
}

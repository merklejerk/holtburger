import type { GeometryResourceKey } from "./resource-manager";
import { Vec2 } from "../math/types";
import {
	WebGL2PortalSubstrate,
	type WebGL2PortalSubstrateDiagnostics,
} from "./webgl2-portal-substrate";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";
import {
	createPortalFixtureGeometry,
	FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
} from "./webgl2-portal-fixture-support";
import { createPortalViewWindow } from "./portal-view-window";

const FIXTURE_EXTENT = { height: 8, width: 8 } as const;
const RESIZED_EXTENT = { height: 16, width: 16 } as const;
const RED = [204, 51, 26, 255] as const;
const GREEN = [51, 204, 51, 255] as const;
const BLUE = [26, 51, 204, 255] as const;
const YELLOW = [204, 204, 26, 255] as const;

/** Executable browser evidence for the production portal target and pass implementation. */
export interface WebGL2PortalSubstrateFixtureResult {
	readonly arbitraryApertureMaskPassed: boolean;
	readonly disposedDiagnostics: WebGL2PortalSubstrateDiagnostics;
	readonly finalPresentationPassed: boolean;
	readonly layerUnionPassed: boolean;
	/** Equality-constrained aperture writes remain inside their exterior entry label. */
	readonly parentConstrainedApertureMaskPassed: boolean;
	/** Equality-constrained NDC-window writes remain inside their exterior entry label. */
	readonly parentConstrainedWindowMaskPassed: boolean;
	/** Masked scene initialization replaces color/depth while retaining stencil ownership. */
	readonly maskedSceneInitializationPassed: boolean;
	readonly maskedDepthResetPassed: boolean;
	/** A suffix depth reset does not alter the exterior color already in the target. */
	readonly maskedDepthResetRetainedColor: boolean;
	/** Existing source-layer depth must reject a child aperture outside the parent opening. */
	readonly nestedLayerConfinementPassed: boolean;
	readonly ordinaryStateRestored: boolean;
	readonly orderedLayerOverwritePassed: boolean;
	readonly resizedDiagnostics: WebGL2PortalSubstrateDiagnostics;
	readonly resizedTargetReplaced: boolean;
	readonly targetDiagnostics: WebGL2PortalSubstrateDiagnostics;
	readonly pixels: {
		readonly afterDepthReset: readonly number[];
		readonly disjoint: readonly number[];
		readonly layerOne: readonly number[];
		readonly layerTwo: readonly number[];
		readonly nestedInsideParent: readonly number[];
		readonly nestedOutsideParent: readonly number[];
		readonly outside: readonly number[];
		readonly parentApertureInside: readonly number[];
		readonly parentApertureOutside: readonly number[];
		readonly parentWindowInside: readonly number[];
		readonly parentWindowOutside: readonly number[];
		readonly parentWindowAfterDepthReset: readonly number[];
		readonly restored: readonly number[];
	};
}

/**
 * Exercise the production substrate on the active browser context.
 *
 * The fixture deliberately uses the shared geometry resource manager so it cannot pass through a
 * test-only aperture upload path.
 */
export function runWebGL2PortalSubstrateFixture(
	gl: WebGL2RenderingContext,
	resources: WebGL2ResourceManager,
): WebGL2PortalSubstrateFixtureResult {
	const destinationExtent = {
		height: gl.drawingBufferHeight,
		width: gl.drawingBufferWidth,
	};
	const substrate = new WebGL2PortalSubstrate(gl);
	const geometryKeys: GeometryResourceKey[] = [];
	let geometryReleased = false;
	let targetDiagnostics: WebGL2PortalSubstrateDiagnostics;
	let resizedDiagnostics: WebGL2PortalSubstrateDiagnostics;
	let disposedDiagnostics: WebGL2PortalSubstrateDiagnostics;
	try {
		const arbitraryKey = createPortalFixtureGeometry(resources, {
			indices: new Uint16Array([0, 1, 3, 1, 2, 3, 0, 3, 5, 3, 4, 5]),
			positions: new Float32Array([
				-0.75, -0.75, 0, 0.75, -0.75, 0, 0.75, -0.25, 0, -0.25, -0.25, 0, -0.25,
				0.75, 0, -0.75, 0.75, 0,
			]),
		});
		geometryKeys.push(arbitraryKey);
		const overlapKey = createPortalFixtureGeometry(resources, {
			indices: quadIndices(),
			positions: quadPositions(0, -0.7, 0.7, -0.3),
		});
		geometryKeys.push(overlapKey);
		const disjointKey = createPortalFixtureGeometry(resources, {
			indices: quadIndices(),
			positions: quadPositions(0.25, 0.25, 0.75, 0.75),
		});
		geometryKeys.push(disjointKey);
		const nestedKey = createPortalFixtureGeometry(resources, {
			indices: quadIndices(),
			positions: quadPositions(0, -0.7, 0.7, 0.7),
		});
		geometryKeys.push(nestedKey);
		const arbitrary = resources.getGeometry(arbitraryKey);
		const overlap = resources.getGeometry(overlapKey);
		const disjoint = resources.getGeometry(disjointKey);
		const nested = resources.getGeometry(nestedKey);

		const initialTarget = substrate.resize(FIXTURE_EXTENT);
		substrate.clearTarget(initialTarget, [0.1, 0.2, 0.8, 1], 0.9, 0);

		substrate.writeLayerMask(
			initialTarget,
			arbitrary,
			0,
			arbitrary.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			{ kind: "replace", value: 1 },
			"less-or-equal",
		);
		substrate.writeLayerMask(
			initialTarget,
			overlap,
			0,
			overlap.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			{ kind: "replace", value: 1 },
			"less-or-equal",
		);
		substrate.writeLayerMask(
			initialTarget,
			disjoint,
			0,
			disjoint.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			{ kind: "replace", value: 1 },
			"less-or-equal",
		);
		substrate.initializeMaskedScene(initialTarget, 1, [0.8, 0.2, 0.1, 1], 0.8);

		substrate.writeLayerMask(
			initialTarget,
			overlap,
			0,
			overlap.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			{ kind: "replace", value: 2 },
			"always",
		);
		substrate.initializeMaskedScene(initialTarget, 2, [0.8, 0.8, 0.1, 1], 0.4);

		substrate.resetMaskedDepth(initialTarget, 1, 1);
		substrate.present(initialTarget, null, FIXTURE_EXTENT);
		const afterDepthResetPixel = readPixel(gl, 1, 5);
		const layerOnePixel = readPixel(gl, 1, 5);
		const disjointPixel = readPixel(gl, 6, 6);
		const layerTwoPixel = readPixel(gl, 5, 1);
		const outsidePixel = readPixel(gl, 4, 4);

		substrate.clearTarget(initialTarget, [0.8, 0.8, 0.1, 1], 0.1, 0);
		substrate.present(initialTarget, null, FIXTURE_EXTENT);
		const restoredPixel = readPixel(gl, 4, 4);

		/*
		 * Seed a nearer root wall with a farther opening, then discard only the temporary stencil
		 * label. This models the depth already written by a physically valid parent cell before
		 * the normal layer-one mask pass begins.
		 */
		substrate.clearTarget(initialTarget, [0.1, 0.2, 0.8, 1], 0.4, 0);
		substrate.writeLayerMask(
			initialTarget,
			arbitrary,
			0,
			arbitrary.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			{ kind: "replace", value: 1 },
			"always",
		);
		substrate.resetMaskedDepth(initialTarget, 1, 1);
		substrate.beginTargetPass(initialTarget);
		gl.clearStencil(0);
		gl.clear(gl.STENCIL_BUFFER_BIT);
		substrate.writeLayerMask(
			initialTarget,
			arbitrary,
			0,
			arbitrary.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			{ kind: "replace", value: 1 },
			"less-or-equal",
		);
		substrate.resetMaskedDepth(initialTarget, 1, 1);
		substrate.initializeMaskedScene(initialTarget, 1, [0.2, 0.8, 0.2, 1], 0.6);
		substrate.writeLayerMask(
			initialTarget,
			nested,
			0,
			nested.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			{ kind: "replace", value: 2 },
			"less-or-equal",
		);
		substrate.resetMaskedDepth(initialTarget, 2, 1);
		substrate.initializeMaskedScene(initialTarget, 2, [0.8, 0.8, 0.1, 1], 0.4);
		substrate.present(initialTarget, null, FIXTURE_EXTENT);
		const nestedInsideParentPixel = readPixel(gl, 5, 2);
		const nestedOutsideParentPixel = readPixel(gl, 5, 5);

		/*
		 * A non-root exterior SCC first owns its entry pixels, then promotes only passing internal
		 * aperture pixels to the adjacent suffix label.
		 */
		substrate.clearTarget(initialTarget, [0.1, 0.2, 0.8, 1], 0.9, 0);
		substrate.writeLayerMask(
			initialTarget,
			arbitrary,
			0,
			arbitrary.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			{ kind: "replace", value: 3 },
			"always",
		);
		substrate.writeLayerMask(
			initialTarget,
			nested,
			0,
			nested.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			{ from: 3, kind: "promote-if-equal", to: 4 },
			"always",
		);
		substrate.initializeMaskedScene(initialTarget, 4, [0.8, 0.8, 0.1, 1], 1);
		substrate.present(initialTarget, null, FIXTURE_EXTENT);
		const parentApertureInsidePixel = readPixel(gl, 5, 2);
		const parentApertureOutsidePixel = readPixel(gl, 5, 5);

		const fullWindow = createPortalViewWindow([
			[new Vec2(-1, -1), new Vec2(1, -1), new Vec2(1, 1), new Vec2(-1, 1)],
		]);
		if (!fullWindow)
			throw new Error("Portal fixture full window normalized empty.");
		substrate.clearTarget(initialTarget, [0.1, 0.2, 0.8, 1], 0.9, 7);
		substrate.writeLayerMask(
			initialTarget,
			arbitrary,
			0,
			arbitrary.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			{ kind: "replace", value: 5 },
			"always",
		);
		substrate.writeLayerWindowMask(initialTarget, fullWindow, {
			from: 5,
			kind: "promote-if-equal",
			to: 6,
		});
		substrate.initializeMaskedScene(initialTarget, 6, [0.2, 0.8, 0.2, 1], 1);
		substrate.initializeMaskedScene(initialTarget, 7, [0.8, 0.2, 0.1, 1], 0.9);
		substrate.present(initialTarget, null, FIXTURE_EXTENT);
		const parentWindowInsidePixel = readPixel(gl, 1, 5);
		const parentWindowOutsidePixel = readPixel(gl, 4, 4);
		substrate.resetMaskedDepth(initialTarget, 6, 0.25);
		substrate.present(initialTarget, null, FIXTURE_EXTENT);
		const parentWindowAfterDepthResetPixel = readPixel(gl, 1, 5);

		targetDiagnostics = substrate.getDiagnostics();
		const resizedTarget = substrate.resize(RESIZED_EXTENT);
		resizedDiagnostics = substrate.getDiagnostics();
		const resizedTargetReplaced = resizedTarget !== initialTarget;
		substrate.restoreOrdinaryPass(null, destinationExtent);
		const ordinaryStateRestored = hasOrdinaryState(gl, destinationExtent);
		const webGlError = gl.getError();
		if (webGlError !== gl.NO_ERROR) {
			throw new Error(
				`Portal substrate browser fixture failed with WebGL error ${webGlError}.`,
			);
		}
		substrate.destroy();
		disposedDiagnostics = substrate.getDiagnostics();
		releaseFixtureGeometry(resources, geometryKeys);
		geometryReleased = true;

		return {
			arbitraryApertureMaskPassed:
				pixelMatches(layerOnePixel, RED) && pixelMatches(outsidePixel, BLUE),
			disposedDiagnostics,
			finalPresentationPassed: pixelMatches(restoredPixel, YELLOW),
			layerUnionPassed:
				pixelMatches(layerOnePixel, RED) &&
				pixelMatches(disjointPixel, RED) &&
				pixelMatches(outsidePixel, BLUE),
			parentConstrainedApertureMaskPassed:
				pixelMatches(parentApertureInsidePixel, YELLOW) &&
				pixelMatches(parentApertureOutsidePixel, BLUE),
			parentConstrainedWindowMaskPassed:
				pixelMatches(parentWindowInsidePixel, GREEN) &&
				pixelMatches(parentWindowOutsidePixel, RED),
			maskedSceneInitializationPassed: pixelMatches(
				parentApertureInsidePixel,
				YELLOW,
			),
			maskedDepthResetPassed: pixelMatches(afterDepthResetPixel, RED),
			maskedDepthResetRetainedColor: pixelMatches(
				parentWindowAfterDepthResetPixel,
				GREEN,
			),
			nestedLayerConfinementPassed:
				pixelMatches(nestedInsideParentPixel, YELLOW) &&
				pixelMatches(nestedOutsideParentPixel, BLUE),
			ordinaryStateRestored,
			orderedLayerOverwritePassed: pixelMatches(layerTwoPixel, YELLOW),
			pixels: {
				afterDepthReset: [...afterDepthResetPixel],
				disjoint: [...disjointPixel],
				layerOne: [...layerOnePixel],
				layerTwo: [...layerTwoPixel],
				nestedInsideParent: [...nestedInsideParentPixel],
				nestedOutsideParent: [...nestedOutsideParentPixel],
				outside: [...outsidePixel],
				parentApertureInside: [...parentApertureInsidePixel],
				parentApertureOutside: [...parentApertureOutsidePixel],
				parentWindowAfterDepthReset: [...parentWindowAfterDepthResetPixel],
				parentWindowInside: [...parentWindowInsidePixel],
				parentWindowOutside: [...parentWindowOutsidePixel],
				restored: [...restoredPixel],
			},
			resizedDiagnostics,
			resizedTargetReplaced,
			targetDiagnostics,
		};
	} finally {
		substrate.destroy();
		if (!geometryReleased) {
			for (const key of geometryKeys) resources.releaseResource(key);
		}
	}
}

function releaseFixtureGeometry(
	resources: WebGL2ResourceManager,
	keys: readonly GeometryResourceKey[],
): void {
	for (const key of keys) {
		if (!resources.releaseResource(key)) {
			throw new Error(
				`Portal substrate fixture lost geometry resource ${key}.`,
			);
		}
	}
}

function quadPositions(
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
): Float32Array {
	return new Float32Array([
		minX,
		minY,
		0,
		maxX,
		minY,
		0,
		maxX,
		maxY,
		0,
		minX,
		maxY,
		0,
	]);
}

function quadIndices(): Uint16Array {
	return new Uint16Array([0, 1, 2, 0, 2, 3]);
}

function readPixel(
	gl: WebGL2RenderingContext,
	x: number,
	y: number,
): Uint8Array {
	const pixel = new Uint8Array(4);
	gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
	return pixel;
}

function pixelMatches(
	actual: Uint8Array,
	expected: readonly [number, number, number, number],
): boolean {
	return expected.every(
		(component, index) => Math.abs(actual[index]! - component) <= 2,
	);
}

function hasOrdinaryState(
	gl: WebGL2RenderingContext,
	extent: { readonly height: number; readonly width: number },
): boolean {
	const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
	const colorMask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
	return (
		gl.getParameter(gl.FRAMEBUFFER_BINDING) === null &&
		viewport[0] === 0 &&
		viewport[1] === 0 &&
		viewport[2] === extent.width &&
		viewport[3] === extent.height &&
		colorMask.every(Boolean) &&
		gl.getParameter(gl.DEPTH_WRITEMASK) === true &&
		gl.getParameter(gl.DEPTH_FUNC) === gl.LEQUAL &&
		gl.isEnabled(gl.DEPTH_TEST) &&
		!gl.isEnabled(gl.STENCIL_TEST) &&
		gl.getParameter(gl.STENCIL_WRITEMASK) === 0xff &&
		!gl.isEnabled(gl.BLEND) &&
		!gl.isEnabled(gl.CULL_FACE) &&
		!gl.isEnabled(gl.SCISSOR_TEST) &&
		gl.getParameter(gl.CURRENT_PROGRAM) === null &&
		gl.getParameter(gl.VERTEX_ARRAY_BINDING) === null &&
		gl.getParameter(gl.ACTIVE_TEXTURE) === gl.TEXTURE0 &&
		gl.getParameter(gl.TEXTURE_BINDING_2D) === null
	);
}

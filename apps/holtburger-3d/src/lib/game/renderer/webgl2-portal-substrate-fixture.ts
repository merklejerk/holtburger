import type { GeometryResourceKey } from "./resource-manager";
import {
	WebGL2PortalSubstrate,
	type WebGL2PortalSubstrateDiagnostics,
} from "./webgl2-portal-substrate";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";
import {
	createPortalFixtureGeometry,
	FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
} from "./webgl2-portal-fixture-support";

const FIXTURE_EXTENT = { height: 8, width: 8 } as const;
const RESIZED_EXTENT = { height: 16, width: 16 } as const;
const RED = [204, 51, 26, 255] as const;
const GREEN = [51, 204, 51, 255] as const;
const BLUE = [26, 51, 204, 255] as const;
const YELLOW = [204, 204, 26, 255] as const;

/** Executable browser evidence for the production portal target and pass implementation. */
export interface WebGL2PortalSubstrateFixtureResult {
	readonly arbitraryApertureMaskPassed: boolean;
	readonly depthCopyPassed: boolean;
	readonly disposedDiagnostics: WebGL2PortalSubstrateDiagnostics;
	readonly finalPresentationPassed: boolean;
	readonly layerUnionPassed: boolean;
	readonly maskedDepthResetPassed: boolean;
	/** Existing source-layer depth must reject a child aperture outside the parent opening. */
	readonly nestedLayerConfinementPassed: boolean;
	readonly ordinaryStateRestored: boolean;
	readonly orderedLayerOverwritePassed: boolean;
	readonly resizedDiagnostics: WebGL2PortalSubstrateDiagnostics;
	readonly resizedTargetsReplaced: boolean;
	readonly targetDiagnostics: WebGL2PortalSubstrateDiagnostics;
	readonly pixels: {
		readonly beforeDepthReset: readonly number[];
		readonly disjoint: readonly number[];
		readonly layerOne: readonly number[];
		readonly layerTwo: readonly number[];
		readonly nestedInsideParent: readonly number[];
		readonly nestedOutsideParent: readonly number[];
		readonly outside: readonly number[];
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

		const initialTargets = substrate.resize(FIXTURE_EXTENT);
		substrate.clearTarget(initialTargets.exterior, [0.8, 0.2, 0.1, 1], 0.25, 0);
		substrate.clearTarget(initialTargets.composite, [0.1, 0.2, 0.8, 1], 0.9, 0);

		substrate.writeLayerMask(
			initialTargets.composite,
			arbitrary,
			0,
			arbitrary.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			1,
			"less-or-equal",
		);
		substrate.writeLayerMask(
			initialTargets.composite,
			overlap,
			0,
			overlap.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			1,
			"less-or-equal",
		);
		substrate.writeLayerMask(
			initialTargets.composite,
			disjoint,
			0,
			disjoint.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			1,
			"less-or-equal",
		);
		substrate.copyScene(
			initialTargets.exterior,
			initialTargets.composite,
			1,
			"always",
		);

		substrate.writeLayerMask(
			initialTargets.composite,
			overlap,
			0,
			overlap.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			2,
			"always",
		);
		substrate.clearTarget(initialTargets.exterior, [0.8, 0.8, 0.1, 1], 0.1, 0);
		substrate.copyScene(
			initialTargets.exterior,
			initialTargets.composite,
			2,
			"always",
		);

		substrate.clearTarget(initialTargets.exterior, [0.2, 0.8, 0.2, 1], 0.5, 0);
		substrate.copyScene(
			initialTargets.exterior,
			initialTargets.composite,
			1,
			"less",
		);
		substrate.present(initialTargets.composite, null, FIXTURE_EXTENT);
		const beforeDepthResetPixel = readPixel(gl, 1, 5);

		substrate.resetMaskedDepth(initialTargets.composite, 1, 1);
		substrate.copyScene(
			initialTargets.exterior,
			initialTargets.composite,
			1,
			"less",
		);

		substrate.present(initialTargets.composite, null, FIXTURE_EXTENT);
		const layerOnePixel = readPixel(gl, 1, 5);
		const disjointPixel = readPixel(gl, 6, 6);
		const layerTwoPixel = readPixel(gl, 5, 1);
		const outsidePixel = readPixel(gl, 4, 4);

		substrate.clearTarget(initialTargets.exterior, [0.8, 0.8, 0.1, 1], 0.1, 0);
		substrate.copyScene(
			initialTargets.exterior,
			initialTargets.composite,
			0,
			"always",
		);
		substrate.present(initialTargets.composite, null, FIXTURE_EXTENT);
		const restoredPixel = readPixel(gl, 4, 4);

		/*
		 * Seed a nearer root wall with a farther opening, then discard only the temporary stencil
		 * label. This models the depth already written by a physically valid parent cell before
		 * the normal layer-one mask pass begins.
		 */
		substrate.clearTarget(initialTargets.composite, [0.1, 0.2, 0.8, 1], 0.4, 0);
		substrate.writeLayerMask(
			initialTargets.composite,
			arbitrary,
			0,
			arbitrary.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			1,
			"always",
		);
		substrate.resetMaskedDepth(initialTargets.composite, 1, 1);
		substrate.beginTargetPass(initialTargets.composite);
		gl.clearStencil(0);
		gl.clear(gl.STENCIL_BUFFER_BIT);
		substrate.writeLayerMask(
			initialTargets.composite,
			arbitrary,
			0,
			arbitrary.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			1,
			"less-or-equal",
		);
		substrate.resetMaskedDepth(initialTargets.composite, 1, 1);
		substrate.clearTarget(initialTargets.exterior, [0.2, 0.8, 0.2, 1], 0.6, 0);
		substrate.copyScene(
			initialTargets.exterior,
			initialTargets.composite,
			1,
			"always",
		);
		substrate.writeLayerMask(
			initialTargets.composite,
			nested,
			0,
			nested.indexCount,
			FIXTURE_IDENTITY_CLIP_FROM_LOCAL,
			2,
			"less-or-equal",
		);
		substrate.resetMaskedDepth(initialTargets.composite, 2, 1);
		substrate.clearTarget(initialTargets.exterior, [0.8, 0.8, 0.1, 1], 0.4, 0);
		substrate.copyScene(
			initialTargets.exterior,
			initialTargets.composite,
			2,
			"always",
		);
		substrate.present(initialTargets.composite, null, FIXTURE_EXTENT);
		const nestedInsideParentPixel = readPixel(gl, 5, 2);
		const nestedOutsideParentPixel = readPixel(gl, 5, 5);

		targetDiagnostics = substrate.getDiagnostics();
		const resizedTargets = substrate.resize(RESIZED_EXTENT);
		resizedDiagnostics = substrate.getDiagnostics();
		const resizedTargetsReplaced =
			resizedTargets.exterior !== initialTargets.exterior &&
			resizedTargets.composite !== initialTargets.composite;
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
				pixelMatches(layerOnePixel, GREEN) && pixelMatches(outsidePixel, BLUE),
			depthCopyPassed: pixelMatches(beforeDepthResetPixel, RED),
			disposedDiagnostics,
			finalPresentationPassed: pixelMatches(restoredPixel, YELLOW),
			layerUnionPassed:
				pixelMatches(layerOnePixel, GREEN) &&
				pixelMatches(disjointPixel, GREEN) &&
				pixelMatches(outsidePixel, BLUE),
			maskedDepthResetPassed: pixelMatches(layerOnePixel, GREEN),
			nestedLayerConfinementPassed:
				pixelMatches(nestedInsideParentPixel, YELLOW) &&
				pixelMatches(nestedOutsideParentPixel, BLUE),
			ordinaryStateRestored,
			orderedLayerOverwritePassed: pixelMatches(layerTwoPixel, YELLOW),
			pixels: {
				beforeDepthReset: [...beforeDepthResetPixel],
				disjoint: [...disjointPixel],
				layerOne: [...layerOnePixel],
				layerTwo: [...layerTwoPixel],
				nestedInsideParent: [...nestedInsideParentPixel],
				nestedOutsideParent: [...nestedOutsideParentPixel],
				outside: [...outsidePixel],
				restored: [...restoredPixel],
			},
			resizedDiagnostics,
			resizedTargetsReplaced,
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

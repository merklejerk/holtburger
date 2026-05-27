import { describe, expect, it } from "vitest";

import { createInitialAssetChannelState } from "../assets/types";
import {
	buildPortalClippedRenderFrustum,
	derivePortalClippedBvhVisibility,
} from "./portal-clipped-bvh-candidates";
import { renderBoundsIntersectsFrustum } from "./render-spatial-math";
import type { RenderFrustum } from "./render-spatial-math";

const broadFrustum: RenderFrustum = {
	planes: [
		{ normal: { x: 1, y: 0, z: 0 }, constant: 1000 },
		{ normal: { x: -1, y: 0, z: 0 }, constant: 1000 },
		{ normal: { x: 0, y: 1, z: 0 }, constant: 1000 },
		{ normal: { x: 0, y: -1, z: 0 }, constant: 1000 },
		{ normal: { x: 0, y: 0, z: 1 }, constant: 1000 },
		{ normal: { x: 0, y: 0, z: -1 }, constant: 1000 },
	],
};

describe("portal clipped BVH candidates", () => {
	it("builds an aperture cone that keeps objects beyond the aperture", () => {
		const frustum = buildPortalClippedRenderFrustum({
			cameraFrustum: broadFrustum,
			cameraPosition: { x: 0, y: 0, z: 0 },
			apertureWorldPoints: [
				{ x: -1, y: -1, z: -5 },
				{ x: 1, y: -1, z: -5 },
				{ x: 1, y: 1, z: -5 },
				{ x: -1, y: 1, z: -5 },
			],
		});

		expect(frustum).not.toBeNull();
		expect(
			renderBoundsIntersectsFrustum(
				{
					min: { x: -0.25, y: -0.25, z: -8 },
					max: { x: 0.25, y: 0.25, z: -7.5 },
				},
				frustum!,
			),
		).toBe(true);
	});

	it("rejects objects outside the aperture cone", () => {
		const frustum = buildPortalClippedRenderFrustum({
			cameraFrustum: broadFrustum,
			cameraPosition: { x: 0, y: 0, z: 0 },
			apertureWorldPoints: [
				{ x: -1, y: -1, z: -5 },
				{ x: 1, y: -1, z: -5 },
				{ x: 1, y: 1, z: -5 },
				{ x: -1, y: 1, z: -5 },
			],
		});

		expect(frustum).not.toBeNull();
		expect(
			renderBoundsIntersectsFrustum(
				{
					min: { x: 5, y: -0.25, z: -8 },
					max: { x: 5.5, y: 0.25, z: -7.5 },
				},
				frustum!,
			),
		).toBe(false);
	});

	it("rejects objects between the camera and the aperture plane", () => {
		const frustum = buildPortalClippedRenderFrustum({
			cameraFrustum: broadFrustum,
			cameraPosition: { x: 0, y: 0, z: 0 },
			apertureWorldPoints: [
				{ x: -1, y: -1, z: -5 },
				{ x: 1, y: -1, z: -5 },
				{ x: 1, y: 1, z: -5 },
				{ x: -1, y: 1, z: -5 },
			],
		});

		expect(frustum).not.toBeNull();
		expect(
			renderBoundsIntersectsFrustum(
				{
					min: { x: -0.25, y: -0.25, z: -3 },
					max: { x: 0.25, y: 0.25, z: -2.5 },
				},
				frustum!,
			),
		).toBe(false);
	});

	it("falls back when portal aperture geometry is unavailable", () => {
		const result = derivePortalClippedBvhVisibility({
			assetState: createInitialAssetChannelState(),
			terrainScene: {
				focusLandblockId: null,
				statusText: "",
				cacheText: "",
				dataSourceText: "",
				tiles: [],
			},
			staticRenderableScene: {
				focusLandblockId: null,
				activeLandblockIds: [],
				sourceInstances: [],
				parts: [],
				partsByRenderGroupKey: new Map(),
				missingSourceAssetIds: [],
				missingGfxAssetIds: [],
				missingSetupAppearanceAssetIds: [],
			},
			structuredInteriorScene: {
				focusEnvCellId: null,
				activeEnvCellIds: [],
				cells: [],
				missingEnvCellAssetIds: [],
				missingInteriorGeometryAssetIds: [],
				missingCellStructureKeys: [],
				statusText: "",
				cacheText: "",
			},
			renderChunkTransforms: [],
			cameraFrustum: broadFrustum,
			cameraPosition: { x: 0, y: 0, z: 0 },
			apertureWorldPoints: [],
			compositeScene: "interior",
			requestedInteriorEnvCellIds: [],
		});

		expect(result.visibleItemKeys.size).toBe(0);
		expect(result.fallbackReasons).toEqual([
			"portal clipped BVH query missing aperture volume",
		]);
	});

	it("falls back when a portal pass has no loaded scene payloads to query", () => {
		const result = derivePortalClippedBvhVisibility({
			assetState: createInitialAssetChannelState(),
			terrainScene: {
				focusLandblockId: null,
				statusText: "",
				cacheText: "",
				dataSourceText: "",
				tiles: [],
			},
			staticRenderableScene: {
				focusLandblockId: null,
				activeLandblockIds: [],
				sourceInstances: [],
				parts: [],
				partsByRenderGroupKey: new Map(),
				missingSourceAssetIds: [],
				missingGfxAssetIds: [],
				missingSetupAppearanceAssetIds: [],
			},
			structuredInteriorScene: {
				focusEnvCellId: null,
				activeEnvCellIds: [],
				cells: [],
				missingEnvCellAssetIds: [],
				missingInteriorGeometryAssetIds: [],
				missingCellStructureKeys: [],
				statusText: "",
				cacheText: "",
			},
			renderChunkTransforms: [],
			cameraFrustum: broadFrustum,
			cameraPosition: { x: 0, y: 0, z: 0 },
			apertureWorldPoints: [
				{ x: -1, y: -1, z: -5 },
				{ x: 1, y: -1, z: -5 },
				{ x: 1, y: 1, z: -5 },
				{ x: -1, y: 1, z: -5 },
			],
			compositeScene: "interior",
			requestedInteriorEnvCellIds: [0x01010001],
		});

		expect(result.visibleItemKeys.size).toBe(0);
		expect(result.fallbackReasons).toEqual([
			"portal interior composite had no loaded structured cells to query",
		]);
	});
});

import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetRecord,
	type PreparedMaterialRecipePayload,
} from "../assets/types";
import { createBaseMaterialAppearanceContext } from "./material-appearance";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import {
	deriveStaticRenderableReadinessModel,
	type StaticRenderableReadinessStatus,
} from "./static-renderable-readiness";
import type {
	StaticRenderablePart,
	StaticRenderableSceneModel,
} from "./static-renderables";

describe("deriveStaticRenderableReadinessModel", () => {
	it("commits resolved static renderable parts", () => {
		const part = createStaticPart();
		const readiness = deriveStaticRenderableReadinessModel({
			assetState: createAssetState([createGfxObjRecord()]),
			scene: createStaticRenderableScene([part]),
		});

		expect(readiness.records.map((record) => record.status)).toEqual([
			"resolved",
		]);
		expect(readiness.committedScene.parts).toEqual([part]);
		expect(readiness.metrics).toMatchObject({
			resolvedCount: 1,
			committedPartCount: 1,
		});
	});

	it("keeps unresolved geometry pending and out of committed output", () => {
		const part = createStaticPart();
		const readiness = deriveStaticRenderableReadinessModel({
			assetState: createAssetState(),
			scene: createStaticRenderableScene([part], {
				missingGfxAssetIds: [part.gfxObjAssetId],
			}),
		});

		expect(readiness.records.map(statusKey)).toEqual([
			"pending:gfx-geometry:gfx-obj/01000001",
			"pending:gfx-geometry:gfx-obj/01000001",
		]);
		expect(readiness.committedScene.parts).toEqual([]);
		expect(readiness.committedScene.partsByRenderGroupKey.size).toBe(0);
		expect(readiness.metrics.pendingCount).toBe(2);
	});

	it("treats material dependency misses as committed debug fallback resolution", () => {
		const part = createStaticPart({
			materialSlots: [
				{
					slotIndex: 0,
					surfaceId: 0x08000001,
					materialAssetId: "material/08000001",
				},
			],
		});
		const readiness = deriveStaticRenderableReadinessModel({
			assetState: createAssetState([createGfxObjRecord()]),
			scene: createStaticRenderableScene([part]),
		});

		expect(readiness.records.map((record) => record.status)).toEqual([
			"fallback-resolved",
		]);
		expect(readiness.records[0]?.dependencyClass).toBe("material-plan");
		expect(readiness.committedScene.parts).toEqual([part]);
		expect(readiness.metrics.fallbackResolvedCount).toBe(1);
	});

	it("treats texture dependency misses as committed debug fallback resolution", () => {
		const part = createStaticPart({
			materialSlots: [
				{
					slotIndex: 0,
					surfaceId: 0x08000001,
					materialAssetId: "material/08000001",
				},
			],
		});
		const readiness = deriveStaticRenderableReadinessModel({
			assetState: createAssetState([
				createGfxObjRecord(),
				createMaterialRecipeRecord({
					materialAssetId: "material/08000001",
					renderSurfaceAssetIds: ["render-surface/06000001"],
				}),
			]),
			scene: createStaticRenderableScene([part]),
		});

		expect(readiness.records.map(statusKey)).toEqual([
			"fallback-resolved:surface-texture:render-surface/06000001",
		]);
		expect(readiness.committedScene.parts).toEqual([part]);
	});

	it("excludes failed empty geometry from committed output", () => {
		const part = createStaticPart();
		const readiness = deriveStaticRenderableReadinessModel({
			assetState: createAssetState([
				createGfxObjRecord({ vertexCount: 0, triangleCount: 0 }),
			]),
			scene: createStaticRenderableScene([part]),
		});

		expect(readiness.records.map((record) => record.status)).toEqual([
			"failed",
		]);
		expect(readiness.committedScene.parts).toEqual([]);
		expect(readiness.metrics.failedCount).toBe(1);
	});

	it("keeps committed output stable when unrelated assets hydrate", () => {
		const part = createStaticPart();
		const scene = createStaticRenderableScene([part]);
		const first = deriveStaticRenderableReadinessModel({
			assetState: createAssetState([createGfxObjRecord()]),
			scene,
		});
		const second = deriveStaticRenderableReadinessModel({
			assetState: createAssetState([
				createGfxObjRecord(),
				createMaterialRecipeRecord({ materialAssetId: "material/unrelated" }),
			]),
			scene,
		});

		expect(second.committedScene).toEqual(first.committedScene);
		expect(second.metrics.committedPartCount).toBe(1);
	});
});

function statusKey(record: {
	status: StaticRenderableReadinessStatus;
	dependencyClass: string;
	assetId: string | null;
}): string {
	return `${record.status}:${record.dependencyClass}:${record.assetId ?? "none"}`;
}

function createStaticRenderableScene(
	parts: StaticRenderablePart[],
	overrides: Partial<StaticRenderableSceneModel> = {},
): StaticRenderableSceneModel {
	return {
		focusLandblockId: null,
		activeLandblockIds: [0x12340000],
		sourceInstances: [],
		parts,
		partsByRenderGroupKey: new Map([["group/a", parts]]),
		missingSourceAssetIds: [],
		missingGfxAssetIds: [],
		missingSetupAppearanceAssetIds: [],
		...overrides,
	};
}

function createStaticPart(
	overrides: Partial<StaticRenderablePart> = {},
): StaticRenderablePart {
	return {
		renderKey: "static/part-a",
		renderDomain: WORLD_RENDER_DOMAIN.exteriorStatic,
		instanceId: "instance-a",
		sourceAssetId: "gfx-obj/01000001",
		sourceDid: 0x01000001,
		owningLandblockId: 0x12340000,
		regionNumber: 1,
		owningEnvCellId: null,
		renderChunk: {
			chunkKey: "landblock/12340000",
			chunkLandblockId: 0x12340000,
		},
		kind: "scenery",
		partIndex: 0,
		gfxObjId: 0x01000001,
		gfxObjAssetId: "gfx-obj/01000001",
		materialAppearanceContext: createBaseMaterialAppearanceContext("base"),
		materialSlots: [],
		materialSignature: "material:none",
		parentPlacements: [],
		chunkLocalInstancePlacement: {
			origin: { x: 0, y: 0, z: 0 },
			orientation: { w: 1, x: 0, y: 0, z: 0 },
		},
		partPlacements: [],
		scale: { x: 1, y: 1, z: 1 },
		debugColorKey: "static/part-a",
		textureVelocity: null,
		textureVelocitySignature: "uv:none",
		detailRoleKind: "object",
		detailSignature: "detail:none",
		...overrides,
	};
}

function createAssetState(records: PreparedAssetRecord[] = []): AssetChannelState {
	const state = createInitialAssetChannelState();
	state.preparedByAssetId = Object.fromEntries(
		records.map((record) => [record.request.assetId, record]),
	);
	return state;
}

function createGfxObjRecord({
	assetId = "gfx-obj/01000001",
	vertexCount = 3,
	triangleCount = 1,
}: {
	assetId?: string;
	vertexCount?: number;
	triangleCount?: number;
} = {}): PreparedAssetRecord {
	return {
		request: { assetId },
		payload: {
			kind: "gfx-obj",
			renderGeometry: {
				vertexCount,
				triangleCount,
			},
		},
	} as PreparedAssetRecord;
}

function createMaterialRecipeRecord({
	materialAssetId,
	renderSurfaceAssetIds = [],
}: {
	materialAssetId: string;
	renderSurfaceAssetIds?: string[];
}): PreparedAssetRecord {
	return {
		request: { assetId: materialAssetId },
		payload: {
			kind: "material-recipe",
			dependencies: {
				surfaceTextureAssetIds: [],
				renderSurfaceAssetIds,
				paletteAssetIds: [],
			},
		} satisfies Partial<PreparedMaterialRecipePayload>,
	} as PreparedAssetRecord;
}

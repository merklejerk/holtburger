import { describe, expect, it } from "vitest";
import type { TexturePlacementUpdate } from "../renderer/types";
import type {
	StaticCoordinatorCommitDelta,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectVisualResource,
	TerrainGeometryStaticDrawUnit,
} from "../static/contracts";
import { installStaticCommit } from "./static-commit-installer";

describe("static commit installer", () => {
	it("installs committed draw units directly from baker output", () => {
		const drawUnit = createTerrainDrawUnit("terrain-textured", {
			textureUseIds: ["terrain-textured:prepared-texture:06000010"],
		});
		const textureUpdate = createTexturePlacementUpdate(drawUnit);

		const installed = installStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [drawUnit],
			}),
			textureUpdate,
		});

		expect(installed.installedDrawUnits).toEqual([drawUnit]);
		expect(installed.textureUpdate).toBe(textureUpdate);
		expect(installed.removedResources).toEqual([]);
	});

	it("rejects textured draw units without committed texture bindings", () => {
		const drawUnit = createTerrainDrawUnit("terrain-textured", {
			textureUseIds: ["terrain-textured:prepared-texture:06000010"],
		});

		expect(() =>
			installStaticCommit({
				commit: createCommitDelta({
					addedDrawUnits: [drawUnit],
				}),
				textureUpdate: null,
			}),
		).toThrow(
			/terrain-textured is missing committed texture bindings for terrain-textured:prepared-texture:06000010/,
		);
	});

	it("passes static object draw units and peer records through without remapping", () => {
		const drawUnit = createStaticObjectDrawUnit("static-object-a");
		const spatialRecord = drawUnit.spatialRecord;
		if (!spatialRecord) {
			throw new Error(
				"Expected static object fixture to have a spatial record.",
			);
		}
		const textureUpdate = createTexturePlacementUpdate(drawUnit);

		const installed = installStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [drawUnit],
				staticSpatialRecords: [spatialRecord],
			}),
			textureUpdate,
		});

		expect(installed.installedDrawUnits).toEqual([drawUnit]);
		expect(installed.staticSpatialRecords).toEqual([spatialRecord]);
		expect(installed.textureUpdate).toBe(textureUpdate);
	});

	it("preserves static object visual resources and their texture update", () => {
		const drawUnit = createStaticObjectDrawUnit("static-object-a");
		const visualResource = createStaticObjectVisualResource(
			"visual-static-object-a",
			drawUnit,
		);
		const textureUpdate =
			createTexturePlacementUpdateForVisualResource(visualResource);

		const installed = installStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [],
				staticObjectVisualResources: [visualResource],
			}),
			textureUpdate,
		});

		expect(installed.staticObjectVisualResources).toEqual([visualResource]);
		expect(installed.textureUpdate).toBe(textureUpdate);
	});

	it("preserves removed resources without expanding old fine draw-unit ids", () => {
		const removedResources = [
			{ drawUnitId: "static-object-a", kind: "draw-unit" as const },
			{
				apertureResourceId: "portal-aperture-resource:da55ffff",
				kind: "portal-aperture-resource" as const,
			},
		];

		const installed = installStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [],
				removedResources,
			}),
			textureUpdate: null,
		});

		expect(installed.installedDrawUnits).toEqual([]);
		expect(installed.removedResources).toEqual(removedResources);
	});
});

function createCommitDelta(options: {
	readonly addedDrawUnits: readonly StaticDrawUnit[];
	readonly removedResources?: StaticCoordinatorCommitDelta["removedResources"];
	readonly staticObjectVisualResources?: readonly StaticObjectVisualResource[];
	readonly staticSpatialRecords?: StaticCoordinatorCommitDelta["staticSpatialRecords"];
}): StaticCoordinatorCommitDelta {
	return {
		addedDrawUnits: options.addedDrawUnits,
		addedPortalApertureResources: [],
		commitId: "static-commit:batch-a",
		materialCoverage: [],
		removedResources: options.removedResources ?? [],
		revision: 7,
		envCellStaticObjectPlacementRecords: [],
		staticBatchId: "batch-a",
		staticObjectRenderInstances: [],
		staticObjectVisualResources: options.staticObjectVisualResources ?? [],
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: options.staticSpatialRecords ?? [],
		staticVisibilityRecords: [],
		tasks: [],
		textureDependencies: [],
		textureUses: [],
	};
}

function createTerrainDrawUnit(
	drawUnitId: string,
	options: {
		readonly textureUseIds?: readonly string[];
	} = {},
): TerrainGeometryStaticDrawUnit {
	const textureUseIds = options.textureUseIds ?? [];

	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId,
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "terrain-geometry",
		landblockId: 0xda55ffff,
		layerSlots: new Float32Array([0, 0, 0]),
		materialBucketKey:
			textureUseIds.length > 0
				? "shader:terrain-single-base-color"
				: "shader:terrain-debug-flat",
		materialFamily:
			textureUseIds.length > 0
				? "terrain-single-base-color"
				: "terrain-debug-flat",
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
		primaryTextureUseId: textureUseIds[0] ?? null,
		sourceTriangleIds: ["triangle-a"],
		terrainFallbackReasons: [],
		terrainMaterialPlan: null,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds,
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createStaticObjectDrawUnit(
	drawUnitId: string,
): StaticObjectGeometryStaticDrawUnit {
	const textureUseIds = [`${drawUnitId}:prepared-texture:0`];
	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-buildings",
		drawUnitId,
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "static-object-geometry",
		landblockId: 0xda55ffff,
		materialBucketKey: "static-object:test",
		materialEntries: [
			{
				alphaTest: 0,
				detailTextureTiling: 1,
				detailTextureUseId: null,
				indexedClipThreshold: -1,
				indexedTextureFormat: null,
				indexTextureUseId: null,
				materialColor: [1, 1, 1, 1],
				materialEmissiveColor: [0, 0, 0],
				materialIds: [1],
				paletteFirstIndex: 0,
				paletteTextureUseId: null,
				primaryTextureUseId: textureUseIds[0]!,
				primaryTextureWrapMode: "clamp",
				renderState: createOpaqueRenderState(),
				slot: 0,
			},
		],
		materialFamily: "texture-rgba",
		materialIds: [1],
		materialPass: "opaque",
		materialSlotIndices: new Float32Array([0, 0, 0]),
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		renderState: createOpaqueRenderState(),
		sort: {
			bounds: null,
			center: [0, 0, 0],
			objectPartKey: null,
			policy: "depth-writing",
		},
		sourceMappingCoverage: [],
		spatialRecord: {
			drawUnitId,
			kind: "draw-unit-bounds",
			owner: {
				drawUnitId,
				kind: "draw-unit",
			},
			triangleCount: 1,
		},
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds,
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createStaticObjectVisualResource(
	resourceId: string,
	drawUnit: StaticObjectGeometryStaticDrawUnit,
): StaticObjectVisualResource {
	const source = {
		kind: "static-object-source" as const,
		sourceAssetKind: "setup-model" as const,
		sourceDid: 0x02000010,
	};
	const geometry = {
		canonical: {
			gfxObj: {
				kind: "static-object-source" as const,
				sourceAssetKind: "gfx-obj" as const,
				sourceDid: 0x01000020,
			},
			kind: "static-object-canonical-geometry" as const,
			partIndex: 0,
		},
		kind: "static-object-source-geometry" as const,
		source,
	};
	return {
		bounds: null,
		coordinateSpace: "static-object-source-local",
		geometry,
		indexType: drawUnit.indexType,
		indices: drawUnit.indices,
		key: {
			geometry,
			indexType: drawUnit.indexType,
			kind: "static-object-visual-resource-key",
			materialEntries: drawUnit.materialEntries,
			materialFamily: drawUnit.materialFamily,
			materialPass: drawUnit.materialPass,
			renderState: drawUnit.renderState,
			textureUseIds: drawUnit.textureUseIds,
		},
		kind: "static-object-visual-resource",
		materialEntries: drawUnit.materialEntries,
		materialFamily: drawUnit.materialFamily,
		materialPass: drawUnit.materialPass,
		materialSlotIndices: drawUnit.materialSlotIndices,
		positions: drawUnit.positions,
		renderState: drawUnit.renderState,
		resourceId,
		texCoords: drawUnit.texCoords,
		textureUseIds: drawUnit.textureUseIds,
		triangleCount: drawUnit.triangleCount,
		vertexCount: drawUnit.vertexCount,
	};
}

function createOpaqueRenderState(): StaticObjectGeometryStaticDrawUnit["renderState"] {
	return {
		blend: {
			dstFactor: null,
			enabled: false,
			mode: "opaque",
			srcFactor: null,
		},
		depthTest: true,
		depthWrite: true,
	};
}

function createTexturePlacementUpdate(
	drawUnit: StaticDrawUnit,
): TexturePlacementUpdate {
	const textureUseId = drawUnit.textureUseIds[0];
	if (!textureUseId) {
		throw new Error("Texture placement fixture needs a textured draw unit.");
	}

	return {
		textureBindings: [
			{
				owner: { drawUnitId: drawUnit.drawUnitId, kind: "draw-unit" },
				rect: { height: 1, width: 1, x: 0, y: 0 },
				rolePage:
					drawUnit.kind === "terrain-geometry"
						? { kind: "color", slot: 0 }
						: { kind: "object-base-color", slot: 0 },
				textureHeight: 1,
				textureRefId: "texture-ref-a",
				textureUseId,
				textureWidth: 1,
			},
		],
		placements: [],
		removedTextureRefIds: [],
		revision: 3,
		resolvedTexturePlacements: [
			{
				rect: [0, 0, 1, 1],
				textureHeight: 1,
				textureRefId: "texture-ref-a",
				textureUseId,
				textureWidth: 1,
			},
		],
	};
}

function createTexturePlacementUpdateForVisualResource(
	resource: StaticObjectVisualResource,
): TexturePlacementUpdate {
	const textureUseId = resource.textureUseIds[0];
	if (!textureUseId) {
		throw new Error("Texture placement fixture needs a textured resource.");
	}

	return {
		textureBindings: [
			{
				owner: {
					kind: "static-object-visual-resource",
					resourceId: resource.resourceId,
				},
				rect: { height: 1, width: 1, x: 0, y: 0 },
				rolePage: { kind: "object-base-color", slot: 0 },
				textureHeight: 1,
				textureRefId: "texture-ref-a",
				textureUseId,
				textureWidth: 1,
			},
		],
		placements: [],
		removedTextureRefIds: [],
		revision: 3,
		resolvedTexturePlacements: [],
	};
}

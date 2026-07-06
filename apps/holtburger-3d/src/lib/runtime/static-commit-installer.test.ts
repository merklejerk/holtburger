import { describe, expect, it } from "vitest";
import type {
	ResolvedTexturePlacement,
	TexturePlacementUpdate,
} from "../renderer/types";
import type {
	StaticCoordinatorCommitDelta,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StructuredInteriorGeometryStaticDrawUnit,
	TerrainGeometryStaticDrawUnit,
} from "../static/contracts";
import type { TextureResourceDependencies } from "../textures/placement";
import { createTextureBindingId } from "../textures/identity";
import {
	createObjectVisualInstallSet,
	type ObjectVisualDirectDrawUnit,
	type ObjectVisualRenderInstance,
	type ObjectVisualResource,
} from "../visual/object-visual-install-set";
import { installStaticCommit } from "./static-commit-installer";

describe("static commit installer", () => {
	it("installs committed draw units directly from baker output", () => {
		const drawUnit = createTerrainDrawUnit("terrain-textured", {
			textureBindingIds: [
				createFixtureBindingId("terrain-textured:prepared-texture:06000010"),
			],
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

	it("rejects textured draw units without resolved texture placements", () => {
		const drawUnit = createTerrainDrawUnit("terrain-textured", {
			textureBindingIds: [
				createFixtureBindingId("terrain-textured:prepared-texture:06000010"),
			],
		});

		expect(() =>
			installStaticCommit({
				commit: createCommitDelta({
					addedDrawUnits: [drawUnit],
				}),
				textureUpdate: null,
			}),
		).toThrow(
			/terrain-textured is missing resolved texture placements for binding\|/,
		);
	});

	it("accepts textured draw units with pending texture readiness", () => {
		const textureBindingId = createFixtureBindingId(
			"terrain-textured:prepared-texture:06000010",
		);
		const drawUnit = createTerrainDrawUnit("terrain-textured", {
			textureBindingIds: [textureBindingId],
		});

		const installed = installStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [drawUnit],
			}),
			textureReadiness: [{ bindingId: textureBindingId, kind: "pending" }],
			textureUpdate: null,
		});

		expect(installed.installedDrawUnits).toEqual([drawUnit]);
		expect(installed.textureUpdate).toBeNull();
	});

	it("rejects textured draw units with failed texture readiness", () => {
		const textureBindingId = createFixtureBindingId(
			"terrain-textured:prepared-texture:06000010",
		);
		const drawUnit = createTerrainDrawUnit("terrain-textured", {
			textureBindingIds: [textureBindingId],
		});

		expect(() =>
			installStaticCommit({
				commit: createCommitDelta({
					addedDrawUnits: [drawUnit],
				}),
				textureReadiness: [
					{
						bindingId: textureBindingId,
						kind: "failed",
						reason: "fixture failure",
					},
				],
				textureUpdate: null,
			}),
		).toThrow(/terrain-textured has failed texture bindings: binding\|/);
	});

	it("rejects textured structured-interior draw units without resolved texture placements", () => {
		const drawUnit = createStructuredInteriorDrawUnit("structured-interior-a");

		expect(() =>
			installStaticCommit({
				commit: createCommitDelta({
					addedDrawUnits: [drawUnit],
				}),
				textureUpdate: null,
			}),
		).toThrow(
			/structured-interior-a is missing resolved texture placements for binding\|/,
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
		const visualResource = createObjectVisualResource(
			"visual-static-object-a",
			drawUnit,
		);
		const renderInstance = createObjectVisualRenderInstance(
			"instance-static-object-a",
			visualResource.resourceId,
		);
		const textureUpdate =
			createTexturePlacementUpdateForVisualResource(visualResource);
		const textureDependencies: readonly TextureResourceDependencies[] = [
			{
				resourceId: visualResource.resourceId,
				roles: [{ itemIds: ["item-a"], purpose: "object-base-color" }],
			},
		];

		const installed = installStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [],
				objectVisualRenderInstances: [renderInstance],
				objectVisualResources: [visualResource],
				textureDependencies,
			}),
			textureUpdate,
		});

		expect(installed.objectVisualInstallSet).toEqual({
			directDrawUnits: [],
			dynamicAnimationPartBindings: [],
			renderInstances: [renderInstance],
			textureDependencies,
			visualResources: [visualResource],
		});
		expect(installed.textureUpdate).toBe(textureUpdate);
	});

	it("publishes object-like direct draw units separately from terrain", () => {
		const terrainDrawUnit = createTerrainDrawUnit("terrain-a");
		const staticObjectDrawUnit = createStaticObjectDrawUnit("static-object-a");
		const structuredInteriorDrawUnit = createStructuredInteriorDrawUnit(
			"structured-interior-a",
		);
		const textureUpdate = createTexturePlacementUpdateForDrawUnits([
			staticObjectDrawUnit,
			structuredInteriorDrawUnit,
		]);

		const installed = installStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [
					terrainDrawUnit,
					staticObjectDrawUnit,
					structuredInteriorDrawUnit,
				],
			}),
			textureUpdate,
		});

		expect(installed.installedDrawUnits).toEqual([
			terrainDrawUnit,
			staticObjectDrawUnit,
			structuredInteriorDrawUnit,
		]);
		expect(installed.objectVisualInstallSet.directDrawUnits).toEqual([
			staticObjectDrawUnit,
			structuredInteriorDrawUnit,
		]);
	});

	it("rejects textured static object visual resources without resolved texture placements", () => {
		const drawUnit = createStaticObjectDrawUnit("static-object-a");
		const visualResource = createObjectVisualResource(
			"visual-static-object-a",
			drawUnit,
		);

		expect(() =>
			installStaticCommit({
				commit: createCommitDelta({
					addedDrawUnits: [],
					objectVisualResources: [visualResource],
				}),
				textureUpdate: null,
			}),
		).toThrow(
			/visual-static-object-a is missing resolved texture placements for binding\|/,
		);
	});

	it("accepts textured static object visual resources with pending texture readiness", () => {
		const drawUnit = createStaticObjectDrawUnit("static-object-a");
		const visualResource = createObjectVisualResource(
			"visual-static-object-a",
			drawUnit,
		);

		const installed = installStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [],
				objectVisualResources: [visualResource],
			}),
			textureReadiness: visualResource.textureBindingIds.map((bindingId) => ({
				bindingId,
				kind: "pending" as const,
			})),
			textureUpdate: null,
		});

		expect(installed.objectVisualInstallSet.visualResources).toEqual([
			visualResource,
		]);
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
	readonly objectVisualRenderInstances?: readonly ObjectVisualRenderInstance[];
	readonly objectVisualResources?: readonly ObjectVisualResource[];
	readonly removedResources?: StaticCoordinatorCommitDelta["removedResources"];
	readonly staticSpatialRecords?: StaticCoordinatorCommitDelta["staticSpatialRecords"];
	readonly textureDependencies?: readonly TextureResourceDependencies[];
}): StaticCoordinatorCommitDelta {
	const textureDependencies = options.textureDependencies ?? [];
	return {
		addedDrawUnits: options.addedDrawUnits,
		addedPortalApertureResources: [],
		commitId: "static-commit:batch-a",
		materialCoverage: [],
		objectVisualInstallSet: createObjectVisualInstallSet({
			directDrawUnits: options.addedDrawUnits.filter(
				isObjectVisualDirectDrawUnit,
			),
			renderInstances: options.objectVisualRenderInstances ?? [],
			textureDependencies,
			visualResources: options.objectVisualResources ?? [],
		}),
		removedResources: options.removedResources ?? [],
		revision: 7,
		envCellStaticObjectPlacementRecords: [],
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: options.staticSpatialRecords ?? [],
		staticVisibilityRecords: [],
		tasks: [],
		textureDependencies,
		textureUses: [],
	};
}

function isObjectVisualDirectDrawUnit(
	drawUnit: StaticDrawUnit,
): drawUnit is ObjectVisualDirectDrawUnit {
	return (
		drawUnit.kind === "static-object-geometry" ||
		drawUnit.kind === "structured-interior-geometry"
	);
}

function createTerrainDrawUnit(
	drawUnitId: string,
	options: {
		readonly textureBindingIds?: readonly string[];
	} = {},
): TerrainGeometryStaticDrawUnit {
	const textureBindingIds = options.textureBindingIds ?? [];

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
			textureBindingIds.length > 0
				? "shader:terrain-single-base-color"
				: "shader:terrain-debug-flat",
		materialFamily:
			textureBindingIds.length > 0
				? "terrain-single-base-color"
				: "terrain-debug-flat",
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
		primaryTextureBindingId: textureBindingIds[0] ?? null,
		sourceTriangleIds: ["triangle-a"],
		terrainFallbackReasons: [],
		terrainMaterialPlan: null,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureBindingIds,
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createStaticObjectDrawUnit(
	drawUnitId: string,
): StaticObjectGeometryStaticDrawUnit {
	const textureBindingIds = [
		createFixtureBindingId(`${drawUnitId}:prepared-texture:0`),
	];
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
				detailTextureBindingId: null,
				indexedClipThreshold: -1,
				indexedTextureFormat: null,
				indexTextureBindingId: null,
				materialColor: [1, 1, 1, 1],
				materialEmissiveColor: [0, 0, 0],
				materialIds: [1],
				paletteTextureBindingId: null,
				primaryTextureBindingId: textureBindingIds[0]!,
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
		textureBindingIds,
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createObjectVisualResource(
	resourceId: string,
	drawUnit: StaticObjectGeometryStaticDrawUnit,
): ObjectVisualResource {
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
			textureBindingIds: drawUnit.textureBindingIds,
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
		textureBindingIds: drawUnit.textureBindingIds,
		triangleCount: drawUnit.triangleCount,
		vertexCount: drawUnit.vertexCount,
	};
}

function createObjectVisualRenderInstance(
	instanceId: string,
	resourceId: string,
): ObjectVisualRenderInstance {
	return {
		bounds: null,
		domain: "outdoor-explicit-objects",
		generated: null,
		instanceId,
		kind: "static-object-render-instance",
		landblockId: 0xda55ffff,
		resourceId,
		sortCenter: { x: 0, y: 0, z: 0 },
		source: {
			kind: "static-object-instance",
			ordinal: 0,
			source: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x02000010,
			},
		},
		sourceToLandblockMatrix: new Float32Array([
			1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
		]),
		transform: {
			orientation: { w: 1, x: 0, y: 0, z: 0 },
			origin: { x: 0, y: 0, z: 0 },
		},
		transparency: { kind: "depth-writing" },
	};
}

function createStructuredInteriorDrawUnit(
	drawUnitId: string,
): StructuredInteriorGeometryStaticDrawUnit {
	const textureBindingIds = [
		createFixtureBindingId(`${drawUnitId}:prepared-texture:06000010`),
	];
	const renderState = createOpaqueRenderState();

	return {
		cellStructure: {
			cellStructureId: 0x0d000001,
			kind: "cell-structure",
		},
		coordinateSpace: "landblock-render-local",
		domain: "env-cell-system",
		drawUnitId,
		envCellId: 0xda550100,
		environment: {
			environmentId: 0x0e000001,
			kind: "environment",
		},
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "structured-interior-geometry",
		landblockId: 0xda55ffff,
		localPlacement: {
			orientation: { w: 1, x: 0, y: 0, z: 0 },
			origin: { x: 0, y: 0, z: 0 },
		},
		materialBucketKey: "family:texture-rgba|pass:opaque|material:08000010",
		materialEntries: [
			{
				alphaTest: 0,
				detailTextureTiling: 1,
				detailTextureBindingId: null,
				indexedClipThreshold: -1,
				indexedTextureFormat: null,
				indexTextureBindingId: null,
				materialColor: [1, 1, 1, 1],
				materialEmissiveColor: [0, 0, 0],
				materialIds: [0x08000010],
				paletteTextureBindingId: null,
				primaryTextureBindingId: textureBindingIds[0]!,
				primaryTextureWrapMode: "repeat",
				renderState,
				slot: 0,
			},
		],
		materialFamily: "texture-rgba",
		materialIds: [0x08000010],
		materialPass: "opaque",
		materialPlan: [
			{
				diagnostics: [],
				family: "texture-rgba",
				material: {
					kind: "static-material-source",
					materialId: 0x08000010,
				},
				outcome: "rendered",
				pass: "opaque",
				slotId: 0,
				surfaceId: 0x08000010,
				textureBindingIds,
			},
		],
		materialSlotIndices: new Float32Array([0, 0, 0]),
		memberId: "cell-0",
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		renderState,
		sourceTriangleIds: ["triangle-a"],
		surfaceIds: [0x08000010],
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureBindingIds,
		triangleCount: 1,
		vertexCount: 3,
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
	const textureBindingId = drawUnit.textureBindingIds[0];
	if (!textureBindingId) {
		throw new Error("Texture placement fixture needs a textured draw unit.");
	}

	return {
		placements: [],
		removedTextureRefIds: [],
		revision: 3,
		resolvedTexturePlacements: [
			createResolvedTexturePlacement(textureBindingId),
		],
	};
}

function createTexturePlacementUpdateForDrawUnits(
	drawUnits: readonly StaticDrawUnit[],
): TexturePlacementUpdate {
	const updates = drawUnits.map(createTexturePlacementUpdate);
	return {
		placements: [],
		removedTextureRefIds: [],
		revision: 3,
		resolvedTexturePlacements: updates.flatMap(
			(update) => update.resolvedTexturePlacements,
		),
	};
}

function createTexturePlacementUpdateForVisualResource(
	resource: ObjectVisualResource,
): TexturePlacementUpdate {
	const textureBindingId = resource.textureBindingIds[0];
	if (!textureBindingId) {
		throw new Error("Texture placement fixture needs a textured resource.");
	}

	return {
		placements: [],
		removedTextureRefIds: [],
		revision: 3,
		resolvedTexturePlacements: [
			createResolvedTexturePlacement(textureBindingId),
		],
	};
}

function createResolvedTexturePlacement(
	textureBindingId: string,
): ResolvedTexturePlacement {
	const textureRefId = "texture-ref-a";
	return {
		bindingId: textureBindingId,
		pageVersion: {
			placementRevision: 3,
			textureRefId,
		},
		rect: [0, 0, 1, 1],
		textureHeight: 1,
		textureRefId,
		textureBindingId,
		textureWidth: 1,
	};
}

function createFixtureBindingId(slot: string): string {
	return createTextureBindingId({
		resourceId: "static-commit-installer-test",
		role: "object-base-color",
		slot,
	});
}

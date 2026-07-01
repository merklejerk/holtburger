import { describe, expect, it } from "vitest";

import type {
	ObjectVisualBakeResult,
	ObjectVisualBakedRenderPart,
} from "./object-visual-baker";
import { createObjectVisualStaticInstallSet } from "./object-visual-static-publication-baker";
import {
	createObjectVisualPartInstanceIndex,
	createObjectVisualStaticPublicationMetadata,
	createObjectVisualStaticResourceGroupId,
} from "./object-visual-static-publication";

describe("object visual static publication baker", () => {
	it("publishes direct static object draw units from baked render parts and metadata", () => {
		const partInstanceIndex = createObjectVisualPartInstanceIndex(0);
		const renderPart = createRenderPart({
			partInstanceIndices: [partInstanceIndex],
			renderPartId: "fixture:render-part:0",
		});
		const metadata = createObjectVisualStaticPublicationMetadata({
			directStaticObjectDrawUnits: [
				{
					domain: "outdoor-explicit-objects",
					drawUnitIdSeed: "direct-static",
					kind: "static-object-direct-draw-unit",
					landblockId: 0xda55ffff,
					ownership: {
						domain: "outdoor-explicit-objects",
						kind: "outdoor-static-objects",
						landblockId: 0xda55ffff,
					},
					partInstanceIndices: [partInstanceIndex],
					sort: {
						bounds: null,
						center: [0, 0, 0],
						objectPartKey: null,
						policy: "depth-writing",
					},
					sourceMappingCoverage: [],
					spatialRecord: {
						drawUnitId: "stale-seed",
						kind: "draw-unit-bounds",
						owner: {
							drawUnitId: "stale-seed",
							kind: "draw-unit",
						},
						triangleCount: 1,
					},
				},
			],
			partInstanceCount: 1,
		});

		const installSet = createObjectVisualStaticInstallSet({
			bakeResult: createBakeResult([renderPart]),
			metadata,
		});

		expect(installSet.directDrawUnits).toHaveLength(1);
		expect(installSet.directDrawUnits[0]).toMatchObject({
			domain: "outdoor-explicit-objects",
			kind: "static-object-geometry",
			landblockId: 0xda55ffff,
			materialIds: [0x08000001],
			spatialRecord: {
				drawUnitId: "direct-static:fixture-render-part-0:0",
				owner: {
					drawUnitId: "direct-static:fixture-render-part-0:0",
				},
			},
		});
	});

	it("publishes structured-interior draw units with explicit source/material facts", () => {
		const partInstanceIndex = createObjectVisualPartInstanceIndex(0);
		const renderPart = createRenderPart({
			partInstanceIndices: [partInstanceIndex],
			renderPartId: "structured:render-part:0",
		});
		const metadata = createObjectVisualStaticPublicationMetadata({
			partInstanceCount: 1,
			structuredInteriorDrawUnits: [
				{
					cellStructure: {
						cellStructureId: 0x0d000001,
						kind: "cell-structure",
					},
					drawUnitIdSeed: "structured-direct",
					envCellId: 0xda550100,
					environment: {
						environmentId: 0x0e000001,
						kind: "environment",
					},
					kind: "structured-interior-direct-draw-unit",
					landblockId: 0xda55ffff,
					localPlacement: {
						orientation: { w: 1, x: 0, y: 0, z: 0 },
						origin: { x: 0, y: 0, z: 0 },
					},
					materialPlan: [
						{
							diagnostics: [],
							family: "flat-color",
							material: {
								kind: "static-material-source",
								materialId: 0x08000001,
							},
							outcome: "rendered",
							pass: "opaque",
							slotId: 0,
							surfaceId: 12,
							textureUseIds: [],
						},
					],
					memberId: "member-a",
					partInstanceIndices: [partInstanceIndex],
					sourceTriangleIds: ["triangle-a"],
					surfaceIds: [12],
				},
			],
		});

		const installSet = createObjectVisualStaticInstallSet({
			bakeResult: createBakeResult([renderPart]),
			metadata,
		});

		expect(installSet.directDrawUnits[0]).toMatchObject({
			cellStructure: { cellStructureId: 0x0d000001 },
			envCellId: 0xda550100,
			kind: "structured-interior-geometry",
			materialPlan: [{ surfaceId: 12 }],
			memberId: "member-a",
			sourceTriangleIds: ["triangle-a"],
			surfaceIds: [12],
		});
	});

	it("publishes instanced visual resources and render instances from resource group metadata", () => {
		const groupId = createObjectVisualStaticResourceGroupId(0);
		const partInstanceIndex = createObjectVisualPartInstanceIndex(0);
		const renderPart = createRenderPart({
			partInstanceIndices: [partInstanceIndex],
			renderPartId: "instanced:render-part:0",
			sourceLocalPositions: new Float32Array([
				10, 10, 10, 11, 10, 10, 10, 11, 10,
			]),
		});
		const metadata = createObjectVisualStaticPublicationMetadata({
			instancedRenderInstances: [
				{
					bounds: null,
					domain: "outdoor-generated-scenery",
					generated: {
						sceneId: 1,
						sceneTemplateIndex: 2,
						terrainIndex: 3,
					},
					groupId,
					instanceIdSeed: "generated-instance",
					kind: "static-object-instanced-render-instance",
					landblockId: 0xda55ffff,
					partInstanceIndex,
					sortCenter: { x: 0, y: 0, z: 0 },
					source: createStaticObjectIdentity(),
					sourceToLandblockMatrix: createIdentityMatrix(),
					transform: {
						orientation: { w: 1, x: 0, y: 0, z: 0 },
						origin: { x: 0, y: 0, z: 0 },
					},
					transparency: { kind: "depth-writing" },
				},
			],
			instancedResourceGroups: [
				{
					geometry: createGeometryIdentity(),
					groupId,
					kind: "static-object-instanced-resource-group",
					minimumInstanceCount: 1,
					resourceIdSeed: "generated-resource",
					transparentReuseAllowed: false,
				},
			],
			partInstanceCount: 1,
		});

		const installSet = createObjectVisualStaticInstallSet({
			bakeResult: createBakeResult([renderPart]),
			metadata,
		});

		expect(installSet.visualResources).toHaveLength(1);
		expect(installSet.visualResources[0]).toMatchObject({
			coordinateSpace: "static-object-source-local",
			geometry: createGeometryIdentity(),
			kind: "static-object-visual-resource",
		});
		expect([...(installSet.visualResources[0]?.positions ?? [])]).toEqual([
			10, 10, 10, 11, 10, 10, 10, 11, 10,
		]);
		expect(installSet.renderInstances).toHaveLength(1);
		expect(installSet.renderInstances[0]).toMatchObject({
			domain: "outdoor-generated-scenery",
			generated: {
				sceneId: 1,
				sceneTemplateIndex: 2,
				terrainIndex: 3,
			},
			kind: "static-object-render-instance",
			resourceId: installSet.visualResources[0]?.resourceId,
		});
	});

	it("rejects render parts that mix publication metadata groups", () => {
		const first = createObjectVisualPartInstanceIndex(0);
		const second = createObjectVisualPartInstanceIndex(1);
		const metadata = createObjectVisualStaticPublicationMetadata({
			directStaticObjectDrawUnits: [
				{
					domain: "outdoor-explicit-objects",
					drawUnitIdSeed: "direct-static",
					kind: "static-object-direct-draw-unit",
					landblockId: 0xda55ffff,
					ownership: {
						domain: "outdoor-explicit-objects",
						kind: "outdoor-static-objects",
						landblockId: 0xda55ffff,
					},
					partInstanceIndices: [first],
					sort: {
						bounds: null,
						center: [0, 0, 0],
						objectPartKey: null,
						policy: "depth-writing",
					},
					sourceMappingCoverage: [],
					spatialRecord: null,
				},
			],
			partInstanceCount: 2,
		});

		expect(() =>
			createObjectVisualStaticInstallSet({
				bakeResult: createBakeResult([
					createRenderPart({
						partInstanceIndices: [first, second],
						renderPartId: "mixed:render-part:0",
					}),
				]),
				metadata,
			}),
		).toThrow(
			/direct-static cannot publish render part mixed:render-part:0 because it also contains part-instance indices 1/,
		);
	});
});

function createBakeResult(
	renderParts: readonly ObjectVisualBakedRenderPart[],
): ObjectVisualBakeResult {
	return {
		animationPartBindings: [],
		renderParts,
		textureDependencies: [
			{
				resourceId: "resource-a",
				roles: [{ itemIds: ["1"], purpose: "object-base-color" }],
			},
		],
	};
}

function createRenderPart(options: {
	readonly partInstanceIndices: readonly number[];
	readonly renderPartId: string;
	readonly sourceLocalPositions?: Float32Array;
}): ObjectVisualBakedRenderPart {
	const payload = {
		bounds: null,
		indexType: "uint16" as const,
		indices: new Uint16Array([0, 1, 2]),
		materialEntries: [
			{
				alphaTest: 0,
				detailTextureTiling: 1,
				detailTextureUseId: null,
				indexTextureUseId: null,
				indexedClipThreshold: 0,
				indexedTextureFormat: null,
				materialColor: [1, 1, 1, 1] as const,
				materialEmissiveColor: [0, 0, 0] as const,
				materialIds: [0x08000001],
				paletteFirstIndex: 0,
				paletteTextureUseId: null,
				primaryTextureUseId: null,
				primaryTextureWrapMode: "repeat" as const,
				renderState: createRenderState(),
				slot: 0,
			},
		],
		materialFamily: "flat-color" as const,
		materialPass: "opaque" as const,
		materialSlotIndices: new Float32Array([0, 0, 0]),
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		renderState: createRenderState(),
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: [],
		triangleCount: 1,
		vertexCount: 3,
	};
	return {
		...payload,
		instanceIds: options.partInstanceIndices.map(
			(index) => `instance:${index}`,
		),
		partInstanceIndices: options.partInstanceIndices,
		renderPartId: options.renderPartId,
		sourceLocalPayload: {
			...payload,
			positions: options.sourceLocalPositions ?? payload.positions,
		},
		sourcePartIndices: [],
	};
}

function createRenderState() {
	return {
		blend: {
			dstFactor: null,
			enabled: false,
			mode: "opaque" as const,
			srcFactor: null,
		},
		depthTest: true as const,
		depthWrite: true,
	};
}

function createGeometryIdentity() {
	const source = {
		kind: "static-object-source" as const,
		sourceAssetKind: "setup-model" as const,
		sourceDid: 0x02000001,
	};
	return {
		canonical: {
			gfxObj: {
				kind: "static-object-source" as const,
				sourceAssetKind: "gfx-obj" as const,
				sourceDid: 0x01000001,
			},
			kind: "static-object-canonical-geometry" as const,
			partIndex: 0,
		},
		kind: "static-object-source-geometry" as const,
		source,
	};
}

function createStaticObjectIdentity() {
	return {
		instanceId: "generated:a",
		kind: "static-object-instance" as const,
		landblockId: 0xda55ffff,
		objectKind: "generated-scenery" as const,
	};
}

function createIdentityMatrix(): Float32Array {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

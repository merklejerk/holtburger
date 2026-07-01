import { describe, expect, it } from "vitest";

import {
	createObjectVisualPartInstanceIndex,
	createObjectVisualStaticPublicationMetadata,
	createObjectVisualStaticResourceGroupId,
	type ObjectVisualStaticSidecarResidencyMetadata,
} from "./object-visual-static-publication";

describe("object visual static publication metadata", () => {
	it("describes outdoor explicit and env-cell static object direct draw-unit publication facts", () => {
		const explicitIndex = createObjectVisualPartInstanceIndex(0);
		const envCellIndex = createObjectVisualPartInstanceIndex(1);
		const explicit = createDirectStaticObjectMetadata({
			domain: "outdoor-explicit-objects",
			drawUnitIdSeed: "explicit-a",
			ownership: {
				domain: "outdoor-explicit-objects",
				kind: "outdoor-static-objects",
				landblockId: 0xda55ffff,
			},
			partInstanceIndex: explicitIndex,
		});
		const envCell = createDirectStaticObjectMetadata({
			domain: "env-cell-system",
			drawUnitIdSeed: "env-cell-static-a",
			ownership: {
				envCellIds: [0xda550100],
				kind: "env-cell-static-object-placements",
				landblockId: 0xda55ffff,
				seedIdentities: [createStaticObjectIdentity("explicit-object")],
			},
			partInstanceIndex: envCellIndex,
		});

		const metadata = createObjectVisualStaticPublicationMetadata({
			directStaticObjectDrawUnits: [explicit, envCell],
			partInstanceCount: 2,
		});

		expect(metadata.directStaticObjectDrawUnits).toEqual([explicit, envCell]);
		expect(
			metadata.directStaticObjectDrawUnits.map(
				(drawUnit) => drawUnit.partInstanceIndices[0],
			),
		).toEqual([0, 1]);
	});

	it("describes generated-scenery resource groups and render instances without string joins", () => {
		const groupId = createObjectVisualStaticResourceGroupId(3);
		const partInstanceIndex = createObjectVisualPartInstanceIndex(0);
		const metadata = createObjectVisualStaticPublicationMetadata({
			instancedRenderInstances: [
				{
					bounds: createBounds(),
					domain: "outdoor-generated-scenery",
					generated: {
						sceneId: 11,
						sceneTemplateIndex: 2,
						terrainIndex: 7,
					},
					groupId,
					instanceIdSeed: "generated-instance-a",
					kind: "static-object-instanced-render-instance",
					landblockId: 0xda55ffff,
					partInstanceIndex,
					sortCenter: { x: 1, y: 2, z: 3 },
					source: createStaticObjectIdentity("generated-scenery"),
					sourceToLandblockMatrix: createIdentityMatrix(),
					transform: {
						orientation: { w: 1, x: 0, y: 0, z: 0 },
						origin: { x: 1, y: 2, z: 3 },
					},
					transparency: { kind: "depth-writing" },
				},
			],
			instancedResourceGroups: [
				{
					groupId,
					kind: "static-object-instanced-resource-group",
					minimumInstanceCount: 2,
					resourceIdSeed: "generated-resource-a",
					transparentReuseAllowed: false,
				},
			],
			partInstanceCount: 1,
		});

		expect(metadata.instancedResourceGroups[0]?.groupId).toBe(3);
		expect(metadata.instancedRenderInstances[0]?.groupId).toBe(3);
		expect(metadata.instancedRenderInstances[0]?.partInstanceIndex).toBe(0);
	});

	it("describes structured-interior draw-unit facts and keeps sidecar residency independent", () => {
		const partInstanceIndex = createObjectVisualPartInstanceIndex(0);
		const sidecarResidency: ObjectVisualStaticSidecarResidencyMetadata = {
			envCellId: 0xda550100,
			kind: "static-sidecar-residency",
			landblockId: 0xda55ffff,
			owner: createLayerOwner("env-cell-system"),
			partInstanceIndices: [partInstanceIndex],
			sidecarKind: "visibility",
		};

		const metadata = createObjectVisualStaticPublicationMetadata({
			partInstanceCount: 1,
			sidecarResidencies: [sidecarResidency],
			structuredInteriorDrawUnits: [
				{
					cellStructure: {
						cellStructureId: 0x0d000001,
						kind: "cell-structure",
					},
					drawUnitIdSeed: "structured-interior-a",
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
					memberId: "env-cell-member-a",
					partInstanceIndices: [partInstanceIndex],
				},
			],
		});

		expect(metadata.structuredInteriorDrawUnits[0]).toMatchObject({
			envCellId: 0xda550100,
			memberId: "env-cell-member-a",
		});
		expect(metadata.sidecarResidencies).toEqual([sidecarResidency]);
	});

	it("rejects metadata that references missing part instances", () => {
		expect(() =>
			createObjectVisualStaticPublicationMetadata({
				directStaticObjectDrawUnits: [
					createDirectStaticObjectMetadata({
						domain: "outdoor-explicit-objects",
						drawUnitIdSeed: "explicit-a",
						ownership: {
							domain: "outdoor-explicit-objects",
							kind: "outdoor-static-objects",
							landblockId: 0xda55ffff,
						},
						partInstanceIndex: createObjectVisualPartInstanceIndex(2),
					}),
				],
				partInstanceCount: 2,
			}),
		).toThrow(
			/Direct static object draw unit explicit-a references part-instance index 2, but only 2 part instances exist/,
		);
	});

	it("rejects generated-scenery render instances without a resource group", () => {
		expect(() =>
			createObjectVisualStaticPublicationMetadata({
				instancedRenderInstances: [
					{
						bounds: createBounds(),
						domain: "outdoor-generated-scenery",
						generated: null,
						groupId: createObjectVisualStaticResourceGroupId(9),
						instanceIdSeed: "generated-instance-a",
						kind: "static-object-instanced-render-instance",
						landblockId: 0xda55ffff,
						partInstanceIndex: createObjectVisualPartInstanceIndex(0),
						sortCenter: { x: 0, y: 0, z: 0 },
						source: createStaticObjectIdentity("generated-scenery"),
						sourceToLandblockMatrix: createIdentityMatrix(),
						transform: {
							orientation: { w: 1, x: 0, y: 0, z: 0 },
							origin: { x: 0, y: 0, z: 0 },
						},
						transparency: { kind: "depth-writing" },
					},
				],
				partInstanceCount: 1,
			}),
		).toThrow(
			/Static object render instance generated-instance-a references missing resource group 9/,
		);
	});
});

function createDirectStaticObjectMetadata(options: {
	readonly domain: "env-cell-system" | "outdoor-explicit-objects";
	readonly drawUnitIdSeed: string;
	readonly ownership:
		| {
				readonly domain: "outdoor-explicit-objects";
				readonly kind: "outdoor-static-objects";
				readonly landblockId: number;
		  }
		| {
				readonly envCellIds: readonly number[];
				readonly kind: "env-cell-static-object-placements";
				readonly landblockId: number;
				readonly seedIdentities: readonly ReturnType<
					typeof createStaticObjectIdentity
				>[];
		  };
	readonly partInstanceIndex: ReturnType<
		typeof createObjectVisualPartInstanceIndex
	>;
}) {
	return {
		domain: options.domain,
		drawUnitIdSeed: options.drawUnitIdSeed,
		kind: "static-object-direct-draw-unit" as const,
		landblockId: 0xda55ffff,
		ownership: options.ownership,
		partInstanceIndices: [options.partInstanceIndex],
		sort: {
			bounds: createBounds(),
			center: [0, 0, 0] as const,
			objectPartKey: null,
			policy: "depth-writing" as const,
		},
		sourceMappingCoverage: [
			{
				geometrySurfaceIds: [1],
				gfxObj: {
					kind: "static-object-source",
					sourceAssetKind: "gfx-obj",
					sourceDid: 0x01000001,
				},
				materialIds: [0x08000001],
				materialSlot: 0,
				materialVariantSignatures: [null],
				object: createStaticObjectIdentity("explicit-object"),
				partIndex: 0,
				polygonCount: 1,
				polygonRange: { max: 1, min: 1 },
				source: {
					kind: "static-object-source",
					sourceAssetKind: "setup-model",
					sourceDid: 0x02000001,
				},
				sourceTriangleCount: 1,
			},
		],
		spatialRecord: {
			drawUnitId: options.drawUnitIdSeed,
			kind: "draw-unit-bounds" as const,
			owner: {
				drawUnitId: options.drawUnitIdSeed,
				kind: "draw-unit" as const,
			},
			triangleCount: 1,
		},
	};
}

function createLayerOwner(domain: "env-cell-system") {
	return {
		domain,
		key: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		kind: "layer-owner" as const,
		ownerId: `${domain}:0xda55ffff`,
	};
}

function createStaticObjectIdentity(
	objectKind: "explicit-object" | "generated-scenery",
) {
	return {
		instanceId: `${objectKind}:a`,
		kind: "static-object-instance" as const,
		landblockId: 0xda55ffff,
		objectKind,
	};
}

function createBounds() {
	return {
		max: { x: 1, y: 1, z: 1 },
		min: { x: 0, y: 0, z: 0 },
	};
}

function createIdentityMatrix(): Float32Array {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

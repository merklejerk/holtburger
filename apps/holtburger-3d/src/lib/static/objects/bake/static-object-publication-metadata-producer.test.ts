import { describe, expect, it } from "vitest";

import {
	objectVisualGeometryBufferId,
	type ObjectVisualGeometryBuffer,
} from "../../../visual/object-visual-recipe-bundle";
import { bakeObjectVisuals } from "../../../visual/object-visual-baker";
import { createObjectVisualStaticInstallSet } from "../../../visual/object-visual-static-publication-baker";
import type {
	StaticLayerPeerRecordOwner,
	StaticObjectInstanceIdentity,
	StaticObjectSourceIdentity,
} from "../../contracts";
import { createStaticObjectSourceGeometryIdentity } from "../static-object-source-assets";
import type { StaticObjectBatchPayload } from "./static-object-batch-partitioner";
import { createStaticObjectPublicationMetadata } from "./static-object-publication-metadata-producer";
import { createStaticObjectVisualBundleExpansion } from "./static-object-visual-bundle-producer";

const TEST_LANDBLOCK_ID = 0xda55ffff;
const TEST_SOURCE: StaticObjectSourceIdentity = {
	kind: "static-object-source",
	sourceAssetKind: "gfx-obj",
	sourceDid: 0x01000001,
};
const TEST_GEOMETRY = createStaticObjectSourceGeometryIdentity({
	gfxObj: TEST_SOURCE,
	partIndex: 0,
	source: TEST_SOURCE,
});

describe("static object publication metadata producer", () => {
	it("publishes direct static object metadata through the shared install bridge", () => {
		const payload = createPayload({
			objectKind: "explicit-object",
		});
		const expansion = createStaticObjectVisualBundleExpansion({
			attachments: { staticObjectSourceGeometry: [createGeometryAttachment()] },
			payload,
		});
		expect(expansion.resolution.kind).toBe("ready");
		if (expansion.resolution.kind !== "ready") {
			throw new Error("Expected ready visual bundle.");
		}
		const publication = createStaticObjectPublicationMetadata({
			owner: createOwner("outdoor-explicit-objects"),
			payload,
		});
		const bake = bakeObjectVisuals({
			bundle: expansion.resolution.bundle,
			geometryBuffers: expansion.geometryBuffers,
			renderPartIdPrefix: "direct-static-publication-fixture",
		});
		const installSet = createObjectVisualStaticInstallSet({
			bakeResult: bake,
			metadata: publication.metadata,
		});

		expect(publication.metadata.directStaticObjectDrawUnits).toHaveLength(1);
		expect(publication.metadata.instancedRenderInstances).toEqual([]);
		expect(installSet.directDrawUnits).toHaveLength(1);
		expect(installSet.visualResources).toEqual([]);
		expect(installSet.directDrawUnits[0]).toMatchObject({
			domain: "outdoor-explicit-objects",
			kind: "static-object-geometry",
			landblockId: TEST_LANDBLOCK_ID,
		});
		expect(
			publication.metadata.directStaticObjectDrawUnits[0]
				?.sourceMappingCoverage[0],
		).toMatchObject({
			geometrySurfaceIds: [1],
			materialIds: [0x08000001],
			polygonRange: { max: 7, min: 7 },
			sourceTriangleCount: 1,
		});
	});

	it("publishes generated scenery as resource-group and render-instance metadata", () => {
		const payload = createPayload({
			objectKind: "generated-scenery",
		});
		const expansion = createStaticObjectVisualBundleExpansion({
			attachments: { staticObjectSourceGeometry: [createGeometryAttachment()] },
			payload,
		});
		expect(expansion.resolution.kind).toBe("ready");
		if (expansion.resolution.kind !== "ready") {
			throw new Error("Expected ready visual bundle.");
		}
		const publication = createStaticObjectPublicationMetadata({
			owner: createOwner("outdoor-generated-scenery"),
			payload,
		});
		const bake = bakeObjectVisuals({
			bundle: expansion.resolution.bundle,
			geometryBuffers: expansion.geometryBuffers,
			partitionKeyByPartInstanceIndex: new Map([[0, "generated:0"]]),
			renderPartIdPrefix: "generated-static-publication-fixture",
		});
		const installSet = createObjectVisualStaticInstallSet({
			bakeResult: bake,
			metadata: publication.metadata,
		});

		expect(publication.metadata.directStaticObjectDrawUnits).toEqual([]);
		expect(publication.metadata.instancedResourceGroups).toHaveLength(1);
		expect(publication.metadata.instancedRenderInstances).toHaveLength(1);
		expect(installSet.visualResources).toHaveLength(1);
		expect(installSet.renderInstances).toHaveLength(1);
		expect(installSet.renderInstances[0]).toMatchObject({
			domain: "outdoor-generated-scenery",
			generated: {
				sceneId: 1,
				sceneTemplateIndex: 2,
				terrainIndex: 3,
			},
			kind: "static-object-render-instance",
		});
	});

	it("publishes env-cell static objects as direct metadata with env-cell ownership", () => {
		const payload = createPayload({
			domain: "env-cell-system",
			instanceId: "da550100:static-object:0",
			objectKind: "explicit-object",
			owningEnvCellId: 0xda550100,
		});
		const publication = createStaticObjectPublicationMetadata({
			owner: createOwner("env-cell-system"),
			payload,
		});

		expect(
			publication.metadata.directStaticObjectDrawUnits[0]?.ownership,
		).toEqual({
			envCellIds: [0xda550100],
			kind: "env-cell-static-object-placements",
			landblockId: TEST_LANDBLOCK_ID,
			seedIdentities: [payload.objects[0]?.identity],
		});
		expect(
			publication.metadata.directStaticObjectDrawUnits[0]?.spatialRecord,
		).toMatchObject({
			envCellId: 0xda550100,
			kind: "env-cell-static-object-bounds",
			landblockId: TEST_LANDBLOCK_ID,
		});
	});

	it("publishes mixed direct and generated metadata from one payload", () => {
		const explicit = createPayload({
			instanceId: "explicit-object:0",
			objectKind: "explicit-object",
		});
		const generated = createPayload({
			instanceId: "generated-scenery:0",
			objectKind: "generated-scenery",
		});
		const payload: StaticObjectBatchPayload = {
			...explicit,
			domain: "outdoor-generated-scenery",
			materialSlots: [...explicit.materialSlots, ...generated.materialSlots],
			objects: [...explicit.objects, ...generated.objects],
		};

		const publication = createStaticObjectPublicationMetadata({
			owner: createOwner("outdoor-generated-scenery"),
			payload,
		});

		expect(publication.metadata.directStaticObjectDrawUnits).toHaveLength(1);
		expect(publication.metadata.instancedResourceGroups).toHaveLength(1);
		expect(publication.metadata.instancedRenderInstances).toHaveLength(1);
		expect([...publication.partInstanceIndexByKey.values()]).toEqual([0, 1]);
	});
});

function createPayload(options: {
	readonly domain?: StaticObjectBatchPayload["domain"];
	readonly instanceId?: string;
	readonly objectKind: StaticObjectInstanceIdentity["objectKind"];
	readonly owningEnvCellId?: number | null;
}): StaticObjectBatchPayload {
	const object: StaticObjectInstanceIdentity = {
		instanceId: options.instanceId ?? `${options.objectKind}:0`,
		kind: "static-object-instance",
		landblockId: TEST_LANDBLOCK_ID,
		objectKind: options.objectKind,
	};
	return {
		domain:
			options.domain ??
			(options.objectKind === "generated-scenery"
				? "outdoor-generated-scenery"
				: "outdoor-explicit-objects"),
		landblock: {
			kind: "landblock-source",
			landblockId: TEST_LANDBLOCK_ID,
			source: options.domain === "env-cell-system" ? "env-cells" : "outdoor",
		},
		materialSlots: [
			{
				gfxObj: TEST_SOURCE,
				identity: {
					geometrySurfaceId: 1,
					kind: "static-material-slot",
					materialSurfaceId: 1,
					part: {
						kind: "static-object-part",
						object,
						partIndex: 0,
					},
					slotIndex: 0,
				},
				material: {
					kind: "static-material-source",
					materialId: 0x08000001,
				},
				materialVariantSignature: null,
				object,
				paletteOverride: null,
				paletteViews: [],
				source: TEST_SOURCE,
			},
		],
		materialSources: [
			{
				diffuse: 1,
				identity: {
					kind: "static-material-source",
					materialId: 0x08000001,
				},
				luminosity: 0,
				source: {
					argb: 0xff336699,
					kind: "solid-color",
				},
				surfaceId: 1,
				surfaceType: 0,
				translucency: 0,
			},
		],
		objects: [
			{
				debug: { sourceAssetId: "gfx-obj:01000001" },
				generated:
					options.objectKind === "generated-scenery"
						? {
								sceneId: 1,
								sceneTemplateIndex: 2,
								terrainIndex: 3,
							}
						: null,
				identity: object,
				instanceBounds: createBounds(2, 3, 4),
				localPlacement: {
					orientation: { w: 1, x: 0, y: 0, z: 0 },
					origin: { x: 2, y: -4, z: 3 },
				},
				owningEnvCellId: options.owningEnvCellId,
				portalCount: 0,
				source: TEST_SOURCE,
				sourceBounds: createBounds(0, 0, 0),
				sourceIndex: 0,
				sourceScale: { x: 1, y: 1, z: 1 },
			},
		],
		paletteSources: [],
		regionRenderProfile: { detailRoles: [] },
		sourceAssets: [
			{
				bounds: createBounds(0, 0, 0),
				debug: { sourceAssetId: "gfx-obj:01000001" },
				defaultAnimation: null,
				identity: TEST_SOURCE,
				invalidPolygonCount: 0,
				materialSlotCount: 1,
				partCount: 1,
				parts: [
					{
						bounds: createBounds(0, 0, 0),
						defaultPlacements: [],
						geometry: TEST_GEOMETRY,
						gfxObj: TEST_SOURCE,
						invalidPolygonCount: 0,
						materialSlotCount: 1,
						materialSlots: [
							{
								geometrySurfaceId: 1,
								material: {
									kind: "static-material-source",
									materialId: 0x08000001,
								},
								materialSurfaceId: 1,
								materialVariantSignature: null,
								paletteOverride: null,
								paletteViews: [],
								slotIndex: 0,
							},
						],
						partIndex: 0,
						physicsPolygonCount: 0,
						renderTriangleCount: 1,
						scale: { x: 1, y: 1, z: 1 },
						skippedPolygonCount: 0,
						source: TEST_SOURCE,
						triangles: [
							{
								firstVertex: 0,
								geometrySurfaceId: 1,
								materialVariantSignature: null,
								polygonId: 7,
							},
						],
					},
				],
				physicsPolygonCount: 0,
				renderTriangleCount: 1,
				skippedPolygonCount: 0,
				sourceAssetKind: "gfx-obj",
			},
		],
		textureRefs: [],
	};
}

function createOwner(
	domain: StaticLayerPeerRecordOwner["domain"],
): StaticLayerPeerRecordOwner {
	return {
		domain,
		key:
			domain === "env-cell-system"
				? {
						kind: "env-cell-system",
						landblockId: TEST_LANDBLOCK_ID,
					}
				: {
						domain,
						kind: "outdoor-static-objects",
						landblockId: TEST_LANDBLOCK_ID,
					},
		ownerId: `${domain}:${TEST_LANDBLOCK_ID}`,
		kind: "layer-owner",
	};
}

function createGeometryAttachment() {
	return {
		buffer: createGeometryBuffer(),
		identity: TEST_GEOMETRY.canonical,
	};
}

function createGeometryBuffer(): ObjectVisualGeometryBuffer {
	return {
		bounds: createBounds(0, 0, 0),
		bufferId: objectVisualGeometryBufferId(0),
		coordinateSpace: "source-local",
		normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		triangleCount: 1,
		triangles: [
			{
				firstVertex: 0,
				materialVariantSignature: null,
				polygonId: 7,
				surfaceId: 1,
			},
		],
		vertexCount: 3,
	};
}

function createBounds(x: number, y: number, z: number) {
	return {
		max: { x: x + 1, y: y + 1, z: z + 1 },
		min: { x, y, z },
	};
}

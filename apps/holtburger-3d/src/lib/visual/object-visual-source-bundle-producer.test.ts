import { describe, expect, it, vi } from "vitest";

import {
	OBJECT_VISUAL_BASE_MATERIAL_VARIANT_SIGNATURE,
	objectVisualGeometryBufferId,
	type ObjectVisualGeometryBuffer,
} from "./object-visual-recipe-bundle";
import { bakeObjectVisuals } from "./object-visual-baker";
import type {
	StaticObjectInstanceIdentity,
	StaticObjectSourceIdentity,
} from "../static/contracts";
import { createStaticObjectSourceGeometryIdentity } from "../static/objects/static-object-source-assets";
import type { ObjectVisualSourcePayload } from "./object-visual-source-payload";
import { createObjectVisualSourceBundleExpansion } from "./object-visual-source-bundle-producer";

const TEST_LANDBLOCK_ID = 0xda55ffff;
const TEST_SOURCE: StaticObjectSourceIdentity = {
	kind: "static-object-source",
	sourceAssetKind: "gfx-obj",
	sourceDid: 0x01000001,
};
const TEST_OBJECT: StaticObjectInstanceIdentity = {
	instanceId: "static-object:0",
	kind: "static-object-instance",
	landblockId: TEST_LANDBLOCK_ID,
	objectKind: "explicit-object",
};
const TEST_GEOMETRY = createStaticObjectSourceGeometryIdentity({
	gfxObj: TEST_SOURCE,
	partIndex: 0,
	source: TEST_SOURCE,
});

describe("object visual source bundle producer", () => {
	it("expands static object source facts into a ready object visual bundle", () => {
		const payload = createPayload();
		const result = createObjectVisualSourceBundleExpansion({
			geometrySidecars: {
				staticObjectSourceGeometry: [createGeometrySidecar()],
			},
			payload,
		});

		expect(result.resolution.kind).toBe("ready");
		if (result.resolution.kind !== "ready") {
			throw new Error("Expected ready visual bundle.");
		}
		expect(result.geometryBuffers.size).toBe(1);
		expect(result.resolution.bundle.partInstances).toHaveLength(1);
		expect(result.resolution.bundle.partInstances[0]?.residency).toEqual({
			kind: "outdoor-landblock",
			landblockId: TEST_LANDBLOCK_ID,
		});

		const bake = bakeObjectVisuals({
			bundle: result.resolution.bundle,
			geometryBuffers: result.geometryBuffers,
			renderPartIdPrefix: "static-object-fixture",
		});

		expect(bake.renderParts).toHaveLength(1);
		expect(bake.renderParts[0]?.materialFamily).toBe("flat-color");
		expect([...bake.renderParts[0]!.positions.slice(0, 9)]).toEqual([
			2, 3, 4, 3, 3, 4, 2, 4, 4,
		]);
	});

	it("returns missing dependencies when source geometry sidecars are absent", () => {
		const result = createObjectVisualSourceBundleExpansion({
			geometrySidecars: { staticObjectSourceGeometry: [] },
			payload: createPayload(),
		});

		expect(result.geometryBuffers.size).toBe(0);
		expect(result.resolution).toMatchObject({
			kind: "missing-dependencies",
			missingDependencies: [{ sourceKind: "static-object-source-geometry" }],
		});
	});

	it("ignores unrelated geometry resources in the same job resource set", () => {
		const unrelatedSource: StaticObjectSourceIdentity = {
			kind: "static-object-source",
			sourceAssetKind: "gfx-obj",
			sourceDid: 0x01000002,
		};
		const unrelatedGeometry = createStaticObjectSourceGeometryIdentity({
			gfxObj: unrelatedSource,
			partIndex: 0,
			source: unrelatedSource,
		});

		const result = createObjectVisualSourceBundleExpansion({
			geometrySidecars: {
				staticObjectSourceGeometry: [
					createGeometrySidecar(),
					{
						buffer: createGeometryBuffer(),
						identity: unrelatedGeometry.canonical,
					},
				],
			},
			payload: createPayload(),
		});

		expect(result.resolution.kind).toBe("ready");
		expect(result.geometryBuffers.size).toBe(1);
	});

	it("uses env-cell residency for env-cell static object payloads", () => {
		const payload = createPayload({
			domain: "env-cell-system",
			object: {
				...TEST_OBJECT,
				instanceId: "env-cell:static-object:0",
			},
			owningEnvCellId: 0xda550100,
		});
		const result = createObjectVisualSourceBundleExpansion({
			geometrySidecars: {
				staticObjectSourceGeometry: [createGeometrySidecar()],
			},
			payload,
		});

		expect(result.resolution.kind).toBe("ready");
		if (result.resolution.kind !== "ready") {
			throw new Error("Expected ready visual bundle.");
		}
		expect(result.resolution.bundle.partInstances[0]?.residency).toEqual({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: TEST_LANDBLOCK_ID,
		});
	});

	it("keeps material recipe variants distinct by texture wrap mode", () => {
		const result = createObjectVisualSourceBundleExpansion({
			geometrySidecars: {
				staticObjectSourceGeometry: [createGeometrySidecar()],
			},
			payload: createPayload({
				materialVariantSignature: "sampler=repeat",
			}),
		});

		expect(result.resolution.kind).toBe("ready");
		if (result.resolution.kind !== "ready") {
			throw new Error("Expected ready visual bundle.");
		}
		expect(
			[...result.resolution.bundle.materialRecipes.values()][0],
		).toMatchObject({
			family: "direct-color",
			primaryTextureWrapMode: "repeat",
		});
	});

	it("merges repeated surface material bindings into one binding", () => {
		const polygonIds = [7, 8];
		const result = createObjectVisualSourceBundleExpansion({
			geometrySidecars: {
				staticObjectSourceGeometry: [
					createGeometrySidecar({
						materialVariantSignature: "sampler=repeat",
						polygonIds,
					}),
				],
			},
			payload: createPayload({
				materialVariantSignature: "sampler=repeat",
				polygonIds,
			}),
		});

		expect(result.resolution.kind).toBe("ready");
		if (result.resolution.kind !== "ready") {
			throw new Error("Expected ready visual bundle.");
		}
		const partRecipe = [...result.resolution.bundle.partRecipes.values()][0];
		expect(partRecipe?.materialBindings).toMatchObject([
			{
				geometrySurfaceId: 1,
				materialVariantSignature: "sampler=repeat",
				polygonIds,
			},
		]);

		const bake = bakeObjectVisuals({
			bundle: result.resolution.bundle,
			geometryBuffers: result.geometryBuffers,
			renderPartIdPrefix: "merged-binding-static-object-fixture",
		});
		expect(bake.renderParts[0]?.triangleCount).toBe(2);
	});

	it("maps unsupported materials to skipped unsupported recipes", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const result = createObjectVisualSourceBundleExpansion({
			geometrySidecars: {
				staticObjectSourceGeometry: [createGeometrySidecar()],
			},
			payload: createPayload({ surfaceType: 0x20000 }),
		});

		try {
			expect(result.resolution.kind).toBe("ready");
			if (result.resolution.kind !== "ready") {
				throw new Error("Expected ready visual bundle.");
			}
			expect(
				[...result.resolution.bundle.materialRecipes.values()][0],
			).toMatchObject({
				family: "unsupported",
			});

			const bake = bakeObjectVisuals({
				bundle: result.resolution.bundle,
				geometryBuffers: result.geometryBuffers,
				renderPartIdPrefix: "unsupported-static-object-fixture",
			});

			expect(bake.renderParts).toEqual([]);
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});

function createPayload(
	options: {
		readonly domain?: ObjectVisualSourcePayload["domain"];
		readonly materialVariantSignature?: string | null;
		readonly object?: StaticObjectInstanceIdentity;
		readonly owningEnvCellId?: number | null;
		readonly polygonIds?: readonly number[];
		readonly surfaceType?: number;
	} = {},
): ObjectVisualSourcePayload {
	const object = options.object ?? TEST_OBJECT;
	const materialVariantSignature = options.materialVariantSignature ?? null;
	const polygonIds = options.polygonIds ?? [7];
	return {
		domain: options.domain ?? "outdoor-explicit-objects",
		landblock: {
			kind: "landblock-source",
			landblockId: TEST_LANDBLOCK_ID,
			source: "outdoor",
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
				materialVariantSignature,
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
				surfaceType: options.surfaceType ?? 0,
				translucency: 0,
			},
		],
		objects: [
			{
				debug: { sourceAssetId: "gfx-obj:01000001" },
				generated: null,
				identity: object,
				instanceBounds: null,
				localPlacement: {
					orientation: { w: 1, x: 0, y: 0, z: 0 },
					origin: { x: 2, y: -4, z: 3 },
				},
				owningEnvCellId: options.owningEnvCellId,
				portalCount: 0,
				source: TEST_SOURCE,
				sourceBounds: null,
				sourceIndex: 0,
				sourceScale: { x: 1, y: 1, z: 1 },
			},
		],
		paletteSources: [],
		regionRenderProfile: { detailRoles: [] },
		sourceAssets: [
			{
				bounds: null,
				debug: { sourceAssetId: "gfx-obj:01000001" },
				defaultAnimation: null,
				identity: TEST_SOURCE,
				invalidPolygonCount: 0,
				materialSlotCount: 1,
				partCount: 1,
				parts: [
					{
						bounds: null,
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
								materialVariantSignature,
								paletteOverride: null,
								paletteViews: [],
								slotIndex: 0,
							},
						],
						partIndex: 0,
						physicsPolygonCount: 0,
						renderTriangleCount: polygonIds.length,
						scale: { x: 1, y: 1, z: 1 },
						skippedPolygonCount: 0,
						source: TEST_SOURCE,
						triangles: polygonIds.map((polygonId, index) => ({
							firstVertex: index * 3,
							geometrySurfaceId: 1,
							materialVariantSignature,
							polygonId,
						})),
					},
				],
				physicsPolygonCount: 0,
				renderTriangleCount: polygonIds.length,
				skippedPolygonCount: 0,
				sourceAssetKind: "gfx-obj",
			},
		],
		textureRefs: [],
	};
}

function createGeometrySidecar(
	options: {
		readonly materialVariantSignature?: string;
		readonly polygonIds?: readonly number[];
	} = {},
) {
	return {
		buffer: createGeometryBuffer(options),
		identity: TEST_GEOMETRY.canonical,
	};
}

function createGeometryBuffer(
	options: {
		readonly materialVariantSignature?: string;
		readonly polygonIds?: readonly number[];
	} = {},
): ObjectVisualGeometryBuffer {
	const polygonIds = options.polygonIds ?? [7];
	const materialVariantSignature =
		options.materialVariantSignature ??
		OBJECT_VISUAL_BASE_MATERIAL_VARIANT_SIGNATURE;
	return {
		bounds: null,
		bufferId: objectVisualGeometryBufferId(0),
		coordinateSpace: "source-local",
		normals: new Float32Array(
			polygonIds.flatMap(() => [0, 0, 1, 0, 0, 1, 0, 0, 1]),
		),
		positions: new Float32Array(
			polygonIds.flatMap(() => [0, 0, 0, 1, 0, 0, 0, 1, 0]),
		),
		texCoords: new Float32Array(polygonIds.flatMap(() => [0, 0, 1, 0, 0, 1])),
		triangleCount: polygonIds.length,
		triangles: polygonIds.map((polygonId, index) => ({
			firstVertex: index * 3,
			materialVariantSignature,
			polygonId,
			surfaceId: 1,
		})),
		vertexCount: polygonIds.length * 3,
	};
}

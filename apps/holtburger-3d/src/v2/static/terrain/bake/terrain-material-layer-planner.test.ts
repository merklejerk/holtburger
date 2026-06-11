import { describe, expect, it } from "vitest";
import type {
	SurfaceTextureIdentity,
	TerrainStaticScopePayload,
	TerrainTextureUseFacts,
} from "../../contracts";
import { buildTerrainMaterialLayerPlan } from "./terrain-material-layer-planner";

describe("V2 terrain material layer planner", () => {
	it("selects repeated-corner terrain base and rotated overlay alpha", () => {
		const payload = createTerrainPayload({
			pcodes: [encodeTerrainPcode([1, 1, 2, 2])],
			terrainAlphaSelectors: [
				{ alphaIndex: 4, selector: 3, textureId: 0x05000102 },
			],
		});

		const plan = requirePlan(payload);

		expect(plan.layerEntries).toEqual([
			expect.objectContaining({
				allRoad: false,
				base: expect.objectContaining({
					texture: surfaceTexture(0x05000101),
					textureUseId: "terrain-base:05000101",
					tiling: 2,
					wrap: "repeat",
				}),
				overlays: [
					expect.objectContaining({
						alpha: expect.objectContaining({
							role: "terrain-alpha",
							texture: surfaceTexture(0x05000102),
							textureUseId: "terrain-alpha:05000102",
							wrap: "clamp",
						}),
						rotation: 2,
						terrain: expect.objectContaining({
							texture: surfaceTexture(0x05000111),
						}),
					}),
				],
				pcode: encodeTerrainPcode([1, 1, 2, 2]),
			}),
		]);
		expect(plan.fallbackReasons).toEqual([]);
	});

	it("treats all-road pcodes as road terrain base", () => {
		const payload = createTerrainPayload({
			pcodes: [encodeTerrainPcode([1, 2, 2, 1]) | 0x0ff0_0000],
		});

		const plan = requirePlan(payload);

		expect(plan.layerEntries).toEqual([
			expect.objectContaining({
				allRoad: true,
				base: expect.objectContaining({
					texture: surfaceTexture(0x05000121),
				}),
				overlays: [],
				roads: [],
			}),
		]);
	});

	it("selects split road alpha masks and rotations", () => {
		const pcode = encodeTerrainPcode([1, 1, 1, 1]) | 0x03f0_0000;
		const payload = createTerrainPayload({
			pcodes: [pcode],
			roadAlphaSelectors: [
				{ alphaTextureId: 0x05000202, roadTextureId: 0x05000201, selector: 6 },
				{ alphaTextureId: 0x05000203, roadTextureId: 0x05000201, selector: 3 },
			],
		});

		const plan = requirePlan(payload);

		expect(plan.layerEntries[0]?.roads).toEqual([
			expect.objectContaining({
				alpha: expect.objectContaining({
					texture: surfaceTexture(0x05000202),
					textureUseId: "road-alpha:05000202",
				}),
				road: expect.objectContaining({
					texture: surfaceTexture(0x05000201),
					textureUseId: "road:05000201",
				}),
				rotation: 0,
			}),
			expect.objectContaining({
				alpha: expect.objectContaining({
					texture: surfaceTexture(0x05000202),
				}),
				rotation: 1,
			}),
		]);
	});

	it("records layer overflow as slices and a typed fallback reason", () => {
		const payload = createTerrainPayload({
			pcodes: [
				encodeTerrainPcode([1, 1, 1, 1]),
				encodeTerrainPcode([2, 2, 2, 2]),
				encodeTerrainPcode([3, 3, 3, 3]),
			],
		});

		const plan = buildTerrainMaterialLayerPlan({
			createTextureUseId,
			maxLayerEntries: 2,
			payload,
		});

		expect(plan?.drawSlices).toEqual([
			expect.objectContaining({
				layerSlots: [0, 1],
				reason: "terrain material layer overflow slice 1",
			}),
			expect.objectContaining({
				layerSlots: [2],
				reason: "terrain material layer overflow slice 2",
			}),
		]);
		expect(plan?.fallbackReasons).toEqual([
			expect.objectContaining({
				code: "layer-overflow",
			}),
		]);
	});

	it("reports missing texture uses without host route strings", () => {
		const payload = createTerrainPayload({
			includeTextureUses: false,
			pcodes: [encodeTerrainPcode([1, 1, 1, 1])],
		});

		const plan = requirePlan(payload);

		expect(plan.fallbackReasons).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "missing-texture-use",
					pcode: encodeTerrainPcode([1, 1, 1, 1]),
					texture: surfaceTexture(0x05000101),
				}),
			]),
		);
		expect(JSON.stringify(plan)).not.toContain("surface-texture/");
	});
});

function requirePlan(payload: TerrainStaticScopePayload) {
	const plan = buildTerrainMaterialLayerPlan({
		createTextureUseId,
		payload,
	});
	if (!plan) {
		throw new Error("expected terrain material layer plan");
	}

	return plan;
}

function createTextureUseId(textureUse: TerrainTextureUseFacts): string {
	return `${textureUse.role}:${textureUse.texture.surfaceTextureId.toString(16).padStart(8, "0")}`;
}

function createTerrainPayload({
	includeTextureUses = true,
	pcodes,
	roadAlphaSelectors = [],
	terrainAlphaSelectors = [],
}: {
	readonly includeTextureUses?: boolean;
	readonly pcodes: readonly number[];
	readonly roadAlphaSelectors?: readonly {
		readonly alphaTextureId: number;
		readonly roadTextureId: number;
		readonly selector: number;
	}[];
	readonly terrainAlphaSelectors?: readonly {
		readonly alphaIndex: number;
		readonly selector: number;
		readonly textureId: number;
	}[];
}): TerrainStaticScopePayload {
	const terrainTypes = [
		{ terrainCode: 1, texture: surfaceTexture(0x05000101), tiling: 2 },
		{ terrainCode: 2, texture: surfaceTexture(0x05000111), tiling: 3 },
		{ terrainCode: 3, texture: surfaceTexture(0x05000121), tiling: 4 },
	];
	const textureUses = includeTextureUses
		? [
				...terrainTypes.map((terrain) =>
					createTextureUse("terrain-base", terrain.texture),
				),
				...terrainAlphaSelectors.map((alpha) =>
					createTextureUse("terrain-alpha", surfaceTexture(alpha.textureId)),
				),
				...roadAlphaSelectors.flatMap((road) => [
					createTextureUse("road", surfaceTexture(road.roadTextureId)),
					createTextureUse("road-alpha", surfaceTexture(road.alphaTextureId)),
				]),
				createTextureUse("detail", surfaceTexture(0x05000301)),
			]
		: [];

	return {
		kind: "terrain",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "outdoor",
		},
		mesh: createMesh(pcodes),
		missingRefs: [],
		regionRenderProfile: {
			detailRoles: [
				{
					fadeFar: 256,
					fadeNear: 128,
					role: "landscape",
					texture: surfaceTexture(0x05000301),
					tiling: 8,
				},
			],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		sourceSpatial: {
			bounds: null,
			coordinateSpace: "landblock-render-local",
			terrainBvhItemCount: 0,
			terrainBvhNodeCount: 0,
		},
		terrainMaterial: {
			alphaMapCount: terrainAlphaSelectors.length,
			identity: {
				kind: "terrain-material",
				regionNumber: 1,
			},
			materialKind: "tex-merge-table",
			pcodeEncoding: {
				roadCodeBits: 2,
				sizeBitMask: 0,
				terrainCodeBits: 5,
			},
			roadAlphaMapCount: roadAlphaSelectors.length,
			roadAlphaMaps: roadAlphaSelectors.map((road, roadIndex) => ({
				alphaTexture: surfaceTexture(road.alphaTextureId),
				roadIndex,
				roadTexture: surfaceTexture(road.roadTextureId),
				selector: road.selector,
			})),
			terrainAlphaMaps: terrainAlphaSelectors.map((alpha) => ({
				alphaIndex: alpha.alphaIndex,
				selector: alpha.selector,
				texture: surfaceTexture(alpha.textureId),
			})),
			terrainTypeCount: terrainTypes.length,
			terrainTypes,
		},
		textureUses,
	};
}

function createTextureUse(
	role: TerrainTextureUseFacts["role"],
	texture: SurfaceTextureIdentity,
): TerrainTextureUseFacts {
	return {
		palette: null,
		preparedTextureUse: {
			kind: "prepared-texture-use",
			outputFormat: "rgba8",
			renderSurfaceId: texture.surfaceTextureId + 0x0100_0000,
			usage:
				role === "terrain-alpha" || role === "road-alpha"
					? "mask"
					: role === "detail"
						? "detail"
						: "color",
		},
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId: texture.surfaceTextureId + 0x0100_0000,
		},
		role,
		texture,
	};
}

function createMesh(
	pcodes: readonly number[],
): TerrainStaticScopePayload["mesh"] {
	return {
		bounds: null,
		gridSize: pcodes.length + 1,
		maxHeight: 0,
		minHeight: 0,
		quadCount: pcodes.length,
		quads: pcodes.map((pcode, quadIndex) => ({
			averageHeight: 0,
			bounds: {
				max: { x: 1, y: 1, z: 0 },
				min: { x: 0, y: 0, z: 0 },
			},
			col: quadIndex,
			cornerTerrainCodes: [0, 0, 0, 0],
			diagonal: "southwest-northeast",
			pcode,
			quadIndex,
			row: 0,
			sourceTerrainIndices: [0, 1, 2, 3],
			terrainQuadId: `q${quadIndex}`,
			triangleIndices: [quadIndex * 2, quadIndex * 2 + 1],
			vertexIndices: [0, 1, 2, 3],
		})),
		tileSize: 24,
		triangleCount: pcodes.length * 2,
		triangles: [],
		vertexCount: 0,
		vertices: [],
	};
}

function encodeTerrainPcode(
	codes: readonly [number, number, number, number],
): number {
	return (codes[0] << 15) | (codes[1] << 10) | (codes[2] << 5) | codes[3];
}

function surfaceTexture(surfaceTextureId: number): SurfaceTextureIdentity {
	return {
		kind: "surface-texture",
		surfaceTextureId,
	};
}

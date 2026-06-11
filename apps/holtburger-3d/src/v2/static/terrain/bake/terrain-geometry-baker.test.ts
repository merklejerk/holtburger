import { describe, expect, it } from "vitest";
import type {
	StaticBakeBatchInput,
	TerrainGeometryStaticDrawUnit,
	TerrainStaticScopePayload,
} from "../../contracts";
import { bakeTerrainGeometry } from "./terrain-geometry-baker";

describe("V2 terrain geometry baker", () => {
	it("converts terrain mesh facts into a geometry-only draw unit", () => {
		const input = createTerrainBakeInput();

		const result = bakeTerrainGeometry(input);
		const drawUnit = requireTerrainDrawUnit(result.drawUnits[0]);

		expect(drawUnit).toMatchObject({
			coordinateSpace: "landblock-render-local",
			domain: "outdoor-terrain",
			drawUnitId: "7:landblock:da55ffff:outdoor-terrain:terrain-geometry",
			indexType: "uint16",
			kind: "terrain-geometry",
			landblockId: 0xda55ffff,
			materialBucketKey:
				"shader:terrain-debug-flat|domain:outdoor-terrain|sampler:none|placement:none",
			materialFamily: "terrain-debug-flat",
			primaryTextureUseId: null,
			triangleCount: 2,
			vertexCount: 6,
		});
		expect(Array.from(drawUnit.positions)).toEqual([
			0, 0, -0, 24, 1, -0, 0, 2, -24, 24, 1, -0, 24, 3, -24, 0, 2, -24,
		]);
		expect(drawUnit.indices).toBeInstanceOf(Uint16Array);
		expect(Array.from(drawUnit.indices)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(drawUnit.sourceTriangleIds).toEqual(["t0", "t1"]);
		expect(Array.from(drawUnit.texCoords)).toEqual([
			0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1,
		]);
		expect(Array.from(drawUnit.layerSlots)).toEqual([0, 0, 0, 0, 0, 0]);
		expect(drawUnit.textureUseIds).toEqual([]);
		expect(drawUnit.terrainMaterialPlan).toEqual(
			expect.objectContaining({
				layerEntries: [],
			}),
		);
		expect(drawUnit.terrainFallbackReasons).toEqual([
			expect.objectContaining({
				code: "missing-terrain-type",
				pcode: 33825,
			}),
		]);
		expect(result).toMatchObject({
			atlasRegistryUpdates: [],
			buildRevision: 42,
			staticAuthoredDynamicSeeds: [],
			staticPortalInteriorRecords: [],
			staticSpatialRecords: [
				"7:landblock:da55ffff:outdoor-terrain:terrain-geometry:bounds",
			],
			staticVisibilityRecords: [],
			textureUses: [],
			works: [input.items[0]?.work],
		});
		expect(result.staticSourceMappings).toEqual([
			"7:landblock:da55ffff:outdoor-terrain:terrain-geometry:source:t0",
			"7:landblock:da55ffff:outdoor-terrain:terrain-geometry:source:t1",
		]);
	});

	it("uses uint32 indices when baked terrain vertices exceed uint16 capacity", () => {
		const input = createTerrainBakeInput({
			triangleCount: 21_846,
		});

		const drawUnit = requireTerrainDrawUnit(
			bakeTerrainGeometry(input).drawUnits[0],
		);

		expect(drawUnit.vertexCount).toBe(65_538);
		expect(drawUnit.indexType).toBe("uint32");
		expect(drawUnit.indices).toBeInstanceOf(Uint32Array);
		expect(drawUnit.indices[65_537]).toBe(65_537);
	});

	it("uses uint16 indices at the uint16 maximum vertex boundary", () => {
		const input = createTerrainBakeInput({
			triangleCount: 21_845,
		});

		const drawUnit = requireTerrainDrawUnit(
			bakeTerrainGeometry(input).drawUnits[0],
		);

		expect(drawUnit.vertexCount).toBe(65_535);
		expect(drawUnit.indexType).toBe("uint16");
		expect(drawUnit.indices).toBeInstanceOf(Uint16Array);
		expect(drawUnit.indices[65_534]).toBe(65_534);
	});

	it("emits bake-local prepared texture uses without renderer texture refs", () => {
		const input = createTerrainBakeInput({ includeTextureUse: true });

		const result = bakeTerrainGeometry(input);
		const drawUnit = requireTerrainDrawUnit(result.drawUnits[0]);

		expect(drawUnit).toMatchObject({
			materialBucketKey:
				"shader:terrain-single-base-color|domain:outdoor-terrain|sampler:color-repeat-filterable|batch:batch-a|texture:7:landblock:da55ffff:outdoor-terrain:prepared-texture:terrain-base:color:06000010",
			materialFamily: "terrain-single-base-color",
			primaryTextureUseId:
				"7:landblock:da55ffff:outdoor-terrain:prepared-texture:terrain-base:color:06000010",
			textureUseIds: [
				"7:landblock:da55ffff:outdoor-terrain:prepared-texture:terrain-base:color:06000010",
			],
		});
		expect(drawUnit.terrainMaterialPlan?.layerEntries).toEqual([
			expect.objectContaining({
				allRoad: false,
				base: expect.objectContaining({
					role: "terrain-base",
					textureUseId:
						"7:landblock:da55ffff:outdoor-terrain:prepared-texture:terrain-base:color:06000010",
					wrap: "repeat",
				}),
				pcode: 33825,
				slot: 0,
			}),
		]);
		expect(result.textureUses).toEqual([
			{
				domain: "outdoor-terrain",
				ownerDrawUnitIds: [drawUnit.drawUnitId],
				staticBatchId: "batch-a",
				source: {
					kind: "prepared-texture-use",
					outputFormat: "rgba8",
					renderSurfaceId: 0x06000010,
					usage: "color",
				},
				textureUseId:
					"7:landblock:da55ffff:outdoor-terrain:prepared-texture:terrain-base:color:06000010",
			},
		]);
		expect(JSON.stringify(result)).not.toContain("texture-ref");
	});

	it("partitions terrain geometry by bounded material draw slices", () => {
		const pcodes = Array.from({ length: 9 }, (_value, index) =>
			encodeTerrainPcode(index + 1),
		);
		const input = createTerrainBakeInput({
			pcodes,
			terrainTypeCodes: pcodes.map((pcode) => decodeRepeatedTerrainCode(pcode)),
		});

		const result = bakeTerrainGeometry(input);
		const drawUnits = result.drawUnits.map(requireTerrainDrawUnit);

		expect(drawUnits).toHaveLength(2);
		expect(drawUnits.map((drawUnit) => drawUnit.drawUnitId)).toEqual([
			"7:landblock:da55ffff:outdoor-terrain:terrain-geometry:slice-0",
			"7:landblock:da55ffff:outdoor-terrain:terrain-geometry:slice-1",
		]);
		expect(drawUnits.map((drawUnit) => drawUnit.triangleCount)).toEqual([
			16, 2,
		]);
		expect(drawUnits[0]?.terrainMaterialPlan?.layerEntries).toHaveLength(8);
		expect(drawUnits[1]?.terrainMaterialPlan?.layerEntries).toHaveLength(1);
		expect(Array.from(drawUnits[0]?.layerSlots ?? [])).toEqual(
			Array.from({ length: 48 }, (_value, index) => Math.floor(index / 6)),
		);
		expect(Array.from(drawUnits[1]?.layerSlots ?? [])).toEqual([
			0, 0, 0, 0, 0, 0,
		]);
		expect(
			drawUnits.flatMap((drawUnit) => drawUnit.terrainFallbackReasons),
		).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "layer-overflow",
				}),
			]),
		);
		expect(result.staticSourceMappings).toHaveLength(18);
	});

	it("assigns terrain texture-use owners to the material slice that binds them", () => {
		const pcodes = Array.from({ length: 9 }, (_value, index) =>
			encodeTerrainPcode(index + 1),
		);
		const input = createTerrainBakeInput({
			pcodes,
			terrainTypeCodes: pcodes.map((pcode) => decodeRepeatedTerrainCode(pcode)),
			textureUseSurfaceTextureIds: pcodes.map(
				(pcode) => 0x05000000 + decodeRepeatedTerrainCode(pcode),
			),
		});

		const result = bakeTerrainGeometry(input);

		expect(result.drawUnits.map((drawUnit) => drawUnit.drawUnitId)).toEqual([
			"7:landblock:da55ffff:outdoor-terrain:terrain-geometry:slice-0",
			"7:landblock:da55ffff:outdoor-terrain:terrain-geometry:slice-1",
		]);
		expect(result.textureUses).toHaveLength(9);
		expect(
			result.textureUses
				.slice(0, 8)
				.map((textureUse) => textureUse.ownerDrawUnitIds),
		).toEqual(
			Array.from({ length: 8 }, () => [
				"7:landblock:da55ffff:outdoor-terrain:terrain-geometry:slice-0",
			]),
		);
		expect(result.textureUses[8]).toMatchObject({
			ownerDrawUnitIds: [
				"7:landblock:da55ffff:outdoor-terrain:terrain-geometry:slice-1",
			],
		});
	});

	it("bakes multiple terrain payloads as one static atlas batch", () => {
		const input = createTerrainBakeInput(
			{ includeTextureUse: true },
			{
				includeSecondLandblock: true,
			},
		);

		const result = bakeTerrainGeometry(input);

		expect(result.staticBatchId).toBe("batch-a");
		expect(result.works.map((work) => work.workId)).toEqual([
			"7:landblock:da55ffff:outdoor-terrain",
			"7:landblock:da56ffff:outdoor-terrain",
		]);
		expect(result.drawUnits.map((drawUnit) => drawUnit.drawUnitId)).toEqual([
			"7:landblock:da55ffff:outdoor-terrain:terrain-geometry",
			"7:landblock:da56ffff:outdoor-terrain:terrain-geometry",
		]);
		expect(
			new Set(result.textureUses.map((textureUse) => textureUse.staticBatchId)),
		).toEqual(new Set(["batch-a"]));
	});
});

function requireTerrainDrawUnit(
	drawUnit: unknown,
): TerrainGeometryStaticDrawUnit {
	if (
		typeof drawUnit !== "object" ||
		drawUnit === null ||
		!("kind" in drawUnit) ||
		drawUnit.kind !== "terrain-geometry"
	) {
		throw new Error("expected terrain geometry draw unit");
	}

	return drawUnit as TerrainGeometryStaticDrawUnit;
}

function createTerrainBakeInput(
	options: {
		readonly includeTextureUse?: boolean;
		readonly pcodes?: readonly number[];
		readonly terrainTypeCodes?: readonly number[];
		readonly triangleCount?: number;
		readonly textureUseSurfaceTextureIds?: readonly number[];
	} = {},
	batchOptions: {
		readonly includeSecondLandblock?: boolean;
	} = {},
): StaticBakeBatchInput {
	const work = createTerrainWork(0xda55ffff);
	const payload = createTerrainPayload(options, 0xda55ffff);
	const items = [
		{
			payload: {
				job: work.job,
				scope: payload,
				sourceRevision: 42,
			},
			work,
		},
	];
	if (batchOptions.includeSecondLandblock) {
		const secondWork = createTerrainWork(0xda56ffff);
		items.push({
			payload: {
				job: secondWork.job,
				scope: createTerrainPayload(options, 0xda56ffff),
				sourceRevision: 43,
			},
			work: secondWork,
		});
	}

	return {
		atlasSnapshot: {
			domain: "outdoor-terrain",
			placements: [],
			staticBatchId: "batch-a",
			textureUses: [],
		},
		domain: "outdoor-terrain",
		items,
		revision: 7,
		staticBatchId: "batch-a",
	};
}

function createTerrainWork(landblockId: number) {
	const landblockHex = landblockId.toString(16).padStart(8, "0");
	return {
		job: {
			domain: "outdoor-terrain" as const,
			scope: {
				kind: "landblock" as const,
				landblockId,
			},
		},
		priority: 0,
		revision: 7,
		workId: `7:landblock:${landblockHex}:outdoor-terrain`,
	};
}

function createTerrainPayload(
	options: {
		readonly includeTextureUse?: boolean;
		readonly pcodes?: readonly number[];
		readonly terrainTypeCodes?: readonly number[];
		readonly triangleCount?: number;
		readonly textureUseSurfaceTextureIds?: readonly number[];
	},
	landblockId: number,
): TerrainStaticScopePayload {
	return {
		kind: "terrain",
		landblock: {
			kind: "landblock-source",
			landblockId,
			source: "outdoor",
		},
		mesh: createTerrainMesh({
			pcodes: options.pcodes,
			triangleCount: options.triangleCount,
		}),
		missingRefs: [],
		regionRenderProfile: {
			detailRoles: [],
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
			alphaMapCount: 0,
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
			roadAlphaMaps: [],
			roadAlphaMapCount: 0,
			terrainAlphaMaps: [],
			terrainTypeCount: 0,
			terrainTypes: createTerrainTypes(options),
		},
		textureUses: createTerrainTextureUses(options),
	};
}

function createTerrainMesh({
	pcodes = [encodeTerrainPcode(1)],
	triangleCount,
}: {
	readonly pcodes?: readonly number[];
	readonly triangleCount?: number;
}): TerrainStaticScopePayload["mesh"] {
	if (triangleCount !== undefined) {
		return createRepeatedTerrainMesh(
			triangleCount,
			pcodes[0] ?? encodeTerrainPcode(1),
		);
	}

	const vertices = [
		{ x: 0, y: 0, z: 0 },
		{ x: 24, y: 0, z: 1 },
		{ x: 0, y: 24, z: 2 },
		{ x: 24, y: 24, z: 3 },
	];
	const quads = pcodes.map((pcode, quadIndex) => ({
		averageHeight: 1,
		bounds: {
			max: { x: 24, y: 24, z: 3 },
			min: { x: 0, y: 0, z: 0 },
		},
		col: quadIndex,
		cornerTerrainCodes: [
			decodeRepeatedTerrainCode(pcode),
			decodeRepeatedTerrainCode(pcode),
			decodeRepeatedTerrainCode(pcode),
			decodeRepeatedTerrainCode(pcode),
		] as const,
		diagonal: "southwest-northeast" as const,
		pcode,
		quadIndex,
		row: 0,
		sourceTerrainIndices: [0, 1, 2, 3] as const,
		terrainQuadId: `q${quadIndex}`,
		triangleIndices: [quadIndex * 2, quadIndex * 2 + 1] as const,
		vertexIndices: [0, 1, 2, 3] as const,
	}));
	const triangles = quads.flatMap((quad) => [
		{
			averageHeight: 1,
			bounds: quad.bounds,
			quadIndex: quad.quadIndex,
			terrainTriangleId: `t${quad.quadIndex * 2}`,
			triangleInQuad: 0 as const,
			vertexIndices: [0, 1, 2] as const,
		},
		{
			averageHeight: 1,
			bounds: quad.bounds,
			quadIndex: quad.quadIndex,
			terrainTriangleId: `t${quad.quadIndex * 2 + 1}`,
			triangleInQuad: 1 as const,
			vertexIndices: [1, 3, 2] as const,
		},
	]);

	return {
		bounds: {
			max: { x: 24, y: 24, z: 3 },
			min: { x: 0, y: 0, z: 0 },
		},
		gridSize: 2,
		maxHeight: 3,
		minHeight: 0,
		quadCount: quads.length,
		quads,
		tileSize: 24,
		triangleCount: triangles.length,
		triangles,
		vertexCount: vertices.length,
		vertices,
	};
}

function createRepeatedTerrainMesh(
	triangleCount: number,
	pcode: number,
): TerrainStaticScopePayload["mesh"] {
	const triangles = Array.from({ length: triangleCount }, (_value, index) => ({
		averageHeight: 1,
		bounds: {
			max: { x: 24, y: 24, z: 3 },
			min: { x: 0, y: 0, z: 0 },
		},
		quadIndex: 0,
		terrainTriangleId: `t${index}`,
		triangleInQuad: (index % 2) as 0 | 1,
		vertexIndices:
			index % 2 === 0 ? ([0, 1, 2] as const) : ([1, 3, 2] as const),
	}));

	return {
		bounds: {
			max: { x: 24, y: 24, z: 3 },
			min: { x: 0, y: 0, z: 0 },
		},
		gridSize: 2,
		maxHeight: 3,
		minHeight: 0,
		quadCount: 1,
		quads: [
			{
				averageHeight: 1,
				bounds: {
					max: { x: 24, y: 24, z: 3 },
					min: { x: 0, y: 0, z: 0 },
				},
				col: 0,
				cornerTerrainCodes: [
					decodeRepeatedTerrainCode(pcode),
					decodeRepeatedTerrainCode(pcode),
					decodeRepeatedTerrainCode(pcode),
					decodeRepeatedTerrainCode(pcode),
				],
				diagonal: "southwest-northeast",
				pcode,
				quadIndex: 0,
				row: 0,
				sourceTerrainIndices: [0, 1, 2, 3],
				terrainQuadId: "q0",
				triangleIndices: [0, 1],
				vertexIndices: [0, 1, 2, 3],
			},
		],
		tileSize: 24,
		triangleCount,
		triangles,
		vertexCount: 4,
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 24, y: 0, z: 1 },
			{ x: 0, y: 24, z: 2 },
			{ x: 24, y: 24, z: 3 },
		],
	};
}

function createTerrainTypes(options: {
	readonly includeTextureUse?: boolean;
	readonly terrainTypeCodes?: readonly number[];
}): TerrainStaticScopePayload["terrainMaterial"]["terrainTypes"] {
	if (options.terrainTypeCodes) {
		return options.terrainTypeCodes.map((terrainCode) => ({
			terrainCode,
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000000 + terrainCode,
			},
			tiling: 1,
		}));
	}
	if (!options.includeTextureUse) {
		return [];
	}

	return [
		{
			terrainCode: 1,
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000010,
			},
			tiling: 1,
		},
	];
}

function createTerrainTextureUses(options: {
	readonly includeTextureUse?: boolean;
	readonly textureUseSurfaceTextureIds?: readonly number[];
}): TerrainStaticScopePayload["textureUses"] {
	if (options.textureUseSurfaceTextureIds) {
		return options.textureUseSurfaceTextureIds.map((surfaceTextureId) => ({
			palette: null,
			preparedTextureUse: {
				kind: "prepared-texture-use",
				outputFormat: "rgba8",
				renderSurfaceId: 0x01000000 + surfaceTextureId,
				usage: "color",
			},
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x01000000 + surfaceTextureId,
			},
			role: "terrain-base",
			texture: {
				kind: "surface-texture",
				surfaceTextureId,
			},
		}));
	}
	if (!options.includeTextureUse) {
		return [];
	}

	return [
		{
			palette: null,
			preparedTextureUse: {
				kind: "prepared-texture-use",
				outputFormat: "rgba8",
				renderSurfaceId: 0x06000010,
				usage: "color",
			},
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			role: "terrain-base",
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000010,
			},
		},
	];
}

function encodeTerrainPcode(terrainCode: number): number {
	return (
		(terrainCode << 15) | (terrainCode << 10) | (terrainCode << 5) | terrainCode
	);
}

function decodeRepeatedTerrainCode(pcode: number): number {
	return pcode & 0x1f;
}

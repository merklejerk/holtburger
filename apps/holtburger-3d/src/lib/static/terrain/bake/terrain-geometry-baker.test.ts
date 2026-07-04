import { describe, expect, it } from "vitest";
import type {
	PreparedAsset,
	PreparedAssetReader,
} from "../../../assets/contracts";
import type {
	StaticBakeJobInput,
	StaticBakeTask,
	TerrainGeometryStaticDrawUnit,
	TerrainStaticScopePayload,
} from "../../contracts";
import {
	bakeTerrainGeometry,
	createTerrainTexturePlacementIntents,
} from "./terrain-geometry-baker";

describe("terrain geometry baker", () => {
	it("converts terrain mesh facts into a geometry-only draw unit", async () => {
		const input = await createTerrainBakeInput();

		const result = bakeTerrainGeometry(input);
		const drawUnit = requireTerrainDrawUnit(result.drawUnits[0]);

		expect(drawUnit).toMatchObject({
			coordinateSpace: "landblock-render-local",
			domain: "outdoor-terrain",
			drawUnitId: "terrain:0xda55ffff:terrain-geometry",
			indexType: "uint16",
			kind: "terrain-geometry",
			landblockId: 0xda55ffff,
			materialBucketKey:
				"shader:terrain-debug-flat|domain:outdoor-terrain|sampler:none|placement:none",
			materialFamily: "terrain-debug-flat",
			primaryTextureBindingId: null,
			triangleCount: 2,
			vertexCount: 6,
		});
		expect(Array.from(drawUnit.positions)).toEqual([
			0, 0, 0, 24, 1, 0, 0, 2, -24, 24, 1, 0, 24, 3, -24, 0, 2, -24,
		]);
		expect(drawUnit.indices).toBeInstanceOf(Uint16Array);
		expect(Array.from(drawUnit.indices)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(drawUnit.sourceTriangleIds).toEqual(["t0", "t1"]);
		expect(Array.from(drawUnit.texCoords)).toEqual([
			0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1,
		]);
		expect(Array.from(drawUnit.layerSlots)).toEqual([0, 0, 0, 0, 0, 0]);
		expect(drawUnit.textureBindingIds).toEqual([]);
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
			envCellStaticObjectPlacementRecords: [],
			staticPortalGraphs: [],
			staticPortalInteriorRecords: [],
			staticSpatialRecords: [
				{
					drawUnitId: "terrain:0xda55ffff:terrain-geometry",
					kind: "draw-unit-bounds",
					owner: {
						drawUnitId: "terrain:0xda55ffff:terrain-geometry",
						kind: "draw-unit",
					},
					triangleCount: 2,
				},
			],
			staticVisibilityRecords: [],
			textureUses: [],
			task: input.task,
		});
		expect(result.staticSourceMappings).toEqual([
			{
				drawUnitId: "terrain:0xda55ffff:terrain-geometry",
				kind: "terrain-source-triangle",
				owner: {
					drawUnitId: "terrain:0xda55ffff:terrain-geometry",
					kind: "draw-unit",
				},
				sourceTriangleId: "t0",
			},
			{
				drawUnitId: "terrain:0xda55ffff:terrain-geometry",
				kind: "terrain-source-triangle",
				owner: {
					drawUnitId: "terrain:0xda55ffff:terrain-geometry",
					kind: "draw-unit",
				},
				sourceTriangleId: "t1",
			},
		]);
	});

	it("uses uint32 indices when baked terrain vertices exceed uint16 capacity", async () => {
		const input = await createTerrainBakeInput({
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

	it("uses uint16 indices at the uint16 maximum vertex boundary", async () => {
		const input = await createTerrainBakeInput({
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

	it("emits bake-local prepared texture uses without renderer texture refs", async () => {
		const input = await createTerrainBakeInput({ includeTextureUse: true });

		const result = bakeTerrainGeometry(input);
		const drawUnit = requireTerrainDrawUnit(result.drawUnits[0]);
		const primaryTextureBindingId = drawUnit.primaryTextureBindingId;
		if (!primaryTextureBindingId) {
			throw new Error("Expected terrain primary texture binding id.");
		}

		expect(drawUnit).toMatchObject({
			materialBucketKey: `shader:terrain-single-base-color|domain:outdoor-terrain|sampler:color-repeat-filterable|texture:${primaryTextureBindingId}`,
			materialFamily: "terrain-single-base-color",
			primaryTextureBindingId,
			textureBindingIds: [primaryTextureBindingId],
		});
		expect(drawUnit.terrainMaterialPlan?.layerEntries).toEqual([
			expect.objectContaining({
				allRoad: false,
				base: expect.objectContaining({
					role: "terrain-base",
					textureBindingId: primaryTextureBindingId,
					wrap: "repeat",
				}),
				pcode: 33825,
				slot: 0,
			}),
		]);
		expect(result.textureUses).toEqual([
			expect.objectContaining({
				bindingId: expect.stringContaining("binding|"),
				domain: "outdoor-terrain",
				ownerIds: [expect.stringContaining("owner=layer|")],
				owners: [{ drawUnitId: drawUnit.drawUnitId, kind: "draw-unit" }],
				pageClass: expect.stringContaining("page-class|"),
				source: {
					kind: "prepared-render-surface-texture-use",
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					usage: "rgba-color",
				},
				textureKey: expect.stringContaining("texture|"),
			}),
		]);
		expect(result.textureDependencies).toEqual([
			{
				resourceId: drawUnit.drawUnitId,
				roles: [
					{
						itemIds: [primaryTextureBindingId],
						purpose: "terrain-color",
					},
				],
			},
		]);
		const placementItemIds = new Set(
			input.texturePlacementSnapshot?.placementsByItemId.keys(),
		);
		expect(
			result.textureDependencies.flatMap((dependency) =>
				dependency.roles.flatMap((role) => role.itemIds),
			),
		).toEqual([...placementItemIds]);
		expect(JSON.stringify(result)).not.toContain("texture-ref");
	});

	it("discovers terrain placement intents before bake", async () => {
		const input = await createTerrainBakeInput({ includeTextureUse: true });

		expect(
			await createTerrainTexturePlacementIntents({
				assetReader: new EmptyPreparedAssetReader(),
				items: [{ payload: input.payload, task: input.task }],
			}),
		).toEqual([
			expect.objectContaining({
				affinityKey: "terrain:terrain:0xda55ffff",
				itemId: expect.stringContaining("binding|"),
				purpose: "terrain-color",
			}),
		]);
	});

	it("splits terrain draw units by final terrain color pages", async () => {
		const pcodes = Array.from({ length: 5 }, (_value, index) =>
			encodeTerrainPcode(index + 1),
		);
		const input = await createTerrainBakeInput({
			pcodes,
			terrainTypeCodes: pcodes.map((pcode) => decodeRepeatedTerrainCode(pcode)),
			textureUseSurfaceTextureIds: pcodes.map(
				(pcode) => 0x05000000 + decodeRepeatedTerrainCode(pcode),
			),
			uniqueColorPages: true,
		});

		const result = bakeTerrainGeometry(input);
		const drawUnits = result.drawUnits.map(requireTerrainDrawUnit);

		expect(drawUnits.map((drawUnit) => drawUnit.drawUnitId)).toEqual([
			"terrain:0xda55ffff:terrain-geometry:slice-0-page-0",
			"terrain:0xda55ffff:terrain-geometry:slice-0-page-1",
		]);
		expect(drawUnits.map((drawUnit) => drawUnit.triangleCount)).toEqual([8, 2]);
		expect(drawUnits.map((drawUnit) => drawUnit.textureBindingIds.length)).toEqual([
			4, 1,
		]);
		expect(result.textureDependencies).toHaveLength(2);
		expect(result.textureDependencies[0]?.roles).toEqual([
			{
				itemIds: drawUnits[0]?.textureBindingIds,
				purpose: "terrain-color",
			},
		]);
	});

	it("fails terrain baking when a required texture is missing pre-bake placement", async () => {
		const input = {
			...(await createTerrainBakeInput({ includeTextureUse: true })),
			texturePlacementSnapshot: {
				placementsByItemId: new Map(),
			},
		};

		expect(() => bakeTerrainGeometry(input)).toThrow(
			/Terrain texture binding\|resource=terrain%3A0xda55ffff%3Aterrain-texture/,
		);
	});

	it("partitions terrain geometry by bounded material draw slices", async () => {
		const pcodes = Array.from({ length: 9 }, (_value, index) =>
			encodeTerrainPcode(index + 1),
		);
		const input = await createTerrainBakeInput({
			pcodes,
			terrainTypeCodes: pcodes.map((pcode) => decodeRepeatedTerrainCode(pcode)),
		});

		const result = bakeTerrainGeometry(input);
		const drawUnits = result.drawUnits.map(requireTerrainDrawUnit);

		expect(drawUnits).toHaveLength(2);
		expect(drawUnits.map((drawUnit) => drawUnit.drawUnitId)).toEqual([
			"terrain:0xda55ffff:terrain-geometry:slice-0-page-0",
			"terrain:0xda55ffff:terrain-geometry:slice-1-page-0",
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

	it("assigns terrain texture-use owners to the material slice that binds them", async () => {
		const pcodes = Array.from({ length: 9 }, (_value, index) =>
			encodeTerrainPcode(index + 1),
		);
		const input = await createTerrainBakeInput({
			pcodes,
			terrainTypeCodes: pcodes.map((pcode) => decodeRepeatedTerrainCode(pcode)),
			textureUseSurfaceTextureIds: pcodes.map(
				(pcode) => 0x05000000 + decodeRepeatedTerrainCode(pcode),
			),
		});

		const result = bakeTerrainGeometry(input);

		expect(result.drawUnits.map((drawUnit) => drawUnit.drawUnitId)).toEqual([
			"terrain:0xda55ffff:terrain-geometry:slice-0-page-0",
			"terrain:0xda55ffff:terrain-geometry:slice-1-page-0",
		]);
		expect(result.textureUses).toHaveLength(9);
		expect(
			result.textureUses.slice(0, 8).map((textureUse) => textureUse.owners),
		).toEqual(
			Array.from({ length: 8 }, () => [
				{
					drawUnitId: "terrain:0xda55ffff:terrain-geometry:slice-0-page-0",
					kind: "draw-unit",
				},
			]),
		);
		expect(result.textureUses[8]).toMatchObject({
			owners: [
				{
					drawUnitId: "terrain:0xda55ffff:terrain-geometry:slice-1-page-0",
					kind: "draw-unit",
				},
			],
		});
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

async function createTerrainBakeInput(
	options: {
		readonly includeTextureUse?: boolean;
		readonly pcodes?: readonly number[];
		readonly terrainTypeCodes?: readonly number[];
		readonly triangleCount?: number;
		readonly textureUseSurfaceTextureIds?: readonly number[];
		readonly uniqueColorPages?: boolean;
	} = {},
): Promise<StaticBakeJobInput> {
	const task = createTerrainTask(0xda55ffff);
	const payload = createTerrainPayload(options, 0xda55ffff);
	const input: StaticBakeJobInput = {
		domain: "outdoor-terrain",
		payload: {
			job: {
				domain: task.domain,
				scope: task.scope,
			},
			scope: payload,
			sourceRevision: 42,
		},
		resources: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		revision: 7,
		task,
	};
	return {
		...input,
		texturePlacementSnapshot: await createTexturePlacementSnapshot(
			input,
			options,
		),
	};
}

async function createTexturePlacementSnapshot(
	input: StaticBakeJobInput,
	options: { readonly uniqueColorPages?: boolean },
): Promise<NonNullable<StaticBakeJobInput["texturePlacementSnapshot"]>> {
	const intents = await createTerrainTexturePlacementIntents({
		assetReader: new EmptyPreparedAssetReader(),
		items: [{ payload: input.payload, task: input.task }],
	});
	return {
		placementsByItemId: new Map(
			intents.map((intent, index) => [
				intent.itemId,
				{
					bindingId: intent.bindingId,
					height: 16,
					itemId: intent.itemId,
					pageId: options.uniqueColorPages
						? `${intent.purpose}:page:${index}`
						: `${intent.purpose}:page:0`,
					pageClass: intent.pageClass,
					purpose: intent.purpose,
					rect: [0, 0, 16, 16] as const,
					textureKey: intent.textureKey,
					width: 16,
				},
			]),
		),
	};
}

class EmptyPreparedAssetReader implements PreparedAssetReader {
	async requestPreparedAsset(): Promise<PreparedAsset> {
		throw new Error(
			"terrain texture placement test did not expect asset reads",
		);
	}
}

function createTerrainTask(landblockId: number): StaticBakeTask {
	const landblockHex = landblockId.toString(16).padStart(8, "0");
	const taskId = `7:landblock:${landblockHex}:outdoor-terrain`;
	return {
		domain: "outdoor-terrain",
		ownerId: `terrain:0x${landblockHex}`,
		ownerKey: {
			kind: "terrain",
			landblockId,
		},
		revision: 7,
		scope: {
			kind: "landblock",
			landblockId,
		},
		scopeKey: `landblock:${landblockHex}`,
		taskId,
	};
}

function createTerrainPayload(
	options: {
		readonly includeTextureUse?: boolean;
		readonly pcodes?: readonly number[];
		readonly terrainTypeCodes?: readonly number[];
		readonly triangleCount?: number;
		readonly textureUseSurfaceTextureIds?: readonly number[];
		readonly uniqueColorPages?: boolean;
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
			terrainBvh: {
				coordinateSpace: "landblock-render-local",
				items: [],
				nodes: [],
			},
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
		{ x: 24, y: 1, z: 0 },
		{ x: 0, y: 2, z: -24 },
		{ x: 24, y: 3, z: -24 },
	];
	const quads = pcodes.map((pcode, quadIndex) => ({
		averageHeight: 1,
		bounds: {
			max: { x: 24, y: 3, z: 0 },
			min: { x: 0, y: 0, z: -24 },
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
			max: { x: 24, y: 3, z: 0 },
			min: { x: 0, y: 0, z: -24 },
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
			max: { x: 24, y: 3, z: 0 },
			min: { x: 0, y: 0, z: -24 },
		},
		quadIndex: 0,
		terrainTriangleId: `t${index}`,
		triangleInQuad: (index % 2) as 0 | 1,
		vertexIndices:
			index % 2 === 0 ? ([0, 1, 2] as const) : ([1, 3, 2] as const),
	}));

	return {
		bounds: {
			max: { x: 24, y: 3, z: 0 },
			min: { x: 0, y: 0, z: -24 },
		},
		gridSize: 2,
		maxHeight: 3,
		minHeight: 0,
		quadCount: 1,
		quads: [
			{
				averageHeight: 1,
				bounds: {
					max: { x: 24, y: 3, z: 0 },
					min: { x: 0, y: 0, z: -24 },
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
			{ x: 24, y: 1, z: 0 },
			{ x: 0, y: 2, z: -24 },
			{ x: 24, y: 3, z: -24 },
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
				kind: "prepared-render-surface-texture-use",
				renderSurface: {
					kind: "render-surface",
					renderSurfaceId: 0x01000000 + surfaceTextureId,
				},
				usage: "rgba-color",
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
				kind: "prepared-render-surface-texture-use",
				renderSurface: {
					kind: "render-surface",
					renderSurfaceId: 0x06000010,
				},
				usage: "rgba-color",
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

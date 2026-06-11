import { describe, expect, it } from "vitest";
import type {
	StaticBakeInput,
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
			materialFamily: "terrain-debug-flat",
			primaryTextureUseId: null,
			triangleCount: 2,
			vertexCount: 6,
		});
		expect(Array.from(drawUnit.positions)).toEqual([
			0, 0, -0, 24, 1, -0, 0, 2, -24,
			24, 1, -0, 24, 3, -24, 0, 2, -24,
		]);
		expect(drawUnit.indices).toBeInstanceOf(Uint16Array);
		expect(Array.from(drawUnit.indices)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(drawUnit.sourceTriangleIds).toEqual(["t0", "t1"]);
		expect(Array.from(drawUnit.texCoords)).toEqual([
			0, 0, 0.125, 0, 0, 0.125,
			0.125, 0, 0.125, 0.125, 0, 0.125,
		]);
		expect(drawUnit.textureUseIds).toEqual([]);
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
			work: input.work,
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
			materialFamily: "terrain-phase8-texture-probe",
			primaryTextureUseId:
				"7:landblock:da55ffff:outdoor-terrain:prepared-texture:06000010",
			textureUseIds: [
				"7:landblock:da55ffff:outdoor-terrain:prepared-texture:06000010",
			],
		});
		expect(result.textureUses).toEqual([
			{
				domain: "outdoor-terrain",
				ownerDrawUnitIds: [drawUnit.drawUnitId],
				placementRevisionAssumption: 42,
				source: {
					colorSpace: "linear",
					kind: "prepared-texture-use",
					mipPolicy: "none",
					outputFormat: "rgba8",
					renderSurfaceId: 0x06000010,
					usage: "color",
				},
				textureUseId:
					"7:landblock:da55ffff:outdoor-terrain:prepared-texture:06000010",
			},
		]);
		expect(JSON.stringify(result)).not.toContain("texture-ref");
	});
});

function requireTerrainDrawUnit(
	drawUnit: StaticBakeInput["payload"] extends never ? never : unknown,
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
		readonly triangleCount?: number;
	} = {},
): StaticBakeInput {
	const work = {
		job: {
			domain: "outdoor-terrain" as const,
			scope: {
				kind: "landblock" as const,
				landblockId: 0xda55ffff,
			},
		},
		priority: 0,
		revision: 7,
		workId: "7:landblock:da55ffff:outdoor-terrain",
	};
	const payload: TerrainStaticScopePayload = {
		kind: "terrain",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "outdoor",
		},
		mesh: createTerrainMesh(options.triangleCount ?? 2),
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
			roadAlphaMapCount: 0,
			terrainTypeCount: 0,
		},
		textureUses: options.includeTextureUse
			? [
					{
						palette: null,
						preparedTextureUse: {
							colorSpace: "linear",
							kind: "prepared-texture-use",
							mipPolicy: "none",
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
				]
			: [],
	};

	return {
		atlasSnapshot: {
			domain: "outdoor-terrain",
			placements: [],
			revision: 42,
			textureUses: [],
		},
		payload: {
			job: work.job,
			scope: payload,
			sourceRevision: 42,
		},
		work,
	};
}

function createTerrainMesh(triangleCount: number): TerrainStaticScopePayload["mesh"] {
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
			index % 2 === 0
				? ([0, 1, 2] as const)
				: ([1, 3, 2] as const),
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
				cornerTerrainCodes: [1, 1, 1, 1],
				diagonal: "southwest-northeast",
				pcode: 1,
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

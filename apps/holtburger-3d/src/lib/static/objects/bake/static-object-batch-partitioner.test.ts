import { describe, expect, it } from "vitest";
import type {
	EnvCellSystemStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
	StaticBakeBatchInput,
	StaticBakeTask,
	StaticBounds,
	StaticMaterialSourceIdentity,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteViewFacts,
	StaticObjectTextureRefFacts,
} from "../../contracts";
import type {
	ObjectVisualTexturePlacementSnapshot,
	TexturePlacementSnapshot,
} from "../../../textures/placement";
import { bakeStaticObjectBatch } from "./static-object-batch-baker";
import {
	partitionStaticObjectBatches,
	STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE,
	type StaticObjectBatchPayload,
} from "./static-object-batch-partitioner";
import { createStaticObjectTexturePlacementIntents } from "./static-object-placement-planner";
import { createStaticObjectSourceGeometryIdentity } from "../static-object-source-assets";
import { objectVisualGeometryBufferId } from "../../../visual/object-visual-recipe-bundle";

describe("static object batch partitioner", () => {
	it("partitions compatible solid materials by bounded material table capacity", () => {
		const materialCount = STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE + 1;
		const payload = createPayload({
			materials: Array.from({ length: materialCount }, (_, index) =>
				createSolidMaterial(0x08000010 + index, {
					diffuse: (index + 1) / materialCount,
					surfaceType: 0x20,
				}),
			),
		});

		const plan = partitionStaticObjectBatches(payload);

		expect(plan.partitions).toHaveLength(2);
		expect(plan.partitions.map((partition) => partition.materialIds)).toEqual([
			Array.from(
				{ length: STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE },
				(_, index) => 0x08000010 + index,
			),
			[0x08000010 + STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE],
		]);
		expect(
			plan.partitions.flatMap((partition) => partition.sourceTriangleIds),
		).toHaveLength(materialCount);
	});

	it("keeps unsupported-but-classified source geometry represented in partitions", () => {
		const payload = createPayload({
			materials: [createSolidMaterial(0x08000010, { surfaceType: 0x20000 })],
		});

		const plan = partitionStaticObjectBatches(payload);

		expect(plan.partitions).toEqual([
			expect.objectContaining({
				family: "unsupported",
				renderCoverage: "unsupported",
				sourceTriangleIds: [
					"da55ffff:building:building-0:part:0:polygon:0:first-vertex:0:geometry-surface:0:variant:base",
				],
			}),
		]);
	});

	it("resolves geometry surface slots independently from material surface ids", () => {
		const payload = createPayload({
			materials: [createSolidMaterial(0x08000010)],
		});

		const plan = partitionStaticObjectBatches(payload);

		expect(plan.partitions).toHaveLength(1);
		expect(plan.partitions[0]).toMatchObject({
			materialIds: [0x08000010],
			sourceTriangleIds: [
				"da55ffff:building:building-0:part:0:polygon:0:first-vertex:0:geometry-surface:0:variant:base",
			],
		});
	});

	it("fails hard when source geometry has no resolved material slot", () => {
		const material = createSolidMaterial(0x08000010);
		const basePayload = createPayload({ materials: [material] });
		const sourceAsset = basePayload.sourceAssets[0];
		const part = sourceAsset?.parts[0];
		if (!sourceAsset || !part) {
			throw new Error("Fixture payload did not create a source part.");
		}
		const payload = {
			...basePayload,
			materialSlots: [],
			sourceAssets: [
				{
					...sourceAsset,
					parts: [
						{
							...part,
							materialSlots: [],
						},
					],
				},
			],
		} satisfies OutdoorStaticObjectsScopePayload;

		expect(() => partitionStaticObjectBatches(payload)).toThrow(
			/has no resolved material slot/,
		);
	});

	it("partitions env-cell static objects by owning env cell before material batching", () => {
		const payload = createEnvCellStaticPayload();

		const plan = partitionStaticObjectBatches(payload);

		expect(plan.partitions).toHaveLength(2);
		expect(
			plan.partitions.map(
				(partition) => partition.partitionAxes.ownership.envCellId,
			),
		).toEqual([0xda550100, 0xda550101]);
		expect(plan.partitions.map((partition) => partition.triangleCount)).toEqual(
			[1, 1],
		);
		expect(plan.partitions.map((partition) => partition.batchKey)).toEqual([
			expect.stringContaining("env-cell:da550100"),
			expect.stringContaining("env-cell:da550101"),
		]);
	});

	it("fails hard when a bake input omits a referenced geometry attachment", () => {
		const payload = createPayload({
			materials: [createTexturedMaterial(0x08000010)],
			textureRefs: createRgbaTextureRefs(),
		});
		const input = {
			...createBakeInput(payload),
			attachments: {
				envCellCellStructureGeometry: [],
				staticObjectSourceGeometry: [],
			},
		};

		expect(() => bakeStaticObjectBatch(input)).toThrow(
			/missing geometry attachment/,
		);
	});

	it("composes resolved building detail overlays into rendered draw units", () => {
		const payload = createPayload({
			detailRoles: [
				{
					fadeFar: 1,
					fadeNear: 0,
					role: "building",
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000030,
					},
					tiling: 7,
				},
			],
			materials: [createTexturedMaterial(0x08000010)],
			textureRefs: [...createRgbaTextureRefs(), ...createDetailTextureRefs()],
		});
		const result = bakeStaticObjectBatch(createBakeInput(payload));
		const drawUnit = result.objectVisualInstallSet.directDrawUnits.find(
			(candidate) => candidate.kind === "static-object-geometry",
		);
		if (!drawUnit || drawUnit.kind !== "static-object-geometry") {
			throw new Error("Expected building detail static object draw unit.");
		}

		expect(drawUnit).toMatchObject({
			kind: "static-object-geometry",
			textureUseIds: [
				"outdoor-buildings:0xda55ffff:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=clamp-to-edge,clamp-to-edge",
				"outdoor-buildings:0xda55ffff:static-object-texture:prepared-render-surface-texture-use:06000030:rgba-detail:sampling:wrap=repeat,repeat",
			],
		});
		expect(drawUnit.materialEntries[0]).toMatchObject({
			detailTextureTiling: 7,
			detailTextureUseId:
				"outdoor-buildings:0xda55ffff:static-object-texture:prepared-render-surface-texture-use:06000030:rgba-detail:sampling:wrap=repeat,repeat",
		});
		expect(
			result.textureUses.map((textureUse) => ({
				id: textureUse.textureUseId,
				samplingPolicy: textureUse.samplingPolicy,
				source: textureUse.source,
			})),
		).toEqual([
			expect.objectContaining({
				id: "outdoor-buildings:0xda55ffff:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=clamp-to-edge,clamp-to-edge",
			}),
			{
				id: "outdoor-buildings:0xda55ffff:static-object-texture:prepared-render-surface-texture-use:06000030:rgba-detail:sampling:wrap=repeat,repeat",
				samplingPolicy: {
					wrapS: "repeat",
					wrapT: "repeat",
				},
				source: {
					kind: "prepared-render-surface-texture-use",
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000030,
					},
					usage: "rgba-detail",
				},
			},
		]);
		expect(result.materialCoverage[0]).toMatchObject({
			detailRoleCount: 1,
			fallbackReasonCounts: [],
			fallbackReasonCount: 0,
		});
	});

	it("bakes opaque flat-color partitions into rendered draw units without texture uses", () => {
		const payload = createPayload({
			materials: [
				createSolidMaterial(0x08000010, {
					argb: 0xff336699,
					diffuse: 0.5,
					luminosity: 0.25,
					surfaceType: 0x20 | 0x40,
				}),
			],
		});
		const input = createBakeInput(payload);

		const result = bakeStaticObjectBatch(input);

		expect(result.objectVisualInstallSet.directDrawUnits).toEqual([
			expect.objectContaining({
				kind: "static-object-geometry",
				materialEntries: [
					expect.objectContaining({
						materialColor: [
							(0x33 / 255) * 0.5,
							(0x66 / 255) * 0.5,
							(0x99 / 255) * 0.5,
							1,
						],
						materialEmissiveColor: [0.25, 0.25, 0.25],
						primaryTextureUseId: null,
					}),
				],
				materialFamily: "flat-color",
				textureUseIds: [],
			}),
		]);
		expect(result.textureUses).toEqual([]);
	});

	it("keeps material color constants as table entries inside compatible partitions", () => {
		const payload = createPayload({
			materials: [
				createTexturedMaterial(0x08000010, {
					diffuse: 0.5,
					surfaceType: 0x20,
				}),
				createTexturedMaterial(0x08000011, {
					diffuse: 0.75,
					surfaceType: 0x20,
				}),
			],
			textureRefs: createRgbaTextureRefs(),
		});

		const plan = partitionStaticObjectBatches(payload);

		expect(plan.partitions).toHaveLength(1);
		expect(
			plan.partitions[0]?.coarseTablePlan.entries.map(
				(entry) => entry.materialColor,
			),
		).toEqual([
			[0.5, 0.5, 0.5, 1],
			[0.75, 0.75, 0.75, 1],
		]);
	});

	it("bakes alpha-test texture-rgba partitions into rendered draw units", () => {
		const payload = createPayload({
			materials: [createTexturedMaterial(0x08000010, { surfaceType: 0x4 })],
			textureRefs: createRgbaTextureRefs(),
		});
		const input = createBakeInput(payload);

		const result = bakeStaticObjectBatch(input);
		const drawUnit = result.objectVisualInstallSet.directDrawUnits[0];

		expect(drawUnit).toMatchObject({
			kind: "static-object-geometry",
			materialFamily: "texture-rgba",
			materialPass: "alpha-test",
		});
		expect(
			drawUnit?.kind === "static-object-geometry"
				? drawUnit.materialEntries[0]?.alphaTest
				: null,
		).toBe(200 / 255);
		expect(result.textureUses).toHaveLength(1);
	});

	it("bakes Base1ClipMap indexed partitions with retail index cutoff", () => {
		const payload = createPayload({
			materials: [createIndexedMaterial(0x08000010, { surfaceType: 0x4 })],
			textureRefs: createIndexedTextureRefs(),
		});
		const input = createBakeInput(payload);

		const result = bakeStaticObjectBatch(input);
		const drawUnit = result.objectVisualInstallSet.directDrawUnits[0];

		expect(drawUnit).toMatchObject({
			kind: "static-object-geometry",
			materialFamily: "indexed-paletted",
			materialPass: "alpha-test",
		});
		expect(
			drawUnit?.kind === "static-object-geometry"
				? drawUnit.materialEntries[0]?.alphaTest
				: null,
		).toBe(100 / 255);
		expect(
			drawUnit?.kind === "static-object-geometry"
				? drawUnit.materialEntries[0]?.indexedClipThreshold
				: null,
		).toBe(8);
	});

	it("keeps compatible opaque object ownership as metadata without splitting batches", () => {
		const payload = duplicateObjectInstance(
			createPayload({
				materials: [createTexturedMaterial(0x08000010)],
				textureRefs: createRgbaTextureRefs(),
			}),
		);

		const plan = partitionStaticObjectBatches(payload);

		expect(plan.partitions).toHaveLength(1);
		expect(plan.partitions[0]).toMatchObject({
			partitionAxes: {
				ownership: {
					objectPartKey: null,
				},
				sort: {
					policy: "opaque-batchable",
				},
				visibility: {
					key: "visibility:landblock-static-neutral",
					policy: "landblock-static-neutral",
				},
			},
			triangleCount: 2,
		});
		expect(plan.partitions[0]?.sourceTriangleIds).toEqual([
			"da55ffff:building:building-0:part:0:polygon:0:first-vertex:0:geometry-surface:0:variant:base",
			"da55ffff:building:building-1:part:0:polygon:0:first-vertex:0:geometry-surface:0:variant:base",
		]);
	});

	it("compacts compatible opaque geometry from different source and gfx identities", () => {
		const payload = duplicateObjectWithDistinctSourceGfx(
			createPayload({
				materials: [createTexturedMaterial(0x08000010)],
				textureRefs: createRgbaTextureRefs(),
			}),
		);

		const plan = partitionStaticObjectBatches(payload);

		expect(plan.partitions).toHaveLength(1);
		expect(plan.partitions[0]).toMatchObject({
			partitionAxes: {
				ownership: {
					gfxKeys: [
						"static-object-source:gfx-obj:01000020",
						"static-object-source:gfx-obj:01000021",
					],
					objectPartKey: null,
					sourceKeys: [
						"static-object-source:setup-model:02000010",
						"static-object-source:setup-model:02000011",
					],
				},
				sort: {
					policy: "opaque-batchable",
				},
			},
			triangleCount: 2,
		});
		expect(
			plan.partitions[0]?.triangles.map((triangle) => ({
				gfxObj: triangle.gfxObj,
				object: triangle.object,
				source: triangle.source,
			})),
		).toEqual([
			{
				gfxObj: createGfxObjIdentity(),
				object: createObjectIdentity(),
				source: createSourceIdentity(),
			},
			{
				gfxObj: createGfxObjIdentity({ sourceDid: 0x01000021 }),
				object: createObjectIdentity({ instanceId: "building-1" }),
				source: createSourceIdentity({ sourceDid: 0x02000011 }),
			},
		]);
	});

	it("compacts compatible alpha-test geometry from different source and gfx identities", () => {
		const payload = duplicateObjectWithDistinctSourceGfx(
			createPayload({
				materials: [createTexturedMaterial(0x08000010, { surfaceType: 0x4 })],
				textureRefs: createRgbaTextureRefs(),
			}),
		);

		const plan = partitionStaticObjectBatches(payload);

		expect(plan.partitions).toHaveLength(1);
		expect(plan.partitions[0]).toMatchObject({
			pass: "alpha-test",
			partitionAxes: {
				ownership: {
					objectPartKey: null,
					sourceKeys: [
						"static-object-source:setup-model:02000010",
						"static-object-source:setup-model:02000011",
					],
				},
				sort: {
					policy: "alpha-test-batchable",
				},
			},
			triangleCount: 2,
		});
	});

	it("discovers static object texture placement intents before baking", () => {
		const payload = createPayload({
			materials: [
				createTexturedMaterial(0x08000010),
				createTexturedMaterial(0x08000011, {
					renderSurfaceId: 0x06000011,
					surfaceTextureId: 0x05000011,
				}),
			],
			textureRefs: [
				...createRgbaTextureRefs(),
				...createRgbaTextureRefs({
					renderSurfaceId: 0x06000011,
					surfaceTextureId: 0x05000011,
				}),
			],
		});
		const bakeInput = createBakeInput(payload);

		const intents = createStaticObjectTexturePlacementIntents({
			items: bakeInput.items,
			bakeBatchId: bakeInput.bakeBatchId,
		});

		expect(
			intents.map((intent) => ({
				affinityKey: intent.affinityKey,
				itemId: intent.itemId,
				pool: intent.pool,
				purpose: intent.purpose,
				textureUseId: intent.textureUseId,
			})),
		).toEqual([
			{
				affinityKey: expect.stringContaining("static-object|"),
				itemId: 0,
				textureUseId:
					"outdoor-buildings:0xda55ffff:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=clamp-to-edge,clamp-to-edge",
				pool: "static-authored-object",
				purpose: "object-base-color",
			},
			{
				affinityKey: expect.stringContaining("static-object|"),
				itemId: 1,
				textureUseId:
					"outdoor-buildings:0xda55ffff:static-object-texture:prepared-render-surface-texture-use:06000011:rgba-color:sampling:wrap=clamp-to-edge,clamp-to-edge",
				pool: "static-authored-object",
				purpose: "object-base-color",
			},
		]);
	});

	it("discovers static object placement intents for mixed wrap entries", () => {
		const payload = createPayload({
			materials: [
				createTexturedMaterial(0x08000010),
				createTexturedMaterial(0x08000011),
			],
			textureRefs: createRgbaTextureRefs(),
		});
		const source = payload.sourceAssets[0];
		const part = source?.parts[0];
		if (!source || !part) {
			throw new Error("Fixture payload did not create a source part.");
		}
		const updatedPart = {
			...part,
			materialSlots: part.materialSlots.map((slot, index) => ({
				...slot,
				materialVariantSignature: index === 1 ? "sampler=repeat" : null,
			})),
			triangles: part.triangles.map((triangle, index) => ({
				...triangle,
				materialVariantSignature: index === 1 ? "sampler=repeat" : null,
				polygonId: 0,
			})),
		};
		const bakeInput = createBakeInput({
			...payload,
			materialSlots: payload.materialSlots.map((slot, index) => ({
				...slot,
				materialVariantSignature: index === 1 ? "sampler=repeat" : null,
			})),
			sourceAssets: [{ ...source, parts: [updatedPart] }],
		});

		const intents = createStaticObjectTexturePlacementIntents({
			items: bakeInput.items,
			bakeBatchId: bakeInput.bakeBatchId,
		});

		expect(intents.map((intent) => intent.itemId)).toEqual([0, 1]);
		expect(intents.map((intent) => intent.textureUseId)).toEqual([
			"outdoor-buildings:0xda55ffff:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=clamp-to-edge,clamp-to-edge",
			"outdoor-buildings:0xda55ffff:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=repeat,repeat",
		]);
	});

	it("reports compact material coverage by rendered, deferred, and unsupported buckets", () => {
		const payload = createPayload({
			materials: [
				createTexturedMaterial(0x08000010),
				createTexturedMaterial(0x08000011, { surfaceType: 0x4 }),
				createSolidMaterial(0x08000012),
				createIndexedMaterial(0x08000013),
				createTexturedMaterial(0x08000014, { surfaceType: 0x10 }),
				createSolidMaterial(0x08000015, { surfaceType: 0x20000 }),
			],
			textureRefs: [...createRgbaTextureRefs(), ...createIndexedTextureRefs()],
		});
		const input = createBakeInput(payload);

		const result = bakeStaticObjectBatch(input);

		expect(result.materialCoverage).toEqual([
			expect.objectContaining({
				deferredTriangleCount: 0,
				detailRoleCount: 0,
				domain: "outdoor-buildings",
				fallbackReasonCount: 1,
				landblockId: 0xda55ffff,
				materialCount: 6,
				partitionCount: 6,
				renderedTriangleCount: 5,
				triangleCount: 6,
				unsupportedTriangleCount: 1,
			}),
		]);
		expect(result.materialCoverage[0]?.buckets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					family: "texture-rgba",
					filteringMode: "none",
					materialCount: 1,
					outcome: "rendered",
					pass: "alpha-test",
					triangleCount: 1,
				}),
				expect.objectContaining({
					family: "flat-color",
					outcome: "rendered",
					pass: "opaque",
					triangleCount: 1,
				}),
				expect.objectContaining({
					family: "indexed-paletted",
					filteringMode: "shader-palette-linear",
					outcome: "rendered",
					pass: "opaque",
					triangleCount: 1,
				}),
				expect.objectContaining({
					family: "texture-rgba",
					outcome: "rendered",
					pass: "transparent",
					triangleCount: 1,
				}),
				expect.objectContaining({
					family: "unsupported",
					outcome: "unsupported",
					pass: "opaque",
					triangleCount: 1,
				}),
			]),
		);
		expect(result.materialCoverage[0]?.fallbackReasonCounts).toEqual([
			{ code: "unsupported-surface-flag", count: 1 },
		]);
		expect(result.materialCoverage[0]?.unrenderedBuckets[0]).toMatchObject({
			family: "unsupported",
			outcome: "unsupported",
			pass: "opaque",
			triangleCount: 1,
		});
	});

	it("bakes indexed paletted partitions with separate index and palette texture uses", () => {
		const payload = createPayload({
			materials: [createIndexedMaterial(0x08000013)],
			textureRefs: createIndexedTextureRefs(),
		});
		const result = bakeStaticObjectBatch(createBakeInput(payload));
		const drawUnit = result.objectVisualInstallSet.directDrawUnits[0];

		expect(drawUnit).toMatchObject({
			kind: "static-object-geometry",
			materialFamily: "indexed-paletted",
		});
		if (!drawUnit || drawUnit.kind !== "static-object-geometry") {
			throw new Error("Expected indexed static object geometry draw unit.");
		}
		const materialEntry = drawUnit.materialEntries[0];
		if (!materialEntry) {
			throw new Error("Expected indexed static object material entry.");
		}
		expect(materialEntry.indexedTextureFormat).toBe("p8");
		expect(materialEntry.primaryTextureUseId).toBeNull();
		expect(materialEntry.indexTextureUseId).toContain("index8");
		expect(materialEntry.paletteTextureUseId).toContain("palette-texture-use");
		expect(materialEntry.paletteFirstIndex).toBe(0);
		expect(drawUnit.textureUseIds).toHaveLength(2);
		expect(drawUnit.textureUseIds).toEqual(
			expect.arrayContaining([
				materialEntry.indexTextureUseId,
				materialEntry.paletteTextureUseId,
			]),
		);
		expect(result.textureUses.map((textureUse) => textureUse.source)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "prepared-render-surface-texture-use",
					usage: "index8",
				}),
				expect.objectContaining({
					kind: "palette-texture-use",
					usage: "palette-rgba",
				}),
			]),
		);
	});

	it("keeps indexed material partitions distinct by authored palette replacements", () => {
		const material = createIndexedMaterial(0x08000013);
		const payload = createPayload({
			materials: [material, material],
			paletteViews: [createPaletteViews(16, 32), createPaletteViews(64, 32)],
			textureRefs: createIndexedTextureRefs(),
		});

		const plan = partitionStaticObjectBatches(payload);

		expect(plan.partitions).toHaveLength(1);
		expect(
			plan.partitions[0]?.coarseTablePlan.entries.map((entry) => {
				const paletteUse = entry.textureDataUses.find(
					(dataUse) => dataUse.kind === "palette-texture-use",
				);
				if (!paletteUse || paletteUse.kind !== "palette-texture-use") {
					throw new Error("Expected indexed partition palette data use.");
				}
				return {
					firstIndex: paletteUse.firstIndex,
					indexCount: paletteUse.indexCount,
					subPalettes: paletteUse.subPalettes.map((subPalette) => ({
						firstIndex: subPalette.firstIndex,
						indexCount: subPalette.indexCount,
						paletteId: subPalette.palette.paletteId,
					})),
				};
			}),
		).toEqual([
			{
				firstIndex: 0,
				indexCount: 256,
				subPalettes: [
					{ firstIndex: 16, indexCount: 32, paletteId: 0x04000010 },
				],
			},
			{
				firstIndex: 0,
				indexCount: 256,
				subPalettes: [
					{ firstIndex: 64, indexCount: 32, paletteId: 0x04000010 },
				],
			},
		]);
	});

	it("bakes static object placement and source scale into render-local positions", () => {
		const payload = createPayload({
			materials: [createTexturedMaterial(0x08000010)],
			objectPlacement: createPlacement({ x: 10, y: 20, z: 30 }),
			partPositions: new Float32Array([0, 1, 0, 0, 0, 1, 1, 0, 0]),
			sourceScale: { x: 2, y: 3, z: 4 },
			textureRefs: createRgbaTextureRefs(),
		});
		const input = createBakeInput(payload);

		const result = bakeStaticObjectBatch(input);
		const drawUnit = result.objectVisualInstallSet.directDrawUnits[0];

		expect(drawUnit).toMatchObject({ kind: "static-object-geometry" });
		if (!drawUnit || drawUnit.kind !== "static-object-geometry") {
			throw new Error("Expected static object geometry draw unit.");
		}
		expect(Array.from(drawUnit.positions.slice(0, 9))).toEqual([
			10, 34, -20, 10, 30, -17, 12, 30, -20,
		]);
	});

	it("bakes fan triangles from the same polygon and material as distinct geometry", () => {
		const payload = createPayload({
			materials: [createTexturedMaterial(0x08000010)],
			partPositions: createPartPositions(2),
			textureRefs: createRgbaTextureRefs(),
		});
		const source = payload.sourceAssets[0];
		const part = source?.parts[0];
		if (!source || !part) {
			throw new Error("Fixture payload did not create a source part.");
		}
		const updatedPart = {
			...part,
			renderTriangleCount: 2,
			triangles: [
				{
					firstVertex: 0,
					geometrySurfaceId: 0,
					materialVariantSignature: null,
					polygonId: 7,
				},
				{
					firstVertex: 3,
					geometrySurfaceId: 0,
					materialVariantSignature: null,
					polygonId: 7,
				},
			],
		};
		const input = createBakeInput({
			...payload,
			sourceAssets: [
				{
					...source,
					parts: [updatedPart],
					renderTriangleCount: 2,
				},
			],
		});

		const result = bakeStaticObjectBatch(input);
		const drawUnit = result.objectVisualInstallSet.directDrawUnits.find(
			(candidate) => candidate.kind === "static-object-geometry",
		);

		expect(drawUnit).toMatchObject({
			kind: "static-object-geometry",
			triangleCount: 2,
		});
		if (!drawUnit || drawUnit.kind !== "static-object-geometry") {
			throw new Error("Expected static object geometry draw unit.");
		}
		expect(Array.from(drawUnit.positions.slice(0, 18))).toEqual([
			1, 1, 1, 0, 1, 1, 1, 0, 1, 2, 1, 1, 0, 1, 1, 1, 0, 1,
		]);
		expect(result.staticSourceMappings).toEqual([]);
		expect(drawUnit.sourceMappingCoverage).toMatchObject([
			{
				geometrySurfaceIds: [0],
				materialVariantSignatures: [null],
				polygonCount: 1,
				polygonRange: { max: 7, min: 7 },
				sourceTriangleCount: 2,
			},
		]);
		const recipeDrawUnit = result.objectVisualInstallSet.directDrawUnits.find(
			(candidate) => candidate.kind === "static-object-geometry",
		);
		expect(recipeDrawUnit).toMatchObject({
			kind: "static-object-geometry",
			triangleCount: 2,
		});
		if (!recipeDrawUnit || recipeDrawUnit.kind !== "static-object-geometry") {
			throw new Error("Expected recipe static object geometry draw unit.");
		}
		expect(Array.from(recipeDrawUnit.positions.slice(0, 18))).toEqual([
			1, 1, 1, 0, 1, 1, 1, 0, 1, 2, 1, 1, 0, 1, 1, 1, 0, 1,
		]);
	});
});

function createEnvCellStaticPayload(): StaticObjectBatchPayload &
	OutdoorStaticObjectsScopePayload {
	const payload = duplicateObjectInstance(
		createPayload({
			domain: "env-cell-system",
			materials: [createSolidMaterial(0x08000010)],
		}),
	);
	const firstObject = payload.objects[0];
	const secondObject = payload.objects[1];
	if (!firstObject || !secondObject) {
		throw new Error("Fixture payload did not create env-cell static objects.");
	}

	const firstIdentity = createObjectIdentity({
		instanceId: "da550100:seed-0",
	});
	const secondIdentity = createObjectIdentity({
		instanceId: "da550101:seed-0",
	});

	return {
		...payload,
		materialSlots: payload.materialSlots.map((slot) => {
			const object =
				slot.object.instanceId === firstObject.identity.instanceId
					? firstIdentity
					: secondIdentity;
			return {
				...slot,
				identity: {
					...slot.identity,
					part: {
						...slot.identity.part,
						object,
					},
				},
				object,
			};
		}),
		objects: [
			{
				...firstObject,
				identity: firstIdentity,
				owningEnvCellId: 0xda550100,
			},
			{
				...secondObject,
				identity: secondIdentity,
				owningEnvCellId: 0xda550101,
			},
		],
	};
}

function createEnvCellStaticBakeInput(): StaticBakeBatchInput {
	const payload = createEnvCellStaticScopePayload();
	const task: StaticBakeTask = {
		domain: "env-cell-system",
		ownerId: "env-cell-system:0xda55ffff",
		ownerKey: {
			kind: "env-cell-system",
			landblockId: 0xda55ffff,
		},
		revision: 1,
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		taskId: "1:landblock:da55ffff:env-cell-system",
	};

	const input: StaticBakeBatchInput = {
		attachments: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: payload.sourceAssets.flatMap((source) =>
				source.parts.map((part) => {
					const fixturePart = part as typeof part & {
						readonly positions: Float32Array;
						readonly texCoords: Float32Array;
					};
					return {
						buffer: {
							bounds: null,
							bufferId: objectVisualGeometryBufferId(0),
							coordinateSpace: "source-local",
							normals: new Float32Array(fixturePart.positions.length),
							positions: fixturePart.positions,
							texCoords: fixturePart.texCoords,
							triangleCount: part.triangles.length,
							triangles: part.triangles.map((triangle) => ({
								firstVertex: triangle.firstVertex,
								materialVariantSignature:
									triangle.materialVariantSignature ?? null,
								polygonId: triangle.polygonId,
								surfaceId: triangle.geometrySurfaceId,
							})),
							vertexCount: fixturePart.positions.length / 3,
						},
						identity: part.geometry.canonical,
					};
				}),
			),
		},
		domain: "env-cell-system",
		items: [
			{
				payload: {
					job: {
						domain: task.domain,
						scope: task.scope,
					},
					scope: payload,
					sourceRevision: 1,
				},
				task,
			},
		],
		revision: 1,
		bakeBatchId: "static-batch:objects",
	};
	return {
		...input,
		texturePlacementSnapshot: createTexturePlacementSnapshotForInput(input),
	};
}

function createEnvCellStaticScopePayload(): EnvCellSystemStaticScopePayload {
	const payload = createEnvCellStaticPayload();
	return {
		acceptedEnvCellIds: [0xda550100, 0xda550101],
		buildingTransitionApertures: [],
		envCells: payload.objects.map((object) =>
			createEnvCellStaticScopeEnvCell(object.owningEnvCellId ?? 0, object),
		),
		kind: "env-cell-system",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "env-cells",
		},
		materialSources: payload.materialSources,
		missingRefs: [],
		paletteSources: payload.paletteSources,
		portalLinks: [],
		regionRenderProfile: {
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		residencySpatial: {
			landblockBounds: null,
			nodeBounds: [],
		},
		sourceAssets: payload.sourceAssets,
		textureRefs: payload.textureRefs,
		visibilityDiagnostics: [],
	};
}

function createEnvCellStaticScopeEnvCell(
	envCellId: number,
	object: StaticObjectBatchPayload["objects"][number],
): EnvCellSystemStaticScopePayload["envCells"][number] {
	return {
		cellBsp: {
			kind: "leaf",
			polyIds: [],
			solid: 0,
			sphere: null,
		},
		cellStructure: {
			cellStructureId: 0x0d000001,
			kind: "cell-structure",
		},
		environment: {
			environmentId: 0x0e000001,
			kind: "environment",
		},
		identity: {
			envCellId,
			kind: "env-cell-source",
		},
		landblockId: 0xda55ffff,
		localPlacement: createPlacement(),
		memberId: `member-${envCellId.toString(16)}`,
		portalApertures: [],
		portals: [],
		renderGeometry: {
			bounds: null,
			invalidPolygons: [],
			skippedPolygonCount: 0,
			sourceId: envCellId,
			surfaceIds: [],
			triangleCount: 0,
			triangles: [],
			vertexCount: 0,
		},
		restrictionObjectId: null,
		seenOutside: null,
		staticObjectPlacements: [
			{
				debug: object.debug,
				identity: object.identity,
				localPlacement: object.localPlacement,
				source: object.source,
				sourceIndex: object.sourceIndex,
				sourceScale: object.sourceScale,
			},
		],
		surfaces: [],
		visibleEnvCellIds: [],
	};
}

function duplicateObjectInstance(
	payload: OutdoorStaticObjectsScopePayload,
): OutdoorStaticObjectsScopePayload {
	const object = payload.objects[0];
	if (!object) {
		throw new Error("Fixture payload did not create an object.");
	}
	const duplicateObject = {
		...object,
		identity: createObjectIdentity({
			instanceId:
				object.identity.objectKind === "generated-scenery"
					? "detail-1"
					: "building-1",
			objectKind: object.identity.objectKind,
		}),
		sourceIndex: object.sourceIndex + 1,
	};

	return {
		...payload,
		materialSlots: [
			...payload.materialSlots,
			...payload.materialSlots.map((slot) => ({
				...slot,
				identity: {
					...slot.identity,
					part: {
						...slot.identity.part,
						object: duplicateObject.identity,
					},
				},
				object: duplicateObject.identity,
			})),
		],
		objects: [...payload.objects, duplicateObject],
	};
}

function duplicateObjectWithDistinctSourceGfx(
	payload: OutdoorStaticObjectsScopePayload,
): OutdoorStaticObjectsScopePayload {
	const object = payload.objects[0];
	const sourceAsset = payload.sourceAssets[0];
	const part = sourceAsset?.parts[0];
	if (!object || !sourceAsset || !part) {
		throw new Error("Fixture payload did not create an object source part.");
	}

	const source = createSourceIdentity({ sourceDid: 0x02000011 });
	const gfxObj = createGfxObjIdentity({ sourceDid: 0x01000021 });
	const duplicateObject = {
		...object,
		debug: { sourceAssetId: "setup-model/02000011" },
		identity: createObjectIdentity({ instanceId: "building-1" }),
		source,
		sourceIndex: object.sourceIndex + 1,
	};

	return {
		...payload,
		materialSlots: [
			...payload.materialSlots,
			...payload.materialSlots.map((slot) => ({
				...slot,
				gfxObj,
				identity: {
					...slot.identity,
					part: {
						...slot.identity.part,
						object: duplicateObject.identity,
					},
				},
				object: duplicateObject.identity,
				source,
			})),
		],
		objects: [...payload.objects, duplicateObject],
		sourceAssets: [
			...payload.sourceAssets,
			{
				...sourceAsset,
				debug: { sourceAssetId: "setup-model/02000011" },
				identity: source,
				parts: [
					{
						...part,
						gfxObj,
						source,
					},
				],
			},
		],
	};
}

function createPayload(options: {
	readonly domain?: OutdoorStaticObjectsScopePayload["domain"];
	readonly materials: readonly StaticObjectMaterialSourceFacts[];
	readonly objectPlacement?: ReturnType<typeof createPlacement>;
	readonly instanceBounds?: StaticBounds;
	readonly partPositions?: Float32Array;
	readonly sourceScale?: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly paletteViews?: readonly (readonly StaticObjectPaletteViewFacts[])[];
	readonly detailRoles?: OutdoorStaticObjectsScopePayload["regionRenderProfile"]["detailRoles"];
	readonly buildingTransitionApertures?: OutdoorStaticObjectsScopePayload["buildingTransitionApertures"];
	readonly textureRefs?: readonly StaticObjectTextureRefFacts[];
}): OutdoorStaticObjectsScopePayload {
	const domain = options.domain ?? "outdoor-buildings";
	const isGeneratedScenery =
		domain === "outdoor-generated-scenery" ||
		domain === "outdoor-generated-scenery";
	const objectIdentity = createObjectIdentity({
		instanceId: isGeneratedScenery ? "detail-0" : "building-0",
		objectKind: isGeneratedScenery ? "generated-scenery" : "building",
	});
	const partPositions =
		options.partPositions ?? createPartPositions(options.materials.length);
	const partVertexCount = partPositions.length / 3;

	return {
		authoredDynamicPlacements: [],
		buildingTransitionApertures: options.buildingTransitionApertures ?? [],
		domain,
		kind: "outdoor-static-objects",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "outdoor",
		},
		materialSlots: options.materials.map((material, index) => ({
			gfxObj: createGfxObjIdentity(),
			identity: {
				kind: "static-material-slot",
				part: {
					kind: "static-object-part",
					object: objectIdentity,
					partIndex: 0,
				},
				geometrySurfaceId: index,
				materialSurfaceId: material.surfaceId,
				slotIndex: index,
			},
			material: material.identity,
			materialVariantSignature: null,
			object: objectIdentity,
			paletteOverride: null,
			paletteViews: options.paletteViews?.[index] ?? [],
			source: createSourceIdentity(),
		})),
		materialSources: options.materials,
		missingRefs: [],
		objects: [
			{
				debug: { sourceAssetId: "setup-model/02000010" },
				generated:
					domain === "outdoor-generated-scenery" ||
					domain === "outdoor-generated-scenery"
						? { sceneId: 1, sceneTemplateIndex: 0, terrainIndex: 0 }
						: null,
				identity: objectIdentity,
				instanceBounds: options.instanceBounds ?? null,
				localPlacement: options.objectPlacement ?? createPlacement(),
				portalCount: 0,
				source: createSourceIdentity(),
				sourceBounds: null,
				sourceIndex: 0,
				sourceScale: options.sourceScale ?? { x: 1, y: 1, z: 1 },
			},
		],
		paletteSources: createPaletteSources(),
		regionRenderProfile: {
			detailRoles: options.detailRoles ?? [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		sourceAssets: [
			{
				bounds: null,
				debug: { sourceAssetId: "setup-model/02000010" },
				defaultAnimation: null,
				identity: createSourceIdentity(),
				invalidPolygonCount: 0,
				materialSlotCount: options.materials.length,
				partCount: 1,
				parts: [
					{
						bounds: null,
						defaultPlacements: [createPlacement()],
						geometry: createStaticObjectSourceGeometryIdentity({
							gfxObj: createGfxObjIdentity(),
							partIndex: 0,
							source: createSourceIdentity(),
						}),
						gfxObj: createGfxObjIdentity(),
						invalidPolygonCount: 0,
						materialSlotCount: options.materials.length,
						materialSlots: options.materials.map((material, index) => ({
							geometrySurfaceId: index,
							material: material.identity,
							materialSurfaceId: material.surfaceId,
							materialVariantSignature: null,
							paletteOverride: null,
							paletteViews: options.paletteViews?.[index] ?? [],
							slotIndex: index,
						})),
						normals: new Float32Array(partPositions.length),
						partIndex: 0,
						physicsPolygonCount: 0,
						positions: partPositions,
						renderTriangleCount: options.materials.length,
						scale: { x: 1, y: 1, z: 1 },
						skippedPolygonCount: 0,
						source: createSourceIdentity(),
						texCoords: new Float32Array(partVertexCount * 2),
						triangles: options.materials.map((material, index) => ({
							firstVertex: index * 3,
							geometrySurfaceId: index,
							materialVariantSignature: null,
							polygonId: index,
						})),
					},
				],
				physicsPolygonCount: 0,
				renderTriangleCount: options.materials.length,
				skippedPolygonCount: 0,
				sourceAssetKind: "setup-model",
			},
		],
		sourceSpatial: {
			bounds: null,
			coordinateSpace: "landblock-render-local",
			outdoorBvhItemCount: 0,
			outdoorBvhNodeCount: 0,
		},
		textureRefs: options.textureRefs ?? [],
	};
}

function createBakeInput(
	payload: OutdoorStaticObjectsScopePayload,
): StaticBakeBatchInput {
	const domain = payload.domain;
	const ownerKey = {
		kind: staticObjectLayerOwnerKindForDomain(domain),
		landblockId: payload.landblock.landblockId,
	} as const;
	const task: StaticBakeTask = {
		domain,
		ownerId: `${ownerKey.kind}:0xda55ffff`,
		ownerKey,
		revision: 1,
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		taskId: `1:landblock:da55ffff:${domain}`,
	};

	const input: StaticBakeBatchInput = {
		attachments: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: payload.sourceAssets.flatMap((source) =>
				source.parts.map((part) => {
					const fixturePart = part as typeof part & {
						readonly positions: Float32Array;
						readonly texCoords: Float32Array;
					};
					return {
						buffer: {
							bounds: null,
							bufferId: objectVisualGeometryBufferId(0),
							coordinateSpace: "source-local",
							normals: new Float32Array(fixturePart.positions.length),
							positions: fixturePart.positions,
							texCoords: fixturePart.texCoords,
							triangleCount: part.triangles.length,
							triangles: part.triangles.map((triangle) => ({
								firstVertex: triangle.firstVertex,
								materialVariantSignature:
									triangle.materialVariantSignature ?? null,
								polygonId: triangle.polygonId,
								surfaceId: triangle.geometrySurfaceId,
							})),
							vertexCount: fixturePart.positions.length / 3,
						},
						identity: part.geometry.canonical,
					};
				}),
			),
		},
		domain,
		items: [
			{
				payload: {
					job: {
						domain: task.domain,
						scope: task.scope,
					},
					scope: payload,
					sourceRevision: 1,
				},
				task,
			},
		],
		revision: 1,
		bakeBatchId: "static-batch:objects",
	};
	return {
		...input,
		texturePlacementSnapshot: createTexturePlacementSnapshotForInput(input),
	};
}

function createTexturePlacementSnapshot(
	placements: readonly (readonly [string, string])[],
): ObjectVisualTexturePlacementSnapshot {
	const itemIdsByTextureUseId = new Map(
		placements.map(([textureUseId], index) => [textureUseId, index]),
	);
	return {
		itemIdsByTextureUseId,
		placementsByItemId: new Map(
			placements.map(([textureUseId, pageId], index) => [
				index,
				{
					height: 64,
					itemId: index,
					pageId,
					pool: "static-authored-object" as const,
					purpose: "object-base-color" as const,
					rect: [0, 0, 64, 64] as const,
					textureRefId: `texture-ref:${pageId}`,
					textureUseId,
					width: 64,
				},
			]),
		),
	};
}

function createTexturePlacementSnapshotForInput(
	input: StaticBakeBatchInput,
): ObjectVisualTexturePlacementSnapshot {
	const intents = createStaticObjectTexturePlacementIntents({
		items: input.items,
	});
	return {
		itemIdsByTextureUseId: new Map(
			intents.map((intent) => [intent.textureUseId, intent.itemId]),
		),
		placementsByItemId: new Map(
			intents.map((intent) => [
				intent.itemId,
				{
					height: 64,
					itemId: intent.itemId,
					pageId: `${intent.purpose}:page:0`,
					pool: intent.pool,
					purpose: intent.purpose,
					rect: [0, 0, 64, 64] as const,
					textureRefId: `${intent.purpose}:texture-ref:0`,
					textureUseId: intent.textureUseId,
					width: 64,
				},
			]),
		),
	};
}

function staticObjectLayerOwnerKindForDomain(
	domain: OutdoorStaticObjectsScopePayload["domain"],
) {
	switch (domain) {
		case "outdoor-buildings":
			return "outdoor-buildings" as const;
		case "outdoor-explicit-objects":
			return "outdoor-explicit-objects" as const;
		case "outdoor-generated-scenery":
			return "outdoor-generated-scenery" as const;
	}
}

function createSolidMaterial(
	materialId: number,
	options: {
		readonly argb?: number;
		readonly diffuse?: number;
		readonly luminosity?: number;
		readonly surfaceType?: number;
	} = {},
): StaticObjectMaterialSourceFacts {
	return {
		diffuse: options.diffuse ?? 1,
		identity: createMaterialIdentity(materialId),
		luminosity: options.luminosity ?? 0,
		source: {
			argb: options.argb ?? 0xffffffff,
			kind: "solid-color",
		},
		surfaceId: materialId,
		surfaceType: options.surfaceType ?? 0,
		translucency: 0,
	};
}

function createTexturedMaterial(
	materialId: number,
	options: {
		readonly diffuse?: number;
		readonly luminosity?: number;
		readonly renderSurfaceId?: number;
		readonly surfaceType?: number;
		readonly surfaceTextureId?: number;
	} = {},
): StaticObjectMaterialSourceFacts {
	const renderSurfaceId = options.renderSurfaceId ?? 0x06000010;
	const surfaceTextureId = options.surfaceTextureId ?? 0x05000010;

	return {
		diffuse: options.diffuse ?? 1,
		identity: createMaterialIdentity(materialId),
		luminosity: options.luminosity ?? 0,
		source: {
			kind: "texture",
			palette: null,
			renderSurfaceDefaultPalettes: [],
			selectedRenderSurface: {
				kind: "render-surface",
				renderSurfaceId,
			},
			texture: {
				kind: "surface-texture",
				surfaceTextureId,
			},
		},
		surfaceId: materialId,
		surfaceType: options.surfaceType ?? 0,
		translucency: 0,
	};
}

function createIndexedMaterial(
	materialId: number,
	overrides: Partial<StaticObjectMaterialSourceFacts> = {},
): StaticObjectMaterialSourceFacts {
	return {
		diffuse: 1,
		identity: createMaterialIdentity(materialId),
		luminosity: 0,
		source: {
			kind: "texture",
			palette: {
				kind: "palette",
				paletteId: 0x04000010,
			},
			renderSurfaceDefaultPalettes: [],
			selectedRenderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000020,
			},
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000020,
			},
		},
		surfaceId: materialId,
		surfaceType: 0,
		translucency: 0,
		...overrides,
	};
}

function createRgbaTextureRefs(
	options: {
		readonly renderSurfaceId?: number;
		readonly surfaceTextureId?: number;
	} = {},
): readonly StaticObjectTextureRefFacts[] {
	const renderSurfaceId = options.renderSurfaceId ?? 0x06000010;
	const surfaceTextureId = options.surfaceTextureId ?? 0x05000010;

	return [
		{
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId,
			},
			role: "surface-texture",
			texture: {
				kind: "surface-texture",
				surfaceTextureId,
			},
		},
		{
			format: "rgba",
			formatRaw: 1,
			height: 32,
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId,
			},
			role: "render-surface",
			width: 32,
		},
	];
}

function createDetailTextureRefs(): readonly StaticObjectTextureRefFacts[] {
	return [
		{
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000030,
			},
			role: "surface-texture",
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000030,
			},
		},
		{
			format: "rgba",
			formatRaw: 1,
			height: 16,
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000030,
			},
			role: "render-surface",
			width: 16,
		},
	];
}

function createIndexedTextureRefs(): readonly StaticObjectTextureRefFacts[] {
	return [
		{
			palette: {
				kind: "palette",
				paletteId: 0x04000010,
			},
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000020,
			},
			role: "surface-texture",
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000020,
			},
		},
		{
			format: "p8",
			formatRaw: 0x29,
			height: 32,
			palette: {
				kind: "palette",
				paletteId: 0x04000010,
			},
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000020,
			},
			role: "render-surface",
			width: 32,
		},
	];
}

function createPaletteSources() {
	return [
		{
			colorCount: 256,
			palette: {
				kind: "palette" as const,
				paletteId: 0x04000010,
			},
		},
	];
}

function createPaletteViews(
	firstIndex: number,
	indexCount: number,
): readonly StaticObjectPaletteViewFacts[] {
	return [
		{
			firstIndex,
			indexCount,
			palette: {
				kind: "palette",
				paletteId: 0x04000010,
			},
		},
	];
}

function createMaterialIdentity(
	materialId: number,
): StaticMaterialSourceIdentity {
	return {
		kind: "static-material-source",
		materialId,
	};
}

function createObjectIdentity(
	options: {
		readonly instanceId?: string;
		readonly objectKind?: "building" | "generated-scenery";
	} = {},
) {
	return {
		instanceId: options.instanceId ?? "building-0",
		kind: "static-object-instance" as const,
		landblockId: 0xda55ffff,
		objectKind: options.objectKind ?? "building",
	};
}

function createSourceIdentity(options: { readonly sourceDid?: number } = {}) {
	return {
		kind: "static-object-source" as const,
		sourceAssetKind: "setup-model" as const,
		sourceDid: options.sourceDid ?? 0x02000010,
	};
}

function createGfxObjIdentity(options: { readonly sourceDid?: number } = {}) {
	return {
		kind: "static-object-source" as const,
		sourceAssetKind: "gfx-obj" as const,
		sourceDid: options.sourceDid ?? 0x01000020,
	};
}

function createPartPositions(triangleCount: number): Float32Array {
	const positions = new Float32Array(triangleCount * 9);
	for (
		let triangleIndex = 0;
		triangleIndex < triangleCount;
		triangleIndex += 1
	) {
		const offset = triangleIndex * 9;
		positions[offset] = 1 + triangleIndex;
		positions[offset + 1] = 1;
		positions[offset + 2] = 1;
		positions[offset + 3] = 0;
		positions[offset + 4] = 1;
		positions[offset + 5] = 1;
		positions[offset + 6] = 1;
		positions[offset + 7] = 0;
		positions[offset + 8] = 1;
	}

	return positions;
}

function createBounds(): StaticBounds {
	return {
		max: { x: 1, y: 1, z: 1 },
		min: { x: 0, y: 0, z: 0 },
	};
}

function createPlacement(
	origin: { readonly x: number; readonly y: number; readonly z: number } = {
		x: 0,
		y: 0,
		z: 0,
	},
) {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin,
	};
}

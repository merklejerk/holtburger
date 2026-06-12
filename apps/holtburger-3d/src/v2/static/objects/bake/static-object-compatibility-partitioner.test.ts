import { describe, expect, it } from "vitest";
import type {
	OutdoorStaticObjectsScopePayload,
	StaticBakeBatchInput,
	StaticMaterialSourceIdentity,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteViewFacts,
	StaticObjectTextureRefFacts,
} from "../../contracts";
import { bakeStaticObjectCompatibility } from "./static-object-compatibility-baker";
import {
	partitionStaticObjectCompatibility,
	STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE,
} from "./static-object-compatibility-partitioner";

describe("V2 static object compatibility partitioner", () => {
	it("partitions compatible solid materials by bounded material table capacity", () => {
		const materialCount = STATIC_OBJECT_MAX_MATERIALS_PER_DRAW_SLICE + 1;
		const payload = createPayload({
			materials: Array.from({ length: materialCount }, (_, index) =>
				createSolidMaterial(0x08000010 + index),
			),
		});

		const plan = partitionStaticObjectCompatibility(payload);

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

		const plan = partitionStaticObjectCompatibility(payload);

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

		const plan = partitionStaticObjectCompatibility(payload);

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

		expect(() => partitionStaticObjectCompatibility(payload)).toThrow(
			/has no resolved material slot/,
		);
	});

	it("bakes opaque texture-rgba partitions into rendered draw units and stageable texture uses", () => {
		const payload = createPayload({
			materials: [createTexturedMaterial(0x08000010)],
			textureRefs: createRgbaTextureRefs(),
		});
		const input = createBakeInput(payload);

		const result = bakeStaticObjectCompatibility(input);

		expect(result.drawUnits).toEqual([
			expect.objectContaining({
				drawUnitId:
					"1:landblock:da55ffff:outdoor-buildings:static-object-partition:slice-0-0",
				kind: "static-object-geometry",
				materialFamily: "texture-rgba",
				materialPass: "opaque",
				primaryTextureUseId:
					"1:landblock:da55ffff:outdoor-buildings:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:wrap:clamp",
			}),
		]);
		expect(result.textureUses).toEqual([
			expect.objectContaining({
				domain: "outdoor-buildings",
				ownerDrawUnitIds: [
					"1:landblock:da55ffff:outdoor-buildings:static-object-partition:slice-0-0",
				],
				source: {
					kind: "prepared-render-surface-texture-use",
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					usage: "rgba-color",
				},
				samplingPolicy: {
					wrapS: "clamp-to-edge",
					wrapT: "clamp-to-edge",
				},
			}),
		]);
		expect(result.staticSourceMappings).toEqual([
			"1:landblock:da55ffff:outdoor-buildings:static-object-partition:slice-0-0:source:da55ffff:building:building-0:part:0:polygon:0:first-vertex:0:geometry-surface:0:variant:base",
		]);
		expect(result.staticSpatialRecords).toEqual([
			"1:landblock:da55ffff:outdoor-buildings:static-object-partition:slice-0-0:bounds:1t",
		]);
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

		const result = bakeStaticObjectCompatibility(input);

		expect(result.drawUnits).toEqual([
			expect.objectContaining({
				kind: "static-object-geometry",
				materialColor: [
					(0x33 / 255) * 0.5,
					(0x66 / 255) * 0.5,
					(0x99 / 255) * 0.5,
					1,
				],
				materialEmissiveColor: [0.25, 0.25, 0.25],
				materialFamily: "flat-color",
				primaryTextureUseId: null,
				textureUseIds: [],
			}),
		]);
		expect(result.textureUses).toEqual([]);
	});

	it("splits static object partitions by material color constants", () => {
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

		const plan = partitionStaticObjectCompatibility(payload);

		expect(plan.partitions).toHaveLength(2);
		expect(plan.partitions.map((partition) => partition.materialColor)).toEqual([
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

		const result = bakeStaticObjectCompatibility(input);
		const drawUnit = result.drawUnits[0];

		expect(drawUnit).toMatchObject({
			alphaTest: 200 / 255,
			kind: "static-object-geometry",
			materialFamily: "texture-rgba",
			materialPass: "alpha-test",
		});
		expect(result.textureUses).toHaveLength(1);
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
			textureRefs: [
				...createRgbaTextureRefs(),
				...createIndexedTextureRefs(),
			],
		});
		const input = createBakeInput(payload);

		const result = bakeStaticObjectCompatibility(input);

		expect(result.materialCoverage).toEqual([
			expect.objectContaining({
				deferredTriangleCount: 1,
				detailRoleCount: 0,
				domain: "outdoor-buildings",
				fallbackReasonCount: 2,
				landblockId: 0xda55ffff,
				materialCount: 6,
				partitionCount: 6,
				renderedTriangleCount: 4,
				triangleCount: 6,
				unsupportedTriangleCount: 1,
			}),
		]);
		expect(result.materialCoverage[0]?.buckets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					family: "texture-rgba",
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
					outcome: "rendered",
					pass: "opaque",
					triangleCount: 1,
				}),
				expect.objectContaining({
					family: "texture-rgba",
					outcome: "render-deferred",
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
			{ code: "translucent-render-deferred", count: 1 },
			{ code: "unsupported-surface-flag", count: 1 },
		]);
		expect(result.materialCoverage[0]?.unrenderedBuckets[0]).toMatchObject({
			family: "texture-rgba",
			outcome: "render-deferred",
			pass: "transparent",
			triangleCount: 1,
		});
	});

	it("bakes indexed paletted partitions with separate index and palette texture uses", () => {
		const payload = createPayload({
			materials: [createIndexedMaterial(0x08000013)],
			textureRefs: createIndexedTextureRefs(),
		});
		const result = bakeStaticObjectCompatibility(createBakeInput(payload));
		const drawUnit = result.drawUnits[0];

		expect(drawUnit).toMatchObject({
			kind: "static-object-geometry",
			materialFamily: "indexed-paletted",
			primaryTextureUseId: null,
		});
		if (!drawUnit || drawUnit.kind !== "static-object-geometry") {
			throw new Error("Expected indexed static object geometry draw unit.");
		}
		expect(drawUnit.indexTextureUseId).toContain("index8");
		expect(drawUnit.paletteTextureUseId).toContain("palette-texture-use");
		expect(drawUnit.paletteFirstIndex).toBe(0);
		expect(drawUnit.textureUseIds).toHaveLength(2);
		expect(drawUnit.textureUseIds).toEqual(
			expect.arrayContaining([
				drawUnit.indexTextureUseId,
				drawUnit.paletteTextureUseId,
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

		const plan = partitionStaticObjectCompatibility(payload);

		expect(plan.partitions).toHaveLength(2);
		expect(
			plan.partitions.map((partition) => {
				const paletteUse = partition.textureDataUses.find(
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
				subPalettes: [{ firstIndex: 16, indexCount: 32, paletteId: 0x04000010 }],
			},
			{
				firstIndex: 0,
				indexCount: 256,
				subPalettes: [{ firstIndex: 64, indexCount: 32, paletteId: 0x04000010 }],
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

		const result = bakeStaticObjectCompatibility(input);
		const drawUnit = result.drawUnits[0];

		expect(drawUnit).toMatchObject({ kind: "static-object-geometry" });
		if (!drawUnit || drawUnit.kind !== "static-object-geometry") {
			throw new Error("Expected static object geometry draw unit.");
		}
		expect(Array.from(drawUnit.positions.slice(0, 9))).toEqual([
			10, 34, -20, 10, 30, -17, 12, 30, -20,
		]);
	});

	it("bakes duplicate polygon ids by geometry surface and material variant", () => {
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
		const input = createBakeInput({
			...payload,
			materialSlots: payload.materialSlots.map((slot, index) => ({
				...slot,
				materialVariantSignature: index === 1 ? "sampler=repeat" : null,
			})),
			sourceAssets: [{ ...source, parts: [updatedPart] }],
		});

		const result = bakeStaticObjectCompatibility(input);
		const drawUnits = result.drawUnits.filter(
			(drawUnit) => drawUnit.kind === "static-object-geometry",
		);

		expect(drawUnits).toHaveLength(2);
		expect(drawUnits.map((drawUnit) => drawUnit.primaryTextureWrapMode)).toEqual([
			"clamp",
			"repeat",
		]);
		expect(result.textureUses.map((textureUse) => ({
			id: textureUse.textureUseId,
			samplingPolicy: textureUse.samplingPolicy,
			usage: textureUse.source.usage,
		}))).toEqual([
			{
				id: "1:landblock:da55ffff:outdoor-buildings:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:wrap:clamp",
				samplingPolicy: {
					wrapS: "clamp-to-edge",
					wrapT: "clamp-to-edge",
				},
				usage: "rgba-color",
			},
			{
				id: "1:landblock:da55ffff:outdoor-buildings:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:wrap:repeat",
				samplingPolicy: {
					wrapS: "repeat",
					wrapT: "repeat",
				},
				usage: "rgba-color",
			},
		]);
		expect(drawUnits.map((drawUnit) => Array.from(drawUnit.positions.slice(0, 3)))).toEqual([
			[1, 1, 1],
			[2, 1, 1],
		]);
		expect(result.staticSourceMappings).toEqual([
			"1:landblock:da55ffff:outdoor-buildings:static-object-partition:slice-0-0:source:da55ffff:building:building-0:part:0:polygon:0:first-vertex:0:geometry-surface:0:variant:base",
			"1:landblock:da55ffff:outdoor-buildings:static-object-partition:slice-1-0:source:da55ffff:building:building-0:part:0:polygon:0:first-vertex:3:geometry-surface:1:variant:sampler=repeat",
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

		const result = bakeStaticObjectCompatibility(input);
		const drawUnit = result.drawUnits.find(
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
			1, 1, 1, 0, 1, 1, 1, 0, 1,
			2, 1, 1, 0, 1, 1, 1, 0, 1,
		]);
		expect(result.staticSourceMappings).toEqual([
			"1:landblock:da55ffff:outdoor-buildings:static-object-partition:slice-0-0:source:da55ffff:building:building-0:part:0:polygon:7:first-vertex:0:geometry-surface:0:variant:base",
			"1:landblock:da55ffff:outdoor-buildings:static-object-partition:slice-0-0:source:da55ffff:building:building-0:part:0:polygon:7:first-vertex:3:geometry-surface:0:variant:base",
		]);
	});
});

function createPayload(options: {
	readonly materials: readonly StaticObjectMaterialSourceFacts[];
	readonly objectPlacement?: ReturnType<typeof createPlacement>;
	readonly partPositions?: Float32Array;
	readonly sourceScale?: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly paletteViews?: readonly (readonly StaticObjectPaletteViewFacts[])[];
	readonly textureRefs?: readonly StaticObjectTextureRefFacts[];
}): OutdoorStaticObjectsScopePayload {
	return {
		domain: "outdoor-buildings",
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
					object: createObjectIdentity(),
					partIndex: 0,
				},
				geometrySurfaceId: index,
				materialSurfaceId: material.surfaceId,
				slotIndex: index,
			},
			material: material.identity,
			materialVariantSignature: null,
			object: createObjectIdentity(),
			paletteOverride: null,
			paletteViews: options.paletteViews?.[index] ?? [],
			source: createSourceIdentity(),
		})),
		materialSources: options.materials,
		missingRefs: [],
		objects: [
			{
				debug: { sourceAssetId: "setup-model/02000010" },
				generated: null,
				identity: createObjectIdentity(),
				instanceBounds: null,
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
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		sourceAssets: [
			{
				bounds: null,
				debug: { sourceAssetId: "setup-model/02000010" },
				identity: createSourceIdentity(),
				invalidPolygonCount: 0,
				materialSlotCount: options.materials.length,
				partCount: 1,
				parts: [
					{
						bounds: null,
						defaultPlacements: [createPlacement()],
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
						normals: new Float32Array(options.materials.length * 9),
						partIndex: 0,
						physicsPolygonCount: 0,
						positions:
							options.partPositions ??
							createPartPositions(options.materials.length),
						renderTriangleCount: options.materials.length,
						scale: { x: 1, y: 1, z: 1 },
						skippedPolygonCount: 0,
						source: createSourceIdentity(),
						texCoords: new Float32Array(options.materials.length * 6),
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
	const work = {
		job: {
			domain: "outdoor-buildings" as const,
			scope: {
				kind: "landblock" as const,
				landblockId: 0xda55ffff,
			},
		},
		priority: 0,
		revision: 1,
		workId: "1:landblock:da55ffff:outdoor-buildings",
	};

	return {
		atlasSnapshot: {
			domain: "outdoor-buildings",
			placements: [],
			staticBatchId: "static-batch:objects",
			textureUses: [],
		},
		domain: "outdoor-buildings",
		items: [
			{
				payload: {
					job: work.job,
					scope: payload,
					sourceRevision: 1,
				},
				work,
			},
		],
		revision: 1,
		staticBatchId: "static-batch:objects",
	};
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
		readonly surfaceType?: number;
	} = {},
): StaticObjectMaterialSourceFacts {
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
				renderSurfaceId: 0x06000010,
			},
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000010,
			},
		},
		surfaceId: materialId,
		surfaceType: options.surfaceType ?? 0,
		translucency: 0,
	};
}

function createIndexedMaterial(materialId: number): StaticObjectMaterialSourceFacts {
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
	};
}

function createRgbaTextureRefs(): readonly StaticObjectTextureRefFacts[] {
	return [
		{
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			role: "surface-texture",
			texture: {
				kind: "surface-texture",
				surfaceTextureId: 0x05000010,
			},
		},
		{
			format: "rgba",
			formatRaw: 1,
			height: 32,
			indexedMaxIndex: null,
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			role: "render-surface",
			width: 32,
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
			indexedMaxIndex: 42,
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

function createObjectIdentity() {
	return {
		instanceId: "building-0",
		kind: "static-object-instance" as const,
		landblockId: 0xda55ffff,
		objectKind: "building" as const,
	};
}

function createSourceIdentity() {
	return {
		kind: "static-object-source" as const,
		sourceAssetKind: "setup-model" as const,
		sourceDid: 0x02000010,
	};
}

function createGfxObjIdentity() {
	return {
		kind: "static-object-source" as const,
		sourceAssetKind: "gfx-obj" as const,
		sourceDid: 0x01000020,
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

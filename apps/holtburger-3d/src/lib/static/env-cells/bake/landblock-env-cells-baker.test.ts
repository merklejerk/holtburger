import { describe, expect, it } from "vitest";
import type {
	EnvCellCellStructureGeometryAttachment,
	LandblockEnvCellStaticFacts,
	LandblockEnvCellsStaticScopePayload,
	RegionDetailRoleFacts,
	StaticBakeBatchInput,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteSourceFacts,
	StaticObjectTextureRefFacts,
	StaticObjectSourceAssetFacts,
} from "../../contracts";
import { createStaticObjectSourceGeometryIdentity } from "../../objects/static-object-source-assets";
import { bakeLandblockEnvCells } from "./landblock-env-cells-baker";
import { createEnvCellCellStructureGeometryIdentity } from "./landblock-env-cell-geometry-attachments";

describe("browser landblock env-cell baker", () => {
	it("emits typed env-cell peer records without draw units", () => {
		const input = createInput();
		const result = bakeLandblockEnvCells(input);

		expect(result).toMatchObject({
			buildRevision: 42,
			domain: "landblock-env-cells",
			drawUnits: [],
			materialCoverage: [
				expect.objectContaining({
					domain: "landblock-env-cells",
					materialCount: 1,
					triangleCount: 0,
				}),
			],
			staticBatchId: "env-batch-a",
			textureUses: [],
			works: [input.items[0]?.work],
		});
		expect(result.staticSpatialRecords).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				kind: "env-cell-spatial",
				landblockId: 0xda55ffff,
				owner: expectedEnvCellLayerOwner(),
				renderBounds: {
					max: { x: 1, y: 2, z: 3 },
					min: { x: -1, y: -2, z: -3 },
				},
				residencyBvhItemCount: 1,
				residencyBvhNodeCount: 1,
			}),
		]);
		expect(result.staticVisibilityRecords).toEqual([
			expect.objectContaining({
				acceptedEnvCellIds: [0xda550100],
				kind: "env-cell-visibility",
				visibleLinks: [
					{
						sourceEnvCellId: 0xda550100,
						targetEnvCellId: 0xda550101,
					},
				],
			}),
		]);
		expect(result.staticPortalInteriorRecords).toEqual([
			expect.objectContaining({
				envCells: [
					expect.objectContaining({
						envCellId: 0xda550100,
						localPlacement: {
							orientation: { w: 1, x: 0, y: 0, z: 0 },
							origin: { x: 0, y: 0, z: 0 },
						},
						portalApertures: [],
						portals: [],
					}),
				],
				kind: "env-cell-portal-interior",
				portalLinks: [],
			}),
		]);
		expect(result.staticSourceMappings).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				kind: "env-cell-source",
				surfaces: [
					{
						material: {
							kind: "static-material-source",
							materialId: 0x08000010,
						},
						slotId: 0,
						surfaceId: 0x08000010,
					},
				],
			}),
		]);
		expect(result.staticAuthoredDynamicSeeds).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				kind: "env-cell-static-object-seed",
				seed: expect.objectContaining({
					sourceIndex: 0,
				}),
			}),
		]);
	});

	it("emits building transition portal resources from env-cell layer facts", () => {
		const input = createInput({
			buildingTransitionApertures: [createBuildingTransitionAperture()],
		});
		const result = bakeLandblockEnvCells(input);

		expect(result.portalApertureResources).toEqual([
			expect.objectContaining({
				apertureResourceId:
					"portal-aperture-resource:building-transition:0xda55ffff",
				landblockId: 0xda55ffff,
				sourceDomain: "outdoor-buildings",
				ranges: [
					expect.objectContaining({
						source: expect.objectContaining({
							buildingInstanceId: "building-01",
							kind: "building-transition",
							targetEnvCellId: 0xda550100,
						}),
						sourceKind: "building-transition",
					}),
				],
			}),
		]);
		expect(result.staticPortalGraphs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					edges: [
						expect.objectContaining({
							sceneCrossing: {
								envCellId: 0xda550100,
								kind: "outdoor-to-env-cell",
								outdoorLandblockId: 0xda55ffff,
							},
						}),
					],
					owner: expectedEnvCellLayerOwner(),
				}),
			]),
		);
	});

	it("rejects non-env-cell batches", () => {
		expect(() =>
			bakeLandblockEnvCells({
				...createInput(),
				domain: "outdoor-terrain",
			}),
		).toThrow(
			"Landblock env-cell baker only supports landblock env-cell batches. Received outdoor-terrain.",
		);
	});

	it("emits classified env-cell dynamic seeds for setup sources with default animations", () => {
		const input = createInputWithEnvCellStaticSource(
			createSetupStaticObjectSourceAsset({
				defaultAnimation: 0x0300061b,
				sourceDid: 0x020003e5,
			}),
			{
				sourceAssetId: "setup-model/020003e5",
				sourceDid: 0x020003e5,
				sourceScale: null,
			},
		);

		const result = bakeLandblockEnvCells(input);

		expect(result.staticAuthoredDynamicSeeds).toEqual([
			{
				kind: "env-cell-static-object-dynamic-seed",
				owner: expectedEnvCellLayerOwner(),
				seed: {
					classificationReason: "setup-default-animation",
					defaultAnimationId: 0x0300061b,
					envCellId: 0xda550100,
					landblockId: 0xda55ffff,
					localPlacement: {
						orientation: { w: 1, x: 0, y: 0, z: 0 },
						origin: { x: 1, y: 2, z: 3 },
					},
					object: {
						instanceId: "env-cell-static-0",
						kind: "static-object-instance",
						landblockId: 0xda55ffff,
						objectKind: "explicit-object",
					},
					setupModelId: 0x020003e5,
					source: {
						kind: "static-object-source",
						sourceAssetKind: "setup-model",
						sourceDid: 0x020003e5,
					},
					sourceAssetId: "setup-model/020003e5",
					sourceResidence: {
						kind: "landblock-source",
						landblockId: 0xda55ffff,
						source: "env-cells",
					},
					sourceScale: { x: 1, y: 1, z: 1 },
				},
			},
		]);
		expect(
			result.drawUnits.filter(
				(drawUnit) => drawUnit.kind === "static-object-geometry",
			),
		).toEqual([]);
	});

	it("does not mirror unclassified env-cell statics into dynamic seeds", () => {
		const input = createInputWithEnvCellStaticSource(
			createSetupStaticObjectSourceAsset({
				defaultAnimation: null,
				sourceDid: 0x020003e5,
			}),
			{
				sourceAssetId: "setup-model/020003e5",
				sourceDid: 0x020003e5,
			},
		);

		const result = bakeLandblockEnvCells(input);

		expect(result.staticAuthoredDynamicSeeds).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				kind: "env-cell-static-object-seed",
			}),
		]);
	});

	it("requires full geometry attachments for renderable cell structures", () => {
		const input = createInputWithRenderableCellStructure();

		expect(() => bakeLandblockEnvCells(input)).toThrow(
			"Missing env-cell cell-structure geometry attachment env-cell-cell-structure-geometry|landblock:da55ffff|env-cell:da550100|environment:0e000001|cell-structure:0d000001.",
		);
	});

	it("accepts full geometry attachments for resolver-light cell structures", () => {
		const input = createInputWithRenderableCellStructure();
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [createGeometryAttachment(envCell)],
				staticObjectSourceGeometry: [],
			},
		});

		expect(result.staticSpatialRecords).toHaveLength(1);
		expect(result.drawUnits).toHaveLength(1);
		expect(result.drawUnits[0]).toMatchObject({
			cellStructure: {
				cellStructureId: 0x0d000001,
				kind: "cell-structure",
			},
			coordinateSpace: "landblock-render-local",
			domain: "landblock-env-cells",
			drawUnitId:
				"7:landblock:da55ffff:landblock-env-cells:structured-interior:da550100:0d000001:slice:0:0",
			envCellId: 0xda550100,
			kind: "structured-interior-geometry",
			landblockId: 0xda55ffff,
			materialPlan: [
				{
					diagnostics: [],
					family: "flat-color",
					outcome: "rendered",
					pass: "opaque",
					slotId: 0,
					surfaceId: 0x08000010,
					textureUseIds: [],
				},
			],
			materialEntries: [
				expect.objectContaining({
					materialColor: expect.any(Array),
					materialIds: [0x08000010],
					primaryTextureUseId: null,
					slot: 0,
				}),
			],
			materialFamily: "flat-color",
			materialIds: [0x08000010],
			materialPass: "opaque",
			sourceTriangleIds: ["polygon:1|surface:0|first:0|variant:none"],
			surfaceIds: [0x08000010],
			textureUseIds: [],
			triangleCount: 1,
			vertexCount: 3,
		});
		const drawUnit = result.drawUnits[0];
		if (!drawUnit || drawUnit.kind !== "structured-interior-geometry") {
			throw new Error("Expected structured interior geometry draw unit.");
		}
		expect(Array.from(drawUnit.indices)).toEqual([0, 1, 2]);
		expect(Array.from(drawUnit.materialSlotIndices)).toEqual([0, 0, 0]);
		expect(Array.from(drawUnit.texCoords)).toEqual([0, 0, 1, 0, 0, 1]);
		expect(result.textureUses).toEqual([]);
		expect(result.materialCoverage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					buckets: [
						{
							family: "flat-color",
							filteringMode: "none",
							materialCount: 1,
							outcome: "rendered",
							partitionCount: 1,
							pass: "opaque",
							textureRoleCount: 0,
							triangleCount: 1,
						},
					],
					deferredTriangleCount: 0,
					domain: "landblock-env-cells",
					fallbackReasonCounts: [],
					fallbackReasonCount: 0,
					landblockId: 0xda55ffff,
					materialCount: 1,
					renderedTriangleCount: 1,
					triangleCount: 1,
					unrenderedBuckets: [],
				}),
			]),
		);
	});

	it("omits structured-interior draw units when all material sources are missing", () => {
		const input = createInputWithRenderableCellStructure({
			includeMaterialSources: false,
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [createGeometryAttachment(envCell)],
				staticObjectSourceGeometry: [],
			},
		});

		expect(result.drawUnits).toEqual([]);
		expect(result.textureUses).toEqual([]);
		expect(result.materialCoverage).toEqual([
			expect.objectContaining({
				deferredTriangleCount: 1,
				fallbackReasonCounts: [
					{ code: "missing-cell-structure-material-source", count: 1 },
				],
				renderedTriangleCount: 0,
				unrenderedBuckets: [
					expect.objectContaining({
						outcome: "render-deferred",
						reasonCodes: ["missing-cell-structure-material-source"],
						triangleCount: 1,
					}),
				],
			}),
		]);
	});

	it("partitions mixed structured-interior material passes into separate draw units", () => {
		const input = createInputWithRenderableCellStructure({
			materialSources: [
				createStaticObjectMaterialSource({ materialId: 0x08000010 }),
				createStaticObjectMaterialSource({
					materialId: 0x08000020,
					surfaceType: 0x4,
				}),
			],
			renderSurfaces: [
				{ materialId: 0x08000010, polygonId: 1 },
				{ materialId: 0x08000020, polygonId: 2 },
			],
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [
					createGeometryAttachment(envCell, {
						positions: new Float32Array([
							0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
						]),
						surfaceIds: [0, 1],
						triangles: [
							{
								firstVertex: 0,
								materialVariantSignature: null,
								polygonId: 1,
								surfaceId: 0,
							},
							{
								firstVertex: 3,
								materialVariantSignature: null,
								polygonId: 2,
								surfaceId: 1,
							},
						],
						uvs: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
					}),
				],
				staticObjectSourceGeometry: [],
			},
		});
		const structuredDrawUnits = result.drawUnits.filter(
			(drawUnit) => drawUnit.kind === "structured-interior-geometry",
		);

		expect(structuredDrawUnits).toHaveLength(2);
		expect(
			structuredDrawUnits.map((drawUnit) => ({
				ids: drawUnit.sourceTriangleIds,
				pass: drawUnit.materialPass,
				surfaceIds: drawUnit.surfaceIds,
				triangleCount: drawUnit.triangleCount,
				vertexCount: drawUnit.vertexCount,
			})),
		).toEqual([
			{
				ids: ["polygon:2|surface:1|first:3|variant:none"],
				pass: "alpha-test",
				surfaceIds: [0x08000020],
				triangleCount: 1,
				vertexCount: 3,
			},
			{
				ids: ["polygon:1|surface:0|first:0|variant:none"],
				pass: "opaque",
				surfaceIds: [0x08000010],
				triangleCount: 1,
				vertexCount: 3,
			},
		]);
		expect(
			new Set(structuredDrawUnits.map((drawUnit) => drawUnit.drawUnitId)).size,
		).toBe(2);
	});

	it("omits missing structured-interior surfaces without blocking renderable slices", () => {
		const input = createInputWithRenderableCellStructure({
			materialSources: [
				createStaticObjectMaterialSource({ materialId: 0x08000010 }),
			],
			renderSurfaces: [
				{ materialId: 0x08000010, polygonId: 1 },
				{ materialId: 0x08000020, polygonId: 2 },
			],
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [
					createGeometryAttachment(envCell, {
						positions: new Float32Array([
							0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
						]),
						surfaceIds: [0, 1],
						triangles: [
							{
								firstVertex: 0,
								materialVariantSignature: null,
								polygonId: 1,
								surfaceId: 0,
							},
							{
								firstVertex: 3,
								materialVariantSignature: null,
								polygonId: 2,
								surfaceId: 1,
							},
						],
						uvs: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
					}),
				],
				staticObjectSourceGeometry: [],
			},
		});
		const structuredDrawUnits = result.drawUnits.filter(
			(drawUnit) => drawUnit.kind === "structured-interior-geometry",
		);

		expect(structuredDrawUnits).toHaveLength(1);
		expect(structuredDrawUnits[0]).toMatchObject({
			sourceTriangleIds: ["polygon:1|surface:0|first:0|variant:none"],
			surfaceIds: [0x08000010],
			triangleCount: 1,
			vertexCount: 3,
		});
		expect(result.materialCoverage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					coverageKind: "structured-interior",
					deferredTriangleCount: 1,
					renderedTriangleCount: 1,
					triangleCount: 2,
					unrenderedBuckets: [
						expect.objectContaining({
							outcome: "render-deferred",
							reasonCodes: ["missing-cell-structure-material-source"],
							triangleCount: 1,
						}),
					],
				}),
			]),
		);
	});

	it("omits structured-interior surfaces with missing render surfaces without blocking renderable slices", () => {
		const input = createInputWithRenderableCellStructure({
			materialSources: [
				createStaticObjectMaterialSource({ materialId: 0x08000010 }),
				createTexturedMaterialSource(0x08000020),
			],
			renderSurfaces: [
				{ materialId: 0x08000010, polygonId: 1 },
				{ materialId: 0x08000020, polygonId: 2 },
			],
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [
					createGeometryAttachment(envCell, {
						positions: new Float32Array([
							0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
						]),
						surfaceIds: [0, 1],
						triangles: [
							{
								firstVertex: 0,
								materialVariantSignature: null,
								polygonId: 1,
								surfaceId: 0,
							},
							{
								firstVertex: 3,
								materialVariantSignature: null,
								polygonId: 2,
								surfaceId: 1,
							},
						],
						uvs: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
					}),
				],
				staticObjectSourceGeometry: [],
			},
		});
		const structuredDrawUnits = result.drawUnits.filter(
			(drawUnit) => drawUnit.kind === "structured-interior-geometry",
		);

		expect(structuredDrawUnits).toHaveLength(1);
		expect(structuredDrawUnits[0]).toMatchObject({
			surfaceIds: [0x08000010],
			triangleCount: 1,
		});
		expect(result.materialCoverage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					deferredTriangleCount: 0,
					fallbackReasonCounts: [{ code: "missing-render-surface", count: 1 }],
					renderedTriangleCount: 1,
					unsupportedTriangleCount: 1,
					unrenderedBuckets: [
						expect.objectContaining({
							outcome: "unsupported",
							reasonCodes: ["missing-render-surface"],
							triangleCount: 1,
						}),
					],
				}),
			]),
		);
	});

	it("omits indexed structured-interior surfaces with missing palettes without blocking renderable slices", () => {
		const input = createInputWithRenderableCellStructure({
			materialSources: [
				createStaticObjectMaterialSource({ materialId: 0x08000010 }),
				createTexturedMaterialSource(0x08000020),
			],
			renderSurfaces: [
				{ materialId: 0x08000010, polygonId: 1 },
				{ materialId: 0x08000020, polygonId: 2 },
			],
			textureRefs: createIndexedTextureRefsWithoutPalette(),
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [
					createGeometryAttachment(envCell, {
						positions: new Float32Array([
							0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
						]),
						surfaceIds: [0, 1],
						triangles: [
							{
								firstVertex: 0,
								materialVariantSignature: null,
								polygonId: 1,
								surfaceId: 0,
							},
							{
								firstVertex: 3,
								materialVariantSignature: null,
								polygonId: 2,
								surfaceId: 1,
							},
						],
						uvs: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
					}),
				],
				staticObjectSourceGeometry: [],
			},
		});
		const structuredDrawUnits = result.drawUnits.filter(
			(drawUnit) => drawUnit.kind === "structured-interior-geometry",
		);

		expect(structuredDrawUnits).toHaveLength(1);
		expect(structuredDrawUnits[0]).toMatchObject({
			surfaceIds: [0x08000010],
			triangleCount: 1,
		});
		expect(result.materialCoverage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					deferredTriangleCount: 0,
					fallbackReasonCounts: [{ code: "missing-palette", count: 1 }],
					renderedTriangleCount: 1,
					unsupportedTriangleCount: 1,
					unrenderedBuckets: [
						expect.objectContaining({
							outcome: "unsupported",
							reasonCodes: ["missing-palette"],
							triangleCount: 1,
						}),
					],
				}),
			]),
		);
	});

	it("emits structured-interior texture uses for textured cell materials", () => {
		const input = createInputWithRenderableCellStructure({
			materialSources: [createTexturedMaterialSource(0x08000010)],
			textureRefs: createRgbaTextureRefs(),
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [createGeometryAttachment(envCell)],
				staticObjectSourceGeometry: [],
			},
		});
		const drawUnit = result.drawUnits[0];
		if (!drawUnit || drawUnit.kind !== "structured-interior-geometry") {
			throw new Error("Expected structured interior geometry draw unit.");
		}

		expect(drawUnit).toMatchObject({
			materialFamily: "texture-rgba",
			materialEntries: [
				expect.objectContaining({
					primaryTextureWrapMode: "repeat",
				}),
			],
			materialPlan: [
				expect.objectContaining({
					family: "texture-rgba",
					outcome: "rendered",
					textureUseIds: [
						"7:landblock:da55ffff:landblock-env-cells:structured-interior-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=repeat,repeat",
					],
				}),
			],
			textureUseIds: [
				"7:landblock:da55ffff:landblock-env-cells:structured-interior-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=repeat,repeat",
			],
		});
		expect(result.textureUses).toEqual([
			expect.objectContaining({
				domain: "landblock-env-cells",
				owners: [{ drawUnitId: drawUnit.drawUnitId, kind: "draw-unit" }],
				samplingPolicy: {
					wrapS: "repeat",
					wrapT: "repeat",
				},
				source: {
					kind: "prepared-render-surface-texture-use",
					renderSurface: {
						kind: "render-surface",
						renderSurfaceId: 0x06000010,
					},
					usage: "rgba-color",
				},
				staticBatchId: "env-batch-a",
				textureUseId:
					"7:landblock:da55ffff:landblock-env-cells:structured-interior-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=repeat,repeat",
			}),
		]);
	});

	it("composes environment detail roles onto structured-interior textured materials", () => {
		const input = createInputWithRenderableCellStructure({
			detailRoles: [
				{
					fadeFar: 256,
					fadeNear: 128,
					role: "environment",
					texture: {
						kind: "surface-texture",
						surfaceTextureId: 0x05000020,
					},
					tiling: 8,
				},
			],
			materialSources: [createTexturedMaterialSource(0x08000010)],
			textureRefs: [...createRgbaTextureRefs(), ...createDetailTextureRefs()],
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [createGeometryAttachment(envCell)],
				staticObjectSourceGeometry: [],
			},
		});
		const drawUnit = result.drawUnits[0];
		if (!drawUnit || drawUnit.kind !== "structured-interior-geometry") {
			throw new Error("Expected structured interior geometry draw unit.");
		}

		expect(drawUnit.materialEntries[0]).toMatchObject({
			detailTextureTiling: 8,
			detailTextureUseId:
				"7:landblock:da55ffff:landblock-env-cells:structured-interior-texture:prepared-render-surface-texture-use:06000020:rgba-detail:sampling:wrap=repeat,repeat",
		});
		expect(drawUnit.textureUseIds).toEqual([
			"7:landblock:da55ffff:landblock-env-cells:structured-interior-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=repeat,repeat",
			"7:landblock:da55ffff:landblock-env-cells:structured-interior-texture:prepared-render-surface-texture-use:06000020:rgba-detail:sampling:wrap=repeat,repeat",
		]);
		expect(result.textureUses).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					samplingPolicy: {
						wrapS: "repeat",
						wrapT: "repeat",
					},
					source: {
						kind: "prepared-render-surface-texture-use",
						renderSurface: {
							kind: "render-surface",
							renderSurfaceId: 0x06000020,
						},
						usage: "rgba-detail",
					},
					textureUseId:
						"7:landblock:da55ffff:landblock-env-cells:structured-interior-texture:prepared-render-surface-texture-use:06000020:rgba-detail:sampling:wrap=repeat,repeat",
				}),
			]),
		);
	});

	it("bakes env-cell local placement into render-local positions", () => {
		const input = createInputWithRenderableCellStructure({
			localPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 10, y: 20, z: 30 },
			},
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [
					createGeometryAttachment(envCell, {
						positions: new Float32Array([0, 1, 0, 0, 0, 1, 1, 0, 0]),
					}),
				],
				staticObjectSourceGeometry: [],
			},
		});
		const drawUnit = result.drawUnits[0];
		if (!drawUnit || drawUnit.kind !== "structured-interior-geometry") {
			throw new Error("Expected structured interior geometry draw unit.");
		}

		expect(Array.from(drawUnit.positions)).toEqual([
			10, 31, -20, 10, 30, -19, 11, 30, -20,
		]);
	});

	it("bakes env-cell static seeds through static object draw units with env-cell ownership", () => {
		const input = createInputWithRenderableStaticSeed({
			envCellLocalPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 10, y: 30, z: -20 },
			},
			seedLocalPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 1, y: 2, z: 3 },
			},
		});

		const result = bakeLandblockEnvCells(input);
		const drawUnit = result.drawUnits.find(
			(candidate) => candidate.kind === "static-object-geometry",
		);
		if (!drawUnit || drawUnit.kind !== "static-object-geometry") {
			throw new Error("Expected env-cell static object geometry draw unit.");
		}

		expect(result.drawUnits).toHaveLength(1);
		expect(drawUnit).toMatchObject({
			domain: "landblock-env-cells",
			kind: "static-object-geometry",
			landblockId: 0xda55ffff,
			materialFamily: "flat-color",
			ownership: {
				envCellIds: [0xda550100],
				kind: "env-cell-static-object-seeds",
				landblockId: 0xda55ffff,
				seedIdentities: [
					{
						instanceId: "da550100:env-cell-static-0",
						kind: "static-object-instance",
						landblockId: 0xda55ffff,
						objectKind: "explicit-object",
					},
				],
			},
			sourceMappingCoverage: [
				expect.objectContaining({
					object: expect.objectContaining({
						instanceId: "da550100:env-cell-static-0",
					}),
					partIndex: 0,
					sourceTriangleCount: 1,
				}),
			],
			triangleCount: 1,
			vertexCount: 3,
		});
		expect(drawUnit.drawUnitId).toContain(
			"7:landblock:da55ffff:landblock-env-cells:static-object-partition:",
		);
		expect(Array.from(drawUnit.positions.slice(0, 9))).toEqual([
			1, 3, -2, 2, 3, -2, 1, 4, -2,
		]);
		expect(result.textureUses).toEqual([]);
		expect(result.staticAuthoredDynamicSeeds).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				kind: "env-cell-static-object-seed",
			}),
		]);
		expect(result.staticSpatialRecords).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					envCellId: 0xda550100,
					kind: "env-cell-spatial",
					landblockId: 0xda55ffff,
				}),
				expect.objectContaining({
					bounds: {
						max: { x: 2, y: 4, z: -2 },
						min: { x: 1, y: 3, z: -2 },
					},
					envCellId: 0xda550100,
					instanceId: "da550100:env-cell-static-0",
					kind: "env-cell-static-object-bounds",
					landblockId: 0xda55ffff,
					owner: expectedEnvCellLayerOwner(),
				}),
			]),
		);
	});

	it("bakes env-cell static seed rotation without applying the containing cell frame", () => {
		const input = createInputWithRenderableStaticSeed({
			envCellLocalPlacement: {
				orientation: {
					w: Math.SQRT1_2,
					x: 0,
					y: Math.SQRT1_2,
					z: 0,
				},
				origin: { x: 0, y: 0, z: 0 },
			},
			seedLocalPlacement: {
				orientation: {
					w: Math.SQRT1_2,
					x: 0,
					y: 0,
					z: Math.SQRT1_2,
				},
				origin: { x: 1, y: 0, z: 0 },
			},
		});

		const result = bakeLandblockEnvCells(input);
		const drawUnit = result.drawUnits.find(
			(candidate) => candidate.kind === "static-object-geometry",
		);
		if (!drawUnit || drawUnit.kind !== "static-object-geometry") {
			throw new Error("Expected env-cell static object geometry draw unit.");
		}

		expectNumbersClose(
			Array.from(drawUnit.positions.slice(0, 9)),
			[1, 0, 0, 1, 0, -1, 1, 1, 0],
		);
	});
});

function createInputWithRenderableCellStructure(
	options: {
		readonly includeMaterialSources?: boolean;
		readonly localPlacement?: LandblockEnvCellStaticFacts["localPlacement"];
		readonly materialSources?: readonly StaticObjectMaterialSourceFacts[];
		readonly paletteSources?: readonly StaticObjectPaletteSourceFacts[];
		readonly detailRoles?: readonly RegionDetailRoleFacts[];
		readonly renderSurfaces?: readonly {
			readonly materialId: number;
			readonly polygonId: number;
		}[];
		readonly textureRefs?: readonly StaticObjectTextureRefFacts[];
	} = {},
): StaticBakeBatchInput {
	const input = createInput();
	const item = input.items[0];
	if (!item) {
		throw new Error("Missing fixture item.");
	}
	const scope = item.payload.scope;
	if (scope?.kind !== "landblock-env-cells") {
		throw new Error("Missing fixture env-cell scope.");
	}
	const envCell = scope.envCells[0];
	if (!envCell) {
		throw new Error("Missing fixture env cell.");
	}
	const renderSurfaces = options.renderSurfaces ?? [
		{ materialId: 0x08000010, polygonId: 1 },
	];

	return {
		...input,
		attachments: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		items: [
			{
				...item,
				payload: {
					...item.payload,
					scope: {
						...scope,
						envCells: [
							{
								...envCell,
								renderGeometry: {
									...envCell.renderGeometry,
									sourceId: 0xda550100,
									surfaceIds: renderSurfaces.map((_surface, slotId) => slotId),
									triangleCount: renderSurfaces.length,
									triangles: renderSurfaces.map((surface, index) => ({
										firstVertex: index * 3,
										materialVariantSignature: null,
										polygonId: surface.polygonId,
										surfaceId: index,
									})),
									vertexCount: renderSurfaces.length * 3,
								},
								localPlacement:
									options.localPlacement ?? envCell.localPlacement,
								surfaces: renderSurfaces.map((surface, slotId) => ({
									material: {
										kind: "static-material-source" as const,
										materialId: surface.materialId,
									},
									slotId,
									surfaceId: surface.materialId,
								})),
							},
						],
						materialSources:
							options.includeMaterialSources === false
								? []
								: (options.materialSources ?? [
										createStaticObjectMaterialSource({
											materialId: 0x08000010,
										}),
									]),
						paletteSources: options.paletteSources ?? scope.paletteSources,
						regionRenderProfile: {
							...scope.regionRenderProfile,
							detailRoles:
								options.detailRoles ?? scope.regionRenderProfile.detailRoles,
						},
						textureRefs: options.textureRefs ?? scope.textureRefs,
					},
				},
			},
		],
	};
}

function requireFirstEnvCell(
	input: StaticBakeBatchInput,
): LandblockEnvCellStaticFacts {
	const item = input.items[0];
	if (!item || item.payload.scope.kind !== "landblock-env-cells") {
		throw new Error("Missing fixture env-cell scope.");
	}
	const envCell = item.payload.scope.envCells[0];
	if (!envCell) {
		throw new Error("Missing fixture env cell.");
	}

	return envCell;
}

function createInputWithRenderableStaticSeed(
	options: {
		readonly envCellLocalPlacement?: LandblockEnvCellStaticFacts["localPlacement"];
		readonly seedLocalPlacement?: LandblockEnvCellStaticFacts["staticObjectSeeds"][number]["localPlacement"];
	} = {},
): StaticBakeBatchInput {
	const input = createInput();
	const item = input.items[0];
	if (!item || item.payload.scope.kind !== "landblock-env-cells") {
		throw new Error("Missing fixture env-cell scope.");
	}
	const scope = item.payload.scope;
	const envCell = scope.envCells[0];
	if (!envCell) {
		throw new Error("Missing fixture env cell.");
	}
	const material = createStaticObjectMaterialSource({
		materialId: 0x08000020,
	});
	const source = createStaticObjectSourceAsset(material);
	const seedIdentity = {
		instanceId: "da550100:env-cell-static-0",
		kind: "static-object-instance" as const,
		landblockId: 0xda55ffff,
		objectKind: "explicit-object" as const,
	};

	return {
		...input,
		attachments: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [
				{
					identity: source.parts[0]?.geometry ?? createStaticObjectGeometry(),
					positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
					texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
				},
			],
		},
		items: [
			{
				...item,
				payload: {
					...item.payload,
					scope: {
						...scope,
						envCells: [
							{
								...envCell,
								localPlacement:
									options.envCellLocalPlacement ?? envCell.localPlacement,
								staticObjectSeeds: envCell.staticObjectSeeds.map((seed) => ({
									...seed,
									identity: seedIdentity,
									localPlacement:
										options.seedLocalPlacement ?? seed.localPlacement,
								})),
							},
						],
						materialSources: [material],
						paletteSources: [],
						sourceAssets: [source],
						textureRefs: [],
					},
				},
			},
		],
	};
}

function createInputWithEnvCellStaticSource(
	source: StaticObjectSourceAssetFacts,
	options: {
		readonly sourceAssetId: string;
		readonly sourceDid: number;
		readonly sourceScale?: LandblockEnvCellStaticFacts["staticObjectSeeds"][number]["sourceScale"];
	},
): StaticBakeBatchInput {
	const input = createInput();
	const item = input.items[0];
	if (!item || item.payload.scope.kind !== "landblock-env-cells") {
		throw new Error("Missing fixture env-cell scope.");
	}
	const scope = item.payload.scope;
	const envCell = scope.envCells[0];
	if (!envCell) {
		throw new Error("Missing fixture env cell.");
	}

	return {
		...input,
		items: [
			{
				...item,
				payload: {
					...item.payload,
					scope: {
						...scope,
						envCells: [
							{
								...envCell,
								staticObjectSeeds: envCell.staticObjectSeeds.map((seed) => ({
									...seed,
									debug: { sourceAssetId: options.sourceAssetId },
									source: {
										kind: "static-object-source" as const,
										sourceAssetKind: "setup-model" as const,
										sourceDid: options.sourceDid,
									},
									sourceScale: options.sourceScale ?? seed.sourceScale,
								})),
							},
						],
						sourceAssets: [source],
					},
				},
			},
		],
	};
}

function expectNumbersClose(
	actual: readonly number[],
	expected: readonly number[],
): void {
	expect(actual).toHaveLength(expected.length);
	for (const [index, expectedValue] of expected.entries()) {
		expect(actual[index]).toBeCloseTo(expectedValue, 5);
	}
}

function createGeometryAttachment(
	envCell: LandblockEnvCellStaticFacts,
	options: {
		readonly positions?: Float32Array;
		readonly surfaceIds?: readonly number[];
		readonly triangles?: readonly EnvCellCellStructureGeometryAttachment["triangles"][number][];
		readonly uvs?: Float32Array;
	} = {},
): EnvCellCellStructureGeometryAttachment {
	return {
		bounds: envCell.renderGeometry.bounds,
		identity: createEnvCellCellStructureGeometryIdentity({ envCell }),
		invalidPolygons: [],
		normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
		positions:
			options.positions ?? new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		skippedPolygonCount: 0,
		sourceId: envCell.renderGeometry.sourceId,
		surfaceIds: options.surfaceIds ?? [0],
		triangleCount: envCell.renderGeometry.triangleCount,
		triangles: options.triangles ?? [
			{
				firstVertex: 0,
				materialVariantSignature: null,
				polygonId: 1,
				surfaceId: 0,
			},
		],
		uvs: options.uvs ?? new Float32Array([0, 0, 1, 0, 0, 1]),
		vertexCount: envCell.renderGeometry.vertexCount,
	};
}

function createStaticObjectMaterialSource(options: {
	readonly materialId: number;
	readonly surfaceType?: number;
}): StaticObjectMaterialSourceFacts {
	return {
		diffuse: 0,
		identity: {
			kind: "static-material-source",
			materialId: options.materialId,
		},
		luminosity: 0,
		source: {
			argb: 0xff336699,
			kind: "solid-color",
		},
		surfaceId: options.materialId,
		surfaceType: options.surfaceType ?? 0,
		translucency: 0,
	};
}

function createTexturedMaterialSource(
	materialId: number,
): StaticObjectMaterialSourceFacts {
	return {
		diffuse: 1,
		identity: {
			kind: "static-material-source",
			materialId,
		},
		luminosity: 0,
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
			height: 1,
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			role: "render-surface",
			width: 1,
		},
	];
}

function createDetailTextureRefs(): readonly StaticObjectTextureRefFacts[] {
	return [
		{
			palette: null,
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
			format: "rgba",
			formatRaw: 1,
			height: 1,
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000020,
			},
			role: "render-surface",
			width: 1,
		},
	];
}

function createIndexedTextureRefsWithoutPalette(): readonly StaticObjectTextureRefFacts[] {
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
			format: "indexed",
			formatRaw: 0x29,
			height: 1,
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: 0x06000010,
			},
			role: "render-surface",
			width: 1,
		},
	];
}

function createStaticObjectSourceAsset(
	material: StaticObjectMaterialSourceFacts,
): StaticObjectSourceAssetFacts {
	const source = {
		kind: "static-object-source" as const,
		sourceAssetKind: "gfx-obj" as const,
		sourceDid: 0x01000020,
	};
	const geometry = createStaticObjectGeometry();
	return {
		bounds: null,
		debug: { sourceAssetId: "gfxobj/01000020" },
		identity: source,
		invalidPolygonCount: 0,
		materialSlotCount: 1,
		partCount: 1,
		parts: [
			{
				bounds: null,
				defaultPlacements: [
					{
						orientation: { w: 1, x: 0, y: 0, z: 0 },
						origin: { x: 0, y: 0, z: 0 },
					},
				],
				geometry,
				gfxObj: source,
				invalidPolygonCount: 0,
				materialSlotCount: 1,
				materialSlots: [
					{
						geometrySurfaceId: 0,
						material: material.identity,
						materialSurfaceId: material.surfaceId,
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
				source,
				triangles: [
					{
						firstVertex: 0,
						geometrySurfaceId: 0,
						materialVariantSignature: null,
						polygonId: 1,
					},
				],
			},
		],
		physicsPolygonCount: 0,
		renderTriangleCount: 1,
		skippedPolygonCount: 0,
		sourceAssetKind: "gfx-obj",
	};
}

function createSetupStaticObjectSourceAsset(options: {
	readonly defaultAnimation: number | null;
	readonly sourceDid: number;
}): StaticObjectSourceAssetFacts {
	const source = {
		kind: "static-object-source" as const,
		sourceAssetKind: "setup-model" as const,
		sourceDid: options.sourceDid,
	};
	return {
		bounds: null,
		debug: { sourceAssetId: `setup-model/${formatHex32(options.sourceDid)}` },
		defaultAnimation: options.defaultAnimation,
		identity: source,
		invalidPolygonCount: 0,
		materialSlotCount: 0,
		partCount: 0,
		parts: [],
		physicsPolygonCount: 0,
		renderTriangleCount: 0,
		skippedPolygonCount: 0,
		sourceAssetKind: "setup-model",
	};
}

function createStaticObjectGeometry() {
	const source = {
		kind: "static-object-source" as const,
		sourceAssetKind: "gfx-obj" as const,
		sourceDid: 0x01000020,
	};
	return createStaticObjectSourceGeometryIdentity({
		gfxObj: source,
		partIndex: 0,
		source,
	});
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}

function expectedEnvCellLayerOwner() {
	return {
		domain: "landblock-env-cells",
		key: {
			kind: "env-cell-system",
			landblockId: 0xda55ffff,
		},
		kind: "layer-owner",
		ownerId: "env-cell-system:0xda55ffff",
	};
}

function createInput(
	options: {
		readonly buildingTransitionApertures?: LandblockEnvCellsStaticScopePayload["buildingTransitionApertures"];
	} = {},
): StaticBakeBatchInput {
	const work = {
		job: {
			domain: "landblock-env-cells" as const,
			scope: {
				kind: "landblock" as const,
				landblockId: 0xda55ffff,
			},
		},
		priority: 5,
		revision: 7,
		workId: "7:landblock:da55ffff:landblock-env-cells",
	};

	return {
		atlasSnapshot: {
			domain: "landblock-env-cells",
			placements: [],
			staticBatchId: "env-batch-a",
			textureUses: [],
		},
		attachments: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		domain: "landblock-env-cells",
		items: [
			{
				payload: {
					job: work.job,
					scope: {
						acceptedEnvCellIds: [0xda550100],
						buildingTransitionApertures:
							options.buildingTransitionApertures ?? [],
						envCells: [
							{
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
									envCellId: 0xda550100,
									kind: "env-cell-source",
								},
								landblockId: 0xda55ffff,
								localPlacement: {
									orientation: { w: 1, x: 0, y: 0, z: 0 },
									origin: { x: 0, y: 0, z: 0 },
								},
								memberId: "cell-0",
								portalApertures: [],
								portals: [],
								renderGeometry: {
									bounds: {
										max: { x: 1, y: 2, z: 3 },
										min: { x: -1, y: -2, z: -3 },
									},
									invalidPolygons: [],
									normals: [],
									positions: [],
									skippedPolygonCount: 0,
									sourceId: 0xda550100,
									surfaceIds: [],
									triangleCount: 0,
									triangles: [],
									uvs: [],
									vertexCount: 0,
								},
								restrictionObjectId: null,
								seenOutside: null,
								staticObjectSeeds: [
									{
										debug: {
											sourceAssetId: "gfxobj/01000020",
										},
										identity: {
											instanceId: "env-cell-static-0",
											kind: "static-object-instance",
											landblockId: 0xda55ffff,
											objectKind: "explicit-object",
										},
										localPlacement: {
											orientation: { w: 1, x: 0, y: 0, z: 0 },
											origin: { x: 1, y: 2, z: 3 },
										},
										source: {
											kind: "static-object-source",
											sourceAssetKind: "gfx-obj",
											sourceDid: 0x01000020,
										},
										sourceIndex: 0,
										sourceScale: null,
									},
								],
								surfaces: [
									{
										material: {
											kind: "static-material-source",
											materialId: 0x08000010,
										},
										slotId: 0,
										surfaceId: 0x08000010,
									},
								],
								visibleEnvCellIds: [0xda550101],
							},
						],
						kind: "landblock-env-cells",
						landblock: {
							kind: "landblock-source",
							landblockId: 0xda55ffff,
							source: "env-cells",
						},
						missingRefs: [],
						materialSources: [],
						paletteSources: [],
						portalLinks: [],
						regionRenderProfile: {
							detailRoles: [],
							identity: {
								kind: "region-render-profile",
								regionNumber: 1,
							},
						},
						residencySpatial: {
							landblockEnvCellBvh: {
								items: [],
								nodes: [],
							},
							landblockEnvCellBvhItemCount: 1,
							landblockEnvCellBvhNodeCount: 1,
						},
						sourceAssets: [],
						textureRefs: [],
						visibilityDiagnostics: [],
					},
					sourceRevision: 42,
				},
				work,
			},
		],
		revision: 7,
		staticBatchId: "env-batch-a",
	};
}

function createBuildingTransitionAperture() {
	return {
		apertureId: "building-transition-aperture:building-01:0",
		buildingInstanceId: "building-01",
		buildingPortalId: "building-portal-0",
		buildingPortalSourceIndex: 0,
		flags: 1,
		linkedEnvCellIds: [0xda550100],
		otherCellId: 0x0100,
		otherPortalId: 0xffff,
		points: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
		polyId: 42,
		portalIndex: 0,
		sourceAssetId: "gfxobj/02001234",
		sourceDid: 0x02001234,
	};
}

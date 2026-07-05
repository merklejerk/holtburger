import { describe, expect, it } from "vitest";
import type {
	PreparedAsset,
	PreparedAssetReader,
} from "../../../assets/contracts";
import type {
	EnvCellCellStructureGeometrySidecar,
	LandblockEnvCellStaticFacts,
	EnvCellSystemStaticScopePayload,
	RegionDetailRoleFacts,
	StaticBakeJobInput,
	StaticBakeTask,
	StaticObjectMaterialSourceFacts,
	StaticObjectPaletteSourceFacts,
	StaticObjectTextureRefFacts,
	StaticObjectSourceAssetFacts,
} from "../../contracts";
import { createStaticObjectSourceGeometryIdentity } from "../../objects/static-object-source-assets";
import { bakeEnvCellSystem } from "./env-cell-system-baker";
import { createEnvCellCellStructureGeometryIdentity } from "./env-cell-system-geometry-resources";
import { createStructuredInteriorTexturePlacementIntents } from "./structured-interior-placement-planner";
import {
	OBJECT_VISUAL_BASE_MATERIAL_VARIANT_SIGNATURE,
	objectVisualGeometryBufferId,
	type ObjectVisualGeometryTriangle,
} from "../../../visual/object-visual-recipe-bundle";

describe("browser landblock env-cell baker", () => {
	it("emits typed env-cell peer records without draw units", () => {
		const input = createInput();
		const result = bakeEnvCellSystem(input);

		expect(result).toMatchObject({
			buildRevision: 42,
			domain: "env-cell-system",
			drawUnits: [],
			materialCoverage: [
				expect.objectContaining({
					domain: "env-cell-system",
					materialCount: 1,
					triangleCount: 0,
				}),
			],
			textureUses: [],
			task: input.task,
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
		expect(result.envCellStaticObjectPlacementRecords).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				kind: "env-cell-static-object-placement",
				placement: expect.objectContaining({
					sourceIndex: 0,
				}),
			}),
		]);
	});

	it("passes through host-emitted portal resources and graph records", () => {
		const transitionResource = createBuildingTransitionPortalApertureResource();
		const transitionGraph = createPortalConnectivityGraph();
		const input = createInput({
			portalApertureResources: [transitionResource],
			portalConnectivityGraph: transitionGraph,
		});
		const result = bakeEnvCellSystem(input);

		expect(result.portalApertureResources).toEqual([transitionResource]);
		expect(result.staticPortalGraphs).toEqual([
			{
				edges: transitionGraph.edges,
				kind: "static-portal-graph",
				landblockId: 0xda55ffff,
				nodes: transitionGraph.nodes,
				owner: expectedEnvCellLayerOwner(),
			},
		]);
	});

	it("rejects non-env-cell batches", () => {
		expect(() =>
			bakeEnvCellSystem({
				...createInput(),
				domain: "outdoor-terrain",
			}),
		).toThrow(
			"Landblock env-cell baker only supports landblock env-cell jobs. Received outdoor-terrain.",
		);
	});

	it("keeps env-cell static object seeds as static placement records", () => {
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

		const result = bakeEnvCellSystem(input);

		expect(result.envCellStaticObjectPlacementRecords).toEqual([
			{
				envCellId: 0xda550100,
				kind: "env-cell-static-object-placement",
				landblockId: 0xda55ffff,
				owner: expectedEnvCellLayerOwner(),
				placement: {
					debug: { sourceAssetId: "setup-model/020003e5" },
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
						sourceAssetKind: "setup-model",
						sourceDid: 0x020003e5,
					},
					sourceIndex: 0,
					sourceScale: null,
				},
			},
		]);
		expect(
			result.objectVisualInstallSet.directDrawUnits.filter(
				(drawUnit) => drawUnit.kind === "static-object-geometry",
			),
		).toEqual([]);
	});

	it("does not mirror unclassified env-cell statics into dynamic placements", () => {
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

		const result = bakeEnvCellSystem(input);

		expect(result.envCellStaticObjectPlacementRecords).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				kind: "env-cell-static-object-placement",
			}),
		]);
	});

	it("requires full geometry sidecars for renderable cell structures", () => {
		const input = createInputWithRenderableCellStructure();

		expect(() => bakeEnvCellSystem(input)).toThrow(
			"Missing env-cell cell-structure geometry resource env-cell-cell-structure-geometry|landblock:da55ffff|env-cell:da550100|environment:0e000001|cell-structure:0d000001.",
		);
	});

	it("omits structured-interior draw units when all material sources are missing", async () => {
		const input = createInputWithRenderableCellStructure({
			includeMaterialSources: false,
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeEnvCellSystem({
			...input,
			resources: {
				envCellCellStructureGeometry: [createGeometrySidecar(envCell)],
				staticObjectSourceGeometry: [],
			},
			texturePlacementSnapshot:
				await createStructuredInteriorPlacementSnapshot(input),
		});

		expect(result.objectVisualInstallSet.directDrawUnits).toEqual([]);
		expect(result.objectVisualInstallSet.directDrawUnits).toEqual([]);
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

	it("emits structured-interior texture uses for textured cell materials", async () => {
		const input = createInputWithRenderableCellStructure({
			materialSources: [createTexturedMaterialSource(0x08000010)],
			textureRefs: createRgbaTextureRefs(),
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeEnvCellSystem({
			...input,
			resources: {
				envCellCellStructureGeometry: [createGeometrySidecar(envCell)],
				staticObjectSourceGeometry: [],
			},
			texturePlacementSnapshot:
				await createStructuredInteriorPlacementSnapshot(input),
		});
		const drawUnit = result.objectVisualInstallSet.directDrawUnits[0];
		if (!drawUnit || drawUnit.kind !== "structured-interior-geometry") {
			throw new Error("Expected structured interior geometry draw unit.");
		}
		const objectVisualDrawUnit =
			result.objectVisualInstallSet.directDrawUnits[0];
		if (!objectVisualDrawUnit) {
			throw new Error("Expected object visual direct draw unit.");
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
					textureBindingIds: drawUnit.textureBindingIds,
				}),
			],
		});
		expect(drawUnit.textureBindingIds).toHaveLength(1);
		expect(result.textureUses).toEqual([
			expect.objectContaining({
				domain: "env-cell-system",
				owners: [
					{
						drawUnitId: objectVisualDrawUnit.drawUnitId,
						kind: "draw-unit",
					},
				],
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
				bindingId: expect.stringContaining(
					"slot=prepared-render-surface-texture-use%3A06000010%3Argba-color",
				),
			}),
		]);
	});

	it("discovers structured-interior placement intents before env-cell baking", async () => {
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

		const intents = await createStructuredInteriorTexturePlacementIntents({
			assetReader: new EmptyPreparedAssetReader(),
			items: [{ payload: input.payload, task: input.task }],
		});
		const result = bakeEnvCellSystem({
			...input,
			resources: {
				envCellCellStructureGeometry: [createGeometrySidecar(envCell)],
				staticObjectSourceGeometry: [],
			},
			texturePlacementSnapshot:
				await createStructuredInteriorPlacementSnapshot(input),
		});
		const drawUnit = result.objectVisualInstallSet.directDrawUnits.find(
			(candidate) => candidate.kind === "structured-interior-geometry",
		);
		if (!drawUnit || drawUnit.kind !== "structured-interior-geometry") {
			throw new Error("Expected structured interior geometry draw unit.");
		}

		expect(
			intents.map((intent) => ({
				affinityKey: intent.affinityKey,
				bindingId: intent.bindingId,
				itemId: intent.itemId,
				purpose: intent.purpose,
			})),
		).toEqual([
			{
				affinityKey: expect.stringContaining("structured-interior|"),
				bindingId: expect.stringContaining(
					"slot=prepared-render-surface-texture-use%3A06000010%3Argba-color",
				),
				itemId: 0,
				purpose: "object-base-color",
			},
			{
				affinityKey: expect.stringContaining("structured-interior|"),
				bindingId: expect.stringContaining(
					"slot=prepared-render-surface-texture-use%3A06000020%3Argba-detail",
				),
				itemId: 1,
				purpose: "object-detail",
			},
		]);
		expect(intents.map((intent) => intent.bindingId)).toEqual(
			drawUnit.textureBindingIds,
		);
	});

	it("rejects textured structured-interior baking without placement snapshot entries", () => {
		const input = createInputWithRenderableCellStructure({
			materialSources: [createTexturedMaterialSource(0x08000010)],
			textureRefs: createRgbaTextureRefs(),
		});
		const envCell = requireFirstEnvCell(input);

		expect(() =>
			bakeEnvCellSystem({
				...input,
				resources: {
					envCellCellStructureGeometry: [createGeometrySidecar(envCell)],
					staticObjectSourceGeometry: [],
				},
			}),
		).toThrow(
			/Structured interior material is missing object-visual placement item id for binding binding\|resource=env-cell-system%3A0xda55ffff%3Astructured-interior-texture/,
		);
	});

	it("composes environment detail roles onto structured-interior textured materials", async () => {
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

		const result = bakeEnvCellSystem({
			...input,
			resources: {
				envCellCellStructureGeometry: [createGeometrySidecar(envCell)],
				staticObjectSourceGeometry: [],
			},
			texturePlacementSnapshot:
				await createStructuredInteriorPlacementSnapshot(input),
		});
		const drawUnit = result.objectVisualInstallSet.directDrawUnits[0];
		if (!drawUnit || drawUnit.kind !== "structured-interior-geometry") {
			throw new Error("Expected structured interior geometry draw unit.");
		}

		const detailTextureBindingId = drawUnit.textureBindingIds.find(
			(bindingId) => bindingId.includes("role=object-detail"),
		);
		expect(drawUnit.materialEntries[0]).toMatchObject({
			detailTextureTiling: 8,
			detailTextureBindingId,
		});
		expect(drawUnit.textureBindingIds).toHaveLength(2);
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
					bindingId: expect.stringContaining(
						"slot=prepared-render-surface-texture-use%3A06000020%3Argba-detail",
					),
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

		const result = bakeEnvCellSystem({
			...input,
			resources: {
				envCellCellStructureGeometry: [
					createGeometrySidecar(envCell, {
						positions: new Float32Array([0, 1, 0, 0, 0, 1, 1, 0, 0]),
					}),
				],
				staticObjectSourceGeometry: [],
			},
		});
		const drawUnit = result.objectVisualInstallSet.directDrawUnits[0];
		if (!drawUnit || drawUnit.kind !== "structured-interior-geometry") {
			throw new Error("Expected structured interior geometry draw unit.");
		}

		expect(Array.from(drawUnit.positions)).toEqual([
			10, 31, -20, 10, 30, -19, 11, 30, -20,
		]);
	});

	it("bakes env-cell static placement rotation without applying the containing cell frame", () => {
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

		const result = bakeEnvCellSystem(input);
		const drawUnit = result.objectVisualInstallSet.directDrawUnits.find(
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
): StaticBakeJobInput {
	const input = createInput();
	const scope = input.payload.scope;
	if (scope?.kind !== "env-cell-system") {
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
		resources: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		payload: {
			...input.payload,
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
						localPlacement: options.localPlacement ?? envCell.localPlacement,
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
	};
}

function requireFirstEnvCell(
	input: StaticBakeJobInput,
): LandblockEnvCellStaticFacts {
	if (input.payload.scope.kind !== "env-cell-system") {
		throw new Error("Missing fixture env-cell scope.");
	}
	const envCell = input.payload.scope.envCells[0];
	if (!envCell) {
		throw new Error("Missing fixture env cell.");
	}

	return envCell;
}

function createInputWithRenderableStaticSeed(
	options: {
		readonly envCellLocalPlacement?: LandblockEnvCellStaticFacts["localPlacement"];
		readonly seedLocalPlacement?: LandblockEnvCellStaticFacts["staticObjectPlacements"][number]["localPlacement"];
	} = {},
): StaticBakeJobInput {
	const input = createInput();
	if (input.payload.scope.kind !== "env-cell-system") {
		throw new Error("Missing fixture env-cell scope.");
	}
	const scope = input.payload.scope;
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
		resources: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [
				{
					buffer: {
						bounds: null,
						bufferId: objectVisualGeometryBufferId(0),
						coordinateSpace: "source-local",
						normals: new Float32Array(9),
						positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
						texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
						triangleCount: 1,
						triangles: [
							{
								firstVertex: 0,
								materialVariantSignature:
									OBJECT_VISUAL_BASE_MATERIAL_VARIANT_SIGNATURE,
								polygonId: 0,
								surfaceId: 0,
							},
						],
						vertexCount: 3,
					},
					identity:
						source.parts[0]?.geometry.canonical ??
						createStaticObjectGeometry().canonical,
				},
			],
		},
		payload: {
			...input.payload,
			scope: {
				...scope,
				envCells: [
					{
						...envCell,
						localPlacement:
							options.envCellLocalPlacement ?? envCell.localPlacement,
						staticObjectPlacements: envCell.staticObjectPlacements.map(
							(seed) => ({
								...seed,
								identity: seedIdentity,
								localPlacement:
									options.seedLocalPlacement ?? seed.localPlacement,
							}),
						),
					},
				],
				materialSources: [material],
				paletteSources: [],
				sourceAssets: [source],
				textureRefs: [],
			},
		},
	};
}

function createInputWithEnvCellStaticSource(
	source: StaticObjectSourceAssetFacts,
	options: {
		readonly sourceAssetId: string;
		readonly sourceDid: number;
		readonly sourceScale?: LandblockEnvCellStaticFacts["staticObjectPlacements"][number]["sourceScale"];
	},
): StaticBakeJobInput {
	const input = createInput();
	if (input.payload.scope.kind !== "env-cell-system") {
		throw new Error("Missing fixture env-cell scope.");
	}
	const scope = input.payload.scope;
	const envCell = scope.envCells[0];
	if (!envCell) {
		throw new Error("Missing fixture env cell.");
	}

	return {
		...input,
		payload: {
			...input.payload,
			scope: {
				...scope,
				envCells: [
					{
						...envCell,
						staticObjectPlacements: envCell.staticObjectPlacements.map(
							(seed) => ({
								...seed,
								debug: { sourceAssetId: options.sourceAssetId },
								source: {
									kind: "static-object-source" as const,
									sourceAssetKind: "setup-model" as const,
									sourceDid: options.sourceDid,
								},
								sourceScale: options.sourceScale ?? seed.sourceScale,
							}),
						),
					},
				],
				sourceAssets: [source],
			},
		},
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

function createGeometrySidecar(
	envCell: LandblockEnvCellStaticFacts,
	options: {
		readonly positions?: Float32Array;
		readonly surfaceIds?: readonly number[];
		readonly triangles?: readonly ObjectVisualGeometryTriangle[];
		readonly uvs?: Float32Array;
	} = {},
): EnvCellCellStructureGeometrySidecar {
	const positions =
		options.positions ?? new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
	const triangles = options.triangles ?? [
		{
			firstVertex: 0,
			materialVariantSignature: OBJECT_VISUAL_BASE_MATERIAL_VARIANT_SIGNATURE,
			polygonId: 1,
			surfaceId: 0,
		},
	];
	return {
		buffer: {
			bounds: envCell.renderGeometry.bounds,
			bufferId: objectVisualGeometryBufferId(0),
			coordinateSpace: "source-local",
			normals: new Float32Array(positions.length),
			positions,
			texCoords: options.uvs ?? new Float32Array([0, 0, 1, 0, 0, 1]),
			triangleCount: triangles.length,
			triangles,
			vertexCount: positions.length / 3,
		},
		identity: createEnvCellCellStructureGeometryIdentity({ envCell }),
		invalidPolygons: [],
		skippedPolygonCount: 0,
		sourceId: envCell.renderGeometry.sourceId,
		surfaceIds: options.surfaceIds ?? [0],
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
	options: {
		readonly renderSurfaceId?: number;
		readonly surfaceTextureId?: number;
	} = {},
): StaticObjectMaterialSourceFacts {
	const renderSurfaceId = options.renderSurfaceId ?? 0x06000010;
	const surfaceTextureId = options.surfaceTextureId ?? 0x05000010;
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
				renderSurfaceId,
			},
			texture: {
				kind: "surface-texture",
				surfaceTextureId,
			},
		},
		surfaceId: materialId,
		surfaceType: 0,
		translucency: 0,
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
			height: 1,
			palette: null,
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId,
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

async function createStructuredInteriorPlacementSnapshot(
	input: StaticBakeJobInput,
	options: { readonly uniquePages?: boolean } = {},
): Promise<NonNullable<StaticBakeJobInput["texturePlacementSnapshot"]>> {
	const intents = await createStructuredInteriorTexturePlacementIntents({
		assetReader: new EmptyPreparedAssetReader(),
		items: [{ payload: input.payload, task: input.task }],
	});
	return {
		itemIdsByBindingId: new Map(
			intents.map((intent) => [intent.bindingId, intent.itemId]),
		),
		placementsByBindingId: new Map(
			intents.map((intent, index) => [
				intent.bindingId,
				{
					bindingId: intent.bindingId,
					placement: {
						height: 16,
						itemId: intent.itemId,
						ownerIds: intent.ownerIds,
						pageId: options.uniquePages
							? `${intent.purpose}:page:${index}`
							: `${intent.purpose}:page:0`,
						pageClass: intent.pageClass,
						purpose: intent.purpose,
						rect: [0, 0, 16, 16] as const,
						textureKey: intent.textureKey,
						textureRefId: options.uniquePages
							? `${intent.purpose}:texture-ref:${index}`
							: `${intent.purpose}:texture-ref:0`,
						width: 16,
					},
				},
			]),
		),
		placementsByItemId: new Map(
			intents.map((intent, index) => [
				intent.itemId,
				{
					height: 16,
					itemId: intent.itemId,
					ownerIds: intent.ownerIds,
					pageId: options.uniquePages
						? `${intent.purpose}:page:${index}`
						: `${intent.purpose}:page:0`,
					pageClass: intent.pageClass,
					purpose: intent.purpose,
					rect: [0, 0, 16, 16] as const,
					textureKey: intent.textureKey,
					textureRefId: options.uniquePages
						? `${intent.purpose}:texture-ref:${index}`
						: `${intent.purpose}:texture-ref:0`,
					width: 16,
				},
			]),
		),
	};
}

class EmptyPreparedAssetReader implements PreparedAssetReader {
	async requestPreparedAsset(): Promise<PreparedAsset> {
		throw new Error(
			"structured interior placement test did not expect asset reads",
		);
	}
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
		domain: "env-cell-system",
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
		readonly portalApertureResources?: EnvCellSystemStaticScopePayload["portalApertureResources"];
		readonly portalConnectivityGraph?: EnvCellSystemStaticScopePayload["portalConnectivityGraph"];
	} = {},
): StaticBakeJobInput {
	const task: StaticBakeTask = {
		domain: "env-cell-system",
		ownerId: "env-cell-system:0xda55ffff",
		ownerKey: {
			kind: "env-cell-system",
			landblockId: 0xda55ffff,
		},
		revision: 7,
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
		scopeKey: "landblock:da55ffff",
		taskId: "7:landblock:da55ffff:env-cell-system",
	};

	return {
		domain: "env-cell-system",
		payload: {
			job: {
				domain: task.domain,
				scope: task.scope,
			},
			scope: {
				acceptedEnvCellIds: [0xda550100],
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
							normals: new Float32Array(),
							positions: new Float32Array(),
							skippedPolygonCount: 0,
							sourceId: 0xda550100,
							surfaceIds: [],
							triangleCount: 0,
							triangles: [],
							uvs: new Float32Array(),
							vertexCount: 0,
						},
						restrictionObjectId: null,
						seenOutside: null,
						staticObjectPlacements: [
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
				kind: "env-cell-system",
				landblock: {
					kind: "landblock-source",
					landblockId: 0xda55ffff,
					source: "env-cells",
				},
				missingRefs: [],
				materialSources: [],
				paletteSources: [],
				portalApertureResources: options.portalApertureResources ?? [],
				portalConnectivityGraph: options.portalConnectivityGraph ?? {
					edges: [],
					nodes: [],
				},
				portalLinks: [],
				regionRenderProfile: {
					detailRoles: [],
					identity: {
						kind: "region-render-profile",
						regionNumber: 1,
					},
				},
				residencySpatial: {
					envCellSystemBvh: {
						items: [],
						nodes: [],
					},
					envCellSystemBvhItemCount: 1,
					envCellSystemBvhNodeCount: 1,
				},
				sourceAssets: [],
				textureRefs: [],
				visibilityDiagnostics: [],
			},
			sourceRevision: 42,
		},
		revision: 7,
		resources: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		task,
		texturePlacementSnapshot: {
			itemIdsByBindingId: new Map(),
			placementsByBindingId: new Map(),
			placementsByItemId: new Map(),
		},
	};
}

function createBuildingTransitionPortalApertureResource(): EnvCellSystemStaticScopePayload["portalApertureResources"][number] {
	return {
		apertureResourceId:
			"portal-aperture-resource:building-transition:0xda55ffff",
		coordinateSpace: "landblock-render-local",
		indices: [0, 2, 1],
		kind: "portal-aperture-resource",
		landblockId: 0xda55ffff,
		ranges: [
			{
				firstIndex: 0,
				indexCount: 3,
				rangeId:
					"portal-aperture:building-transition:portal-aperture-resource:building-transition:0xda55ffff:transition-portal:outdoor-buildings:3663069183:building-transition-aperture:building-01:0:0:3",
				source: {
					buildingInstanceId: "building-01",
					buildingPortalId: "building-portal-0",
					buildingPortalSourceIndex: 0,
					kind: "building-transition",
					landblockId: 0xda55ffff,
					linkedEnvCellIds: [0xda550100],
					otherCellId: 0x0100,
					otherPortalId: 0xffff,
					polyId: 42,
					portalId:
						"transition-portal:outdoor-buildings:3663069183:building-transition-aperture:building-01:0",
					portalIndex: 0,
					sourceAssetId: "gfxobj/02001234",
					sourceDid: 0x02001234,
					targetEnvCellId: 0xda550100,
				},
				sourceId:
					"building-transition:portal-aperture-resource:building-transition:0xda55ffff:transition-portal:outdoor-buildings:3663069183:building-transition-aperture:building-01:0:0:3",
				sourceKind: "building-transition",
			},
		],
		sourceDomain: "outdoor-buildings",
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
	};
}

function createPortalConnectivityGraph(): EnvCellSystemStaticScopePayload["portalConnectivityGraph"] {
	return {
		edges: [
			{
				direction: "directed",
				edgeId:
					"building-transition:portal-aperture-resource:building-transition:0xda55ffff:transition-portal:outdoor-buildings:3663069183:building-transition-aperture:building-01:0:3663008000",
				flags: 0,
				linkId:
					"transition:portal-aperture-resource:building-transition:0xda55ffff:transition-portal:outdoor-buildings:3663069183:building-transition-aperture:building-01:0:3663008000",
				polygonId: 42,
				provenance: {
					apertureResourceId:
						"portal-aperture-resource:building-transition:0xda55ffff",
					buildingInstanceId: "building-01",
					buildingPortalId: "building-portal-0",
					kind: "building-transition",
					portalId:
						"transition-portal:outdoor-buildings:3663069183:building-transition-aperture:building-01:0",
					targetEnvCellId: 0xda550100,
				},
				sceneCrossing: {
					envCellId: 0xda550100,
					kind: "outdoor-to-env-cell",
					outdoorLandblockId: 0xda55ffff,
				},
				sourceIndex: 0,
				sourceNodeId: "outdoor:3663069183",
				targetNodeId: "env-cell:3663008000",
			},
		],
		nodes: [
			{
				nodeId: "env-cell:3663008000",
				scene: { envCellId: 0xda550100, kind: "env-cell" },
			},
			{
				nodeId: "outdoor:3663069183",
				scene: { kind: "outdoor", landblockId: 0xda55ffff },
			},
		],
	};
}

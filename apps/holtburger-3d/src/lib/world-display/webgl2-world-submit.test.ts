import { describe, expect, it } from "vitest";

import type { WorldRenderFrame } from "./world-render-frame";
import {
	planWebgl2DirectDrawRoute,
	type Webgl2DirectDrawPrograms,
} from "./webgl2/families/direct-family-adapters";
import {
	partitionWebgl2SceneDomainDrawUnits,
	planWebgl2FlatWorldSubmitOrder,
	planWebgl2PortalMaskSubmitOrder,
	planWebgl2TerrainTileSubmitReadiness,
	planWebgl2TerrainTileSubmitOrder,
	planWebgl2WorldSubmitPassSchedule,
	submitWebgl2FlatWorldDrawUnits,
	submitWebgl2FlatWorldFrame,
	type Webgl2FlatWorldProgram,
	type Webgl2IndexedP16WorldProgram,
	type Webgl2IndexedP8WorldProgram,
	type Webgl2TerrainBlendWorldProgram,
} from "./webgl2-world-submit";
import type {
	Webgl2CompactedGeometryBatchResource,
	Webgl2IndexedPalettedFamilyResource,
	Webgl2RgbaTexturePageFamilyResource,
} from "./webgl2/resources/compacted-geometry-resources";
import type { Webgl2TerrainTileResource } from "./webgl2/resources/terrain-tile-resources";
import type { Webgl2TextureAtlasGenerationResource } from "./webgl2/resources/texture-atlas-generation";
import type { Webgl2RgbaTexturePageFamilyWorldProgram } from "./webgl2/families/rgba-texture-page-family-submit";
import type { Webgl2IndexedPalettedFamilyWorldProgram } from "./webgl2/families/indexed-paletted-family-submit";
import type { Webgl2TerrainFamilyWorldProgram } from "./webgl2/families/terrain-family-submit";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";
import {
	Webgl2StateCache,
	type Webgl2StateCacheGl,
} from "./webgl2-state-cache";

describe("planWebgl2FlatWorldSubmitOrder", () => {
	it("sorts visible draw units by material and geometry key", () => {
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			["z", createDrawUnit({ id: "z", materialKey: "mat-b" })],
			["a", createDrawUnit({ id: "a", materialKey: "mat-a" })],
			[
				"b",
				createDrawUnit({
					id: "b",
					materialKey: "mat-a",
					geometrySignature: "geo-b",
				}),
			],
		]);

		expect(
			planWebgl2FlatWorldSubmitOrder(
				createFrame(["z", "b", "a"]),
				drawUnitsById,
			).map((drawUnit) => drawUnit.id),
		).toEqual(["a", "b", "z"]);
	});

	it("fails when frame visibility references a missing draw unit", () => {
		expect(() =>
			planWebgl2FlatWorldSubmitOrder(createFrame(["missing"]), new Map()),
		).toThrow("missing WebGL2 draw unit missing");
	});

	it("keeps portal masks out of the normal world submit order", () => {
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			["world", createDrawUnit({ id: "world" })],
			[
				"mask",
				createDrawUnit({
					id: "mask",
					kind: "portal-mask",
					materialKey: "portal-mask",
				}),
			],
		]);
		const frame = createFrame(["mask", "world"]);

		expect(
			planWebgl2FlatWorldSubmitOrder(frame, drawUnitsById).map(
				(drawUnit) => drawUnit.id,
			),
		).toEqual(["world"]);
		expect(
			planWebgl2PortalMaskSubmitOrder(frame, drawUnitsById).map(
				(drawUnit) => drawUnit.id,
			),
		).toEqual(["mask"]);
	});

	it("plans visible terrain tiles separately from draw units", () => {
		const terrainTilesById = new Map<string, Webgl2TerrainTileResource>([
			["terrain-tile/a", createTerrainTile({ id: "terrain-tile/a" })],
		]);

		expect(
			planWebgl2TerrainTileSubmitOrder(
				createFrameWithTerrainTiles(["terrain-tile/a"]),
				terrainTilesById,
			).map((tile) => tile.id),
		).toEqual(["terrain-tile/a"]);
		expect(
			planWebgl2FlatWorldSubmitOrder(
				createFrameWithTerrainTiles(["terrain-tile/a"]),
				new Map(),
			),
		).toEqual([]);
	});

	it("fails when frame visibility references a missing terrain tile", () => {
		expect(() =>
			planWebgl2TerrainTileSubmitOrder(
				createFrameWithTerrainTiles(["missing-terrain"]),
				new Map(),
			),
		).toThrow("missing WebGL2 terrain tile missing-terrain");
	});

	it("partitions terrain tiles by one-draw readiness while retaining compatibility routing", () => {
		const readyTile = createTerrainTile({
			id: "terrain-tile/ready",
			oneDrawReadiness: {
				status: "ready",
				layerEntryCount: 1,
				texturePageBindingCount: 1,
				colorPageBindingCount: 1,
				maskPageBindingCount: 0,
			},
		});
		const blockedTile = createTerrainTile({
			id: "terrain-tile/blocked",
			oneDrawReadiness: {
				status: "blocked",
				blockers: ["missing terrain color page"],
			},
		});

		const plan = planWebgl2TerrainTileSubmitReadiness([
			blockedTile,
			readyTile,
		]);

		expect(plan.oneDrawTiles.map((tile) => tile.id)).toEqual([
			"terrain-tile/ready",
		]);
		expect(plan.compatibilityTiles.map((tile) => tile.id)).toEqual([
			"terrain-tile/blocked",
		]);
		expect(plan.blockedTiles).toEqual([
			{
				tile: blockedTile,
				blockers: ["missing terrain color page"],
			},
		]);
	});

	it("routes ready terrain draw slices instead of compatibility rendering", () => {
		const slice = createTerrainDrawSlice({
			id: "terrain-tile/blocked/slice/0",
			parentTerrainTileId: "terrain-tile/blocked",
			vertexArrayLabel: "terrain-slice",
			layerPlan: createTerrainLayerPlan(),
			texturePageBindings: [
				{
					family: "terrain-color",
					atlasEntryKey: "terrain-page/color/00000001/21/1/1",
					textureIndex: 0,
					rect: [1, 2, 3, 4],
				},
			],
			oneDrawReadiness: {
				status: "ready",
				layerEntryCount: 1,
				texturePageBindingCount: 1,
				colorPageBindingCount: 1,
				maskPageBindingCount: 0,
			},
		});
		const tile = createTerrainTile({
			id: "terrain-tile/blocked",
			drawSlices: [slice],
		});

		const plan = planWebgl2TerrainTileSubmitReadiness([tile]);

		expect(plan.oneDrawTiles).toEqual([]);
		expect(plan.oneDrawSlices).toEqual([slice]);
		expect(plan.compatibilityTiles).toEqual([]);
		expect(plan.blockedTiles).toEqual([]);
	});
});

describe("partitionWebgl2SceneDomainDrawUnits", () => {
	it("routes exterior, interior, and portal-mask draw units into separate ownership", () => {
		const partition = partitionWebgl2SceneDomainDrawUnits([
			createDrawUnit({ id: "terrain", kind: "terrain" }),
			createDrawUnit({
				id: "outdoor-static",
				kind: "static",
				sceneDomain: "exterior",
			}),
			createDrawUnit({
				id: "indoor-static",
				kind: "static",
				sceneDomain: "interior",
			}),
			createDrawUnit({
				id: "interior",
				kind: "structured-interior",
			}),
			createDrawUnit({ id: "mask", kind: "portal-mask" }),
		]);

		expect(partition.exterior.map((drawUnit) => drawUnit.id)).toEqual([
			"terrain",
			"outdoor-static",
		]);
		expect(partition.interior.map((drawUnit) => drawUnit.id)).toEqual([
			"indoor-static",
			"interior",
		]);
	});
});

describe("planWebgl2WorldSubmitPassSchedule", () => {
	it("keeps retained opaque, compacted families, and retained blended as explicit ordered passes", () => {
		const indexedMaterial = createIndexedMaterial("p8");
		const schedule = planWebgl2WorldSubmitPassSchedule({
			drawUnits: [
				createDrawUnit({ id: "opaque-direct" }),
				createDrawUnit({
					id: "rgba-compacted",
					materialKind: "direct-texture",
					materialKey: "rgba-material",
				}),
				createDrawUnit({
					id: "indexed-compacted",
					materialKind: "indexed-paletted",
					indexedMaterial,
				}),
				createDrawUnit({
					id: "blended-direct",
					materialBehavior: createBlendedMaterialBehavior(),
				}),
			],
			viewProjectionMatrix: createIdentityMat4(),
			rgbaTexturePageFamilyResources: {
				batches: [createRgbaTexturePageFamilyBatch(["rgba-compacted"])],
				rgbaTexturePageFamilies: [
					createRgbaTexturePageFamilyResource(["rgba-compacted"]),
				],
				generation: createTextureAtlasGeneration(),
			},
			indexedPalettedFamilyResources: {
				batches: [createRgbaTexturePageFamilyBatch(["indexed-compacted"])],
				indexedPalettedFamilies: [
					createIndexedPalettedFamilyResource(["indexed-compacted"]),
				],
				detailTextures: [],
				texturesByKey: new Map([
					[
						indexedMaterial.indexTextureKey,
						createTextureResource({} as WebGLTexture),
					],
					[
						indexedMaterial.paletteTextureKey,
						createTextureResource({} as WebGLTexture),
					],
				]),
			},
		});

		expect(
			schedule.passes.map((pass) =>
				pass.kind === "retained-direct"
					? `${pass.kind}:${pass.alphaPolicy}`
					: pass.kind,
			),
		).toEqual([
			"retained-direct:opaque-or-cutout",
			"compacted-rgba-texture-page-family",
			"compacted-indexed-paletted-family",
			"retained-direct:transparent-blend",
		]);
		expect(schedule.retainedDrawUnits.map((drawUnit) => drawUnit.id)).toEqual([
			"opaque-direct",
			"blended-direct",
		]);
		expect(schedule.retainedDirectOpaqueDrawUnitCount).toBe(1);
		expect(schedule.retainedDirectBlendedDrawUnitCount).toBe(1);
		expect(schedule.passes[1]).toMatchObject({
			kind: "compacted-rgba-texture-page-family",
			replaceableDrawUnitTriangleCount: 1,
		});
		expect(schedule.passes[2]).toMatchObject({
			kind: "compacted-indexed-paletted-family",
			replaceableDrawUnitTriangleCount: 1,
		});
	});
});

describe("planWebgl2DirectDrawRoute", () => {
	it("routes flat and portal-mask/debug draw units through the flat program", () => {
		const programs = createDirectDrawPrograms();
		const flat = planWebgl2DirectDrawRoute({
			drawUnit: createDrawUnit({ id: "flat" }),
			programs,
		});
		const mask = planWebgl2DirectDrawRoute({
			drawUnit: createDrawUnit({ id: "mask", kind: "portal-mask" }),
			programs,
		});

		expect(flat.programKind).toBe("flat");
		expect(flat.activeProgram).toBe(programs.flat);
		expect(flat.submission.material.family).toBe("flat-constant-color");
		expect(mask.programKind).toBe("flat");
		expect(mask.activeProgram).toBe(programs.flat);
		expect(mask.submission.material.family).toBe("debug-pipeline");
	});

	it("routes RGBA texture-page draw units with resolved texture-page binding", () => {
		const programs = createDirectDrawPrograms();
		const standaloneTexture = {} as WebGLTexture;
		const atlasTexture = {} as WebGLTexture;
		const route = planWebgl2DirectDrawRoute({
			drawUnit: createDrawUnit({
				id: "texture",
				materialKind: "direct-texture",
				texture: createTextureResource(standaloneTexture),
				baseTexturePageBinding: createPackedBaseTexturePageBinding(
					createTextureResource(atlasTexture, 4, 4),
				),
			}),
			programs,
		});

		expect(route.programKind).toBe("texture");
		expect(route.activeProgram).toBe(programs.rgbaTexturePage);
		expect(route.texturePageBinding?.pageKind).toBe("packed-atlas");
		expect(route.activeBaseTexture).toBe(atlasTexture);
		expect(route.detailTextureUnit).toBe(1);
		expect(route.submission.material.family).toBe("rgba-texture-page");
	});

	it("routes indexed P8 and P16 draw units through distinct indexed programs", () => {
		const programs = createDirectDrawPrograms();
		const p8 = planWebgl2DirectDrawRoute({
			drawUnit: createDrawUnit({
				id: "indexed-p8",
				materialKind: "indexed-paletted",
				indexedMaterial: createIndexedMaterial("p8"),
			}),
			programs,
		});
		const p16 = planWebgl2DirectDrawRoute({
			drawUnit: createDrawUnit({
				id: "indexed-p16",
				materialKind: "indexed-paletted",
				indexedMaterial: createIndexedMaterial("index16"),
			}),
			programs,
		});

		expect(p8.programKind).toBe("indexed-p8");
		expect(p8.activeProgram).toBe(programs.indexedP8);
		expect(p8.detailTextureUnit).toBe(2);
		expect(p8.submission.material.family).toBe("indexed-paletted");
		expect(p16.programKind).toBe("indexed-p16");
		expect(p16.activeProgram).toBe(programs.indexedP16);
		expect(p16.submission.material.family).toBe("indexed-paletted");
	});

	it("routes terrain draw units through the terrain program", () => {
		const programs = createDirectDrawPrograms();
		const route = planWebgl2DirectDrawRoute({
			drawUnit: createDrawUnit({
				id: "terrain",
				kind: "terrain",
				materialKind: "terrain-blend",
				terrainBlend: createTerrainBlendResources(),
			}),
			programs,
		});

		expect(route.programKind).toBe("terrain");
		expect(route.activeProgram).toBe(programs.terrainBlend);
		expect(route.colorProgram).toBeNull();
		expect(route.submission.material.family).toBe("terrain-blend");
	});
});

describe("submitWebgl2FlatWorldFrame", () => {
	it("submits visible draw units through the state cache", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const vertexArray = {} as WebGLVertexArrayObject;
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			["first", createDrawUnit({ id: "first", vertexArray })],
			["second", createDrawUnit({ id: "second", vertexArray })],
		]);
		const program = {
			program: {} as WebGLProgram,
			attributes: { position: 0 },
			uniforms: {
				uModelViewProjection: {} as WebGLUniformLocation,
				uColor: {} as WebGLUniformLocation,
			},
			dispose() {
				return;
			},
		} satisfies Webgl2FlatWorldProgram;
		const texturedProgram = {
			program: {} as WebGLProgram,
			attributes: { position: 0, uv: 1 },
			uniforms: {
				uModelViewProjection: {} as WebGLUniformLocation,
				uColor: {} as WebGLUniformLocation,
				uAlphaTest: {} as WebGLUniformLocation,
				uTexture: {} as WebGLUniformLocation,
				uAtlasEnabled: {} as WebGLUniformLocation,
				uAtlasRect: {} as WebGLUniformLocation,
				uAtlasSize: {} as WebGLUniformLocation,
				uTexturePageWrapMode: {} as WebGLUniformLocation,
				uDetailTexture: {} as WebGLUniformLocation,
				uDetailTiling: {} as WebGLUniformLocation,
				uDetailEnabled: {} as WebGLUniformLocation,
			},
			dispose() {
				return;
			},
		};

		const metrics = submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program,
			texturedProgram,
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			drawUnitsById,
			frame: createFrame(["first", "second"]),
		});

		expect(metrics.drawCallCount).toBe(2);
		expect(metrics.programSwitchCount).toBe(1);
		expect(metrics.vertexArrayBindCount).toBe(1);
		expect(metrics.uniformUploadCount).toBe(2);
		expect(metrics.triangleCount).toBe(2);
		expect(gl.calls).toContain(`disable:${gl.CULL_FACE}`);
		expect(
			gl.calls.filter((call) => call === "drawElements:4:3:5123:0"),
		).toHaveLength(2);
	});

	it("submits textured draw units with material color and opacity", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			[
				"textured",
				createDrawUnit({
					id: "textured",
					color: new Float32Array([0, 0, 0, 0.5]),
					materialKind: "direct-texture",
					texture: {
						texture: {} as WebGLTexture,
						width: 1,
						height: 1,
						dispose() {
							return;
						},
					},
				}),
			],
		]);

		submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			drawUnitsById,
			frame: createFrame(["textured"]),
		});

		expect(gl.uniform4fvValues).toContainEqual([0, 0, 0, 0.5]);
	});

	it("submits eligible retained direct draw units through the shared texture atlas", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const standaloneTexture = {} as WebGLTexture;
		const atlasTexture = {} as WebGLTexture;
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			[
				"atlas-staged",
				createDrawUnit({
					id: "atlas-staged",
					materialKind: "direct-texture",
					texture: createTextureResource(standaloneTexture),
					atlasEntryKey: "entry/a",
					baseTexturePageBinding: createPackedBaseTexturePageBinding(
						createTextureResource(atlasTexture, 4, 4),
					),
				}),
			],
		]);

		const metrics = submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			rgbaTexturePageFamilyResources: {
				batches: [],
				rgbaTexturePageFamilies: [],
				generation: createTextureAtlasGeneration({
					atlasEntryKey: "entry/a",
					texture: atlasTexture,
				}),
			},
			drawUnitsById,
			frame: createFrame(["atlas-staged"]),
		});

		expect(metrics.directTexturePageDrawCount).toBe(1);
		expect(metrics.directPackedTexturePageDrawCount).toBe(1);
		expect(metrics.directSingleEntryTexturePageDrawCount).toBe(0);
		expect(metrics.directPackedTexturePageEstimatedBindAvoidedCount).toBe(1);
		expect(metrics.directPackedTexturePageTextureCount).toBe(1);
		expect(metrics.directTexturePageFallbackSamples).toEqual([]);
		expect(gl.boundTextures).toContain(atlasTexture);
		expect(gl.boundTextures).not.toContain(standaloneTexture);
		expect(gl.uniform1iValues).toContain(1);
		expect(gl.uniform4fValues).toContainEqual([1, 2, 3, 4]);
		expect(gl.uniform2fValues).toContainEqual([4, 4]);
	});

	it("keeps RGBA family replacement ahead of staged atlas routing", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			[
				"atlas",
				createDrawUnit({
					id: "atlas",
					materialKind: "direct-texture",
					texture: createTextureResource({} as WebGLTexture),
					atlasEntryKey: "entry/a",
				}),
			],
		]);

		const metrics = submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			rgbaTexturePageFamilyProgram: createRgbaTexturePageFamilyProgram(),
			rgbaTexturePageFamilyResources: {
				batches: [createRgbaTexturePageFamilyBatch(["atlas"])],
				rgbaTexturePageFamilies: [
					createRgbaTexturePageFamilyResource(["atlas"]),
				],
				generation: createTextureAtlasGeneration({ atlasEntryKey: "entry/a" }),
			},
			drawUnitsById,
			frame: createFrame(["atlas"]),
		});

		expect(metrics.rgbaTexturePageFamilyReplacedDrawUnitCount).toBe(1);
		expect(metrics.directPackedTexturePageDrawCount).toBe(0);
		expect(metrics.directSingleEntryTexturePageDrawCount).toBe(0);
	});

	it("falls back to standalone direct texture when staged atlas has no generation", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const standaloneTexture = {} as WebGLTexture;
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			[
				"standalone",
				createDrawUnit({
					id: "standalone",
					materialKind: "direct-texture",
					texture: createTextureResource(standaloneTexture),
					atlasEntryKey: "entry/a",
				}),
			],
		]);

		const metrics = submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			drawUnitsById,
			frame: createFrame(["standalone"]),
		});

		expect(metrics.directPackedTexturePageDrawCount).toBe(0);
		expect(metrics.directSingleEntryTexturePageDrawCount).toBe(1);
		expect(metrics.directTexturePageFallbackSamples).toContain(
			"direct packed base page missing texture atlas generation",
		);
		expect(gl.boundTextures).toContain(standaloneTexture);
		expect(gl.uniform1iValues).toContain(1);
	});

	it("samples repeat direct draw units through packed texture pages with wrap uniforms", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const standaloneTexture = {} as WebGLTexture;
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			[
				"repeat",
				createDrawUnit({
					id: "repeat",
					materialKind: "direct-texture",
					texture: createTextureResource(standaloneTexture),
					atlasEntryKey: "entry/a",
					atlasWrapS: "repeat",
					atlasWrapT: "repeat",
					baseTexturePageBinding: createPackedBaseTexturePageBinding(
						createTextureResource({} as WebGLTexture, 4, 4),
						"repeat",
						"repeat",
					),
				}),
			],
		]);

		const metrics = submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			rgbaTexturePageFamilyResources: {
				batches: [],
				rgbaTexturePageFamilies: [],
				generation: createTextureAtlasGeneration({ atlasEntryKey: "entry/a" }),
			},
			drawUnitsById,
			frame: createFrame(["repeat"]),
		});

		expect(metrics.directPackedTexturePageDrawCount).toBe(1);
		expect(metrics.directSingleEntryTexturePageDrawCount).toBe(0);
		expect(metrics.directTexturePageFallbackSamples).toEqual([]);
		expect(gl.boundTextures).not.toContain(standaloneTexture);
		expect(gl.uniform2fValues).toContainEqual([1, 1]);
	});

	it("replaces RGBA texture-page family draw units through the RGBA family submit path", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			["atlas", createDrawUnit({ id: "atlas" })],
			["staged", createDrawUnit({ id: "staged" })],
		]);

		const metrics = submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			rgbaTexturePageFamilyProgram: createRgbaTexturePageFamilyProgram(),
			rgbaTexturePageFamilyResources: {
				batches: [createRgbaTexturePageFamilyBatch(["atlas"])],
				rgbaTexturePageFamilies: [
					createRgbaTexturePageFamilyResource(["atlas"]),
				],
				generation: createTextureAtlasGeneration(),
			},
			drawUnitsById,
			frame: createFrame(["atlas", "staged"]),
		});

		expect(metrics.visibleDrawUnitCount).toBe(2);
		expect(metrics.drawCallCount).toBe(2);
		expect(metrics.triangleCount).toBe(2);
		expect(metrics.rgbaTexturePageFamilyReplacedDrawUnitCount).toBe(1);
		expect(metrics.rgbaTexturePageFamilyReplacedDrawUnitTriangleCount).toBe(1);
		expect(metrics.rgbaTexturePageFamilyRetainedDirectDrawUnitCount).toBe(1);
		expect(metrics.rgbaTexturePageFamilyShaderDrawCallCount).toBe(1);
		expect(
			metrics.rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount,
		).toBe(1);
		expect(metrics.rgbaTexturePageFamilySubmittedTriangleCount).toBe(1);
		expect(metrics.rgbaTexturePageFamilyConservativeOverdrawTriangleCount).toBe(
			0,
		);
		expect(metrics.rgbaTexturePageFamilyConservativeOverdrawRatio).toBe(0);
		expect(metrics.rgbaTexturePageFamilyOriginalDrawCallEstimateCount).toBe(2);
		expect(metrics.rgbaTexturePageFamilySubmittedDrawCallEstimateCount).toBe(2);
		expect(metrics.rgbaTexturePageFamilyDrawCallSavingsCount).toBe(0);
		expect(
			metrics.visibleRetainedDirectDrawUnitCountsByCompactionFamily,
		).toEqual({
			"flat-constant-color": 1,
		});
		expect(metrics.rgbaTexturePageFamilyFallbackSamples).toEqual([]);
	});

	it("reports conservative whole-slice atlas overdraw", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			["atlas", createDrawUnit({ id: "atlas" })],
			["staged", createDrawUnit({ id: "staged" })],
		]);

		const metrics = submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			rgbaTexturePageFamilyProgram: createRgbaTexturePageFamilyProgram(),
			rgbaTexturePageFamilyResources: {
				batches: [
					createRgbaTexturePageFamilyBatch(["atlas", "not-visible"], {
						indexCount: 6,
						triangleCount: 2,
					}),
				],
				rgbaTexturePageFamilies: [
					createRgbaTexturePageFamilyResource(["atlas", "not-visible"], {
						indexCount: 6,
					}),
				],
				generation: createTextureAtlasGeneration(),
			},
			drawUnitsById,
			frame: createFrame(["atlas", "staged"]),
		});

		expect(metrics.rgbaTexturePageFamilyReplacedDrawUnitCount).toBe(1);
		expect(metrics.rgbaTexturePageFamilyReplacedDrawUnitTriangleCount).toBe(1);
		expect(
			metrics.rgbaTexturePageFamilySubmittedSliceRepresentedDrawUnitCount,
		).toBe(2);
		expect(metrics.rgbaTexturePageFamilySubmittedTriangleCount).toBe(2);
		expect(metrics.rgbaTexturePageFamilyConservativeOverdrawTriangleCount).toBe(
			1,
		);
		expect(metrics.rgbaTexturePageFamilyConservativeOverdrawRatio).toBe(0.5);
	});

	it("attributes no-visible atlas route checks to the submit route", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const drawUnits = [createDrawUnit({ id: "visible" })];

		const metrics = submitWebgl2FlatWorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			rgbaTexturePageFamilyProgram: createRgbaTexturePageFamilyProgram(),
			rgbaTexturePageFamilyResources: {
				batches: [createRgbaTexturePageFamilyBatch(["not-visible"])],
				rgbaTexturePageFamilies: [
					createRgbaTexturePageFamilyResource(["not-visible"]),
				],
				generation: createTextureAtlasGeneration(),
			},
			viewProjectionMatrix: createIdentityMat4(),
			drawUnits,
			rgbaTexturePageFamilySubmitRoute: "scene-domain-interior",
		});

		expect(metrics.rgbaTexturePageFamilyNoVisibleRouteCount).toBe(1);
		expect(metrics.rgbaTexturePageFamilyNoVisibleExteriorRouteCount).toBe(0);
		expect(metrics.rgbaTexturePageFamilyNoVisibleInteriorRouteCount).toBe(1);
		expect(metrics.rgbaTexturePageFamilyNoVisibleOtherRouteCount).toBe(0);
		expect(metrics.rgbaTexturePageFamilyFallbackSamples).toEqual([]);
	});

	it("submits one-draw-ready terrain tiles through the terrain family shader", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const atlasTexture = { debugLabel: "terrain-atlas" } as WebGLTexture;
		const terrainTile = createTerrainTile({
			id: "terrain-tile/ready",
			vertexArrayLabel: "terrain-ready",
			vertexCount: 6,
			triangleCount: 2,
			layerPlan: createTerrainLayerPlan(),
			texturePageBindings: [
				{
					family: "terrain-color",
					atlasEntryKey: "terrain-page/color/00000001/21/1/1",
					textureIndex: 0,
					rect: [1, 2, 3, 4],
				},
			],
			oneDrawReadiness: {
				status: "ready",
				layerEntryCount: 1,
				texturePageBindingCount: 1,
				colorPageBindingCount: 1,
				maskPageBindingCount: 0,
			},
		});

		const metrics = submitWebgl2FlatWorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			terrainFamilyProgram: createTerrainFamilyProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			rgbaTexturePageFamilyResources: {
				batches: [],
				rgbaTexturePageFamilies: [],
				generation: createTextureAtlasGeneration({
					atlasEntryKey: "terrain-page/color/00000001/21/1/1",
					texture: atlasTexture,
				}),
			},
			viewProjectionMatrix: createIdentityMat4(),
			drawUnits: [],
			terrainTiles: [terrainTile],
		});

		expect(metrics.terrainOneDrawShaderDrawCallCount).toBe(1);
		expect(metrics.terrainOneDrawSubmittedTileCount).toBe(1);
		expect(metrics.terrainCompatibilityDrawCallCount).toBe(0);
		expect(gl.calls).toContain("drawElementsFor:terrain-ready");
		expect(gl.boundTextures).toContain(atlasTexture);
	});

	it("submits blended retained direct draw units after compacted opaque family draws", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const drawUnits = [
			createDrawUnit({
				id: "opaque-direct",
				modelMatrix: createTranslationMat4({ z: 2 }),
			}),
			createDrawUnit({
				id: "atlas",
				materialKind: "direct-texture",
				materialKey: "atlas-material",
			}),
			createDrawUnit({
				id: "blended-direct",
				materialBehavior: createBlendedMaterialBehavior(),
				modelMatrix: createTranslationMat4({ z: 6 }),
			}),
		];

		const metrics = submitWebgl2FlatWorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			rgbaTexturePageFamilyProgram: createRgbaTexturePageFamilyProgram(),
			rgbaTexturePageFamilyResources: {
				batches: [createRgbaTexturePageFamilyBatch(["atlas"])],
				rgbaTexturePageFamilies: [
					createRgbaTexturePageFamilyResource(["atlas"]),
				],
				generation: createTextureAtlasGeneration(),
			},
			viewProjectionMatrix: createIdentityMat4(),
			drawUnits,
		});

		const opaqueDirectDrawIndex = gl.calls.indexOf(
			"drawElementsFor:opaque-direct",
		);
		const compactedDrawIndex = gl.calls.findIndex(
			(call) => call === "drawElementsFor:atlas-batch",
		);
		const blendedDirectDrawIndex = gl.calls.indexOf(
			"drawElementsFor:blended-direct",
		);

		expect(metrics.retainedDirectOpaqueDrawUnitCount).toBe(1);
		expect(metrics.retainedDirectBlendedDrawUnitCount).toBe(1);
		expect(opaqueDirectDrawIndex).toBeGreaterThanOrEqual(0);
		expect(compactedDrawIndex).toBeGreaterThan(opaqueDirectDrawIndex);
		expect(blendedDirectDrawIndex).toBeGreaterThan(compactedDrawIndex);
		expect(gl.calls.slice(compactedDrawIndex, blendedDirectDrawIndex)).toContain(
			"depthMask:false",
		);
		expect(gl.calls.slice(compactedDrawIndex, blendedDirectDrawIndex)).toContain(
			`enable:${gl.BLEND}`,
		);
		expect(gl.calls.slice(blendedDirectDrawIndex)).toContain("depthMask:true");
		expect(gl.calls.slice(blendedDirectDrawIndex)).toContain(
			`disable:${gl.BLEND}`,
		);
	});

	it("sorts blended retained direct draw units back to front", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const drawUnits = [
			createDrawUnit({
				id: "near-blended",
				materialBehavior: createBlendedMaterialBehavior(),
				modelMatrix: createTranslationMat4({ z: 1 }),
			}),
			createDrawUnit({
				id: "far-blended",
				materialBehavior: createBlendedMaterialBehavior(),
				modelMatrix: createTranslationMat4({ z: 8 }),
			}),
		];

		const metrics = submitWebgl2FlatWorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			viewProjectionMatrix: createIdentityMat4(),
			drawUnits,
		});

		expect(metrics.retainedDirectOpaqueDrawUnitCount).toBe(0);
		expect(metrics.retainedDirectBlendedDrawUnitCount).toBe(2);
		expect(
			gl.calls.filter((call) => call.startsWith("drawElementsFor:")),
		).toEqual(["drawElementsFor:far-blended", "drawElementsFor:near-blended"]);
	});

	it("submits blended retained direct RGBA draw units through packed atlas bindings", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const standaloneTexture = {} as WebGLTexture;
		const atlasTexture = {} as WebGLTexture;
		const drawUnits = [
			createDrawUnit({
				id: "blended-atlas-direct",
				materialKind: "direct-texture",
				texture: createTextureResource(standaloneTexture),
				atlasEntryKey: "entry/blended",
				baseTexturePageBinding: createPackedBaseTexturePageBinding(
					createTextureResource(atlasTexture, 4, 4),
				),
				materialBehavior: createBlendedMaterialBehavior(),
			}),
		];

		const metrics = submitWebgl2FlatWorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			rgbaTexturePageFamilyResources: {
				batches: [],
				rgbaTexturePageFamilies: [],
				generation: createTextureAtlasGeneration({
					atlasEntryKey: "entry/blended",
					texture: atlasTexture,
				}),
			},
			viewProjectionMatrix: createIdentityMat4(),
			drawUnits,
		});

		const drawIndex = gl.calls.indexOf("drawElementsFor:blended-atlas-direct");

		expect(metrics.retainedDirectOpaqueDrawUnitCount).toBe(0);
		expect(metrics.retainedDirectBlendedDrawUnitCount).toBe(1);
		expect(metrics.directPackedTexturePageDrawCount).toBe(1);
		expect(metrics.directSingleEntryTexturePageDrawCount).toBe(0);
		expect(gl.boundTextures).toContain(atlasTexture);
		expect(gl.boundTextures).not.toContain(standaloneTexture);
		expect(drawIndex).toBeGreaterThanOrEqual(0);
		expect(gl.calls.slice(0, drawIndex)).toContain(`enable:${gl.BLEND}`);
		expect(gl.calls.slice(drawIndex)).toContain(`disable:${gl.BLEND}`);
	});

	it("enables backface culling only for terrain when requested", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const drawUnits = [
			createDrawUnit({
				id: "terrain",
				kind: "terrain",
				materialKind: "terrain-blend",
				terrainBlend: createTerrainBlendResources(),
			}),
			createDrawUnit({ id: "static", kind: "static" }),
		];

		submitWebgl2FlatWorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			viewProjectionMatrix: createIdentityMat4(),
			drawUnits,
			terrainBackfaceCulling: true,
		});

		const cullCalls = gl.calls.filter(
			(call) =>
				call === `enable:${gl.CULL_FACE}` || call === `disable:${gl.CULL_FACE}`,
		);
		expect(cullCalls).toEqual([
			`disable:${gl.CULL_FACE}`,
			`enable:${gl.CULL_FACE}`,
			`disable:${gl.CULL_FACE}`,
		]);
	});

	it("keeps terrain backface culling disabled by default", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);

		submitWebgl2FlatWorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			viewProjectionMatrix: createIdentityMat4(),
			drawUnits: [
				createDrawUnit({
					id: "terrain",
					kind: "terrain",
					materialKind: "terrain-blend",
					terrainBlend: createTerrainBlendResources(),
				}),
			],
		});

		expect(gl.calls).toContain(`disable:${gl.CULL_FACE}`);
		expect(gl.calls).not.toContain(`enable:${gl.CULL_FACE}`);
	});

	it("submits indexed draw units with index and palette texture bindings", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			[
				"indexed",
				createDrawUnit({
					id: "indexed",
					materialKind: "indexed-paletted",
					indexedMaterial: {
						key: "indexed",
						indexFormat: "p8",
						indexTextureKey: "index",
						paletteTextureKey: "palette",
						indexTexture: {
							texture: {} as WebGLTexture,
							width: 2,
							height: 1,
							dispose() {
								return;
							},
						},
						paletteTexture: {
							texture: {} as WebGLTexture,
							width: 2,
							height: 1,
							dispose() {
								return;
							},
						},
						width: 2,
						height: 1,
						paletteColorCount: 2,
						wrapS: "clamp",
						wrapT: "repeat",
						clipThreshold: -1,
					},
				}),
			],
		]);

		submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			drawUnitsById,
			frame: createFrame(["indexed"]),
		});

		expect(gl.calls.filter((call) => call === "bindTexture")).toHaveLength(2);
		expect(gl.calls).toContain("uniform2f");
	});

	it("replaces opaque indexed draw units through the indexed-paletted family submit path", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const indexTexture = {} as WebGLTexture;
		const paletteTexture = {} as WebGLTexture;
		const indexedMaterial = createIndexedMaterial("p8");
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			[
				"indexed",
				createDrawUnit({
					id: "indexed",
					materialKind: "indexed-paletted",
					indexedMaterial,
				}),
			],
			["staged", createDrawUnit({ id: "staged" })],
		]);

		const metrics = submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			indexedPalettedFamilyP8Program: createIndexedPalettedFamilyProgram(),
			indexedPalettedFamilyP16Program: createIndexedPalettedFamilyProgram(),
			indexedPalettedFamilyResources: {
				batches: [createRgbaTexturePageFamilyBatch(["indexed"])],
				indexedPalettedFamilies: [
					createIndexedPalettedFamilyResource(["indexed"]),
				],
				detailTextures: [],
				texturesByKey: new Map([
					[
						indexedMaterial.indexTextureKey,
						createTextureResource(indexTexture),
					],
					[
						indexedMaterial.paletteTextureKey,
						createTextureResource(paletteTexture),
					],
				]),
			},
			drawUnitsById,
			frame: createFrame(["indexed", "staged"]),
		});

		expect(metrics.visibleDrawUnitCount).toBe(2);
		expect(metrics.drawCallCount).toBe(2);
		expect(metrics.indexedPalettedFamilyReplacedDrawUnitCount).toBe(1);
		expect(metrics.indexedPalettedFamilyShaderDrawCallCount).toBe(1);
		expect(metrics.indexedPalettedFamilySubmittedTriangleCount).toBe(1);
		expect(metrics.indexedPalettedFamilyRetainedDirectDrawUnitCount).toBe(1);
		expect(
			metrics.visibleRetainedDirectDrawUnitCountsByCompactionFamily,
		).toEqual({
			"flat-constant-color": 1,
		});
		expect(gl.boundTextures).toContain(indexTexture);
		expect(gl.boundTextures).toContain(paletteTexture);
		expect(
			gl.calls.filter((call) => call.startsWith("drawElements:")),
		).toHaveLength(2);
	});

	it("binds detail atlas pages for compacted indexed family draw slices", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const indexTexture = {} as WebGLTexture;
		const paletteTexture = {} as WebGLTexture;
		const detailTexture = {} as WebGLTexture;
		const indexedMaterial = createIndexedMaterial("p8");
		const drawUnitsById = new Map<string, Webgl2WorldDrawUnit>([
			[
				"indexed-detail",
				createDrawUnit({
					id: "indexed-detail",
					materialKind: "indexed-paletted",
					indexedMaterial,
				}),
			],
		]);

		const metrics = submitWebgl2FlatWorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainBlendProgram: createTerrainBlendProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			indexedPalettedFamilyP8Program: createIndexedPalettedFamilyProgram(),
			indexedPalettedFamilyP16Program: createIndexedPalettedFamilyProgram(),
			indexedPalettedFamilyResources: {
				batches: [createRgbaTexturePageFamilyBatch(["indexed-detail"])],
				indexedPalettedFamilies: [
					createIndexedPalettedFamilyResource(["indexed-detail"], {
						detailAtlasTextureIndex: 0,
					}),
				],
				detailTextures: [
					{
						key: "detail-texture",
						textureIndex: 0,
						texture: createTextureResource(detailTexture),
						width: 4,
						height: 4,
						placementCount: 1,
					},
				],
				texturesByKey: new Map([
					[
						indexedMaterial.indexTextureKey,
						createTextureResource(indexTexture),
					],
					[
						indexedMaterial.paletteTextureKey,
						createTextureResource(paletteTexture),
					],
				]),
			},
			drawUnitsById,
			frame: createFrame(["indexed-detail"]),
		});

		expect(metrics.indexedPalettedFamilyReplacedDrawUnitCount).toBe(1);
		expect(gl.boundTextures).toContain(indexTexture);
		expect(gl.boundTextures).toContain(paletteTexture);
		expect(gl.boundTextures).toContain(detailTexture);
		expect(gl.uniform2fValues).toContainEqual([4, 4]);
	});
});

function createFrame(drawUnitIds: readonly string[]): WorldRenderFrame {
	return {
		cameraFrame: createCameraFrame(),
		viewProjectionMatrix: createIdentityMat4(),
		passes: [
			{
				id: "world",
				draws: drawUnitIds.map((drawUnitId) => ({
					kind: "draw-unit" as const,
					drawUnitId,
					category: "static",
				})),
			},
		],
		metrics: {
			registeredBatchCount: drawUnitIds.length,
			keyedBatchCount: 0,
			representedItemKeyCount: 0,
			visibleItemKeyCount: 0,
			candidateBatchCount: drawUnitIds.length,
			itemKeyMatchedBatchCount: 0,
			unboundFallbackBatchCount: 0,
			explicitFallbackBatchCount: 0,
			queryFallbackBatchCount: 0,
			fallbackReasonCount: 0,
			fallbackReasonSamples: [],
			candidateCountsByCategory: createCategoryCounts(),
			visibleDrawCountsByCategory: createCategoryCounts(),
			fallbackCountsByCategory: createCategoryCounts(),
			representedItemKeyCountsByCategory: createCategoryCounts(),
		},
	};
}

function createFrameWithTerrainTiles(
	terrainTileIds: readonly string[],
): WorldRenderFrame {
	return {
		cameraFrame: createCameraFrame(),
		viewProjectionMatrix: createIdentityMat4(),
		passes: [
			{
				id: "world",
				draws: terrainTileIds.map((terrainTileId) => ({
					kind: "terrain-tile" as const,
					terrainTileId,
					category: "terrain" as const,
				})),
			},
		],
		metrics: {
			registeredBatchCount: terrainTileIds.length,
			keyedBatchCount: 0,
			representedItemKeyCount: 0,
			visibleItemKeyCount: 0,
			candidateBatchCount: terrainTileIds.length,
			itemKeyMatchedBatchCount: 0,
			unboundFallbackBatchCount: 0,
			explicitFallbackBatchCount: 0,
			queryFallbackBatchCount: 0,
			fallbackReasonCount: 0,
			fallbackReasonSamples: [],
			candidateCountsByCategory: createCategoryCounts(),
			visibleDrawCountsByCategory: createCategoryCounts(),
			fallbackCountsByCategory: createCategoryCounts(),
			representedItemKeyCountsByCategory: createCategoryCounts(),
		},
	};
}

function createCameraFrame(): WorldRenderFrame["cameraFrame"] {
	return {
		position: { x: 0, y: 0, z: 10 },
		target: { x: 0, y: 0, z: 0 },
		up: { x: 0, y: 1, z: 0 },
		fovDegrees: 60,
		aspect: 1,
		near: 0.1,
		far: 100,
	};
}

function createTerrainTile({
	id,
	vertexArrayLabel,
	vertexCount = 0,
	triangleCount = 0,
	layerPlan = null,
	texturePageBindings = [],
	drawSlices = [],
	oneDrawReadiness = {
		status: "blocked",
		blockers: ["test terrain tile is not one-draw ready"],
	},
}: {
	id: string;
	vertexArrayLabel?: string;
	vertexCount?: number;
	triangleCount?: number;
	layerPlan?: Webgl2TerrainTileResource["layerPlan"];
	texturePageBindings?: Webgl2TerrainTileResource["texturePageBindings"];
	drawSlices?: Webgl2TerrainTileResource["drawSlices"];
	oneDrawReadiness?: Webgl2TerrainTileResource["oneDrawReadiness"];
}): Webgl2TerrainTileResource {
	return {
		id,
		assetId: id.replace(/^terrain-tile\//, ""),
		landblockId: 0x12340000,
		label: "1234",
		placementKey: "landblock/1234ffff",
		geometrySignature: "terrain-geo",
		vertexArray: createVertexArrayResource(vertexArrayLabel),
		vertexBuffer: createBufferResource(),
		uvBuffer: createBufferResource(),
		layerSlotBuffer: createBufferResource(),
		indexBuffer: createBufferResource(),
		indexType: 5123,
		vertexCount,
		triangleCount,
		modelMatrix: createIdentityMat4(),
		readiness: {
			status: "fallback-debug",
			reason: "test",
		},
		dataSource: "unknown",
		bvhItemKeys: ["terrain:landblock:12340000:quad:0"],
		bvhFallbackReason: null,
		compatibilityDraws: [],
		layerPlan,
		layerPlanBlockers: [],
		texturePageBindings,
		texturePageBlockers: [],
		oneDrawReadiness,
		drawSlices,
	};
}

function createTerrainDrawSlice({
	id,
	parentTerrainTileId,
	vertexArrayLabel,
	layerPlan,
	texturePageBindings = [],
	oneDrawReadiness,
}: {
	id: string;
	parentTerrainTileId: string;
	vertexArrayLabel?: string;
	layerPlan: NonNullable<Webgl2TerrainTileResource["layerPlan"]>;
	texturePageBindings?: Webgl2TerrainTileResource["texturePageBindings"];
	oneDrawReadiness: Webgl2TerrainTileResource["oneDrawReadiness"];
}): Webgl2TerrainTileResource["drawSlices"][number] {
	return {
		id,
		parentTerrainTileId,
		reason: "test slice",
		geometrySignature: "slice-geo",
		vertexArray: createVertexArrayResource(vertexArrayLabel),
		vertexBuffer: createBufferResource(),
		uvBuffer: createBufferResource(),
		layerSlotBuffer: createBufferResource(),
		indexBuffer: createBufferResource(),
		indexType: 5123,
		vertexCount: 6,
		triangleCount: 2,
		modelMatrix: createIdentityMat4(),
		bvhItemKeys: ["terrain:landblock:12340000:quad:0"],
		layerPlan,
		texturePageBindings,
		texturePageBlockers: [],
		oneDrawReadiness,
	};
}

function createTerrainLayerPlan(): NonNullable<
	Webgl2TerrainTileResource["layerPlan"]
> {
	const base = {
		textureAssetId: "surface-texture/00000001",
		renderSurface: {
			renderSurfaceId: 1,
			formatRaw: 0x15,
			width: 1,
			height: 1,
		},
		tiling: 4,
		wrap: "repeat",
		role: "color",
	} as const;
	const plan = {
		pcode: 1,
		base,
		overlays: [],
		roads: [],
		allRoad: false,
	};
	return {
		layerEntries: [
			{
				slot: 0,
				pcode: 1,
				plan,
				colorRefCount: 1,
				maskRefCount: 0,
			},
		],
		layerSlotByPcode: new Map([[1, 0]]),
		blockers: [],
		signature: "terrain-layer-plan/test",
	};
}

function createVertexArrayResource(debugLabel?: string) {
	return {
		vertexArray: { debugLabel } as WebGLVertexArrayObject,
		dispose() {},
	};
}

function createBufferResource() {
	return {
		buffer: {} as WebGLBuffer,
		target: 0,
		byteLength: 0,
		dispose() {},
	};
}

function createDrawUnit({
	id,
	materialKey = "mat-a",
	materialKind = "flat",
	geometrySignature = "geo-a",
	color = new Float32Array([1, 0, 0, 1]),
	texture = null,
	indexedMaterial = null,
	terrainBlend = null,
	atlasEntryKey = null,
	atlasWrapS = "clamp",
	atlasWrapT = "clamp",
	baseTexturePageBinding,
	vertexArray = {} as WebGLVertexArrayObject,
	kind = "static",
	sceneDomain,
	materialBehavior = null,
	modelMatrix = createIdentityMat4(),
}: {
	id: string;
	kind?: Webgl2WorldDrawUnit["kind"];
	sceneDomain?: Webgl2WorldDrawUnit["sceneDomain"];
	materialKey?: string;
	materialKind?: Webgl2WorldDrawUnit["materialKind"];
	geometrySignature?: string;
	color?: Float32Array;
	texture?: Webgl2WorldDrawUnit["texture"];
	indexedMaterial?: Webgl2WorldDrawUnit["indexedMaterial"];
	terrainBlend?: Webgl2WorldDrawUnit["terrainBlend"];
	atlasEntryKey?: string | null;
	atlasWrapS?: "clamp" | "repeat";
	atlasWrapT?: "clamp" | "repeat";
	baseTexturePageBinding?: Webgl2WorldDrawUnit["texturePageBindings"][number];
	vertexArray?: WebGLVertexArrayObject;
	materialBehavior?: LegacyMaterialBehaviorDto | null;
	modelMatrix?: Float32Array;
}): Webgl2WorldDrawUnit {
	const defaultTexturePageBinding = texture
		? createSingleEntryBaseTexturePageBinding(texture, atlasWrapS, atlasWrapT)
		: null;
	return {
		id,
		kind,
		owningLandblockId: kind === "static" ? 0x0102ffff : null,
		geometrySignature,
		submitOrderKey: [
			texture ? "0" : "1",
			materialKind,
			materialKey,
			"",
			geometrySignature,
			id,
		].join("\0"),
		vertexArray: {
			vertexArray: attachDebugLabel(vertexArray, id),
			dispose() {
				return;
			},
		},
		vertexBuffer: {
			buffer: {} as WebGLBuffer,
			dispose() {
				return;
			},
		},
		uvBuffer: null,
		directGeometryLayout: "position",
		indexBuffer: {
			buffer: {} as WebGLBuffer,
			dispose() {
				return;
			},
		},
		indexType: 5123,
		vertexCount: 3,
		triangleCount: 1,
		color,
		materialKind,
		materialKey,
		materialFallbackReason: null,
		materialBehavior,
		directTextureSamplingPolicy: texture
			? {
					wrapS: atlasWrapS,
					wrapT: atlasWrapT,
					magFilter: "linear",
					minFilter: "linear",
					mipFilter: "linear",
					colorSpace: "srgb",
					anisotropy: 1,
					generateMipmaps: true,
					flipY: false,
				}
			: null,
		textureUploadSample: null,
		texturePageReadiness: atlasEntryKey
			? {
					atlasEntryKey,
					materialSlotKey: `${materialKey}|slot`,
					renderStateKey:
						"shader=atlas-color;blend=opaque;depth=write;alphaTest=0;side=front",
					samplingKey: `wrap=${atlasWrapS}/${atlasWrapT};filter=linear/linear/linear;color=linear;mips=atlas`,
					samplingPolicy: { wrapS: atlasWrapS, wrapT: atlasWrapT },
					atlasEntry: {
						renderSurfaceId: 1,
						preparedTextureAssetId: "prepared-texture/00000001",
						level: {
							width: 1,
							height: 1,
							bytes: new Uint8Array([255, 255, 255, 255]),
						},
						sourceHash: "hash",
						sourceFormatRaw: 0,
					},
				}
			: null,
		compactionEligibility: {
			decision: "direct-draw",
			material: {
				family:
					materialKind === "indexed-paletted"
						? "indexed-paletted"
						: materialKind === "terrain-blend"
							? "terrain-blend"
							: materialKind === "direct-texture"
								? "textured-opaque"
								: "flat-constant-color",
				compatible: false,
				blockers: ["missing-base-texture-page"],
				alphaPolicy: "opaque",
				texturePageReadiness: null,
				detailAtlasEntry: null,
			},
			geometry: {
				compatible: false,
				blockers: ["missing-landblock-origin"],
			},
		},
		textureKey: null,
		texture,
		indexedMaterial,
		detailOverlay: null,
		terrainBlend,
		texturePageBindings:
			(baseTexturePageBinding ?? defaultTexturePageBinding)
				? [baseTexturePageBinding ?? defaultTexturePageBinding].filter(
						(binding): binding is NonNullable<typeof binding> =>
							binding !== null,
					)
				: [],
		texturePageBindingFallbackSamples:
			texture && atlasEntryKey && !baseTexturePageBinding
				? ["direct packed base page missing texture atlas generation"]
				: [],
		sceneDomain: sceneDomain ?? defaultSceneDomainForKind(kind),
		modelMatrix,
		bvhItemKeys: [],
		bvhFallbackReason: null,
		staticPartCount: 1,
		staticObjectKeys: [id],
	};
}

function createBlendedMaterialBehavior(): LegacyMaterialBehaviorDto {
	return {
		color: [1, 1, 1],
		emissive: [0, 0, 0],
		emissiveIntensity: 0,
		opacity: 1,
		transparent: true,
		alphaTest: 0,
		side: "front",
		blend: {
			mode: "alpha",
			enabled: true,
			srcFactor: "src-alpha",
			dstFactor: "one-minus-src-alpha",
			depthWrite: false,
		},
		unsupportedSurfaceFlags: [],
	};
}

function createSingleEntryBaseTexturePageBinding(
	texture: NonNullable<Webgl2WorldDrawUnit["texture"]>,
	wrapS: "clamp" | "repeat" = "clamp",
	wrapT: "clamp" | "repeat" = "clamp",
): Webgl2WorldDrawUnit["texturePageBindings"][number] {
	return {
		pageKind: "single-entry",
		usageBucket: "base-color",
		sampleClass: "rgba-color",
		texture,
		rect: [0, 0, texture.width, texture.height],
		width: texture.width,
		height: texture.height,
		wrapS,
		wrapT,
		sampling: {
			wrapS,
			wrapT,
			minFilter: "linear",
			magFilter: "linear",
			mip: "material-policy",
			samplingDomain: "color",
			lookup: "color-filtered",
		},
		source: "standalone-direct-texture",
	};
}

function createPackedBaseTexturePageBinding(
	texture: NonNullable<Webgl2WorldDrawUnit["texture"]>,
	wrapS: "clamp" | "repeat" = "clamp",
	wrapT: "clamp" | "repeat" = "clamp",
): Webgl2WorldDrawUnit["texturePageBindings"][number] {
	return {
		...createSingleEntryBaseTexturePageBinding(texture, wrapS, wrapT),
		pageKind: "packed-atlas",
		rect: [1, 2, 3, 4],
		width: 4,
		height: 4,
		source: "shared-packed-page",
	};
}

function defaultSceneDomainForKind(
	kind: Webgl2WorldDrawUnit["kind"],
): Webgl2WorldDrawUnit["sceneDomain"] {
	switch (kind) {
		case "terrain":
			return "exterior";
		case "static":
			return "exterior";
		case "structured-interior":
			return "interior";
		case "portal-mask":
			return null;
	}
}

function createFlatProgram(): Webgl2FlatWorldProgram {
	return {
		program: {} as WebGLProgram,
		attributes: { position: 0 },
		uniforms: {
			uModelViewProjection: {} as WebGLUniformLocation,
			uColor: {} as WebGLUniformLocation,
		},
		dispose() {
			return;
		},
	};
}

function createTexturedProgram() {
	return {
		program: {} as WebGLProgram,
		attributes: { position: 0, uv: 1 },
		uniforms: {
			uModelViewProjection: {} as WebGLUniformLocation,
			uColor: {} as WebGLUniformLocation,
			uAlphaTest: {} as WebGLUniformLocation,
			uTexture: {} as WebGLUniformLocation,
			uAtlasEnabled: {} as WebGLUniformLocation,
			uAtlasRect: {} as WebGLUniformLocation,
			uAtlasSize: {} as WebGLUniformLocation,
			uTexturePageWrapMode: {} as WebGLUniformLocation,
			uDetailTexture: {} as WebGLUniformLocation,
			uDetailTiling: {} as WebGLUniformLocation,
			uDetailEnabled: {} as WebGLUniformLocation,
		},
		dispose() {
			return;
		},
	};
}

function createIndexedP8Program(): Webgl2IndexedP8WorldProgram {
	return createIndexedProgram() as Webgl2IndexedP8WorldProgram;
}

function createIndexedP16Program(): Webgl2IndexedP16WorldProgram {
	return createIndexedProgram() as Webgl2IndexedP16WorldProgram;
}

function createIndexedProgram() {
	return {
		program: {} as WebGLProgram,
		attributes: { position: 0, uv: 1 },
		uniforms: Object.fromEntries(
			[
				"uModelViewProjection",
				"uColor",
				"uAlphaTest",
				"uIndexTexture",
				"uPaletteTexture",
				"uTextureSize",
				"uPaletteColorCount",
				"uClipThreshold",
				"uRepeatS",
				"uRepeatT",
				"uDetailTexture",
				"uDetailTiling",
				"uDetailEnabled",
			].map((name) => [name, {} as WebGLUniformLocation]),
		),
		dispose() {
			return;
		},
	};
}

function createTerrainBlendProgram(): Webgl2TerrainBlendWorldProgram {
	return {
		program: {} as WebGLProgram,
		attributes: { position: 0, uv: 1 },
		uniforms: Object.fromEntries(
			[
				"uModelViewProjection",
				"uBaseTexture",
				"uBaseTiling",
				"uOverlay0",
				"uOverlay1",
				"uOverlay2",
				"uOverlayAlpha0",
				"uOverlayAlpha1",
				"uOverlayAlpha2",
				"uOverlayTiling0",
				"uOverlayTiling1",
				"uOverlayTiling2",
				"uOverlayRotation0",
				"uOverlayRotation1",
				"uOverlayRotation2",
				"uOverlayCount",
				"uRoadTexture",
				"uRoadTiling",
				"uRoadAlpha0",
				"uRoadAlpha1",
				"uRoadRotation0",
				"uRoadRotation1",
				"uRoadCount",
			].map((name) => [name, {} as WebGLUniformLocation]),
		) as Webgl2TerrainBlendWorldProgram["uniforms"],
		dispose() {
			return;
		},
	};
}

function createTerrainFamilyProgram(): Webgl2TerrainFamilyWorldProgram {
	return {
		program: {} as WebGLProgram,
		attributes: { position: 0, uv: 1, terrainLayerSlot: 2 },
		uniforms: Object.fromEntries(
			[
				"uModelViewProjection",
				"uColorAtlasTexture",
				"uColorAtlasSize",
				"uMaskAtlasTexture",
				"uMaskAtlasSize",
				"uLayerBaseColorRects",
				"uLayerBaseTilings",
				"uLayerOverlayColorRects",
				"uLayerOverlayMaskRects",
				"uLayerOverlayTilings",
				"uLayerOverlayRotations",
				"uLayerOverlayCounts",
				"uLayerRoadColorRects",
				"uLayerRoadMaskRects",
				"uLayerRoadTilings",
				"uLayerRoadRotations",
				"uLayerRoadCounts",
			].map((name) => [name, {} as WebGLUniformLocation]),
		) as Webgl2TerrainFamilyWorldProgram["uniforms"],
		dispose() {
			return;
		},
	};
}

function createDirectDrawPrograms(): Webgl2DirectDrawPrograms {
	return {
		flat: createFlatProgram(),
		rgbaTexturePage: createTexturedProgram(),
		terrainBlend: createTerrainBlendProgram(),
		indexedP8: createIndexedP8Program(),
		indexedP16: createIndexedP16Program(),
	};
}

function createRgbaTexturePageFamilyProgram(): Webgl2RgbaTexturePageFamilyWorldProgram {
	return {
		program: {} as WebGLProgram,
		attributes: {
			position: 0,
			uv: 1,
			materialSlot: 2,
		},
		uniforms: {
			uViewProjection: {} as WebGLUniformLocation,
			uBatchModel: {} as WebGLUniformLocation,
			uAtlasTexture: {} as WebGLUniformLocation,
			uAtlasSize: {} as WebGLUniformLocation,
			uDetailAtlasTexture: {} as WebGLUniformLocation,
			uDetailAtlasSize: {} as WebGLUniformLocation,
			uMaterialRects: {} as WebGLUniformLocation,
			uMaterialWrapModes: {} as WebGLUniformLocation,
			uMaterialAlphaTests: {} as WebGLUniformLocation,
			uDetailMaterialRects: {} as WebGLUniformLocation,
			uDetailMaterialTilings: {} as WebGLUniformLocation,
			uDetailMaterialEnabled: {} as WebGLUniformLocation,
		},
		dispose() {
			return;
		},
	};
}

function createIndexedPalettedFamilyProgram(): Webgl2IndexedPalettedFamilyWorldProgram {
	return {
		program: {} as WebGLProgram,
		attributes: {
			position: 0,
			uv: 1,
			materialSlot: 2,
		},
		uniforms: {
			uViewProjection: {} as WebGLUniformLocation,
			uBatchModel: {} as WebGLUniformLocation,
			uIndexTexture: {} as WebGLUniformLocation,
			uPaletteTexture: {} as WebGLUniformLocation,
			uDetailAtlasTexture: {} as WebGLUniformLocation,
			uDetailAtlasSize: {} as WebGLUniformLocation,
			uMaterialColors: {} as WebGLUniformLocation,
			uMaterialParams: {} as WebGLUniformLocation,
			uDetailMaterialRects: {} as WebGLUniformLocation,
			uDetailMaterialParams: {} as WebGLUniformLocation,
		},
		dispose() {
			return;
		},
	};
}

function createRgbaTexturePageFamilyBatch(
	drawUnitIds: readonly string[],
	options: {
		indexCount?: number;
		triangleCount?: number;
	} = {},
): Webgl2CompactedGeometryBatchResource {
	const indexCount = options.indexCount ?? 3;
	const triangleCount = options.triangleCount ?? indexCount / 3;
	return {
		key: "atlas-batch",
		landblockId: 0x0102ffff,
		vertexArray: {
			vertexArray: attachDebugLabel({} as WebGLVertexArrayObject, "atlas-batch"),
			dispose() {
				return;
			},
		},
		positionBuffer: null as never,
		uvBuffer: null as never,
		materialSlotBuffer: null as never,
		indexBuffer: null as never,
		indexType: 5123,
		batchModelMatrix: createIdentityMat4(),
		vertexCount: 3,
		indexCount,
		triangleCount,
		drawSliceCount: 1,
		drawUnitCount: drawUnitIds.length,
		positionByteLength: 36,
		uvByteLength: 24,
		materialSlotByteLength: 12,
		indexByteLength: 6,
		totalByteLength: 78,
		dispose() {
			return;
		},
	};
}

function createRgbaTexturePageFamilyResource(
	drawUnitIds: readonly string[],
	options: { indexCount?: number } = {},
): Webgl2RgbaTexturePageFamilyResource {
	return {
		family: "rgba-texture-page",
		key: "rgba-texture-page|atlas-batch",
		geometryBatchKey: "atlas-batch",
		materialSlots: [
			{
				key: "material-slot",
				index: 0,
				atlasTextureIndex: 0,
				atlasRect: [0, 0, 1, 1],
				detailAtlasTextureIndex: null,
				detailAtlasRect: [0, 0, 1, 1],
				detailTiling: 1,
				renderStateKey: "opaque",
				samplingKey: "sampling",
				alphaPolicy: "opaque",
				alphaTest: 0,
				wrapS: "clamp",
				wrapT: "clamp",
			},
		],
		drawSlices: [
			{
				key: "slice",
				atlasTextureIndex: 0,
				detailAtlasTextureIndex: null,
				renderStateKey: "opaque",
				firstIndex: 0,
				indexCount: options.indexCount ?? 3,
				drawUnitIds,
				materialSlotKeys: ["material-slot"],
			},
		],
	};
}

function createIndexedPalettedFamilyResource(
	drawUnitIds: readonly string[],
	options: { detailAtlasTextureIndex?: number | null } = {},
): Webgl2IndexedPalettedFamilyResource {
	const detailAtlasTextureIndex = options.detailAtlasTextureIndex ?? null;
	return {
		family: "indexed-paletted",
		key: "indexed-paletted|atlas-batch",
		geometryBatchKey: "atlas-batch",
		materialTableRecords: [
			{
				key: "indexed-material-slot",
				sourceMaterialKey: "indexed",
				indexPageKey: "index",
				palettePageKey: "palette",
				indexFormat: "p8",
				indexPageWidth: 2,
				indexPageHeight: 1,
				paletteColorCount: 2,
				clipThreshold: -1,
				wrapS: "clamp",
				wrapT: "repeat",
				color: new Float32Array([1, 1, 1, 1]),
				detailAtlasEntryKey:
					detailAtlasTextureIndex == null ? null : "detail-entry",
				detailAtlasTextureIndex,
				detailAtlasRect:
					detailAtlasTextureIndex == null ? [0, 0, 1, 1] : [1, 1, 2, 2],
				detailTiling: detailAtlasTextureIndex == null ? 1 : 12,
				alphaPolicy: "opaque",
				filteringMode: "shader-palette-linear",
			},
		],
		drawSlices: [
			{
				key: "indexed-slice",
				indexFormat: "p8",
				indexPageKey: "index",
				palettePageKey: "palette",
				detailAtlasTextureIndex,
				renderStateKey: "indexed-opaque",
				firstIndex: 0,
				indexCount: 3,
				drawUnitIds,
				materialSlotKeys: ["indexed-material-slot"],
			},
		],
	};
}

function createTextureResource(
	texture: WebGLTexture,
): NonNullable<Webgl2WorldDrawUnit["texture"]> {
	return {
		texture,
		width: 1,
		height: 1,
		dispose() {
			return;
		},
	};
}

function createIndexedMaterial(
	indexFormat: NonNullable<
		Webgl2WorldDrawUnit["indexedMaterial"]
	>["indexFormat"],
): NonNullable<Webgl2WorldDrawUnit["indexedMaterial"]> {
	return {
		key: `indexed-${indexFormat}`,
		indexFormat,
		indexTextureKey: "index",
		paletteTextureKey: "palette",
		indexTexture: createTextureResource({} as WebGLTexture),
		paletteTexture: createTextureResource({} as WebGLTexture),
		width: 2,
		height: 1,
		paletteColorCount: 2,
		wrapS: "clamp",
		wrapT: "repeat",
		clipThreshold: -1,
	};
}

function createTextureAtlasGeneration(
	options: {
		atlasEntryKey?: string;
		texture?: WebGLTexture;
	} = {},
): Webgl2TextureAtlasGenerationResource {
	const atlasEntryKey = options.atlasEntryKey ?? "entry/default";
	return {
		key: "generation",
		textures: [
			{
				key: "texture",
				textureIndex: 0,
				texture: {
					texture: options.texture ?? ({} as WebGLTexture),
					width: 4,
					height: 4,
					dispose() {
						return;
					},
				},
				width: 4,
				height: 4,
				placementCount: 1,
			},
		],
		placements: [
			{
				atlasEntryKey,
				textureIndex: 0,
				rect: [1, 2, 3, 4],
				width: 4,
				height: 4,
			},
		],
		preparedTextureAssetIds: [],
		rgbaAtlasReadyDrawUnitIds: [],
		dispose() {
			return;
		},
	};
}

function createTerrainBlendResources(): NonNullable<
	Webgl2WorldDrawUnit["terrainBlend"]
> {
	const texture = {
		texture: {} as WebGLTexture,
		width: 1,
		height: 1,
		dispose() {
			return;
		},
	};
	return {
		plan: {} as NonNullable<Webgl2WorldDrawUnit["terrainBlend"]>["plan"],
		base: {
			key: "terrain/base",
			texture,
			tiling: 1,
		},
		overlays: [],
		roads: [],
	};
}

function createIdentityMat4(): Float32Array {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function createTranslationMat4({ z }: { z: number }): Float32Array {
	const matrix = createIdentityMat4();
	matrix[14] = z;
	return matrix;
}

function attachDebugLabel(
	vertexArray: WebGLVertexArrayObject,
	label: string,
): WebGLVertexArrayObject {
	(vertexArray as { debugLabel?: string }).debugLabel = label;
	return vertexArray;
}

function createCategoryCounts() {
	return {
		terrain: 0,
		"structured-interior": 0,
		"static-staged": 0,
		static: 0,
		"portal-mask": 0,
		"debug-overlay": 0,
	};
}

class CapturingSubmitGl implements Webgl2StateCacheGl {
	readonly TEXTURE0 = 33984;
	readonly TEXTURE_2D = 3553;
	readonly DEPTH_TEST = 2929;
	readonly BLEND = 3042;
	readonly CULL_FACE = 2884;
	readonly STENCIL_TEST = 2960;
	readonly FRAMEBUFFER = 36160;
	readonly FRONT = 1028;
	readonly BACK = 1029;
	readonly FRONT_AND_BACK = 1032;
	readonly ALWAYS = 519;
	readonly KEEP = 7680;
	readonly LEQUAL = 515;
	readonly ONE = 1;
	readonly ZERO = 0;
	readonly FUNC_ADD = 32774;
	readonly SRC_ALPHA = 770;
	readonly ONE_MINUS_SRC_ALPHA = 771;
	readonly TRIANGLES = 4;
	readonly UNSIGNED_SHORT = 5123;
	readonly UNSIGNED_INT = 5125;
	readonly calls: string[] = [];
	readonly uniform4fvValues: number[][] = [];
	readonly uniform4fValues: number[][] = [];
	readonly uniform2fValues: number[][] = [];
	readonly uniform1iValues: number[] = [];
	readonly boundTextures: WebGLTexture[] = [];
	private currentVertexArrayLabel: string | null = null;

	asContext(): WebGL2RenderingContext {
		return this as unknown as WebGL2RenderingContext;
	}

	useProgram(): void {
		this.calls.push("useProgram");
	}

	bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
		this.calls.push("bindVertexArray");
		this.currentVertexArrayLabel =
			(vertexArray as { debugLabel?: string } | null)?.debugLabel ?? null;
	}

	activeTexture(): void {
		this.calls.push("activeTexture");
	}

	bindTexture(_target: GLenum, texture: WebGLTexture): void {
		this.calls.push("bindTexture");
		this.boundTextures.push(texture);
	}

	enable(capability: GLenum): void {
		this.calls.push(`enable:${capability}`);
	}

	disable(capability: GLenum): void {
		this.calls.push(`disable:${capability}`);
	}

	depthMask(flag: boolean): void {
		this.calls.push(`depthMask:${flag}`);
	}

	depthFunc(func: GLenum): void {
		this.calls.push(`depthFunc:${func}`);
	}

	blendFuncSeparate(): void {
		this.calls.push("blendFuncSeparate");
	}

	blendEquationSeparate(): void {
		this.calls.push("blendEquationSeparate");
	}

	cullFace(mode: GLenum): void {
		this.calls.push(`cullFace:${mode}`);
	}

	stencilMask(mask: number): void {
		this.calls.push(`stencilMask:${mask}`);
	}

	stencilFunc(func: GLenum, ref: number, mask: number): void {
		this.calls.push(`stencilFunc:${func}:${ref}:${mask}`);
	}

	stencilOp(): void {
		this.calls.push("stencilOp");
	}

	viewport(): void {
		this.calls.push("viewport");
	}

	bindFramebuffer(): void {
		this.calls.push("bindFramebuffer");
	}

	uniformMatrix4fv(): void {
		this.calls.push("uniformMatrix4fv");
	}

	uniform4fv(_location: WebGLUniformLocation, value: Iterable<number>): void {
		this.calls.push("uniform4fv");
		this.uniform4fvValues.push([...value]);
	}

	uniform1f(): void {
		this.calls.push("uniform1f");
	}

	uniform2f(_location: WebGLUniformLocation, x: number, y: number): void {
		this.calls.push("uniform2f");
		this.uniform2fValues.push([x, y]);
	}

	uniform4f(
		_location: WebGLUniformLocation,
		x: number,
		y: number,
		z: number,
		w: number,
	): void {
		this.calls.push("uniform4f");
		this.uniform4fValues.push([x, y, z, w]);
	}

	uniform1i(_location: WebGLUniformLocation, value: number): void {
		this.calls.push("uniform1i");
		this.uniform1iValues.push(value);
	}

	uniform1fv(): void {
		this.calls.push("uniform1fv");
	}

	uniform2fv(): void {
		this.calls.push("uniform2fv");
	}

	uniform1iv(): void {
		this.calls.push("uniform1iv");
	}

	uniform2iv(): void {
		this.calls.push("uniform2iv");
	}

	drawElements(
		mode: GLenum,
		count: number,
		type: GLenum,
		offset: number,
	): void {
		if (this.currentVertexArrayLabel) {
			this.calls.push(`drawElementsFor:${this.currentVertexArrayLabel}`);
		}
		this.calls.push(`drawElements:${mode}:${count}:${type}:${offset}`);
	}
}

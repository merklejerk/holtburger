import { describe, expect, it } from "vitest";

import type { WorldRenderFrame } from "./world-render-frame";
import type { RenderChunkTransform } from "./render-anchor";
import { parseStaticMaterialFamilyKey } from "./static-material-artifacts";
import {
	planWebgl2DirectDrawRoute,
	type Webgl2DirectDrawPrograms,
} from "./webgl2/families/direct-family-adapters";
import {
	partitionWebgl2SceneDomainDrawUnits,
	planWebgl2StaticBundleLayerSubmitOrder,
	planWebgl2WorldSubmitOrder,
	planWebgl2PortalMaskSubmitOrder,
	planWebgl2TerrainTileSubmitReadiness,
	planWebgl2TerrainTileSubmitOrder,
	planWebgl2WorldSubmitPassSchedule,
	submitWebgl2WorldDrawUnits,
	submitWebgl2WorldFrame,
	type Webgl2FlatWorldProgram,
	type Webgl2IndexedP16WorldProgram,
	type Webgl2IndexedP8WorldProgram,
} from "./webgl2-world-submit";
import type { Webgl2TerrainTileResource } from "./webgl2/resources/terrain-tile-resources";
import type { Webgl2TerrainFamilyWorldProgram } from "./webgl2/families/terrain-family-submit";
import type {
	Webgl2StaticBundleLayerResource,
	Webgl2StaticBundleLayerResourceStore,
} from "./webgl2/resources/static-bundle-layer-resources";
import type {
	Webgl2StructuredInteriorCellResource,
	Webgl2StructuredInteriorResourceStore,
} from "./webgl2/resources/structured-interior-resources";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type {
	Webgl2IndexedMaterialDescriptor,
	Webgl2WorldDrawUnit,
} from "./webgl2-world-resources";
import {
	Webgl2StateCache,
	type Webgl2StateCacheGl,
} from "./webgl2-state-cache";

const TEST_CAMERA_POSITION: WorldRenderFrame["cameraFrame"]["position"] = {
	x: 0,
	y: 0,
	z: 0,
};

describe("planWebgl2WorldSubmitOrder", () => {
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
			planWebgl2WorldSubmitOrder(
				createFrame(["z", "b", "a"]),
				drawUnitsById,
			).map((drawUnit) => drawUnit.id),
		).toEqual(["a", "b", "z"]);
	});

	it("fails when frame visibility references a missing draw unit", () => {
		expect(() =>
			planWebgl2WorldSubmitOrder(createFrame(["missing"]), new Map()),
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
			planWebgl2WorldSubmitOrder(frame, drawUnitsById).map(
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
			planWebgl2WorldSubmitOrder(
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

	it("plans visible static bundle layers without creating draw-unit refs", () => {
		const store = createStaticBundleLayerResourceStore([
			createStaticBundleLayerResource({ layerKey: "layer/a" }),
		]);

		expect(
			planWebgl2StaticBundleLayerSubmitOrder(
				createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
				store,
			).map((layer) => layer.key),
		).toEqual(["layer/a:revision/a"]);
		expect(
			planWebgl2WorldSubmitOrder(
				createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
				new Map(),
			),
		).toEqual([]);
	});

	it("partitions terrain tiles by one-draw readiness and blocked diagnostics", () => {
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

		const plan = planWebgl2TerrainTileSubmitReadiness([blockedTile, readyTile]);

		expect(plan.oneDrawTiles.map((tile) => tile.id)).toEqual([
			"terrain-tile/ready",
		]);
		expect(plan.blockedTiles).toEqual([
			{
				tile: blockedTile,
				blockers: ["missing terrain color page"],
			},
		]);
	});

	it("routes ready terrain draw slices instead of blocking the parent tile", () => {
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
	it("keeps retained opaque and retained blended as explicit ordered passes", () => {
		const schedule = planWebgl2WorldSubmitPassSchedule({
			drawUnits: [
				createDrawUnit({ id: "opaque-direct" }),
				createDrawUnit({
					id: "blended-direct",
					materialBehavior: createBlendedMaterialBehavior(),
				}),
			],
			viewProjectionMatrix: createIdentityMat4(),
		});

		expect(
			schedule.passes.map((pass) => `${pass.kind}:${pass.alphaPolicy}`),
		).toEqual(["retained-direct:opaque-or-cutout", "retained-direct:transparent-blend"]);
		expect(schedule.retainedDrawUnits.map((drawUnit) => drawUnit.id)).toEqual([
			"opaque-direct",
			"blended-direct",
		]);
		expect(schedule.retainedDirectOpaqueDrawUnitCount).toBe(1);
		expect(schedule.retainedDirectBlendedDrawUnitCount).toBe(1);
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
				directIndexedMaterialResources: createIndexedMaterial("p8"),
			}),
			programs,
		});
		const p16 = planWebgl2DirectDrawRoute({
			drawUnit: createDrawUnit({
				id: "indexed-p16",
				materialKind: "indexed-paletted",
				directIndexedMaterialResources: createIndexedMaterial("index16"),
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
});

describe("submitWebgl2WorldFrame", () => {
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

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program,
			texturedProgram,
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

		submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
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

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			drawUnitsById,
			frame: createFrame(["atlas-staged"]),
		});

		expect(metrics.directTexturePageDrawCount).toBe(1);
		expect(metrics.directPackedTexturePageDrawCount).toBe(1);
		expect(metrics.directSingleEntryTexturePageDrawCount).toBe(0);
		expect(metrics.directPackedTexturePageEstimatedBindAvoidedCount).toBe(1);
		expect(metrics.directTexturePageFallbackSamples).toEqual([]);
		expect(gl.boundTextures).toContain(atlasTexture);
		expect(gl.boundTextures).not.toContain(standaloneTexture);
		expect(gl.uniform1iValues).toContain(1);
		expect(gl.uniform4fValues).toContainEqual([1, 2, 3, 4]);
		expect(gl.uniform2fValues).toContainEqual([4, 4]);
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

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			drawUnitsById,
			frame: createFrame(["standalone"]),
		});

		expect(metrics.directPackedTexturePageDrawCount).toBe(0);
		expect(metrics.directSingleEntryTexturePageDrawCount).toBe(1);
		expect(metrics.directTexturePageFallbackSamples).toContain(
			"direct packed base page binding missing",
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

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			drawUnitsById,
			frame: createFrame(["repeat"]),
		});

		expect(metrics.directPackedTexturePageDrawCount).toBe(1);
		expect(metrics.directSingleEntryTexturePageDrawCount).toBe(0);
		expect(metrics.directTexturePageFallbackSamples).toEqual([]);
		expect(gl.boundTextures).not.toContain(standaloneTexture);
		expect(gl.uniform2fValues).toContainEqual([1, 1]);
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
						texturePage: {
							key: "terrain-color/0",
							family: "terrain-color",
							textureIndex: 0,
							texture: createTextureResource(atlasTexture, 4, 4),
							width: 4,
							height: 4,
							placementCount: 1,
						},
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

		const metrics = submitWebgl2WorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainFamilyProgram: createTerrainFamilyProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
				viewProjectionMatrix: createIdentityMat4(),
			cameraPosition: TEST_CAMERA_POSITION,
			drawUnits: [],
			terrainTiles: [terrainTile],
		});

		expect(metrics.terrainOneDrawShaderDrawCallCount).toBe(1);
		expect(metrics.terrainOneDrawSubmittedTileCount).toBe(1);
		expect(gl.calls).toContain("drawElementsFor:terrain-ready");
		expect(gl.boundTextures).toContain(atlasTexture);
	});

	it("uploads explicit camera position for terrain family detail fade", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const terrainTexture = {} as WebGLTexture;
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
						texturePage: {
							key: "terrain-color/0",
							family: "terrain-color",
							textureIndex: 0,
							texture: createTextureResource(terrainTexture, 4, 4),
							width: 4,
							height: 4,
							placementCount: 1,
						},
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

		submitWebgl2WorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			terrainFamilyProgram: createTerrainFamilyProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
				viewProjectionMatrix: createIdentityMat4(),
			cameraPosition: { x: 11, y: 22, z: 33 },
			drawUnits: [],
			terrainTiles: [terrainTile],
		});

		expect(gl.uniform3fValues).toContainEqual([11, 22, 33]);
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

		const metrics = submitWebgl2WorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			viewProjectionMatrix: createIdentityMat4(),
			cameraPosition: TEST_CAMERA_POSITION,
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

		const metrics = submitWebgl2WorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			viewProjectionMatrix: createIdentityMat4(),
			cameraPosition: TEST_CAMERA_POSITION,
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

	it("does not apply terrain backface culling to retained direct draws", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const drawUnits = [createDrawUnit({ id: "static", kind: "static" })];

		submitWebgl2WorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			viewProjectionMatrix: createIdentityMat4(),
			cameraPosition: TEST_CAMERA_POSITION,
			drawUnits,
			terrainBackfaceCulling: true,
		});

		const cullCalls = gl.calls.filter(
			(call) =>
				call === `enable:${gl.CULL_FACE}` || call === `disable:${gl.CULL_FACE}`,
		);
		expect(cullCalls).toEqual([`disable:${gl.CULL_FACE}`]);
	});

	it("keeps retained direct backface culling disabled by default", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);

		submitWebgl2WorldDrawUnits({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			viewProjectionMatrix: createIdentityMat4(),
			cameraPosition: TEST_CAMERA_POSITION,
			drawUnits: [createDrawUnit({ id: "static", kind: "static" })],
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
					directIndexedMaterialResources: {
						descriptor: {
							key: "indexed",
							indexFormat: "p8",
							indexTextureKey: "index",
							paletteTextureKey: "palette",
							width: 2,
							height: 1,
							indexSourceBytes: Uint8Array.from([0, 1]),
							paletteColorCount: 2,
							paletteRgbaBytes: Uint8Array.from([
								0, 0, 0, 0, 255, 255, 255, 255,
							]),
							wrapS: "clamp",
							wrapT: "repeat",
							clipThreshold: -1,
						},
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
					},
				}),
			],
		]);

		submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			drawUnitsById,
			frame: createFrame(["indexed"]),
		});

		expect(gl.calls.filter((call) => call === "bindTexture")).toHaveLength(2);
		expect(gl.calls).toContain("uniform2f");
	});

	it("submits resident RGBA static bundle geometry directly from product resources", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const texture = {} as WebGLTexture;

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			staticBundleLayerResources: createStaticBundleLayerResourceStore([
				createStaticBundleLayerResource({ texture }),
			]),
			drawUnitsById: new Map(),
			frame: createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
		});

		expect(metrics.visibleDrawUnitCount).toBe(0);
		expect(metrics.staticBundleLayerSubmittedCount).toBe(1);
		expect(metrics.staticBundleGeometrySubmittedCount).toBe(1);
		expect(metrics.staticBundleDrawCallCount).toBe(1);
		expect(metrics.staticBundleTriangleCount).toBe(1);
		expect(metrics.drawCallCount).toBe(1);
		expect(metrics.triangleCount).toBe(1);
		expect(metrics.staticBundleSubmitFallbackSamples).toEqual([]);
		expect(gl.boundTextures).toContain(texture);
		expect(gl.uniform1iValues).toContain(1);
	});

	it("applies render chunk offsets when submitting static bundle layers", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const landblockId = 0xda560100;
		const renderChunkTransforms: readonly RenderChunkTransform[] = [
			{
				chunkKey: "landblock/da56ffff",
				chunkLandblockId: 0xda56ffff,
				offset: { x: 192, y: 0, z: -384 },
			},
		];

		submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			staticBundleLayerResources: createStaticBundleLayerResourceStore([
				createStaticBundleLayerResource({ landblockId }),
			]),
			renderChunkTransforms,
			drawUnitsById: new Map(),
			frame: createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
		});

		expect(gl.uniformMatrix4fvValues).toHaveLength(1);
		expect(gl.uniformMatrix4fvValues[0]?.[12]).toBe(192);
		expect(gl.uniformMatrix4fvValues[0]?.[13]).toBe(0);
		expect(gl.uniformMatrix4fvValues[0]?.[14]).toBe(-384);
	});

	it("submits product static textured bundle geometry from typed family keys", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const texture = {} as WebGLTexture;

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			staticBundleLayerResources: createStaticBundleLayerResourceStore([
				createStaticBundleLayerResource({
					familyKey: "static:textured-opaque:alpha=opaque",
					texture,
				}),
			]),
			drawUnitsById: new Map(),
			frame: createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
		});

		expect(metrics.staticBundleGeometrySubmittedCount).toBe(1);
		expect(metrics.staticBundleSkippedGeometryCount).toBe(0);
		expect(metrics.staticBundleSubmitFallbackSamples).toEqual([]);
		expect(gl.boundTextures).toContain(texture);
	});

	it("submits direct static bundle geometry from typed family keys when texture bindings exist", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const texture = {} as WebGLTexture;

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			staticBundleLayerResources: createStaticBundleLayerResourceStore([
				createStaticBundleLayerResource({
					familyKey: "static:direct:alpha=transparent-blend",
					texture,
				}),
			]),
			drawUnitsById: new Map(),
			frame: createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
		});

		expect(metrics.staticBundleGeometrySubmittedCount).toBe(1);
		expect(metrics.staticBundleSkippedGeometryCount).toBe(0);
		expect(metrics.staticBundleSubmitFallbackSamples).toEqual([]);
		expect(gl.boundTextures).toContain(texture);
	});

	it("submits resident env-cell static bundle geometry from topology products", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const texture = {} as WebGLTexture;

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			staticBundleLayerResources: createStaticBundleLayerResourceStore([
				createStaticBundleLayerResource({
					layerKind: "env-cell-static",
					texture,
				}),
			]),
			drawUnitsById: new Map(),
			frame: createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
		});

		expect(metrics.visibleDrawUnitCount).toBe(0);
		expect(metrics.staticBundleLayerSubmittedCount).toBe(1);
		expect(metrics.staticBundleGeometrySubmittedCount).toBe(1);
		expect(metrics.drawCallCount).toBe(1);
		expect(gl.boundTextures).toContain(texture);
	});

	it("submits resident P8 indexed static bundle geometry", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const indexTexture = {} as WebGLTexture;
		const paletteTexture = {} as WebGLTexture;

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			staticBundleLayerResources: createStaticBundleLayerResourceStore([
				createStaticBundleLayerResource({
					familyKey: "indexed-paletted",
					indexedFormat: "p8",
					indexTexture,
					paletteTexture,
				}),
			]),
			drawUnitsById: new Map(),
			frame: createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
		});

		expect(metrics.staticBundleDrawCallCount).toBe(1);
		expect(metrics.staticBundleGeometrySubmittedCount).toBe(1);
		expect(metrics.staticBundleSkippedGeometryCount).toBe(0);
		expect(metrics.staticBundleSubmitFallbackSamples).toEqual([]);
		expect(gl.boundTextures).toContain(indexTexture);
		expect(gl.boundTextures).toContain(paletteTexture);
		expect(gl.uniform2fValues).toContainEqual([2, 1]);
		expect(gl.uniform1iValues).toContain(-1);
	});

	it("submits product indexed static bundle geometry from typed family keys", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const indexTexture = {} as WebGLTexture;
		const paletteTexture = {} as WebGLTexture;

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			staticBundleLayerResources: createStaticBundleLayerResourceStore([
				createStaticBundleLayerResource({
					familyKey: "static:indexed-paletted:alpha=opaque",
					indexedFormat: "p8",
					indexTexture,
					paletteTexture,
				}),
			]),
			drawUnitsById: new Map(),
			frame: createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
		});

		expect(metrics.staticBundleDrawCallCount).toBe(1);
		expect(metrics.staticBundleGeometrySubmittedCount).toBe(1);
		expect(metrics.staticBundleSkippedGeometryCount).toBe(0);
		expect(metrics.staticBundleSubmitFallbackSamples).toEqual([]);
		expect(gl.boundTextures).toContain(indexTexture);
		expect(gl.boundTextures).toContain(paletteTexture);
	});

	it("submits resident 16-bit indexed static bundle geometry with detail", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);
		const indexTexture = {} as WebGLTexture;
		const paletteTexture = {} as WebGLTexture;
		const detailTexture = {} as WebGLTexture;

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			staticBundleLayerResources: createStaticBundleLayerResourceStore([
				createStaticBundleLayerResource({
					familyKey: "indexed-paletted",
					indexedFormat: "index16",
					indexTexture,
					paletteTexture,
					detailTexture,
				}),
			]),
			drawUnitsById: new Map(),
			frame: createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
		});

		expect(metrics.staticBundleDrawCallCount).toBe(1);
		expect(metrics.staticBundleSkippedGeometryCount).toBe(0);
		expect(gl.boundTextures).toContain(indexTexture);
		expect(gl.boundTextures).toContain(paletteTexture);
		expect(gl.boundTextures).toContain(detailTexture);
		expect(gl.uniform2fValues).toContainEqual([2, 1]);
		expect(gl.uniform1iValues).toContain(1);
	});

	it("skips malformed indexed static bundle materials", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			staticBundleLayerResources: createStaticBundleLayerResourceStore([
				createStaticBundleLayerResource({
					familyKey: "indexed-paletted",
					omitIndexedMaterial: true,
				}),
			]),
			drawUnitsById: new Map(),
			frame: createFrameWithStaticBundleLayers(["layer/a:revision/a"]),
		});

		expect(metrics.staticBundleDrawCallCount).toBe(0);
		expect(metrics.staticBundleSkippedGeometryCount).toBe(1);
		expect(metrics.staticBundleSubmitFallbackSamples).toEqual([
			"incomplete static bundle indexed material bindings; layer layer/a; material material/a",
		]);
	});

	it("submits resident structured interior resources directly from product resources", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			structuredInteriorResources: createStructuredInteriorResourceStore([
				createStructuredInteriorCellResource(),
			]),
			drawUnitsById: new Map(),
			frame: createFrame([]),
		});

		expect(metrics.visibleDrawUnitCount).toBe(0);
		expect(metrics.structuredInteriorResourceSubmittedCount).toBe(1);
		expect(metrics.structuredInteriorResourceDrawCallCount).toBe(1);
		expect(metrics.structuredInteriorResourceTriangleCount).toBe(1);
		expect(metrics.drawCallCount).toBe(1);
		expect(gl.calls).toContain("drawElementsFor:structured-interior");
	});

	it("submits resident structured interior material slices through texture pages", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			structuredInteriorResources: createStructuredInteriorResourceStore([
				createTexturedStructuredInteriorCellResource(),
			]),
			drawUnitsById: new Map(),
			frame: createFrame([]),
		});

		expect(metrics.structuredInteriorResourceSubmittedCount).toBe(1);
		expect(metrics.structuredInteriorResourceDrawCallCount).toBe(1);
		expect(metrics.structuredInteriorResourceTriangleCount).toBe(1);
		expect(metrics.structuredInteriorResourceSkippedGeometryCount).toBe(0);
		expect(gl.calls).toContain(
			"drawElementsFor:structured-interior-material",
		);
		expect(gl.calls).not.toContain("drawElementsFor:structured-interior");
		expect(gl.uniform4fValues).toContainEqual([0, 0, 1, 1]);
		expect(gl.uniform2fValues).toContainEqual([1, 1]);
	});

	it("submits resident indexed structured interior material slices", () => {
		const gl = new CapturingSubmitGl();
		const stateCache = new Webgl2StateCache(gl);

		const metrics = submitWebgl2WorldFrame({
			gl: gl.asContext(),
			stateCache,
			program: createFlatProgram(),
			texturedProgram: createTexturedProgram(),
			indexedP8Program: createIndexedP8Program(),
			indexedP16Program: createIndexedP16Program(),
			structuredInteriorResources: createStructuredInteriorResourceStore([
				createIndexedStructuredInteriorCellResource(),
			]),
			drawUnitsById: new Map(),
			frame: createFrame([]),
		});

		expect(metrics.structuredInteriorResourceSubmittedCount).toBe(1);
		expect(metrics.structuredInteriorResourceSkippedGeometryCount).toBe(0);
		expect(gl.calls).toContain(
			"drawElementsFor:structured-interior-indexed-material",
		);
		expect(gl.uniform2fValues).toContainEqual([2, 1]);
		expect(gl.uniform1iValues).toContain(-1);
		expect(gl.uniform1iValues).toContain(1);
	});
});

function createStaticBundleLayerResourceStore(
	layers: readonly Webgl2StaticBundleLayerResource[],
): Webgl2StaticBundleLayerResourceStore {
	return {
		layersByKey: new Map(layers.map((layer) => [layer.key, layer])),
	};
}

function createStructuredInteriorResourceStore(
	cells: readonly Webgl2StructuredInteriorCellResource[],
): Webgl2StructuredInteriorResourceStore {
	return {
		cellsByKey: new Map(cells.map((cell) => [cell.key, cell])),
	};
}

function createStructuredInteriorCellResource(): Webgl2StructuredInteriorCellResource {
	return {
		key: "structured-interior:cell/a",
		artifactKey: "detailed/a",
		landblockId: 1,
		envCellId: 0x01000100,
		geometrySignature: "structured-interior-geometry/a",
		modelMatrix: createIdentityMat4(),
		texturePages: [],
		texturePagesByKey: new Map(),
		materialRecords: [],
		materialSlices: [],
		fallbackShell: {
			color: new Float32Array([0.5, 0.6, 0.7, 1]),
			vertexArray: createVertexArrayResource("structured-interior"),
			positionBuffer: createBufferResource(),
			indexBuffer: createBufferResource(),
			indexType: 5123,
			indexCount: 3,
			triangleCount: 1,
			dispose() {},
		},
		triangleCount: 1,
		dispose() {},
	};
}

function createTexturedStructuredInteriorCellResource(): Webgl2StructuredInteriorCellResource {
	const texture = createTextureResource({} as WebGLTexture);
	return {
		key: "structured-interior:cell/textured",
		artifactKey: "detailed/a",
		landblockId: 1,
		envCellId: 0x01000100,
		geometrySignature: "structured-interior-geometry/textured",
		modelMatrix: createIdentityMat4(),
		texturePages: [],
		texturePagesByKey: new Map(),
		materialRecords: [
			{
				key: "material/textured",
				familyKey: "rgba-texture-page",
				isTransparent: false,
				textureBindings: [
					{
						virtualRefKey: "texture/base",
						texturePageKey: "page/base",
						usageBucket: "base-color",
						sampleClass: "rgba-color",
						indexedFormat: undefined,
						rect: [0, 0, 1, 1],
						width: 1,
						height: 1,
						wrapS: "clamp",
						wrapT: "clamp",
						texture,
					},
				],
			},
		],
		materialSlices: [
			{
				key: "structured-interior-material",
				cellKey: "structured-interior:cell/textured",
				envCellId: 0x01000100,
				materialRecordKey: "material/textured",
				materialVariantSignature: null,
				vertexArray: createVertexArrayResource("structured-interior-material"),
				positionBuffer: createBufferResource(),
				uvBuffer: createBufferResource(),
				indexBuffer: createBufferResource(),
				indexType: 5123,
				indexCount: 3,
				triangleCount: 1,
				dispose() {},
			},
		],
		fallbackShell: null,
		triangleCount: 1,
		dispose() {},
	};
}

function createIndexedStructuredInteriorCellResource(): Webgl2StructuredInteriorCellResource {
	const indexTexture = createTextureResource({} as WebGLTexture);
	const paletteTexture = createTextureResource({} as WebGLTexture);
	return {
		key: "structured-interior:cell/indexed",
		artifactKey: "detailed/a",
		landblockId: 1,
		envCellId: 0x01000100,
		geometrySignature: "structured-interior-geometry/indexed",
		modelMatrix: createIdentityMat4(),
		texturePages: [],
		texturePagesByKey: new Map(),
		materialRecords: [
			{
				key: "material/indexed",
				familyKey: "indexed-paletted",
				isTransparent: false,
				indexedMaterial: {
					indexFormat: "p8",
					width: 2,
					height: 1,
					paletteColorCount: 2,
					wrapS: "clamp",
					wrapT: "repeat",
					clipThreshold: -1,
				},
				textureBindings: [
					{
						virtualRefKey: "texture/index",
						texturePageKey: "page/index",
						usageBucket: "indexed-texels",
						sampleClass: "indexed-data",
						indexedFormat: "p8",
						rect: [0, 0, 1, 1],
						width: 2,
						height: 1,
						wrapS: "clamp",
						wrapT: "repeat",
						texture: indexTexture,
					},
					{
						virtualRefKey: "texture/palette",
						texturePageKey: "page/palette",
						usageBucket: "palette-lookup",
						sampleClass: "palette-data",
						indexedFormat: undefined,
						rect: [0, 0, 1, 1],
						width: 2,
						height: 1,
						wrapS: "clamp",
						wrapT: "clamp",
						texture: paletteTexture,
					},
				],
			},
		],
		materialSlices: [
			{
				key: "structured-interior-indexed-material",
				cellKey: "structured-interior:cell/indexed",
				envCellId: 0x01000100,
				materialRecordKey: "material/indexed",
				materialVariantSignature: null,
				vertexArray: createVertexArrayResource(
					"structured-interior-indexed-material",
				),
				positionBuffer: createBufferResource(),
				uvBuffer: createBufferResource(),
				indexBuffer: createBufferResource(),
				indexType: 5123,
				indexCount: 3,
				triangleCount: 1,
				dispose() {},
			},
		],
		fallbackShell: null,
		triangleCount: 1,
		dispose() {},
	};
}

function createStaticBundleLayerResource({
	familyKey = "rgba-texture-page",
	layerKind = "outdoor-buildings",
	landblockId = 1,
	texture = {} as WebGLTexture,
	indexedFormat = "p8",
	indexTexture = {} as WebGLTexture,
	paletteTexture = {} as WebGLTexture,
	detailTexture = null,
	omitIndexedMaterial = false,
}: {
	familyKey?: string;
	layerKind?: Webgl2StaticBundleLayerResource["layerKind"];
	landblockId?: number;
	texture?: WebGLTexture;
	indexedFormat?: "p8" | "index16";
	indexTexture?: WebGLTexture;
	paletteTexture?: WebGLTexture;
	detailTexture?: WebGLTexture | null;
	omitIndexedMaterial?: boolean;
} = {}): Webgl2StaticBundleLayerResource {
	const textureResource = createTextureResource(texture);
	const indexTextureResource = createTextureResource(indexTexture);
	const paletteTextureResource = createTextureResource(paletteTexture);
	const detailTextureResource = detailTexture
		? createTextureResource(detailTexture)
		: null;
	const family = parseStaticMaterialFamilyKey(familyKey);
	const isIndexedFamily = family?.kind === "indexed-paletted";
		return {
		key: "layer/a:revision/a",
		layerKey: "layer/a",
		landblockId,
		layerKind,
		sourceRevision: "revision/a",
		texturePages: [],
		texturePagesByKey: new Map(),
		materialRecords: [
			{
				key: "material/a",
				familyKey,
				isTransparent: false,
				indexedMaterial:
					isIndexedFamily && !omitIndexedMaterial
						? {
								indexFormat: indexedFormat,
								width: 2,
								height: 1,
								paletteColorCount: 2,
								wrapS: "clamp",
								wrapT: "repeat",
								clipThreshold: -1,
							}
						: undefined,
				textureBindings:
					isIndexedFamily
						? [
								{
									virtualRefKey: "texture/index",
									texturePageKey: "page/index",
									usageBucket: "indexed-texels",
									sampleClass: "indexed-data",
									indexedFormat,
									rect: [0, 0, 1, 1],
									width: 2,
									height: 1,
									wrapS: "clamp",
									wrapT: "repeat",
									texture: indexTextureResource,
								},
								{
									virtualRefKey: "texture/palette",
									texturePageKey: "page/palette",
									usageBucket: "palette-lookup",
									sampleClass: "palette-data",
									indexedFormat: undefined,
									rect: [0, 0, 1, 1],
									width: 2,
									height: 1,
									wrapS: "clamp",
									wrapT: "clamp",
									texture: paletteTextureResource,
								},
								...(detailTextureResource
									? [
											{
												virtualRefKey: "texture/detail",
												texturePageKey: "page/detail",
												usageBucket: "detail" as const,
												sampleClass: "rgba-color" as const,
												indexedFormat: undefined,
												rect: [0, 0, 1, 1] as const,
												width: 1,
												height: 1,
												wrapS: "clamp" as const,
												wrapT: "clamp" as const,
												texture: detailTextureResource,
											},
										]
									: []),
							]
						: [
								{
									virtualRefKey: "texture/a",
									texturePageKey: "page/a",
									usageBucket: "base-color",
									sampleClass: "rgba-color",
									indexedFormat: undefined,
									rect: [0, 0, 1, 1],
									width: 1,
									height: 1,
									wrapS: "clamp",
									wrapT: "clamp",
									texture: textureResource,
								},
							],
			},
		],
		compactedBatches: [createStaticBundleGeometryResource()],
		directEntries: [],
		dispose() {
			return;
		},
	};
}

function createStaticBundleGeometryResource(): Webgl2StaticBundleLayerResource["compactedBatches"][number] {
	return {
		key: "geometry/a",
		renderChunkKey: "chunk/a",
		materialRecordKey: "material/a",
		objectKeys: ["object/a"],
		vertexArray: {
			vertexArray: attachDebugLabel({} as WebGLVertexArrayObject, "geometry/a"),
			dispose() {
				return;
			},
		},
		positionBuffer: {
			buffer: {} as WebGLBuffer,
			dispose() {
				return;
			},
		},
		normalBuffer: {
			buffer: {} as WebGLBuffer,
			dispose() {
				return;
			},
		},
		uvBuffer: {
			buffer: {} as WebGLBuffer,
			dispose() {
				return;
			},
		},
		indexBuffer: {
			buffer: {} as WebGLBuffer,
			dispose() {
				return;
			},
		},
		indexType: 5123,
		vertexCount: 3,
		indexCount: 3,
		triangleCount: 1,
		dispose() {
			return;
		},
	};
}

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

function createFrameWithStaticBundleLayers(
	staticBundleLayerIds: readonly string[],
): WorldRenderFrame {
	return {
		cameraFrame: createCameraFrame(),
		viewProjectionMatrix: createIdentityMat4(),
		passes: [
			{
				id: "world",
				draws: staticBundleLayerIds.map((staticBundleLayerId) => ({
					kind: "static-bundle-layer" as const,
					staticBundleLayerId,
					category: "static" as const,
				})),
			},
		],
		metrics: {
			registeredBatchCount: staticBundleLayerIds.length,
			keyedBatchCount: 0,
			representedItemKeyCount: 0,
			visibleItemKeyCount: 0,
			candidateBatchCount: staticBundleLayerIds.length,
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
	directIndexedMaterialResources = null,
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
	directIndexedMaterialResources?: Webgl2WorldDrawUnit["directIndexedMaterialResources"];
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
		indexedMaterialDescriptor: directIndexedMaterialResources
			? createIndexedMaterialDescriptor(directIndexedMaterialResources)
			: null,
		directIndexedMaterialResources,
		detailOverlay: null,
		texturePageBindings:
			(baseTexturePageBinding ?? defaultTexturePageBinding)
				? [baseTexturePageBinding ?? defaultTexturePageBinding].filter(
						(binding): binding is NonNullable<typeof binding> =>
							binding !== null,
					)
				: [],
		texturePageBindingFallbackSamples:
			texture && atlasEntryKey && !baseTexturePageBinding
				? ["direct packed base page binding missing"]
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
		indexedP8: createIndexedP8Program(),
		indexedP16: createIndexedP16Program(),
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
	indexFormat: Webgl2IndexedMaterialDescriptor["indexFormat"],
): NonNullable<Webgl2WorldDrawUnit["directIndexedMaterialResources"]> {
	const descriptor = createIndexedMaterialDescriptor({
		key: `indexed-${indexFormat}`,
		indexFormat,
		indexTextureKey: "index",
		paletteTextureKey: "palette",
	});
	return {
		descriptor,
		indexTexture: createTextureResource({} as WebGLTexture),
		paletteTexture: createTextureResource({} as WebGLTexture),
	};
}

function createIndexedMaterialDescriptor(
	options: Partial<Webgl2IndexedMaterialDescriptor> = {},
): Webgl2IndexedMaterialDescriptor {
	return {
		key: options.key ?? "indexed",
		indexFormat: options.indexFormat ?? "p8",
		indexTextureKey: options.indexTextureKey ?? "index",
		paletteTextureKey: options.paletteTextureKey ?? "palette",
		width: options.width ?? 2,
		height: options.height ?? 1,
		indexSourceBytes: options.indexSourceBytes ?? Uint8Array.from([0, 1]),
		paletteColorCount: options.paletteColorCount ?? 2,
		paletteRgbaBytes:
			options.paletteRgbaBytes ??
			Uint8Array.from([0, 0, 0, 0, 255, 255, 255, 255]),
		wrapS: options.wrapS ?? "clamp",
		wrapT: options.wrapT ?? "repeat",
		clipThreshold: options.clipThreshold ?? -1,
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
	readonly uniform3fValues: number[][] = [];
	readonly uniformMatrix4fvValues: number[][] = [];
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

	uniformMatrix4fv(
		_location: WebGLUniformLocation,
		_transpose: boolean,
		value: Iterable<number>,
	): void {
		this.calls.push("uniformMatrix4fv");
		this.uniformMatrix4fvValues.push([...value]);
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

	uniform3f(
		_location: WebGLUniformLocation,
		x: number,
		y: number,
		z: number,
	): void {
		this.calls.push("uniform3f");
		this.uniform3fValues.push([x, y, z]);
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

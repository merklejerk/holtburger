import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	StaticObjectGeometryStaticDrawUnit,
	StructuredInteriorGeometryStaticDrawUnit,
	TerrainGeometryStaticDrawUnit,
	TransitionApertureBatch,
} from "../../static/contracts";
import {
	MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../types";
import type { PortalFrameWorkPlan } from "../types";
import {
	compareStaticObjectTransparentDrawEntries,
	DEBUG_OVERLAY_FRAGMENT_SHADER,
	DEBUG_OVERLAY_VERTEX_SHADER,
	resolveStaticObjectBlendFactor,
	createWebgl2Renderer,
	SOURCE_SCENE_COPY_FRAGMENT_SHADER,
	STATIC_OBJECT_FRAGMENT_SHADER,
	TERRAIN_FRAGMENT_SHADER,
} from "./webgl2-renderer";

let pendingFrame: FrameRequestCallback | null = null;

afterEach(() => {
	vi.unstubAllGlobals();
	pendingFrame = null;
});

describe("V2 WebGL2 terrain renderer shader contract", () => {
	it("uses bounded explicit terrain color and mask page samplers", () => {
		for (let slot = 0; slot < MAX_TERRAIN_COLOR_PAGES_PER_DRAW; slot += 1) {
			expect(TERRAIN_FRAGMENT_SHADER).toContain(
				`uniform sampler2D uColorAtlasTexture${slot};`,
			);
		}
		for (let slot = 0; slot < MAX_TERRAIN_MASK_PAGES_PER_DRAW; slot += 1) {
			expect(TERRAIN_FRAGMENT_SHADER).toContain(
				`uniform sampler2D uMaskAtlasTexture${slot};`,
			);
		}

		expect(TERRAIN_FRAGMENT_SHADER).toContain("sampleColorPage(int page");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("sampleMaskPage(int page");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("uLayerBaseColorPages");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("uLayerOverlayColorPages");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("uLayerOverlayMaskPages");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("uLayerRoadColorPages");
		expect(TERRAIN_FRAGMENT_SHADER).toContain("uLayerRoadMaskPages");
		expect(TERRAIN_FRAGMENT_SHADER).not.toContain(
			"uniform sampler2D uColorAtlasTexture;",
		);
		expect(TERRAIN_FRAGMENT_SHADER).not.toContain(
			"uniform sampler2D uMaskAtlasTexture;",
		);
	});
});

describe("V2 WebGL2 static object indexed shader contract", () => {
	it("keeps index textures exact and filters after palette lookup", () => {
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"uniform sampler2D uStaticIndexTexture0;",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).not.toContain("usampler2D");
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"vec4 sampleIndexedPaletteLinear(vec2 uv)",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"fetchStaticIndexPage(uMaterialIndexTexturePages[slot], atlasCoord) * 255.0",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"paletteColor(paletteIndexAt(resolveIndexSampleCoord(baseCoord, ivec2(1, 1))))",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"return mix(top, bottom, blend.y);",
		);
	});

	it("reconstructs index16 pages from normalized RG8 low and high bytes", () => {
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			`uniform int uMaterialIndexedTextureFormats[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];`,
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"if (uMaterialIndexedTextureFormats[slot] == 1)",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"floor(packed.r + 0.5) + floor(packed.g + 0.5) * 256.0",
		);
	});
});

describe("V2 WebGL2 static object role-page shader contract", () => {
	it("uses bounded explicit static base-color page samplers and material page selectors", () => {
		for (
			let slot = 0;
			slot < MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW;
			slot += 1
		) {
			expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
				`uniform sampler2D uStaticBaseColorTexture${slot};`,
			);
		}

		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			`uniform vec4 uMaterialBaseColorRects[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];`,
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			`uniform int uMaterialBaseColorPages[${MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW}];`,
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"sampleStaticBaseColorPage(int page, vec4 rect, vec2 localUv)",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).not.toContain(
			"uniform sampler2D uTexture;",
		);
	});
});

describe("V2 WebGL2 static object detail shader contract", () => {
	it("composes detail overlays as a second repeat-sampled material role", () => {
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"uniform sampler2D uStaticDetailTexture0;",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"vec4 sampleDetailOverlay(vec2 uv)",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"vec2 localUv = fract(uv * uMaterialDetailTilings[slot]);",
		);
		expect(STATIC_OBJECT_FRAGMENT_SHADER).toContain(
			"rgb = clamp(rgb * (detailColor.rgb + (1.0 - detailAlpha)), vec3(0.0), vec3(1.0));",
		);
	});
});

describe("V2 WebGL2 static object transparent pass helpers", () => {
	it("sorts precomputed transparent entries back-to-front with a stable id tie-break", () => {
		const resources = [
			{ drawUnitId: "near", distanceSquared: 16 },
			{ drawUnitId: "far-b", distanceSquared: 144 },
			{ drawUnitId: "far-a", distanceSquared: 144 },
			{ drawUnitId: "middle", distanceSquared: 64 },
		];

		expect(
			resources
				.toSorted((left, right) =>
					compareStaticObjectTransparentDrawEntries(left, right),
				)
				.map((resource) => resource.drawUnitId),
		).toEqual(["far-a", "far-b", "middle", "near"]);
	});

	it("maps typed static blend factors to WebGL constants", () => {
		const gl = {
			ONE: 1,
			ONE_MINUS_SRC_ALPHA: 771,
			SRC_ALPHA: 770,
		} as WebGL2RenderingContext;

		expect(resolveStaticObjectBlendFactor(gl, "one")).toBe(gl.ONE);
		expect(resolveStaticObjectBlendFactor(gl, "src-alpha")).toBe(gl.SRC_ALPHA);
		expect(resolveStaticObjectBlendFactor(gl, "one-minus-src-alpha")).toBe(
			gl.ONE_MINUS_SRC_ALPHA,
		);
	});
});

describe("V2 WebGL2 structured interior rendering", () => {
	it("copies source scene color and depth without sampled aperture-depth coverage", () => {
		expect(SOURCE_SCENE_COPY_FRAGMENT_SHADER).toContain(
			"uniform sampler2D uSourceSceneColor;",
		);
		expect(SOURCE_SCENE_COPY_FRAGMENT_SHADER).toContain(
			"uniform sampler2D uSourceSceneDepth;",
		);
		expect(SOURCE_SCENE_COPY_FRAGMENT_SHADER).toContain("texelFetch");
		expect(SOURCE_SCENE_COPY_FRAGMENT_SHADER).toContain(
			"gl_FragDepth = sourceDepth;",
		);
		expect(SOURCE_SCENE_COPY_FRAGMENT_SHADER).not.toContain(
			"uPreviousCompositeDepth",
		);
		expect(SOURCE_SCENE_COPY_FRAGMENT_SHADER).not.toContain(
			"apertureDepth > previousDepth",
		);
	});

	it("uses non-antialiased RGB8/depth24-stencil8 scene-domain targets", () => {
		const gl = createFakeWebgl2Context();
		const getContext = vi.fn((kind: string) => (kind === "webgl2" ? gl : null));
		const canvas = {
			clientHeight: 64,
			clientWidth: 64,
			getContext,
			height: 64,
			width: 64,
		} as unknown as HTMLCanvasElement;
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);
		let latestSnapshot = rendererSnapshotPlaceholder();
		renderer.subscribe((snapshot) => {
			latestSnapshot = snapshot;
		});

		expect(getContext).toHaveBeenCalledWith(
			"webgl2",
			expect.objectContaining({ antialias: false }),
		);

		renderer.setRenderPassPlan({
			baseScene: {
				kind: "exterior",
				landblockId: 0xda55ffff,
			},
			kind: "portal-scene-domains",
			transitionDepthPolicy: { maxDepth: 4 },
		});
		pendingFrame?.(16);

		expect(gl.texImage2D).toHaveBeenCalledWith(
			gl.TEXTURE_2D,
			0,
			gl.RGB8,
			64,
			64,
			0,
			gl.RGB,
			gl.UNSIGNED_BYTE,
			null,
		);
		expect(gl.texImage2D).toHaveBeenCalledWith(
			gl.TEXTURE_2D,
			0,
			gl.DEPTH24_STENCIL8,
			64,
			64,
			0,
			gl.DEPTH_STENCIL,
			gl.UNSIGNED_INT_24_8,
			null,
		);
		expect(latestSnapshot.sceneDomainTargets).toMatchObject({
			active: true,
			colorFormat: "rgb8",
			depthFormat: "depth24-stencil8",
			height: 64,
			width: 64,
		});

		renderer.dispose();
	});

	it("publishes portal frame work plan snapshots independently from render pass execution", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);
		let latestSnapshot = rendererSnapshotPlaceholder();
		renderer.subscribe((snapshot) => {
			latestSnapshot = snapshot;
		});

		const portalFrameWorkPlan = createDirectEnvCellPortalFrameWorkPlan({
			baseScene: { kind: "outdoor-target", landblockId: 0xf418ffff },
			edges: [
				{
					apertureResourceId: "transition-aperture:f4180103",
					apertureSourceId: "transition-portal:f4180103/01",
					childNodeId: 1,
					edgeId: 0,
					linkId: "transition:f4180103/01",
					parentNodeId: 0,
					sourceKind: "building-transition",
				},
			],
			nodes: [
				{
					debugStackLabel: "outdoor-root",
					incomingEdgeIds: [],
					nodeId: 0,
					parentNodeId: null,
					resources: {
						envCellStaticObjectDrawUnitIds: [],
						resourceState: "not-applicable",
						structuredInteriorDrawUnitIds: [],
					},
					scene: { kind: "outdoor-target", landblockId: 0xf418ffff },
					traversalDepth: 0,
				},
				{
					debugStackLabel: "transition:f4180103/01",
					incomingEdgeIds: [0],
					nodeId: 1,
					parentNodeId: 0,
					resources: {
						envCellStaticObjectDrawUnitIds: [],
						resourceState: "missing-resources",
						structuredInteriorDrawUnitIds: [],
					},
					scene: {
						envCellId: 0xf4180103,
						kind: "env-cell-direct",
						landblockId: 0xf418ffff,
					},
					traversalDepth: 1,
				},
			],
		});
		renderer.setPortalFrameWorkPlan(portalFrameWorkPlan);

		expect(latestSnapshot.portalFrameWorkPlan).toEqual(portalFrameWorkPlan);
		expect(latestSnapshot.renderPassPlan).toEqual({
			kind: "single-surface-resident",
		});

		renderer.dispose();
	});

	it("draws only direct env-cell frame plan resources when a direct plan is active", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);
		let latestSnapshot = rendererSnapshotPlaceholder();
		renderer.subscribe((snapshot) => {
			latestSnapshot = snapshot;
		});

		renderer.applyStaticDelta({
			addedDrawUnits: [
				createStructuredInteriorDrawUnit({
					drawUnitId: "structured-selected",
					envCellId: 0xda550100,
				}),
				createStructuredInteriorDrawUnit({
					drawUnitId: "structured-resident-unselected",
					envCellId: 0xda550101,
				}),
				createEnvCellStaticObjectDrawUnit("static-selected", [0xda550100]),
				createEnvCellStaticObjectDrawUnit(
					"static-resident-unselected",
					[0xda550101],
				),
			],
			addedTransitionApertureBatches: [],
			removedDrawUnitIds: [],
			removedTransitionApertureBatchIds: [],
			revision: 1,
		});
		renderer.setRenderPassPlan({
			baseScene: {
				envCellId: 0xda550100,
				kind: "interior",
				landblockId: 0xda55ffff,
			},
			kind: "portal-scene-domains",
			transitionDepthPolicy: { maxDepth: 4 },
		});
		renderer.setPortalFrameWorkPlan(
			createDirectEnvCellPortalFrameWorkPlan({
				baseScene: {
					envCellId: 0xda550100,
					kind: "env-cell-direct",
					landblockId: 0xda55ffff,
				},
				nodes: [
				{
						debugStackLabel: "root",
						incomingEdgeIds: [],
						nodeId: 0,
						parentNodeId: null,
						resources: {
							envCellStaticObjectDrawUnitIds: ["static-selected"],
							resourceState: "ready",
							structuredInteriorDrawUnitIds: ["structured-selected"],
						},
						scene: {
							envCellId: 0xda550100,
							kind: "env-cell-direct",
							landblockId: 0xda55ffff,
						},
					traversalDepth: 0,
				},
			],
			}),
		);

		gl.drawElementsCalls.length = 0;
		pendingFrame?.(16);

		expect(gl.drawElementsCalls).toHaveLength(2);
		expect(latestSnapshot.directEnvCellDrawCalls).toBe(2);
		expect(latestSnapshot.sceneDomainTargets.active).toBe(false);
		expect(latestSnapshot.renderPassPlan).toEqual({
			baseScene: {
				envCellId: 0xda550100,
				kind: "interior",
				landblockId: 0xda55ffff,
			},
			kind: "portal-scene-domains",
			transitionDepthPolicy: { maxDepth: 4 },
		});

		renderer.dispose();
	});

	it("executes direct env-cell aperture masks around child cell draws", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);
		let latestSnapshot = rendererSnapshotPlaceholder();
		renderer.subscribe((snapshot) => {
			latestSnapshot = snapshot;
		});

		renderer.applyStaticDelta({
			addedDrawUnits: [
				createStructuredInteriorDrawUnit({
					drawUnitId: "structured-root",
					envCellId: 0xda550100,
				}),
				createStructuredInteriorDrawUnit({
					drawUnitId: "structured-child",
					envCellId: 0xda550101,
				}),
			],
			addedTransitionApertureBatches: [],
			removedDrawUnitIds: [],
			removedTransitionApertureBatchIds: [],
			revision: 1,
		});
		renderer.setPortalFrameWorkPlan(
			createDirectEnvCellPortalFrameWorkPlan({
				apertureResources: [
				{
						resourceId: "portal-aperture:a-to-b",
						sourceKinds: ["env-cell-portal"],
						vertices: [
							[0, 0, 0],
							[1, 0, 0],
							[0, 1, 0],
						],
				},
				{
						resourceId: "portal-aperture:a-to-b-side",
						sourceKinds: ["env-cell-portal"],
						vertices: [
							[2, 0, 0],
							[3, 0, 0],
							[2, 1, 0],
						],
				},
			],
				baseScene: {
					envCellId: 0xda550100,
					kind: "env-cell-direct",
					landblockId: 0xda55ffff,
				},
				edges: [
				{
						apertureResourceId: "portal-aperture:a-to-b",
						apertureSourceId:
							"env-cell-portal:0xda55ffff:0xda550100:portal-a",
						childNodeId: 1,
						edgeId: 0,
						linkId: "a-to-b",
						parentNodeId: 0,
						sourceKind: "env-cell-portal",
				},
				{
						apertureResourceId: "portal-aperture:a-to-b-side",
						apertureSourceId:
							"env-cell-portal:0xda55ffff:0xda550100:portal-a-side",
						childNodeId: 1,
						edgeId: 1,
						linkId: "a-to-b-side",
						parentNodeId: 0,
						sourceKind: "env-cell-portal",
				},
			],
				nodes: [
				{
						debugStackLabel: "root",
						incomingEdgeIds: [],
						nodeId: 0,
						parentNodeId: null,
						resources: {
							envCellStaticObjectDrawUnitIds: [],
							resourceState: "ready",
							structuredInteriorDrawUnitIds: ["structured-root"],
						},
						scene: {
						envCellId: 0xda550100,
						kind: "env-cell-direct",
						landblockId: 0xda55ffff,
					},
						traversalDepth: 0,
				},
				{
						debugStackLabel: "root/a-to-b",
						incomingEdgeIds: [0, 1],
						nodeId: 1,
						parentNodeId: 0,
						resources: {
							envCellStaticObjectDrawUnitIds: [],
							resourceState: "ready",
							structuredInteriorDrawUnitIds: ["structured-child"],
						},
						scene: {
						envCellId: 0xda550101,
						kind: "env-cell-direct",
						landblockId: 0xda55ffff,
					},
						traversalDepth: 1,
				},
			],
			}),
		);

		gl.drawArraysCalls.length = 0;
		gl.drawElementsCalls.length = 0;
		gl.stencilFuncCalls.length = 0;
		gl.stencilOpCalls.length = 0;
		pendingFrame?.(16);

		expect(gl.drawElementsCalls).toHaveLength(2);
		expect(gl.drawArraysCalls).toEqual([
			{ count: 3, first: 0, mode: gl.TRIANGLES },
			{ count: 3, first: 0, mode: gl.TRIANGLES },
			{ count: 3, first: 0, mode: gl.TRIANGLES },
			{ count: 3, first: 0, mode: gl.TRIANGLES },
		]);
		expect(gl.stencilFuncCalls).toEqual(
			expect.arrayContaining([
				{ func: gl.ALWAYS, mask: 0xff, ref: 1 },
				{ func: gl.EQUAL, mask: 0xff, ref: 1 },
			]),
		);
		expect(gl.stencilOpCalls).toEqual(
			expect.arrayContaining([
				{ fail: gl.KEEP, zfail: gl.KEEP, zpass: gl.REPLACE },
				{ fail: gl.KEEP, zfail: gl.KEEP, zpass: gl.DECR },
			]),
		);
		expect(gl.depthFuncModes).toContain(gl.LEQUAL);
		expect(gl.depthFuncModes).toContain(gl.ALWAYS);
		expect(latestSnapshot.directEnvCellDrawCalls).toBe(2);

		renderer.dispose();
	});

	it("executes outdoor-target transition masks through direct env-cell draws", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);
		let latestSnapshot = rendererSnapshotPlaceholder();
		renderer.subscribe((snapshot) => {
			latestSnapshot = snapshot;
		});

		renderer.applyStaticDelta({
			addedDrawUnits: [
				createTerrainDrawUnit(),
				createStructuredInteriorDrawUnit({
					drawUnitId: "structured-transition-root",
					envCellId: 0xda550100,
				}),
			],
			addedTransitionApertureBatches: [],
			removedDrawUnitIds: [],
			removedTransitionApertureBatchIds: [],
			revision: 1,
		});
		renderer.setPortalFrameWorkPlan(
			createDirectEnvCellPortalFrameWorkPlan({
				apertureResources: [
				{
						resourceId: "transition-aperture:root",
						sourceKinds: ["building-transition"],
						vertices: [
							[0, 0, 0],
							[1, 0, 0],
							[0, 1, 0],
						],
				},
			],
				baseScene: {
					kind: "outdoor-target",
					landblockId: 0xda55ffff,
				},
				edges: [
				{
						apertureResourceId: "transition-aperture:root",
						apertureSourceId:
							"building-transition:transition-aperture-batch:da55ffff:transition-portal:0",
						childNodeId: 1,
						edgeId: 0,
						linkId: "transition-root",
						parentNodeId: 0,
						sourceKind: "building-transition",
				},
			],
				nodes: [
				{
						debugStackLabel: "outdoor-root",
						incomingEdgeIds: [],
						nodeId: 0,
						parentNodeId: null,
						resources: {
							envCellStaticObjectDrawUnitIds: [],
							resourceState: "not-applicable",
							structuredInteriorDrawUnitIds: [],
						},
						scene: {
						kind: "outdoor-target",
						landblockId: 0xda55ffff,
					},
						traversalDepth: 0,
				},
				{
						debugStackLabel: "transition-root",
						incomingEdgeIds: [0],
						nodeId: 1,
						parentNodeId: 0,
						resources: {
							envCellStaticObjectDrawUnitIds: [],
							resourceState: "ready",
							structuredInteriorDrawUnitIds: ["structured-transition-root"],
						},
						scene: {
						envCellId: 0xda550100,
						kind: "env-cell-direct",
						landblockId: 0xda55ffff,
					},
					traversalDepth: 1,
				},
			],
			}),
		);

		pendingFrame?.(16);

		expect(latestSnapshot.sceneDomainTargets).toMatchObject({
			active: true,
			compositingMode: "none",
			exteriorDrawCalls: 1,
			interiorDrawCalls: 0,
		});
		expect(latestSnapshot.directEnvCellDrawCalls).toBe(1);
		expect(gl.stencilFuncCalls).toEqual(
			expect.arrayContaining([
				{ func: gl.ALWAYS, mask: 0xff, ref: 1 },
				{ func: gl.EQUAL, mask: 0xff, ref: 1 },
			]),
		);

		renderer.dispose();
	});

	it("executes planned transition composite passes with depth propagation targets", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);
		let latestSnapshot = rendererSnapshotPlaceholder();
		renderer.subscribe((snapshot) => {
			latestSnapshot = snapshot;
		});

		renderer.applyStaticDelta({
			addedDrawUnits: [
				createTerrainDrawUnit(),
				createStructuredInteriorDrawUnit(),
			],
			addedTransitionApertureBatches: [createTransitionApertureBatch()],
			removedDrawUnitIds: [],
			removedTransitionApertureBatchIds: [],
			revision: 1,
		});
		renderer.setRenderPassPlan({
			baseScene: {
				kind: "exterior",
				landblockId: 0xda55ffff,
			},
			kind: "portal-scene-domains",
			transitionDepthPolicy: { maxDepth: 2 },
		});
		pendingFrame?.(16);

		expect(latestSnapshot.sceneDomainTargets).toMatchObject({
			apertureBatchDrawCalls: 2,
			compositePasses: 2,
			compositingMode: "stencil-mask",
			executedCompositeDepth: 2,
		});
		expect(gl.drawElementsCalls).toHaveLength(4);
		expect(gl.drawElementsCalls).toEqual(
			expect.arrayContaining([
				{ count: 3, mode: gl.TRIANGLES, type: gl.UNSIGNED_SHORT },
			]),
		);
		expect(gl.depthFuncModes).toContain(gl.ALWAYS);
		expect(gl.depthFuncModes).toContain(gl.LEQUAL);
		expect(gl.cullFaceModes).toEqual(
			expect.arrayContaining([gl.FRONT, gl.BACK]),
		);
		expect(gl.blitFramebufferCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					mask: gl.DEPTH_BUFFER_BIT,
				}),
				expect.objectContaining({
					mask: gl.STENCIL_BUFFER_BIT,
				}),
				expect.objectContaining({
					mask: gl.COLOR_BUFFER_BIT,
				}),
			]),
		);
		expect(gl.stencilFuncCalls).toEqual(
			expect.arrayContaining([
				{ func: gl.ALWAYS, mask: 0xff, ref: 1 },
				{ func: gl.EQUAL, mask: 0xff, ref: 1 },
				{ func: gl.EQUAL, mask: 0xff, ref: 1 },
				{ func: gl.EQUAL, mask: 0xff, ref: 2 },
			]),
		);
		expect(gl.stencilFuncCalls).not.toEqual(
			expect.arrayContaining([{ func: gl.ALWAYS, mask: 0xff, ref: 2 }]),
		);
		expect(gl.stencilOpCalls).toEqual(
			expect.arrayContaining([
				{ fail: gl.KEEP, zfail: gl.KEEP, zpass: gl.REPLACE },
				{ fail: gl.KEEP, zfail: gl.KEEP, zpass: gl.INCR },
			]),
		);

		renderer.dispose();
	});

	it("draws and removes structured-interior geometry through the static material path", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);
		let latestSnapshot = rendererSnapshotPlaceholder();
		renderer.subscribe((snapshot) => {
			latestSnapshot = snapshot;
		});

		renderer.applyStaticDelta({
			addedDrawUnits: [createStructuredInteriorDrawUnit()],
			addedTransitionApertureBatches: [],
			removedDrawUnitIds: [],
			removedTransitionApertureBatchIds: [],
			revision: 1,
		});
		expect(latestSnapshot.staticDrawUnits).toBe(1);
		expect(latestSnapshot.renderedTriangles).toBe(1);

		pendingFrame?.(16);
		expect(gl.drawElementsCalls).toEqual([
			{ count: 3, mode: gl.TRIANGLES, type: gl.UNSIGNED_SHORT },
		]);
		expect(gl.bufferDataTargets).toEqual(
			expect.arrayContaining([gl.ARRAY_BUFFER, gl.ELEMENT_ARRAY_BUFFER]),
		);
		expect(gl.enabledVertexAttributes).toEqual(
			expect.arrayContaining([0, 1, 2]),
		);

		renderer.applyStaticDelta({
			addedDrawUnits: [],
			addedTransitionApertureBatches: [],
			removedDrawUnitIds: ["structured-interior-a"],
			removedTransitionApertureBatchIds: [],
			revision: 2,
		});
		expect(latestSnapshot.staticDrawUnits).toBe(0);
		expect(latestSnapshot.renderedTriangles).toBe(0);
		gl.drawElementsCalls.length = 0;
		pendingFrame?.(32);
		expect(gl.drawElementsCalls).toEqual([]);

		renderer.dispose();
	});

	it("reports resident env-cell resource membership from uploaded draw units", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);
		let latestSnapshot = rendererSnapshotPlaceholder();
		renderer.subscribe((snapshot) => {
			latestSnapshot = snapshot;
		});

		renderer.applyStaticDelta({
			addedDrawUnits: [
				createStructuredInteriorDrawUnit(),
				createEnvCellStaticObjectDrawUnit(
					"env-static-a",
					[0xda550100, 0xda550101],
				),
			],
			addedTransitionApertureBatches: [],
			removedDrawUnitIds: [],
			removedTransitionApertureBatchIds: [],
			revision: 1,
		});

		expect(latestSnapshot.envCellResourceMembership).toEqual([
			{
				envCellId: 0xda550100,
				envCellStaticObjectDrawUnitIds: ["env-static-a"],
				landblockId: 0xda55ffff,
				sharedEnvCellStaticObjectDrawUnits: 1,
				structuredInteriorDrawUnitIds: ["structured-interior-a"],
			},
			{
				envCellId: 0xda550101,
				envCellStaticObjectDrawUnitIds: ["env-static-a"],
				landblockId: 0xda55ffff,
				sharedEnvCellStaticObjectDrawUnits: 1,
				structuredInteriorDrawUnitIds: [],
			},
		]);

		renderer.applyStaticDelta({
			addedDrawUnits: [],
			addedTransitionApertureBatches: [],
			removedDrawUnitIds: ["structured-interior-a", "env-static-a"],
			removedTransitionApertureBatchIds: [],
			revision: 2,
		});

		expect(latestSnapshot.envCellResourceMembership).toEqual([]);

		renderer.dispose();
	});

	it("enables backface culling for structured interiors in flat vision mode", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);

		renderer.applyStaticDelta({
			addedDrawUnits: [createStructuredInteriorDrawUnit()],
			addedTransitionApertureBatches: [],
			removedDrawUnitIds: [],
			removedTransitionApertureBatchIds: [],
			revision: 1,
		});

		pendingFrame?.(16);
		expect(gl.enabledCapabilities).not.toContain(gl.CULL_FACE);

		gl.enabledCapabilities.length = 0;
		gl.disabledCapabilities.length = 0;
		gl.cullFaceModes.length = 0;
		renderer.setFlatVisionModeEnabled(true);
		pendingFrame?.(32);

		expect(gl.enabledCapabilities).toContain(gl.CULL_FACE);
		expect(gl.cullFaceModes).toContain(gl.BACK);

		renderer.dispose();
	});

	it("uploads and removes transition aperture batches as non-draw-unit resources", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);
		let latestSnapshot = rendererSnapshotPlaceholder();
		renderer.subscribe((snapshot) => {
			latestSnapshot = snapshot;
		});

		renderer.applyStaticDelta({
			addedDrawUnits: [],
			addedTransitionApertureBatches: [
				{
					apertureBatchId: "transition-aperture-batch:da55ffff",
					coordinateSpace: "landblock-render-local",
					frontFace: "indoor-visible",
					indices: [0, 1, 2],
					kind: "transition-aperture-batch",
					landblockId: 0xda55ffff,
					planes: [null],
					ranges: [
						{
							envCellId: 0xda550100,
							exterior: {
								kind: "outside",
								landblockId: 0xda55ffff,
							},
							firstIndex: 0,
							indexCount: 3,
							portalId: "transition-portal:0",
						},
					],
					vertices: [
						{ x: 0, y: 0, z: 0 },
						{ x: 1, y: 0, z: 0 },
						{ x: 0, y: 1, z: 0 },
					],
				},
			],
			removedDrawUnitIds: [],
			removedTransitionApertureBatchIds: [],
			revision: 1,
		});

		expect(latestSnapshot.staticDrawUnits).toBe(0);
		expect(latestSnapshot.renderedTriangles).toBe(0);
		expect(latestSnapshot.transitionApertureBatches).toBe(1);
		expect(latestSnapshot.transitionApertures).toBe(1);
		expect(gl.bufferDataTargets).toEqual(
			expect.arrayContaining([gl.ARRAY_BUFFER, gl.ELEMENT_ARRAY_BUFFER]),
		);

		renderer.applyStaticDelta({
			addedDrawUnits: [],
			addedTransitionApertureBatches: [],
			removedDrawUnitIds: [],
			removedTransitionApertureBatchIds: ["transition-aperture-batch:da55ffff"],
			revision: 2,
		});

		expect(latestSnapshot.transitionApertureBatches).toBe(0);
		expect(latestSnapshot.transitionApertures).toBe(0);

		renderer.dispose();
	});
});

describe("V2 WebGL2 debug overlay shader contract", () => {
	it("draws in-scene debug primitives through the scene camera matrix", () => {
		expect(DEBUG_OVERLAY_VERTEX_SHADER).toContain(
			"uniform mat4 uModelViewProjection;",
		);
		expect(DEBUG_OVERLAY_VERTEX_SHADER).toContain(
			"layout(location = 0) in vec3 position;",
		);
		expect(DEBUG_OVERLAY_VERTEX_SHADER).toContain(
			"layout(location = 1) in vec4 color;",
		);
		expect(DEBUG_OVERLAY_FRAGMENT_SHADER).toContain("fragColor = vColor;");
	});
});

function createStructuredInteriorDrawUnit(
	options: {
		readonly drawUnitId?: string;
		readonly envCellId?: number;
	} = {},
): StructuredInteriorGeometryStaticDrawUnit {
	const drawUnitId = options.drawUnitId ?? "structured-interior-a";
	const envCellId = options.envCellId ?? 0xda550100;
	return {
		cellStructure: {
			cellStructureId: 0x0d000001,
			kind: "cell-structure",
		},
		coordinateSpace: "landblock-render-local",
		domain: "landblock-env-cells",
		drawUnitId,
		envCellId,
		environment: {
			environmentId: 0x0e000001,
			kind: "environment",
		},
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "structured-interior-geometry",
		landblockId: 0xda55ffff,
		localPlacement: {
			orientation: { w: 1, x: 0, y: 0, z: 0 },
			origin: { x: 0, y: 0, z: 0 },
		},
		materialBucketKey: "family:flat-color|pass:opaque|material:08000010",
		materialEntries: [
			{
				alphaTest: 0,
				detailTextureTiling: 1,
				detailTextureUseId: null,
				indexedClipThreshold: -1,
				indexedTextureFormat: null,
				indexTextureUseId: null,
				materialColor: [1, 0, 0, 1],
				materialEmissiveColor: [0, 0, 0],
				materialIds: [0x08000010],
				paletteFirstIndex: 0,
				paletteTextureUseId: null,
				primaryTextureUseId: null,
				primaryTextureWrapMode: "clamp",
				renderState: {
					blend: {
						dstFactor: null,
						enabled: false,
						mode: "opaque",
						srcFactor: null,
					},
					depthTest: true,
					depthWrite: true,
				},
				slot: 0,
			},
		],
		materialFamily: "flat-color",
		materialIds: [0x08000010],
		materialPass: "opaque",
		materialPlan: [
			{
				diagnostics: [],
				family: "flat-color",
				material: {
					kind: "static-material-source",
					materialId: 0x08000010,
				},
				outcome: "rendered",
				pass: "opaque",
				slotId: 0,
				surfaceId: 0x08000010,
				textureUseIds: [],
			},
		],
		materialSlotIndices: new Float32Array([0, 0, 0]),
		memberId: "cell-0",
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		renderState: {
			blend: {
				dstFactor: null,
				enabled: false,
				mode: "opaque",
				srcFactor: null,
			},
			depthTest: true,
			depthWrite: true,
		},
		sourceTriangleIds: ["triangle-a"],
		surfaceIds: [0x08000010],
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: [],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createEnvCellStaticObjectDrawUnit(
	drawUnitId: string,
	envCellIds: readonly number[],
): StaticObjectGeometryStaticDrawUnit {
	const renderState = {
		blend: {
			dstFactor: null,
			enabled: false,
			mode: "opaque" as const,
			srcFactor: null,
		},
		depthTest: true as const,
		depthWrite: true,
	};
	const object = {
		instanceId: `${drawUnitId}:seed`,
		kind: "static-object-instance" as const,
		landblockId: 0xda55ffff,
		objectKind: "explicit-object" as const,
	};

	return {
		alphaTest: 0,
		coordinateSpace: "landblock-render-local",
		detailTextureTiling: 1,
		detailTextureUseId: null,
		domain: "landblock-env-cells",
		drawUnitId,
		indexTextureUseId: null,
		indexType: "uint16",
		indexedClipThreshold: 0,
		indexedTextureFormat: null,
		indices: new Uint16Array([0, 1, 2]),
		kind: "static-object-geometry",
		landblockId: 0xda55ffff,
		materialBucketKey: "family:flat-color|pass:opaque|material:08000010",
		materialColor: [1, 1, 1, 1],
		materialEmissiveColor: [0, 0, 0],
		materialEntries: [
			{
				alphaTest: 0,
				detailTextureTiling: 1,
				detailTextureUseId: null,
				indexTextureUseId: null,
				indexedClipThreshold: 0,
				indexedTextureFormat: null,
				materialColor: [1, 1, 1, 1],
				materialEmissiveColor: [0, 0, 0],
				materialIds: [0x08000010],
				paletteFirstIndex: 0,
				paletteTextureUseId: null,
				primaryTextureUseId: null,
				primaryTextureWrapMode: "clamp",
				renderState,
				slot: 0,
			},
		],
		materialFamily: "flat-color",
		materialIds: [0x08000010],
		materialPass: "opaque",
		materialSlotIndices: new Float32Array([0, 0, 0]),
		ownership: {
			envCellIds,
			kind: "env-cell-static-object-seeds",
			landblockId: 0xda55ffff,
			seedIdentities: [object],
		},
		paletteFirstIndex: 0,
		paletteTextureUseId: null,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		primaryTextureUseId: null,
		primaryTextureWrapMode: "clamp",
		renderState,
		sort: {
			bounds: null,
			center: [0, 0, 0],
			objectPartKey: null,
			policy: "depth-writing",
		},
		sourceMappingCoverage: [
			{
				geometrySurfaceIds: [0],
				gfxObj: {
					kind: "static-object-source",
					sourceAssetKind: "gfx-obj",
					sourceDid: 0x01000020,
				},
				materialIds: [0x08000010],
				materialSlot: 0,
				materialVariantSignatures: [null],
				object,
				partIndex: 0,
				polygonCount: 1,
				polygonRange: { max: 0, min: 0 },
				source: {
					kind: "static-object-source",
					sourceAssetKind: "setup-model",
					sourceDid: 0x02000010,
				},
				sourceTriangleCount: 1,
			},
		],
		spatialRecord: null,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: [],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createTerrainDrawUnit(): TerrainGeometryStaticDrawUnit {
	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId: "terrain-a",
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "terrain-geometry",
		landblockId: 0xda55ffff,
		layerSlots: new Float32Array([0, 0, 0, 0, 0, 0]),
		materialBucketKey: "family:terrain-debug-flat|material:debug",
		materialFamily: "terrain-debug-flat",
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		primaryTextureUseId: null,
		sourceTriangleIds: ["terrain-triangle-a"],
		terrainFallbackReasons: [],
		terrainMaterialPlan: null,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: [],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createTransitionApertureBatch(): TransitionApertureBatch {
	return {
		apertureBatchId: "transition-aperture-batch:da55ffff",
		coordinateSpace: "landblock-render-local",
		frontFace: "indoor-visible",
		indices: [0, 1, 2],
		kind: "transition-aperture-batch",
		landblockId: 0xda55ffff,
		planes: [null],
		ranges: [
			{
				exterior: {
					buildingInstanceId: "building-0",
					buildingPortalId: "building-portal-0",
					kind: "landblock-building",
				},
				firstIndex: 0,
				indexCount: 3,
				portalId: "transition-portal:0",
				source: {
					buildingInstanceId: "building-0",
					buildingPortalId: "building-portal-0",
					buildingPortalSourceIndex: 0,
					kind: "building-portal",
					linkedEnvCellIds: [0xda550100],
					otherCellId: 0x0100,
					otherPortalId: 0xffff,
					polyId: 7,
					portalIndex: 0,
					sourceAssetId: "gfx-obj/01001234",
					sourceDid: 0x01001234,
				},
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

function createFakeCanvas(gl: WebGL2RenderingContext): HTMLCanvasElement {
	return {
		clientHeight: 64,
		clientWidth: 64,
		getContext: (kind: string) => (kind === "webgl2" ? gl : null),
		height: 64,
		width: 64,
	} as HTMLCanvasElement;
}

function rendererSnapshotPlaceholder() {
	return {
		backend: "webgl2" as const,
		canvasHeight: 0,
		canvasWidth: 0,
		debugOverlayPrimitives: 0,
		error: null,
		frameCount: 0,
		frameHandlerMs: 0,
		isRunning: false,
		renderPassPlan: { kind: "single-surface-resident" as const },
		portalFrameWorkPlan: {
			kind: "legacy-render-pass" as const,
			mode: "single-surface-resident" as const,
			renderPassPlan: { kind: "single-surface-resident" as const },
		},
		renderedTriangles: 0,
		sceneDomainTargets: {
			active: false,
			apertureBatchDrawCalls: 0,
			colorFormat: "rgb8" as const,
			compositePasses: 0,
			compositingMode: "none" as const,
			depthFormat: "depth24-stencil8" as const,
			executedCompositeDepth: 0,
			exteriorDrawCalls: 0,
			height: 0,
			interiorDrawCalls: 0,
			width: 0,
		},
		envCellResourceMembership: [],
		directEnvCellDrawCalls: 0,
		staticDrawUnits: 0,
		terrainDrawUnits: 0,
		transitionApertureBatches: 0,
		transitionApertures: 0,
	};
}

function createDirectEnvCellPortalFrameWorkPlan(options: {
	readonly baseScene:
		| { readonly kind: "outdoor-target"; readonly landblockId: number }
		| {
				readonly kind: "env-cell-direct";
				readonly landblockId: number;
				readonly envCellId: number;
		  };
	readonly apertureResources?: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["graph"]["apertureResources"];
	readonly diagnostics?: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["graph"]["diagnostics"];
	readonly edges?: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["graph"]["edges"];
	readonly nodes?: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["graph"]["nodes"];
}): PortalFrameWorkPlan {
	const baseNode = {
		debugStackLabel:
			options.baseScene.kind === "outdoor-target" ? "outdoor-root" : "root",
		incomingEdgeIds: [],
		nodeId: 0,
		parentNodeId: null,
		resources: {
			envCellStaticObjectDrawUnitIds: [],
			resourceState:
				options.baseScene.kind === "outdoor-target"
					? ("not-applicable" as const)
					: ("missing-resources" as const),
			structuredInteriorDrawUnitIds: [],
		},
		scene: options.baseScene,
		traversalDepth: 0,
	};
	return {
		graph: {
			apertureResources: options.apertureResources ?? [],
			baseNodeId: 0,
			diagnostics: options.diagnostics ?? emptyPortalApertureDiagnostics(),
			edges: options.edges ?? [],
			nodes: options.nodes ?? [baseNode],
		},
		kind: "direct-env-cell",
		mode: "portal-traversal",
	};
}

function emptyPortalApertureDiagnostics() {
	return {
		buildingTransitionEdges: 0,
		dedupedGeometryResources: 0,
		duplicateMaskEdges: 0,
		envCellPortalEdges: 0,
		selectedMaskEdges: 0,
		transitionRootCandidateCount: 0,
		transitionRootCount: 0,
		transitionRootsRejectedNotSeenOutside: 0,
		transitionRootsRejectedUnknownSeenOutside: 0,
	};
}

function createFakeWebgl2Context(): WebGL2RenderingContext & {
	readonly blitFramebufferCalls: { readonly mask: GLenum }[];
	readonly bufferDataTargets: GLenum[];
	readonly cullFaceModes: GLenum[];
	readonly depthFuncModes: GLenum[];
	readonly disabledCapabilities: GLenum[];
	readonly drawElementsCalls: {
		readonly count: number;
		readonly mode: GLenum;
		readonly type: GLenum;
	}[];
	readonly drawArraysCalls: {
		readonly count: number;
		readonly first: number;
		readonly mode: GLenum;
	}[];
	readonly enabledCapabilities: GLenum[];
	readonly enabledVertexAttributes: number[];
	readonly stencilFuncCalls: {
		readonly func: GLenum;
		readonly mask: number;
		readonly ref: number;
	}[];
	readonly stencilOpCalls: {
		readonly fail: GLenum;
		readonly zfail: GLenum;
		readonly zpass: GLenum;
	}[];
} {
	let nextObjectId = 1;
	const blitFramebufferCalls: { mask: GLenum }[] = [];
	const bufferDataTargets: GLenum[] = [];
	const cullFaceModes: GLenum[] = [];
	const depthFuncModes: GLenum[] = [];
	const disabledCapabilities: GLenum[] = [];
	const drawElementsCalls: { count: number; mode: GLenum; type: GLenum }[] = [];
	const drawArraysCalls: { count: number; first: number; mode: GLenum }[] = [];
	const enabledCapabilities: GLenum[] = [];
	const enabledVertexAttributes: number[] = [];
	const stencilFuncCalls: { func: GLenum; mask: number; ref: number }[] = [];
	const stencilOpCalls: { fail: GLenum; zfail: GLenum; zpass: GLenum }[] = [];
	const createObject = () => ({ id: nextObjectId++ });
	const gl = {
		ALWAYS: 519,
		ARRAY_BUFFER: 34962,
		BACK: 1029,
		BLEND: 3042,
		CLAMP_TO_EDGE: 33071,
		COLOR_BUFFER_BIT: 16384,
		COMPILE_STATUS: 35713,
		CULL_FACE: 2884,
		DEPTH_ATTACHMENT: 36096,
		DEPTH_STENCIL_ATTACHMENT: 33306,
		DEPTH_BUFFER_BIT: 256,
		DEPTH_COMPONENT: 6402,
		DEPTH_COMPONENT24: 33190,
		DEPTH24_STENCIL8: 35056,
		DEPTH_STENCIL: 34041,
		DEPTH_TEST: 2929,
		DECR: 7683,
		drawingBufferHeight: 64,
		drawingBufferWidth: 64,
		DRAW_FRAMEBUFFER: 36009,
		DYNAMIC_DRAW: 35048,
		ELEMENT_ARRAY_BUFFER: 34963,
		EQUAL: 514,
		FLOAT: 5126,
		FRAGMENT_SHADER: 35632,
		FRAMEBUFFER: 36160,
		FRAMEBUFFER_COMPLETE: 36053,
		FRONT: 1028,
		FRONT_AND_BACK: 1032,
		FUNC_ADD: 32774,
		FUNC_SUBTRACT: 32778,
		KEEP: 7680,
		INCR: 7682,
		LEQUAL: 515,
		LESS: 513,
		LINEAR: 9729,
		LINES: 1,
		LINK_STATUS: 35714,
		NEAREST: 9728,
		ONE: 1,
		ONE_MINUS_SRC_ALPHA: 771,
		R8: 33321,
		READ_FRAMEBUFFER: 36008,
		RED: 6403,
		RGB: 6407,
		RGB8: 32849,
		RG: 33319,
		RG8: 33323,
		RGBA: 6408,
		SRC_ALPHA: 770,
		STATIC_DRAW: 35044,
		STENCIL_BUFFER_BIT: 1024,
		STENCIL_TEST: 2960,
		TEXTURE0: 33984,
		TEXTURE_2D: 3553,
		TEXTURE_MAG_FILTER: 10240,
		TEXTURE_MIN_FILTER: 10241,
		TEXTURE_WRAP_S: 10242,
		TEXTURE_WRAP_T: 10243,
		TRIANGLES: 4,
		UNPACK_ALIGNMENT: 3317,
		UNSIGNED_BYTE: 5121,
		UNSIGNED_INT: 5125,
		UNSIGNED_INT_24_8: 34042,
		UNSIGNED_SHORT: 5123,
		VERTEX_SHADER: 35633,
		ZERO: 0,
		activeTexture: vi.fn(),
		attachShader: vi.fn(),
		bindBuffer: vi.fn(),
		bindFramebuffer: vi.fn(),
		bindTexture: vi.fn(),
		bindVertexArray: vi.fn(),
		blendEquationSeparate: vi.fn(),
		blendFuncSeparate: vi.fn(),
		blitFramebuffer: vi.fn(
			(
				_x0: number,
				_y0: number,
				_x1: number,
				_y1: number,
				_x2: number,
				_y2: number,
				_x3: number,
				_y3: number,
				mask: GLenum,
			) => {
				blitFramebufferCalls.push({ mask });
			},
		),
		bufferData: vi.fn((target: GLenum) => {
			bufferDataTargets.push(target);
		}),
		clear: vi.fn(),
		clearColor: vi.fn(),
		clearDepth: vi.fn(),
		checkFramebufferStatus: vi.fn(() => 36053),
		clearStencil: vi.fn(),
		compileShader: vi.fn(),
		colorMask: vi.fn(),
		createBuffer: vi.fn(createObject),
		createFramebuffer: vi.fn(createObject),
		createProgram: vi.fn(createObject),
		createShader: vi.fn(createObject),
		createTexture: vi.fn(createObject),
		createVertexArray: vi.fn(createObject),
		cullFace: vi.fn((mode: GLenum) => {
			cullFaceModes.push(mode);
		}),
		deleteBuffer: vi.fn(),
		deleteFramebuffer: vi.fn(),
		deleteProgram: vi.fn(),
		deleteShader: vi.fn(),
		deleteTexture: vi.fn(),
		deleteVertexArray: vi.fn(),
		depthFunc: vi.fn((mode: GLenum) => {
			depthFuncModes.push(mode);
		}),
		depthMask: vi.fn(),
		disable: vi.fn((capability: GLenum) => {
			disabledCapabilities.push(capability);
		}),
		drawArrays: vi.fn((mode: GLenum, first: number, count: number) => {
			drawArraysCalls.push({ count, first, mode });
		}),
		drawElements: vi.fn((mode: GLenum, count: number, type: GLenum) => {
			drawElementsCalls.push({ count, mode, type });
		}),
		enable: vi.fn((capability: GLenum) => {
			enabledCapabilities.push(capability);
		}),
		enableVertexAttribArray: vi.fn((slot: number) => {
			enabledVertexAttributes.push(slot);
		}),
		framebufferTexture2D: vi.fn(),
		generateMipmap: vi.fn(),
		getExtension: vi.fn(() => null),
		getParameter: vi.fn(() => 1),
		getProgramInfoLog: vi.fn(() => null),
		getProgramParameter: vi.fn(() => true),
		getShaderInfoLog: vi.fn(() => null),
		getShaderParameter: vi.fn(() => true),
		getUniformLocation: vi.fn((_program: WebGLProgram, name: string) => ({
			name,
		})),
		lineWidth: vi.fn(),
		linkProgram: vi.fn(),
		pixelStorei: vi.fn(),
		shaderSource: vi.fn(),
		REPLACE: 7681,
		stencilFunc: vi.fn((func: GLenum, ref: number, mask: number) => {
			stencilFuncCalls.push({ func, mask, ref });
		}),
		stencilMask: vi.fn(),
		stencilOp: vi.fn((fail: GLenum, zfail: GLenum, zpass: GLenum) => {
			stencilOpCalls.push({ fail, zfail, zpass });
		}),
		texImage2D: vi.fn(),
		texParameterf: vi.fn(),
		texParameteri: vi.fn(),
		uniform1f: vi.fn(),
		uniform1fv: vi.fn(),
		uniform1i: vi.fn(),
		uniform1iv: vi.fn(),
		uniform2f: vi.fn(),
		uniform2fv: vi.fn(),
		uniform3f: vi.fn(),
		uniform3fv: vi.fn(),
		uniform4f: vi.fn(),
		uniform4fv: vi.fn(),
		uniformMatrix4fv: vi.fn(),
		useProgram: vi.fn(),
		vertexAttribPointer: vi.fn(),
		viewport: vi.fn(),
		blitFramebufferCalls,
		bufferDataTargets,
		cullFaceModes,
		depthFuncModes,
		drawArraysCalls,
		disabledCapabilities,
		drawElementsCalls,
		enabledCapabilities,
		enabledVertexAttributes,
		stencilFuncCalls,
		stencilOpCalls,
	};

	return gl as unknown as WebGL2RenderingContext & {
		readonly blitFramebufferCalls: { readonly mask: GLenum }[];
		readonly bufferDataTargets: GLenum[];
		readonly cullFaceModes: GLenum[];
		readonly depthFuncModes: GLenum[];
		readonly drawElementsCalls: {
			readonly count: number;
			readonly mode: GLenum;
			readonly type: GLenum;
		}[];
		readonly drawArraysCalls: {
			readonly count: number;
			readonly first: number;
			readonly mode: GLenum;
		}[];
		readonly enabledVertexAttributes: number[];
		readonly stencilFuncCalls: {
			readonly func: GLenum;
			readonly mask: number;
			readonly ref: number;
		}[];
		readonly stencilOpCalls: {
			readonly fail: GLenum;
			readonly zfail: GLenum;
			readonly zpass: GLenum;
		}[];
	};
}

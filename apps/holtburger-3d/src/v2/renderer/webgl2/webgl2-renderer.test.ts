import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	StaticObjectGeometryStaticDrawUnit,
	StaticPortalApertureResource,
	StructuredInteriorGeometryStaticDrawUnit,
	TerrainGeometryStaticDrawUnit,
} from "../../static/contracts";
import {
	MAX_STATIC_OBJECT_BASE_COLOR_PAGES_PER_DRAW,
	MAX_STATIC_OBJECT_MATERIAL_ENTRIES_PER_DRAW,
	MAX_TERRAIN_COLOR_PAGES_PER_DRAW,
	MAX_TERRAIN_MASK_PAGES_PER_DRAW,
} from "../types";
import type {
	EnvCellSystemLayerPayload,
	PortalFrameWorkPlan,
	TerrainLayerPayload,
} from "../types";
import {
	compareStaticObjectTransparentDrawEntries,
	DEBUG_OVERLAY_FRAGMENT_SHADER,
	DEBUG_OVERLAY_VERTEX_SHADER,
	DIRECT_PORTAL_DEPTH_RESET_FRAGMENT_SHADER,
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

	it("resets direct portal child depth to far under the active stencil", () => {
		expect(DIRECT_PORTAL_DEPTH_RESET_FRAGMENT_SHADER).toContain(
			"gl_FragDepth = 1.0;",
		);
		expect(DIRECT_PORTAL_DEPTH_RESET_FRAGMENT_SHADER).not.toContain(
			"sampler2D",
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
		const latestSnapshot = renderer.createDiagnosticsSnapshot();
		expect(latestSnapshot.sceneDomainTargets).toMatchObject({
			active: true,
			colorFormat: "rgb8",
			depthFormat: "depth24-stencil8",
			height: 64,
			width: 64,
		});

		renderer.dispose();
	});

	it("resets unmanaged framebuffer write state before rendering", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);

		gl.disabledCapabilities.length = 0;
		pendingFrame?.(16);

		expect(gl.colorMask).toHaveBeenCalledWith(true, true, true, true);
		expect(gl.disabledCapabilities).toContain(gl.SCISSOR_TEST);

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

		const portalFrameWorkPlan = createDirectEnvCellPortalFrameWorkPlan({
			baseScene: { kind: "outdoor-target", landblockId: 0xf418ffff },
			edges: [
				{
					apertureRangeId: "transition-aperture:f4180103",
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

		const latestSnapshot = renderer.createDiagnosticsSnapshot();
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

		renderer.setEnvCellSystemLayer(
			0xda55ffff,
			createEnvCellSystemLayerPayload({
				envCellStaticObjectDrawUnits: [
					createEnvCellStaticObjectDrawUnit("static-selected", [0xda550100]),
					createEnvCellStaticObjectDrawUnit(
						"static-resident-unselected",
						[0xda550101],
					),
				],
				structuredInteriorDrawUnits: [
					createStructuredInteriorDrawUnit({
						drawUnitId: "structured-selected",
						envCellId: 0xda550100,
					}),
					createStructuredInteriorDrawUnit({
						drawUnitId: "structured-resident-unselected",
						envCellId: 0xda550101,
					}),
				],
			}),
		);
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
		const latestSnapshot = renderer.createDiagnosticsSnapshot();
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

		renderer.setEnvCellSystemLayer(
			0xda55ffff,
			createEnvCellSystemLayerPayload({
				structuredInteriorDrawUnits: [
					createStructuredInteriorDrawUnit({
						drawUnitId: "structured-root",
						envCellId: 0xda550100,
					}),
					createStructuredInteriorDrawUnit({
						drawUnitId: "structured-child",
						envCellId: 0xda550101,
					}),
				],
				portalApertureResources: [
					createPortalApertureResource({
						apertureResourceId: "portal-aperture-resource:env-cell:test",
						ranges: [
							{
								rangeId: "portal-aperture:a-to-b",
								sourceId: "env-cell-portal:0xda55ffff:0xda550100:portal-a",
								sourceKind: "env-cell-portal",
							},
							{
								rangeId: "portal-aperture:a-to-b-side",
								sourceId: "env-cell-portal:0xda55ffff:0xda550100:portal-a-side",
								sourceKind: "env-cell-portal",
							},
						],
					}),
				],
			}),
		);
		renderer.setPortalFrameWorkPlan(
			createDirectEnvCellPortalFrameWorkPlan({
				apertureResources: [
					{
						resourceId: "portal-aperture:a-to-b",
						sourceKinds: ["env-cell-portal"],
					},
					{
						resourceId: "portal-aperture:a-to-b-side",
						sourceKinds: ["env-cell-portal"],
					},
				],
				baseScene: {
					envCellId: 0xda550100,
					kind: "env-cell-direct",
					landblockId: 0xda55ffff,
				},
				edges: [
					{
						apertureRangeId: "portal-aperture:a-to-b",
						apertureSourceId: "env-cell-portal:0xda55ffff:0xda550100:portal-a",
						childNodeId: 1,
						edgeId: 0,
						linkId: "a-to-b",
						parentNodeId: 0,
						sourceKind: "env-cell-portal",
					},
					{
						apertureRangeId: "portal-aperture:a-to-b-side",
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

		expect(gl.drawElementsCalls).toEqual(
			expect.arrayContaining([
				{ count: 3, mode: gl.TRIANGLES, type: gl.UNSIGNED_SHORT },
			]),
		);
		expect(gl.drawElementsCalls).toHaveLength(4);
		expect(gl.drawArraysCalls).toEqual([
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
			]),
		);
		expect(gl.depthFuncModes).toContain(gl.LEQUAL);
		expect(gl.depthFuncModes).toContain(gl.ALWAYS);
		const latestSnapshot = renderer.createDiagnosticsSnapshot();
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

		renderer.setTerrainLayer(
			0xda55ffff,
			createTerrainLayerPayload("terrain-a"),
		);
		renderer.setEnvCellSystemLayer(
			0xda55ffff,
			createEnvCellSystemLayerPayload({
				structuredInteriorDrawUnits: [
					createStructuredInteriorDrawUnit({
						drawUnitId: "structured-transition-root",
						envCellId: 0xda550100,
					}),
				],
				portalApertureResources: [
					createPortalApertureResource({
						apertureResourceId: "portal-aperture-resource:transition:test",
						ranges: [
							{
								rangeId: "transition-aperture:root",
								sourceId:
									"building-transition:portal-aperture-resource:da55ffff:transition-portal:0",
								sourceKind: "building-transition",
							},
						],
						sourceDomain: "outdoor-buildings",
					}),
				],
			}),
		);
		renderer.setPortalFrameWorkPlan(
			createDirectEnvCellPortalFrameWorkPlan({
				apertureResources: [
					{
						resourceId: "transition-aperture:root",
						sourceKinds: ["building-transition"],
					},
				],
				baseScene: {
					kind: "outdoor-target",
					landblockId: 0xda55ffff,
				},
				edges: [
					{
						apertureRangeId: "transition-aperture:root",
						apertureSourceId:
							"building-transition:portal-aperture-resource:da55ffff:transition-portal:0",
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

		const latestSnapshot = renderer.createDiagnosticsSnapshot();
		expect(latestSnapshot.sceneDomainTargets).toMatchObject({
			active: true,
			compositingMode: "none",
			exteriorDrawCalls: 1,
			interiorDrawCalls: 0,
		});
		expect(latestSnapshot.directEnvCellDrawCalls).toBe(1);
		expect(gl.drawElementsCalls).toEqual(
			expect.arrayContaining([
				{ count: 3, mode: gl.TRIANGLES, type: gl.UNSIGNED_SHORT },
			]),
		);
		expect(gl.drawArraysCalls).toEqual([
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
		expect(gl.enabledCapabilities).not.toContain(gl.CULL_FACE);
		expect(gl.blitFramebufferCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					mask: gl.DEPTH_BUFFER_BIT,
				}),
			]),
		);
		expect(gl.blitFramebufferCalls).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					mask: gl.COLOR_BUFFER_BIT,
				}),
			]),
		);

		renderer.dispose();
	});

	it("samples bounded exterior suffix composites for indoor outdoor crossings", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);

		renderer.setTerrainLayer(
			0xda55ffff,
			createTerrainLayerPayload("terrain-a"),
		);
		renderer.setEnvCellSystemLayer(
			0xda55ffff,
			createEnvCellSystemLayerPayload({
				structuredInteriorDrawUnits: [
					createStructuredInteriorDrawUnit({
						drawUnitId: "structured-root",
						envCellId: 0xda550100,
					}),
					createStructuredInteriorDrawUnit({
						drawUnitId: "structured-transition-root",
						envCellId: 0xda550101,
					}),
				],
				portalApertureResources: [
					createPortalApertureResource({
						apertureResourceId: "portal-aperture-resource:transition:test",
						ranges: [
							{
								rangeId: "transition-aperture:root",
								sourceId:
									"building-transition:portal-aperture-resource:da55ffff:transition-portal:0",
								sourceKind: "building-transition",
							},
						],
						sourceDomain: "outdoor-buildings",
					}),
				],
			}),
		);
		const exteriorPlan = createDirectEnvCellPortalFrameWorkPlan({
			apertureResources: [
				{
					resourceId: "transition-aperture:root",
					sourceKinds: ["building-transition"],
				},
			],
			baseScene: {
				kind: "outdoor-target",
				landblockId: 0xda55ffff,
			},
			edges: [
				{
					apertureRangeId: "transition-aperture:root",
					apertureSourceId:
						"building-transition:portal-aperture-resource:da55ffff:transition-portal:0",
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
						envCellId: 0xda550101,
						kind: "env-cell-direct",
						landblockId: 0xda55ffff,
					},
					traversalDepth: 1,
				},
			],
			outdoorCrossings: [
				{
					apertureRangeId: "transition-aperture:root",
					apertureSourceId:
						"building-transition:portal-aperture-resource:da55ffff:transition-portal:0",
					crossingId: 0,
					linkId: "transition-root",
					outdoorLandblockId: 0xda55ffff,
					targetEnvCellId: 0xda550101,
				},
			],
		});
		if (exteriorPlan.kind !== "direct-env-cell") {
			throw new Error("Expected direct env-cell fixture.");
		}
		renderer.setPortalFrameWorkPlan(
			createDirectEnvCellPortalFrameWorkPlan({
				baseScene: {
					envCellId: 0xda550100,
					kind: "env-cell-direct",
					landblockId: 0xda55ffff,
				},
				exteriorComposite: {
					graphs: [exteriorPlan.layeredGraph],
					maxDepth: 1,
				},
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
				],
				outdoorCrossings: [
					{
						apertureRangeId: "transition-aperture:root",
						apertureSourceId:
							"building-transition:portal-aperture-resource:da55ffff:transition-portal:0",
						crossingId: 0,
						linkId: "transition-root",
						outdoorLandblockId: 0xda55ffff,
						targetEnvCellId: 0xda550100,
					},
				],
			}),
		);

		pendingFrame?.(16);

		const latestSnapshot = renderer.createDiagnosticsSnapshot();
		expect(latestSnapshot.sceneDomainTargets).toMatchObject({
			active: true,
			exteriorDrawCalls: 1,
			exteriorSuffixCompositeDepth: 1,
			exteriorSuffixCompositePasses: 1,
			outdoorCrossingSource: "exterior-suffix",
		});
		expect(latestSnapshot.directEnvCellDrawCalls).toBe(2);
		expect(gl.blitFramebufferCalls).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ mask: gl.DEPTH_BUFFER_BIT }),
			]),
		);
		expect(gl.blitFramebufferCalls).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ mask: gl.COLOR_BUFFER_BIT }),
			]),
		);
		expect(gl.stencilFuncCalls).toEqual(
			expect.arrayContaining([
				{ func: gl.EQUAL, mask: 0xff, ref: 0xfe },
			]),
		);
		expect(gl.enabledCapabilities).toContain(gl.CULL_FACE);
		expect(gl.cullFaceModes).toContain(gl.BACK);

		renderer.dispose();
	});

	it("draws and removes structured-interior geometry through env-cell system layers", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);

		renderer.setEnvCellSystemLayer(
			0xda55ffff,
			createEnvCellSystemLayerPayload({
				envCellStaticObjectDrawUnits: [],
				portalApertureResources: [],
				structuredInteriorDrawUnits: [createStructuredInteriorDrawUnit()],
			}),
		);
		const addedSnapshot = renderer.createDiagnosticsSnapshot();
		expect(addedSnapshot.staticDrawUnits).toBe(1);
		expect(addedSnapshot.renderedTriangles).toBe(1);

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

		renderer.setEnvCellSystemLayer(0xda55ffff, null);
		const removedSnapshot = renderer.createDiagnosticsSnapshot();
		expect(removedSnapshot.staticDrawUnits).toBe(0);
		expect(removedSnapshot.renderedTriangles).toBe(0);
		gl.drawElementsCalls.length = 0;
		pendingFrame?.(32);
		expect(gl.drawElementsCalls).toEqual([]);

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

		renderer.setEnvCellSystemLayer(
			0xda55ffff,
			createEnvCellSystemLayerPayload({
				envCellStaticObjectDrawUnits: [],
				portalApertureResources: [],
				structuredInteriorDrawUnits: [createStructuredInteriorDrawUnit()],
			}),
		);

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

	it("replaces and clears terrain layers without static delta remove lists", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);

		renderer.setTerrainLayer(
			0xda55ffff,
			createTerrainLayerPayload("terrain-a"),
		);
		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			renderedTriangles: 1,
			staticDrawUnits: 1,
			terrainDrawUnits: 1,
		});

		renderer.setTerrainLayer(
			0xda55ffff,
			createTerrainLayerPayload("terrain-b"),
		);
		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			renderedTriangles: 1,
			staticDrawUnits: 1,
			terrainDrawUnits: 1,
		});

		renderer.setTerrainLayer(0xda55ffff, null);
		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			renderedTriangles: 0,
			staticDrawUnits: 0,
			terrainDrawUnits: 0,
		});

		renderer.dispose();
	});

	it("clears env-cell system layers without touching terrain layers", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);

		renderer.setTerrainLayer(
			0xda55ffff,
			createTerrainLayerPayload("terrain-a"),
		);
		renderer.setEnvCellSystemLayer(
			0xda55ffff,
			createEnvCellSystemLayerPayload(),
		);
		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			renderedTriangles: 3,
			staticDrawUnits: 3,
			terrainDrawUnits: 1,
		});

		renderer.setEnvCellSystemLayer(0xda55ffff, null);
		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			renderedTriangles: 1,
			staticDrawUnits: 1,
			terrainDrawUnits: 1,
		});

		renderer.dispose();
	});

	it("hides static layers without clearing installed layer ownership", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);

		renderer.setTerrainLayer(
			0xda55ffff,
			createTerrainLayerPayload("terrain-a"),
		);
		renderer.setStaticLayerVisibility({
			envCellInteriors: true,
			outdoorBuildings: true,
			outdoorDetail: true,
			terrain: false,
		});
		pendingFrame?.(16);

		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			renderedTriangles: 1,
			staticDrawUnits: 1,
			terrainDrawUnits: 1,
		});
		expect(gl.drawElementsCalls).toEqual([]);

		renderer.dispose();
	});

	it("rejects mismatched layer payload landblocks", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);

		expect(() =>
			renderer.setTerrainLayer(
				0xda55ffff,
				createTerrainLayerPayload("terrain-a", 0xdb00ffff),
			),
		).toThrow(/received payload/);

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

	it("ignores debug overlay updates after disposal", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);
		const bufferDataCallsBeforeDispose = gl.bufferData.mock.calls.length;

		renderer.dispose();
		renderer.setDebugOverlayPrimitives([
			{
				color: [1, 0, 0, 1],
				id: "late-overlay",
				kind: "aabb",
				max: [1, 1, 1],
				min: [0, 0, 0],
			},
		]);

		expect(gl.bufferData.mock.calls).toHaveLength(bufferDataCallsBeforeDispose);
	});

	it("allows renderer disposal to be called more than once", () => {
		const gl = createFakeWebgl2Context();
		const canvas = createFakeCanvas(gl);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 1;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});
		vi.stubGlobal("window", { devicePixelRatio: 1 });
		const renderer = createWebgl2Renderer(canvas);

		renderer.dispose();
		renderer.dispose();

		expect(gl.deleteVertexArray).toHaveBeenCalledTimes(2);
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

function createTerrainLayerPayload(
	drawUnitId: string,
	landblockId = 0xda55ffff,
): TerrainLayerPayload {
	return {
		drawUnits: [createTerrainDrawUnit({ drawUnitId, landblockId })],
		generationId: `terrain:${drawUnitId}`,
		kind: "terrain",
		landblockId,
		materialCoverage: [],
		sourceMappingRecords: [],
		spatialRecords: [],
		textureUses: [],
	};
}

function createEnvCellSystemLayerPayload(
	options: {
		readonly envCellStaticObjectDrawUnits?: EnvCellSystemLayerPayload["envCellStaticObjectDrawUnits"];
		readonly portalApertureResources?: EnvCellSystemLayerPayload["portalApertureResources"];
		readonly structuredInteriorDrawUnits?: EnvCellSystemLayerPayload["structuredInteriorDrawUnits"];
	} = {},
): EnvCellSystemLayerPayload {
	return {
		authoredDynamicSeedRecords: [],
		envCellStaticObjectDrawUnits: options.envCellStaticObjectDrawUnits ?? [
			createEnvCellStaticObjectDrawUnit("env-cell-static-a", [0xda550100]),
		],
		generationId: "env-cell-system:a",
		kind: "env-cell-system",
		landblockId: 0xda55ffff,
		materialCoverage: [],
		portalApertureResources: options.portalApertureResources ?? [
			createPortalApertureResource({
				apertureResourceId: "portal-aperture-resource:env-layer",
				ranges: [
					{
						rangeId: "portal-range:env-layer",
						sourceId: "env-portal:0",
						sourceKind: "env-cell-portal",
					},
				],
			}),
		],
		portalGraphRecords: [],
		portalInteriorRecords: [],
		portalProjectionRecords: [],
		resourceMembership: [],
		sourceMappingRecords: [],
		spatialRecords: [],
		structuredInteriorDrawUnits: options.structuredInteriorDrawUnits ?? [
			createStructuredInteriorDrawUnit(),
		],
		textureUses: [],
		visibilityRecords: [],
	};
}

function createTerrainDrawUnit(
	options: {
		readonly drawUnitId?: string;
		readonly landblockId?: number;
	} = {},
): TerrainGeometryStaticDrawUnit {
	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId: options.drawUnitId ?? "terrain-a",
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "terrain-geometry",
		landblockId: options.landblockId ?? 0xda55ffff,
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

function createPortalApertureResource(options: {
	readonly apertureResourceId: string;
	readonly ranges: readonly {
		readonly rangeId: string;
		readonly sourceId: string;
		readonly sourceKind: "building-transition" | "env-cell-portal";
	}[];
	readonly sourceDomain?: StaticPortalApertureResource["sourceDomain"];
}): StaticPortalApertureResource {
	return {
		apertureResourceId: options.apertureResourceId,
		coordinateSpace: "landblock-render-local",
		indices: options.ranges.flatMap((_range, rangeIndex) => {
			const firstVertex = rangeIndex * 3;
			return [firstVertex, firstVertex + 1, firstVertex + 2];
		}),
		kind: "portal-aperture-resource",
		landblockId: 0xda55ffff,
		ranges: options.ranges.map((range, rangeIndex) => ({
			firstIndex: rangeIndex * 3,
			indexCount: 3,
			rangeId: range.rangeId,
			sourceId: range.sourceId,
			sourceKind: range.sourceKind,
		})),
		sourceDomain: options.sourceDomain ?? "landblock-env-cells",
		vertices: options.ranges.flatMap((_range, rangeIndex) => {
			const offset = rangeIndex * 2;
			return [
				{ x: offset, y: 0, z: 0 },
				{ x: offset + 1, y: 0, z: 0 },
				{ x: offset, y: 1, z: 0 },
			];
		}),
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

function createDirectEnvCellPortalFrameWorkPlan(options: {
	readonly baseScene:
		| { readonly kind: "outdoor-target"; readonly landblockId: number }
		| {
				readonly kind: "env-cell-direct";
				readonly landblockId: number;
				readonly envCellId: number;
		  };
	readonly apertureResources?: DirectEnvCellFixtureApertureResource[];
	readonly diagnostics?: ReturnType<typeof emptyPortalApertureDiagnostics>;
	readonly edges?: DirectEnvCellFixtureEdge[];
	readonly exteriorComposite?: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["exteriorComposite"];
	readonly nodes?: DirectEnvCellFixtureNode[];
	readonly outdoorCrossings?: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["layeredGraph"]["outdoorCrossings"];
}): PortalFrameWorkPlan {
	const baseNode: DirectEnvCellFixtureNode = {
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
	const nodes = options.nodes ?? [baseNode];
	const resolvedBaseNode = nodes.find((node) => node.nodeId === 0) ?? baseNode;
	const baseEntry =
		options.baseScene.kind === "outdoor-target"
			? {
					debugStackLabel: resolvedBaseNode.debugStackLabel,
					scene: options.baseScene,
				}
			: {
					debugStackLabel: resolvedBaseNode.debugStackLabel,
					resources: resolvedBaseNode.resources,
					scene: options.baseScene,
				};
	const childNodes = nodes.filter((node) => node.nodeId !== 0);
	const renderEntries = childNodes.map((node, renderEntryId) => {
		if (node.scene.kind !== "env-cell-direct") {
			throw new Error(
				"Direct env-cell fixture child must be an env-cell scene.",
			);
		}
		return {
			debugStackLabel: node.debugStackLabel,
			envCellId: node.scene.envCellId,
			incomingMaskEdgeIds: (options.edges ?? [])
				.filter((edge) => edge.childNodeId === node.nodeId)
				.map((edge) => edge.edgeId),
			landblockId: node.scene.landblockId,
			renderEntryId,
			renderLayer: node.traversalDepth,
			resources: node.resources,
		};
	});
	const renderEntryIdByNodeId = new Map(
		childNodes.map((node, index) => [node.nodeId, index] as const),
	);
	const renderLayers = [
		...new Set(renderEntries.map((entry) => entry.renderLayer)),
	]
		.sort((left, right) => left - right)
		.map((renderLayer) => ({
			renderEntryIds: renderEntries
				.filter((entry) => entry.renderLayer === renderLayer)
				.map((entry) => entry.renderEntryId),
			renderLayer,
		}));
	return {
		kind: "direct-env-cell",
		layeredGraph: {
			apertureResources: options.apertureResources ?? [],
			baseEntry,
			diagnostics: options.diagnostics ?? emptyPortalApertureDiagnostics(),
			maskEdges: (options.edges ?? []).map((edge) => {
				const childNode = nodes.find(
					(node) => node.nodeId === edge.childNodeId,
				);
				if (!childNode || childNode.scene.kind !== "env-cell-direct") {
					throw new Error(
						"Direct env-cell fixture edge references missing child.",
					);
				}
				return {
					apertureRangeId: edge.apertureRangeId,
					apertureSourceId: edge.apertureSourceId,
					edgeId: edge.edgeId,
					linkId: edge.linkId,
					renderEntryId: renderEntryIdByNodeId.get(edge.childNodeId) ?? 0,
					renderLayer: childNode.traversalDepth,
					sourceEnvCellId:
						edge.sourceKind === "building-transition"
							? null
							: getFixtureSourceEnvCellId(nodes, edge.parentNodeId),
					sourceKind: edge.sourceKind,
					targetEnvCellId: childNode.scene.envCellId,
				};
			}),
			outdoorCrossings: options.outdoorCrossings ?? [],
			projectionDiagnostics: {
				componentCount: renderEntries.length,
				componentInternalEdgeCount: 0,
				cyclicComponentCount: 0,
				maskEdgesSkippedByLayerCap: 0,
				maskEdgesSkippedByMaxMaskEdges: 0,
				maxProjectionRenderLayer: Math.max(
					0,
					...renderEntries.map((entry) => entry.renderLayer),
				),
				maxSelectedRenderLayer: Math.max(
					0,
					...renderEntries.map((entry) => entry.renderLayer),
				),
				missingResourceMembershipCount: renderEntries.filter(
					(entry) => entry.resources.resourceState !== "ready",
				).length,
				outdoorCrossingCount: options.outdoorCrossings?.length ?? 0,
				outdoorCrossingsSkippedByLayerCap: 0,
				outdoorCrossingsSkippedByUnselectedTarget: 0,
				projectedEnvCellCount: renderEntries.length,
				renderEntriesSkippedByLayerCap: 0,
				renderEntriesSkippedByMaxRenderEntries: 0,
				renderEntryCount: renderEntries.length,
			},
			renderEntries,
			renderLayers,
		},
		...(options.exteriorComposite
			? { exteriorComposite: options.exteriorComposite }
			: {}),
		mode: "portal-projection",
	};
}

type DirectEnvCellFixtureApertureResource = Extract<
	PortalFrameWorkPlan,
	{ readonly kind: "direct-env-cell" }
>["layeredGraph"]["apertureResources"][number];

interface DirectEnvCellFixtureEdge {
	readonly apertureRangeId: string;
	readonly apertureSourceId: string;
	readonly childNodeId: number;
	readonly edgeId: number;
	readonly linkId: string;
	readonly parentNodeId: number;
	readonly sourceKind: "building-transition" | "env-cell-portal";
}

interface DirectEnvCellFixtureNode {
	readonly debugStackLabel: string;
	readonly incomingEdgeIds: readonly number[];
	readonly nodeId: number;
	readonly parentNodeId: number | null;
	readonly resources: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["layeredGraph"]["renderEntries"][number]["resources"];
	readonly scene:
		| { readonly kind: "outdoor-target"; readonly landblockId: number }
		| {
				readonly kind: "env-cell-direct";
				readonly landblockId: number;
				readonly envCellId: number;
		  };
	readonly traversalDepth: number;
}

function getFixtureSourceEnvCellId(
	nodes: readonly DirectEnvCellFixtureNode[],
	nodeId: number,
): number | null {
	const node = nodes.find((candidate) => candidate.nodeId === nodeId);
	return node?.scene.kind === "env-cell-direct" ? node.scene.envCellId : null;
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
		SCISSOR_TEST: 3089,
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

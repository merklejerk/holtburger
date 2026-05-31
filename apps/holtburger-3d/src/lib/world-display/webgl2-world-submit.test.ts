import { describe, expect, it } from "vitest";

import type { StagedWorldFrame } from "./staged-world-frame";
import {
	partitionWebgl2SceneDomainDrawUnits,
	planWebgl2FlatWorldSubmitOrder,
	planWebgl2PortalMaskSubmitOrder,
	submitWebgl2FlatWorldDrawUnits,
	submitWebgl2FlatWorldFrame,
	type Webgl2FlatWorldProgram,
	type Webgl2IndexedP16WorldProgram,
	type Webgl2IndexedP8WorldProgram,
	type Webgl2TerrainBlendWorldProgram,
} from "./webgl2-world-submit";
import type { Webgl2AtlasStaticBatchResource } from "./webgl2-atlas-static-batches";
import type { Webgl2AtlasStaticGenerationResource } from "./webgl2-atlas-static-generation";
import type { Webgl2AtlasStaticWorldProgram } from "./webgl2-atlas-static-submit";
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

	it("replaces compacted static draw units through the default atlas submit path", () => {
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
			atlasStaticProgram: createAtlasStaticProgram(),
			atlasStaticResources: {
				batches: [createAtlasStaticBatch(["atlas"])],
				generation: createAtlasStaticGeneration(),
			},
			drawUnitsById,
			frame: createFrame(["atlas", "staged"]),
		});

		expect(metrics.visibleDrawUnitCount).toBe(2);
		expect(metrics.drawCallCount).toBe(2);
		expect(metrics.triangleCount).toBe(2);
		expect(metrics.atlasStaticReplacedDrawUnitCount).toBe(1);
		expect(metrics.atlasStaticRetainedDrawUnitCount).toBe(1);
		expect(metrics.atlasStaticShaderDrawCallCount).toBe(1);
		expect(metrics.atlasStaticSubmitFallbackSamples).toEqual([]);
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
});

function createFrame(drawUnitIds: readonly string[]): StagedWorldFrame {
	return {
		viewProjectionMatrix: createIdentityMat4(),
		passes: [
			{
				id: "world",
				draws: drawUnitIds.map((drawUnitId) => ({
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

function createDrawUnit({
	id,
	materialKey = "mat-a",
	materialKind = "flat",
	geometrySignature = "geo-a",
	color = new Float32Array([1, 0, 0, 1]),
	texture = null,
	indexedMaterial = null,
	terrainBlend = null,
	vertexArray = {} as WebGLVertexArrayObject,
	kind = "static",
	sceneDomain,
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
	vertexArray?: WebGLVertexArrayObject;
}): Webgl2WorldDrawUnit {
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
			vertexArray,
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
		materialBehavior: null,
		textureSamplingPolicy: null,
		textureUploadSample: null,
		atlasEligibility: null,
		atlasCandidateSample: null,
		textureKey: null,
		texture,
		indexedMaterial,
		detailOverlay: null,
		terrainBlend,
		sceneDomain: sceneDomain ?? defaultSceneDomainForKind(kind),
		modelMatrix: createIdentityMat4(),
		bvhItemKeys: [],
		bvhFallbackReason: null,
		staticPartCount: 1,
		staticObjectKeys: [id],
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

function createAtlasStaticProgram(): Webgl2AtlasStaticWorldProgram {
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
			uMaterialRects: {} as WebGLUniformLocation,
		},
		dispose() {
			return;
		},
	};
}

function createAtlasStaticBatch(
	drawUnitIds: readonly string[],
): Webgl2AtlasStaticBatchResource {
	return {
		key: "atlas-batch",
		landblockId: 0x0102ffff,
		vertexArray: {
			vertexArray: {} as WebGLVertexArrayObject,
			dispose() {
				return;
			},
		},
		positionBuffer: null as never,
		uvBuffer: null as never,
		materialSlotBuffer: null as never,
		indexBuffer: null as never,
		indexType: 5123,
		materialSlots: [
			{
				key: "material-slot",
				index: 0,
				atlasTextureIndex: 0,
				atlasRect: [0, 0, 1, 1],
				renderStateKey: "opaque",
				samplingKey: "sampling",
			},
		],
		batchModelMatrix: createIdentityMat4(),
		drawSlices: [
			{
				key: "slice",
				atlasTextureIndex: 0,
				renderStateKey: "opaque",
				firstIndex: 0,
				indexCount: 3,
				drawUnitIds,
				materialSlotKeys: ["material-slot"],
			},
		],
		vertexCount: 3,
		indexCount: 3,
		triangleCount: 1,
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

function createAtlasStaticGeneration(): Webgl2AtlasStaticGenerationResource {
	return {
		key: "generation",
		textures: [
			{
				key: "texture",
				textureIndex: 0,
				texture: {
					texture: {} as WebGLTexture,
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
		preparedTextureAssetIds: [],
		compactableDrawUnitIds: [],
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

	asContext(): WebGL2RenderingContext {
		return this as unknown as WebGL2RenderingContext;
	}

	useProgram(): void {
		this.calls.push("useProgram");
	}

	bindVertexArray(): void {
		this.calls.push("bindVertexArray");
	}

	activeTexture(): void {
		this.calls.push("activeTexture");
	}

	bindTexture(): void {
		this.calls.push("bindTexture");
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

	uniform2f(): void {
		this.calls.push("uniform2f");
	}

	uniform1i(): void {
		this.calls.push("uniform1i");
	}

	drawElements(
		mode: GLenum,
		count: number,
		type: GLenum,
		offset: number,
	): void {
		this.calls.push(`drawElements:${mode}:${count}:${type}:${offset}`);
	}
}

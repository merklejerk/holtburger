import { describe, expect, it } from "vitest";

import type { StagedWorldFrame } from "./staged-world-frame";
import {
	planWebgl2FlatWorldSubmitOrder,
	submitWebgl2FlatWorldFrame,
	type Webgl2FlatWorldProgram,
	type Webgl2IndexedP16WorldProgram,
	type Webgl2IndexedP8WorldProgram,
	type Webgl2TerrainBlendWorldProgram,
} from "./webgl2-world-submit";
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
	vertexArray = {} as WebGLVertexArrayObject,
}: {
	id: string;
	materialKey?: string;
	materialKind?: Webgl2WorldDrawUnit["materialKind"];
	geometrySignature?: string;
	color?: Float32Array;
	texture?: Webgl2WorldDrawUnit["texture"];
	indexedMaterial?: Webgl2WorldDrawUnit["indexedMaterial"];
	vertexArray?: WebGLVertexArrayObject;
}): Webgl2WorldDrawUnit {
	return {
		id,
		kind: "static",
		geometrySignature,
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
		terrainBlend: null,
		modelMatrix: createIdentityMat4(),
		bvhItemKeys: [],
		bvhFallbackReason: null,
		staticPartCount: 1,
		staticObjectKeys: [id],
	};
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

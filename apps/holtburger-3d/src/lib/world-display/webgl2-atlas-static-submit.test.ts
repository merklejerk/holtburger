import { describe, expect, it } from "vitest";

import {
	WEBGL2_ATLAS_STATIC_MAX_TRANSFORMS,
	planWebgl2AtlasStaticReplacement,
	submitWebgl2AtlasStaticBatch,
	type Webgl2AtlasStaticWorldProgram,
} from "./webgl2-atlas-static-submit";
import type { Webgl2AtlasStaticBatchResource } from "./webgl2-atlas-static-batches";
import type { Webgl2AtlasStaticGenerationResource } from "./webgl2-atlas-static-generation";
import { Webgl2StateCache } from "./webgl2-state-cache";

describe("planWebgl2AtlasStaticReplacement", () => {
	it("keeps staged draws when atlas resources are missing", () => {
		const plan = planWebgl2AtlasStaticReplacement({
			visibleDrawUnitIds: ["draw-a"],
			resources: {
				batch: null,
				generation: null,
			},
		});

		expect([...plan.replaceableDrawUnitIds]).toEqual([]);
		expect(plan.fallbackSamples).toEqual([
			"atlas static submit missing atlas generation",
		]);
	});

	it("selects visible compacted draw units when resources are ready", () => {
		const plan = planWebgl2AtlasStaticReplacement({
			visibleDrawUnitIds: ["draw-a", "staged-only"],
			resources: {
				batch: createBatch(["draw-a", "draw-b"]),
				generation: createGeneration(),
			},
		});

		expect([...plan.replaceableDrawUnitIds]).toEqual(["draw-a"]);
		expect(plan.fallbackSamples).toEqual([]);
	});

	it("falls back when the transform table exceeds the bounded shader path", () => {
		const plan = planWebgl2AtlasStaticReplacement({
			visibleDrawUnitIds: ["draw-a"],
			resources: {
				batch: {
					...createBatch(["draw-a"]),
					transformTable: Array.from(
						{ length: WEBGL2_ATLAS_STATIC_MAX_TRANSFORMS + 1 },
						() => new Float32Array(16),
					),
				},
				generation: createGeneration(),
			},
		});

		expect([...plan.replaceableDrawUnitIds]).toEqual([]);
		expect(plan.fallbackSamples[0]).toContain("transforms");
	});

	it("submits visible compacted draw slices with atlas texture and table uniforms", () => {
		const gl = new FakeAtlasSubmitGl();
		const batch = createBatch(["draw-a"]);
		const generation = createGeneration();

		const metrics = submitWebgl2AtlasStaticBatch({
			gl: gl.asContext(),
			stateCache: new Webgl2StateCache(gl),
			program: createProgram(),
			viewProjectionMatrix: new Float32Array(16),
			resources: { batch, generation },
			replaceableDrawUnitIds: new Set(["draw-a"]),
			retainedDrawUnitCount: 3,
		});

		expect(metrics).toMatchObject({
			shaderDrawCallCount: 1,
			submittedDrawSliceCount: 1,
			submittedTriangleCount: 1,
			replacedDrawUnitCount: 1,
			retainedDrawUnitCount: 3,
		});
		expect(gl.calls).toContain("useProgram");
		expect(gl.calls).toContain("bindVertexArray");
		expect(gl.calls).toContain("bindTexture");
		expect(gl.calls).toContain("drawElements:4:3:5123:0");
		expect(gl.uniform4fvLengths).toEqual([128 * 4]);
		expect(gl.uniformMatrix4fvLengths).toEqual([16, 128 * 16]);
	});
});

function createBatch(
	drawUnitIds: readonly string[],
): Webgl2AtlasStaticBatchResource {
	return {
		key: "batch",
		vertexArray: {
			vertexArray: {} as WebGLVertexArrayObject,
			dispose() {
				return;
			},
		},
		positionBuffer: null as never,
		uvBuffer: null as never,
		materialSlotBuffer: null as never,
		transformSlotBuffer: null as never,
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
		transformTable: [new Float32Array(16)],
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
		transformSlotByteLength: 12,
		indexByteLength: 6,
		totalByteLength: 90,
		dispose() {
			return;
		},
	};
}

function createGeneration(): Webgl2AtlasStaticGenerationResource {
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

function createProgram(): Webgl2AtlasStaticWorldProgram {
	return {
		program: {} as WebGLProgram,
		attributes: {
			position: 0,
			uv: 1,
			materialSlot: 2,
			transformSlot: 3,
		},
		uniforms: {
			uViewProjection: {} as WebGLUniformLocation,
			uAtlasTexture: {} as WebGLUniformLocation,
			uAtlasSize: {} as WebGLUniformLocation,
			uMaterialRects: {} as WebGLUniformLocation,
			uTransforms: {} as WebGLUniformLocation,
		},
		dispose() {
			return;
		},
	};
}

class FakeAtlasSubmitGl {
	readonly TEXTURE0 = 33984;
	readonly TEXTURE_2D = 3553;
	readonly TRIANGLES = 4;
	readonly UNSIGNED_SHORT = 5123;
	readonly UNSIGNED_INT = 5125;
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
	readonly calls: string[] = [];
	readonly uniform4fvLengths: number[] = [];
	readonly uniformMatrix4fvLengths: number[] = [];

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

	uniform1i(): void {
		this.calls.push("uniform1i");
	}

	uniform2f(): void {
		this.calls.push("uniform2f");
	}

	uniform4fv(_location: WebGLUniformLocation, value: Float32Array): void {
		this.uniform4fvLengths.push(value.length);
	}

	uniformMatrix4fv(
		_location: WebGLUniformLocation,
		_transpose: boolean,
		value: Float32Array,
	): void {
		this.uniformMatrix4fvLengths.push(value.length);
	}

	drawElements(
		mode: GLenum,
		count: number,
		type: GLenum,
		offset: number,
	): void {
		this.calls.push(`drawElements:${mode}:${count}:${type}:${offset}`);
	}

	enable(): void {
		return;
	}

	disable(): void {
		return;
	}

	depthMask(): void {
		return;
	}

	depthFunc(): void {
		return;
	}

	blendFuncSeparate(): void {
		return;
	}

	blendEquationSeparate(): void {
		return;
	}

	cullFace(): void {
		return;
	}

	stencilMask(): void {
		return;
	}

	stencilFunc(): void {
		return;
	}

	stencilOp(): void {
		return;
	}

	viewport(): void {
		return;
	}

	bindFramebuffer(): void {
		return;
	}
}

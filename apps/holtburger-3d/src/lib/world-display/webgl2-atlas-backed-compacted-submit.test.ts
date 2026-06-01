import { describe, expect, it } from "vitest";

import {
	WEBGL2_ATLAS_BACKED_COMPACTED_MAX_MATERIAL_SLOTS,
	planWebgl2AtlasBackedCompactedReplacement,
	submitWebgl2AtlasBackedCompactedBatch,
	type Webgl2AtlasBackedCompactedWorldProgram,
} from "./webgl2-atlas-backed-compacted-submit";
import type { Webgl2AtlasBackedCompactedBatchResource } from "./webgl2-atlas-backed-compacted-batches";
import type { Webgl2TextureAtlasGenerationResource } from "./webgl2-texture-atlas-generation";
import { Webgl2StateCache } from "./webgl2-state-cache";

describe("planWebgl2AtlasBackedCompactedReplacement", () => {
	it("keeps staged draws when atlas resources are missing", () => {
		const plan = planWebgl2AtlasBackedCompactedReplacement({
			visibleDrawUnitIds: ["draw-a"],
			resources: {
				batches: [],
				generation: null,
			},
		});

		expect([...plan.replaceableDrawUnitIds]).toEqual([]);
		expect(plan.noVisibleRouteCount).toBe(0);
		expect(plan.fallbackSamples).toEqual([
			"atlas-backed compacted submit missing atlas generation",
		]);
	});

	it("selects visible compacted draw units when resources are ready", () => {
		const plan = planWebgl2AtlasBackedCompactedReplacement({
			visibleDrawUnitIds: ["draw-a", "staged-only"],
			resources: {
				batches: [createBatch(["draw-a", "draw-b"])],
				generation: createGeneration(),
			},
		});

		expect([...plan.replaceableDrawUnitIds]).toEqual(["draw-a"]);
		expect(plan.noVisibleRouteCount).toBe(0);
		expect(plan.fallbackSamples).toEqual([]);
	});

	it("counts no-visible route checks without reporting a fallback", () => {
		const plan = planWebgl2AtlasBackedCompactedReplacement({
			visibleDrawUnitIds: ["staged-only"],
			resources: {
				batches: [createBatch(["draw-a"])],
				generation: createGeneration(),
			},
		});

		expect([...plan.replaceableDrawUnitIds]).toEqual([]);
		expect(plan.noVisibleRouteCount).toBe(1);
		expect(plan.fallbackSamples).toEqual([]);
	});

	it("selects visible draw units from landblock-scoped batches", () => {
		const plan = planWebgl2AtlasBackedCompactedReplacement({
			visibleDrawUnitIds: ["landblock-a"],
			resources: {
				batches: [
					createBatch(["landblock-a"], 0x0102ffff),
					createBatch(["landblock-b"], 0x0103ffff),
				],
				generation: createGeneration(),
			},
		});

		expect([...plan.replaceableDrawUnitIds]).toEqual(["landblock-a"]);
		expect(plan.noVisibleRouteCount).toBe(1);
		expect(plan.fallbackSamples).toEqual([]);
	});

	it("falls back when material slots exceed the bounded shader path", () => {
		const plan = planWebgl2AtlasBackedCompactedReplacement({
			visibleDrawUnitIds: ["draw-a"],
			resources: {
				batches: [
					{
						...createBatch(["draw-a"]),
						materialSlots: Array.from(
							{ length: WEBGL2_ATLAS_BACKED_COMPACTED_MAX_MATERIAL_SLOTS + 1 },
							(_, index) => ({
								key: `material-slot-${index}`,
								index,
								atlasTextureIndex: 0,
								atlasRect: [0, 0, 1, 1],
								detailAtlasTextureIndex: null,
								detailAtlasRect: [0, 0, 1, 1],
								detailTiling: 1,
								renderStateKey: "opaque",
								samplingKey: "sampling",
								wrapS: "clamp",
								wrapT: "clamp",
							}),
						),
					},
				],
				generation: createGeneration(),
			},
		});

		expect([...plan.replaceableDrawUnitIds]).toEqual([]);
		expect(plan.noVisibleRouteCount).toBe(0);
		expect(plan.fallbackSamples[0]).toContain("material slots");
	});

	it("submits visible compacted draw slices with atlas texture and table uniforms", () => {
		const gl = new FakeAtlasSubmitGl();
		const batch = createBatch(["draw-a"]);
		const generation = createGeneration();

		const metrics = submitWebgl2AtlasBackedCompactedBatch({
			gl: gl.asContext(),
			stateCache: new Webgl2StateCache(gl),
			program: createProgram(),
			viewProjectionMatrix: new Float32Array(16),
			resources: { batches: [batch], generation },
			replaceableDrawUnitIds: new Set(["draw-a"]),
			retainedDrawUnitCount: 3,
		});

		expect(metrics).toMatchObject({
			shaderDrawCallCount: 1,
			submittedDrawSliceCount: 1,
			submittedTriangleCount: 1,
			submittedSliceRepresentedDrawUnitCount: 1,
			replacedDrawUnitCount: 1,
			retainedDrawUnitCount: 3,
		});
		expect(gl.calls).toContain("useProgram");
		expect(gl.calls).toContain("bindVertexArray");
		expect(gl.calls).toContain("bindTexture");
		expect(gl.calls).toContain("drawElements:4:3:5123:0");
		expect(gl.uniform4fvLengths).toEqual([128 * 4, 128 * 4]);
		expect(gl.uniform1fvLengths).toEqual([128]);
		expect(gl.uniform1ivLengths).toEqual([128]);
		expect(gl.uniform2ivLengths).toEqual([128 * 2]);
		expect(gl.uniformMatrix4fvLengths).toEqual([16, 16]);
	});

	it("binds a detail atlas page when the visible compacted slice requires detail", () => {
		const gl = new FakeAtlasSubmitGl();
		const batch = createBatch(["draw-a"], 0x0102ffff, {
			detailAtlasTextureIndex: 0,
		});

		const metrics = submitWebgl2AtlasBackedCompactedBatch({
			gl: gl.asContext(),
			stateCache: new Webgl2StateCache(gl),
			program: createProgram(),
			viewProjectionMatrix: new Float32Array(16),
			resources: { batches: [batch], generation: createGeneration({ detail: true }) },
			replaceableDrawUnitIds: new Set(["draw-a"]),
			retainedDrawUnitCount: 0,
		});

		expect(metrics.fallbackSamples).toEqual([]);
		expect(metrics.shaderDrawCallCount).toBe(1);
		expect(gl.calls.filter((call) => call === "bindTexture")).toHaveLength(2);
		expect(gl.uniform1ivLengths).toEqual([128]);
	});
});

function createBatch(
	drawUnitIds: readonly string[],
	landblockId = 0x0102ffff,
	options: { detailAtlasTextureIndex?: number | null } = {},
): Webgl2AtlasBackedCompactedBatchResource {
	return {
		key: "batch",
		landblockId,
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
				detailAtlasTextureIndex: options.detailAtlasTextureIndex ?? null,
				detailAtlasRect: [0, 0, 1, 1],
				detailTiling: 8,
				renderStateKey: "opaque",
				samplingKey: "sampling",
				wrapS: "repeat",
				wrapT: "clamp",
			},
		],
		batchModelMatrix: new Float32Array(16),
		drawSlices: [
			{
				key: "slice",
				atlasTextureIndex: 0,
				detailAtlasTextureIndex: options.detailAtlasTextureIndex ?? null,
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

function createGeneration(
	options: { detail?: boolean } = {},
): Webgl2TextureAtlasGenerationResource {
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
		placements: [],
		detailTextures: options.detail
			? [
					{
						key: "detail-texture",
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
				]
			: [],
		detailPlacements: [],
		preparedTextureAssetIds: [],
		compactableDrawUnitIds: [],
		dispose() {
			return;
		},
	};
}

function createProgram(): Webgl2AtlasBackedCompactedWorldProgram {
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
			uDetailMaterialRects: {} as WebGLUniformLocation,
			uDetailMaterialTilings: {} as WebGLUniformLocation,
			uDetailMaterialEnabled: {} as WebGLUniformLocation,
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
	readonly uniform1fvLengths: number[] = [];
	readonly uniform1ivLengths: number[] = [];
	readonly uniform2ivLengths: number[] = [];
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

	uniform1fv(_location: WebGLUniformLocation, value: Float32Array): void {
		this.uniform1fvLengths.push(value.length);
	}

	uniform1iv(_location: WebGLUniformLocation, value: Int32Array): void {
		this.uniform1ivLengths.push(value.length);
	}

	uniform2iv(_location: WebGLUniformLocation, value: Int32Array): void {
		this.uniform2ivLengths.push(value.length);
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

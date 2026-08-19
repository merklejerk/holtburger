import { acVector3, renderVector3 } from "../../assets/ac-frame";
import { describe, expect, it, vi } from "vitest";
import type { DatAssetId } from "../game-types";
import type { ParticleDrawBatch } from "./particle-render-routing";
import { PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES } from "./portal-propagation-metadata";
import {
	WebGL2ParticlePass,
	type ParticleDrawGeometry,
} from "./webgl2-particle-pass";
import { createParticleFragmentShader } from "./webgl2-particle-program";

import { TextureWrapMode } from "../textures/types";
import type { WebGL2TextureSamplerCatalog } from "./webgl2-texture-sampler-catalog";

const MESH = "0x01000ff4" as DatAssetId;

function batch(
	motionType: number,
	particleCount: number,
	hwGfxObjId: DatAssetId = MESH,
): ParticleDrawBatch {
	return {
		hwGfxObjId,
		motionType,
		particles: Array.from({ length: particleCount }, () => ({
			a: acVector3([1, 0, 0]),
			b: acVector3([0, 0, 0]),
			birthTime: 0,
			c: acVector3([0, 0, 0]),
			finalScale: 1,
			finalTranslucency: 1,
			lifespan: 4,
			offset: acVector3([0, 0, 0]),
			origin: renderVector3([0, 0, 0]),
			startScale: 1,
			startTranslucency: 0,
		})),
	};
}

const GEOMETRY: ParticleDrawGeometry = {
	alphaTest: 0,
	baseMipLevels: 2,
	baseTexture: {} as WebGLTexture,
	indexCount: 6,
	indexOffsetBytes: 0,
	lockedAxis: renderVector3([0, 0, 1]),
	materialColor: null,
	// 1 is direct colour in the encoding now shared with the object program.
	materialKind: 1,
	orientation: 1,
	paletteTexture: null,
	palettedClipMap: false,
	rawSurfaceFlags: 0,
	vertexArray: {} as WebGLVertexArrayObject,
	wrap: TextureWrapMode.Clamp,
};

function fakeGl() {
	const draws: number[] = [];
	const blendFuncs: Array<[number, number]> = [];
	const intUniforms: Array<[string, number]> = [];
	const samplerBinds: Array<{
		readonly unit: number;
		readonly request: unknown;
	}> = [];
	const texSubImage2D = vi.fn();
	const gl = {
		ARRAY_BUFFER: 1,
		BLEND: 2,
		COMPILE_STATUS: 3,
		DEPTH_TEST: 4,
		DYNAMIC_DRAW: 5,
		FLOAT: 6,
		FRAGMENT_SHADER: 7,
		INVALID_INDEX: 0xffff_ffff,
		LINK_STATUS: 8,
		TEXTURE0: 9,
		TEXTURE1: 10,
		TEXTURE_2D: 11,
		TEXTURE_MIN_FILTER: 19,
		TEXTURE_MAG_FILTER: 20,
		TEXTURE_WRAP_S: 21,
		TEXTURE_WRAP_T: 22,
		NEAREST: 23,
		CLAMP_TO_EDGE: 24,
		RGBA: 25,
		RGBA32F: 26,
		TRIANGLES: 12,
		UNSIGNED_INT: 13,
		UNIFORM_BLOCK_DATA_SIZE: 18,
		VERTEX_SHADER: 14,
		ONE: 15,
		ONE_MINUS_SRC_ALPHA: 16,
		SRC_ALPHA: 17,
		activeTexture: () => undefined,
		attachShader: () => undefined,
		bindBuffer: () => undefined,
		bindTexture: () => undefined,
		bindVertexArray: () => undefined,
		blendFunc: (source: number, destination: number) =>
			blendFuncs.push([source, destination]),
		bufferData: () => undefined,
		bufferSubData: () => undefined,
		compileShader: () => undefined,
		createBuffer: () => ({}) as WebGLBuffer,
		createTexture: () => ({}) as WebGLTexture,
		createProgram: () => ({}) as WebGLProgram,
		createShader: () => ({}) as WebGLShader,
		deleteBuffer: () => undefined,
		deleteTexture: () => undefined,
		deleteProgram: () => undefined,
		deleteShader: () => undefined,
		depthMask: () => undefined,
		disable: () => undefined,
		drawElementsInstanced: (
			_mode: number,
			_count: number,
			_type: number,
			_offset: number,
			instanceCount: number,
		) => draws.push(instanceCount),
		enable: () => undefined,
		enableVertexAttribArray: () => undefined,
		getProgramInfoLog: () => "",
		getProgramParameter: () => true,
		getShaderInfoLog: () => "",
		getShaderParameter: () => true,
		getUniformLocation: (_p: WebGLProgram, name: string) =>
			({ name }) as unknown as WebGLUniformLocation,
		getUniformBlockIndex: () => 0,
		getActiveUniformBlockParameter: () =>
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		linkProgram: () => undefined,
		shaderSource: () => undefined,
		texImage2D: () => undefined,
		texParameteri: () => undefined,
		texSubImage2D,
		uniform1f: () => undefined,
		uniform1i: (location: { name: string }, value: number) =>
			intUniforms.push([location.name, value]),
		uniform1ui: () => undefined,
		uniform3f: () => undefined,
		uniform4f: () => undefined,
		uniformMatrix4fv: () => undefined,
		useProgram: () => undefined,
		uniformBlockBinding: () => undefined,
		vertexAttribDivisor: () => undefined,
		vertexAttribPointer: () => undefined,
	} as unknown as WebGL2RenderingContext;
	const samplers = {
		bind: (unit: number, request: unknown) => {
			samplerBinds.push({ request, unit });
		},
	} as unknown as WebGL2TextureSamplerCatalog;
	return {
		calls: { blendFuncs, texSubImage2D },
		draws,
		gl,
		intUniforms,
		samplerBinds,
		samplers,
	};
}

const context = (
	gl: WebGL2RenderingContext,
	samplers?: WebGL2TextureSamplerCatalog,
) => ({
	cameraPosition: renderVector3([0, 0, 0]),
	clockSeconds: 1,
	gl,
	projection: new Float32Array(16),
	samplers:
		samplers ??
		({
			bind: () => undefined,
		} as unknown as WebGL2TextureSamplerCatalog),
	textureFiltering: "linear" as const,
	view: new Float32Array(16),
});

describe("WebGL2ParticlePass", () => {
	it("draws one instanced call per batch", () => {
		const { calls, draws, gl } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl), [batch(2, 3), batch(5, 7)]);

		// One call per batch regardless of particle count; retail's per-part ceiling is not inherited.
		expect(draws).toEqual([3, 7]);
		expect(calls.texSubImage2D).toHaveBeenCalledTimes(1);
		expect(pass.getDiagnostics()).toMatchObject({
			drawnBatchCount: 2,
			drawnParticleCount: 10,
		});
	});

	it("binds motion type as a per-batch constant", () => {
		const { gl, intUniforms } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl), [batch(6, 1)]);

		expect(intUniforms).toContainEqual(["uMotionType", 6]);
		expect(intUniforms).toContainEqual(["uOrientation", 1]);
	});

	it("routes scoped batches without splitting their one frame upload", () => {
		const { calls, draws, gl } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);
		const routedScopes: string[] = [];

		pass.drawScoped(
			context(gl),
			new Map([
				["outdoor", [batch(2, 3)]],
				["env-cell:0101/01010001", [batch(5, 7)]],
			]),
			{
				routeDeferredSubmission: (renderScopeKey) =>
					routedScopes.push(renderScopeKey),
			},
		);

		expect(draws).toEqual([3, 7]);
		expect(routedScopes).toEqual(["outdoor", "env-cell:0101/01010001"]);
		expect(calls.texSubImage2D).toHaveBeenCalledTimes(1);
	});

	it("rejects portal-hidden fragments before particle material sampling", () => {
		const shader = createParticleFragmentShader(true);
		const visibilityIndex = shader.indexOf(
			"if (!portalDeferredFragmentVisible()) discard;",
		);

		expect(shader).toContain("uniform uint uPortalRenderDomain");
		expect(shader).toContain("uniform highp sampler2D uPortalEnvelopeDepth;");
		expect(visibilityIndex).toBeGreaterThanOrEqual(0);
		expect(visibilityIndex).toBeLessThan(
			shader.indexOf("vec4 color = sampleMaterial()"),
		);
	});

	it("selects a blend mode per batch instead of inheriting one", () => {
		const { calls, gl } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl), [batch(2, 1)]);

		// Enabling BLEND without a func leaves whatever the previous pass bound, which renders
		// particles opaque over their own black backing.
		expect(calls.blendFuncs).toHaveLength(1);
	});

	it("counts a batch whose mesh is not resident instead of dropping it silently", () => {
		const { draws, gl } = fakeGl();
		const pass = new WebGL2ParticlePass(() => null);

		pass.draw(context(gl), [batch(2, 4)]);

		expect(draws).toEqual([]);
		expect(pass.getDiagnostics().unresolvedBatchCount).toBe(1);
	});

	it("does not create a program for an empty frame", () => {
		const { gl } = fakeGl();
		const createProgram = vi.spyOn(gl, "createProgram");
		const createTexture = vi.spyOn(gl, "createTexture");
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl), []);
		pass.draw(context(gl), [batch(2, 0)]);

		// A scene with no live particles must cost nothing, including no lazy GPU allocation.
		expect(createProgram).not.toHaveBeenCalled();
		expect(createTexture).not.toHaveBeenCalled();
		expect(pass.getDiagnostics().drawnBatchCount).toBe(0);
	});

	it("binds samplers with the configured policy for base and palette units", () => {
		const { gl, samplerBinds, samplers } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl, samplers), [batch(2, 3)]);

		expect(samplerBinds).toEqual([
			{
				request: {
					mipLevels: 1,
					policy: "linear",
					samplingClass: "exact",
					wrap: TextureWrapMode.Clamp,
				},
				unit: 1,
			},
			{
				request: {
					mipLevels: 2,
					policy: "linear",
					samplingClass: "filterable",
					wrap: TextureWrapMode.Clamp,
				},
				unit: 0,
			},
		]);
	});
});

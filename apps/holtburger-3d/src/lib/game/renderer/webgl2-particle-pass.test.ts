import {
	landblockVector3,
	renderVector3,
	sceneVector3,
} from "../../assets/ac-frame";
import { describe, expect, it, vi } from "vitest";
import type { DatAssetId } from "../game-types";
import type { ParticleDrawRange } from "./particle-render-routing";
import { PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES } from "./portal-propagation-metadata";
import {
	WebGL2ParticlePass,
	type ParticleDrawGeometry,
} from "./webgl2-particle-pass";
import { createParticleFragmentShader } from "./webgl2-particle-program";

import { TextureWrapMode } from "../textures/types";
import type { WebGL2TextureSamplerCatalog } from "./webgl2-texture-sampler-catalog";
import { WebGL2DeviceStateApplicator } from "./webgl2-device-state-applicator";

const MESH = "0x01000ff4" as DatAssetId;
const RECORD_ORIGIN = { kind: "record" } as const;

let nextBaseSlot = 0;

/** One drawable slot range; slots are handed out ascending so ranges never overlap. */
function batch(
	motionType: number,
	particleCount: number,
	hwGfxObjId: DatAssetId = MESH,
	origin: ParticleDrawRange["origin"] = RECORD_ORIGIN,
): ParticleDrawRange {
	const baseSlot = nextBaseSlot;
	nextBaseSlot += particleCount;
	return {
		baseSlot,
		count: particleCount,
		hwGfxObjId,
		motionType,
		origin,
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
	const vec3Uniforms: Array<[string, number, number, number]> = [];
	const samplerBinds: Array<{
		readonly unit: number;
		readonly request: unknown;
	}> = [];
	const texImage2D = vi.fn();
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
		bindSampler: (unit: number, sampler: { request: unknown }) =>
			samplerBinds.push({ request: sampler.request, unit }),
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
		texImage2D,
		texParameteri: () => undefined,
		texSubImage2D,
		uniform1f: () => undefined,
		uniform1i: (location: { name: string }, value: number) =>
			intUniforms.push([location.name, value]),
		uniform1ui: () => undefined,
		uniform3f: (location: { name: string }, x: number, y: number, z: number) =>
			vec3Uniforms.push([location.name, x, y, z]),
		uniform4f: () => undefined,
		uniformMatrix4fv: () => undefined,
		useProgram: () => undefined,
		uniformBlockBinding: () => undefined,
		vertexAttribDivisor: () => undefined,
		vertexAttribPointer: () => undefined,
	} as unknown as WebGL2RenderingContext;
	const samplers = {
		getSampler: (request: unknown) => ({ request }) as unknown as WebGLSampler,
	} as unknown as WebGL2TextureSamplerCatalog;
	return {
		calls: { blendFuncs, texImage2D, texSubImage2D },
		draws,
		gl,
		intUniforms,
		samplerBinds,
		samplers,
		vec3Uniforms,
	};
}

const context = (
	gl: WebGL2RenderingContext,
	samplers?: WebGL2TextureSamplerCatalog,
) => ({
	anchorOrigin: sceneVector3([0, 0, 0]),
	cameraPosition: renderVector3([0, 0, 0]),
	records: { data: new Float32Array(4096), dirtySlots: null },
	clockSeconds: 1,
	gl,
	projection: new Float32Array(16),
	samplers:
		samplers ??
		({
			getSampler: () => ({}) as WebGLSampler,
		} as unknown as WebGL2TextureSamplerCatalog),
	state: new WebGL2DeviceStateApplicator(gl),
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
		expect(
			calls.texImage2D.mock.calls.length +
				calls.texSubImage2D.mock.calls.length,
		).toBe(1);
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

	it("filters repeated batch state while retaining the required slot-base write", () => {
		const { calls, gl, intUniforms } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl), [batch(2, 1), batch(2, 1)]);

		expect(calls.blendFuncs).toHaveLength(1);
		expect(intUniforms.filter(([name]) => name === "uMotionType")).toHaveLength(
			1,
		);
		expect(
			intUniforms.filter(([name]) => name === "uUsesRangeOrigin"),
		).toHaveLength(1);
		expect(
			intUniforms.filter(([name]) => name === "uInstanceBase"),
		).toHaveLength(2);
	});

	it("binds one split live origin for a parent-following range", () => {
		const { gl, intUniforms, vec3Uniforms } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl), [
			batch(2, 4, MESH, {
				kind: "range",
				landblockOrigin: sceneVector3([384, 0, -576]),
				localOrigin: landblockVector3([12, 7, 18]),
			}),
		]);

		expect(intUniforms).toContainEqual(["uUsesRangeOrigin", 1]);
		expect(vec3Uniforms).toContainEqual([
			"uRangeLandblockOrigin",
			384,
			0,
			-576,
		]);
		expect(vec3Uniforms).toContainEqual(["uRangeLocalOrigin", 12, 7, 18]);
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
		expect(
			calls.texImage2D.mock.calls.length +
				calls.texSubImage2D.mock.calls.length,
		).toBe(1);
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

	it("owns sampler state for every texture unit", () => {
		const { gl, samplerBinds, samplers } = fakeGl();
		const pass = new WebGL2ParticlePass(() => GEOMETRY);

		pass.draw(context(gl, samplers), [batch(2, 3)]);

		expect(samplerBinds.sort((left, right) => left.unit - right.unit)).toEqual([
			{
				request: {
					mipLevels: 2,
					policy: "linear",
					samplingClass: "filterable",
					wrap: TextureWrapMode.Clamp,
				},
				unit: 0,
			},
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
					mipLevels: 1,
					policy: "linear",
					samplingClass: "exact",
					wrap: TextureWrapMode.Clamp,
				},
				unit: 2,
			},
		]);
	});
});

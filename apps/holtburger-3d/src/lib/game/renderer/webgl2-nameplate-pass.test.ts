import { describe, expect, it } from "vitest";

import {
	WebGL2NameplatePass,
	type NameplateDrawInstance,
	type NameplateScopedDrawInstance,
} from "./webgl2-nameplate-pass";
import type { NameplateTextureBinding } from "./webgl2-nameplate-texture-cache";
import { PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES } from "./portal-propagation-metadata";
import { Vec3 } from "../math/types";

function binding(
	key: string,
	width: number,
	height: number,
): NameplateTextureBinding {
	return { height, texture: { key } as unknown as WebGLTexture, width };
}

function createFixture() {
	const draws: number[] = [];
	const uploadedFloatCounts: number[] = [];
	const anchorOffsets: number[] = [];
	const plateSizes: Array<readonly [number, number]> = [];
	const referenceDistances: number[] = [];
	const sampler = { key: "nameplate" } as unknown as WebGLSampler;
	const samplerBindings: Array<WebGLSampler | null> = [];
	const shaderSources: string[] = [];
	const deleted = { buffers: 0, programs: 0, vertexArrays: 0 };
	const gl = {
		ARRAY_BUFFER: 1,
		BLEND: 2,
		COMPILE_STATUS: 3,
		CULL_FACE: 4,
		DEPTH_TEST: 5,
		FLOAT: 6,
		FRAGMENT_SHADER: 7,
		LEQUAL: 8,
		LINK_STATUS: 9,
		INVALID_INDEX: 0xffff_ffff,
		ONE_MINUS_SRC_ALPHA: 10,
		SRC_ALPHA: 11,
		STATIC_DRAW: 12,
		STREAM_DRAW: 13,
		TEXTURE0: 14,
		TEXTURE_2D: 15,
		TRIANGLES: 16,
		UNIFORM_BLOCK_DATA_SIZE: 17,
		VERTEX_SHADER: 18,
		activeTexture: () => undefined,
		attachShader: () => undefined,
		bindBuffer: () => undefined,
		bindSampler: (_unit: number, binding: WebGLSampler | null) =>
			samplerBindings.push(binding),
		bindTexture: () => undefined,
		bindVertexArray: () => undefined,
		blendFunc: () => undefined,
		bufferData: (_target: number, data: BufferSource, usage: number) => {
			if (usage === 13) uploadedFloatCounts.push((data as Float32Array).length);
		},
		compileShader: () => undefined,
		createBuffer: () => ({}) as WebGLBuffer,
		createProgram: () => ({}) as WebGLProgram,
		createShader: () => ({}) as WebGLShader,
		createVertexArray: () => ({}) as WebGLVertexArrayObject,
		deleteBuffer: () => {
			deleted.buffers += 1;
		},
		deleteProgram: () => {
			deleted.programs += 1;
		},
		deleteShader: () => undefined,
		deleteVertexArray: () => {
			deleted.vertexArrays += 1;
		},
		depthFunc: () => undefined,
		depthMask: () => undefined,
		disable: () => undefined,
		drawArraysInstanced: (
			_mode: number,
			_first: number,
			_count: number,
			instanceCount: number,
		) => draws.push(instanceCount),
		enable: () => undefined,
		enableVertexAttribArray: () => undefined,
		getProgramInfoLog: () => "",
		getProgramParameter: () => true,
		getUniformBlockIndex: () => 0,
		getActiveUniformBlockParameter: () =>
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		getShaderInfoLog: () => "",
		getShaderParameter: () => true,
		getUniformLocation: (_program: WebGLProgram, name: string) =>
			({ name }) as unknown as WebGLUniformLocation,
		linkProgram: () => undefined,
		shaderSource: (_shader: WebGLShader, source: string) =>
			shaderSources.push(source),
		uniform1i: () => undefined,
		uniform1f: (location: { readonly name: string }, value: number) => {
			if (location.name === "uReferenceDistance")
				referenceDistances.push(value);
		},
		uniformBlockBinding: () => undefined,
		uniform2f: (
			location: { readonly name: string },
			first: number,
			second: number,
		) => {
			if (location.name === "uPlateSize") plateSizes.push([first, second]);
		},
		uniformMatrix4fv: () => undefined,
		useProgram: () => undefined,
		vertexAttribDivisor: () => undefined,
		vertexAttribPointer: (
			index: number,
			_size: number,
			_type: number,
			_normalized: boolean,
			_stride: number,
			offset: number,
		) => {
			if (index === 1) anchorOffsets.push(offset);
		},
	} as unknown as WebGL2RenderingContext;
	return {
		anchorOffsets,
		deleted,
		draws,
		gl,
		plateSizes,
		referenceDistances,
		sampler,
		samplerBindings,
		shaderSources,
		uploadedFloatCounts,
	};
}

const context = {
	clipFromAnchor: new Float32Array(16),
	referenceDistance: 6.25,
	viewportHeight: 720,
	viewportWidth: 1_280,
};

describe("WebGL2NameplatePass", () => {
	it("applies perspective scaling around the supplied reference distance", () => {
		const fixture = createFixture();

		const pass = new WebGL2NameplatePass(fixture.gl, fixture.sampler);

		const vertexSources = fixture.shaderSources.filter((source) =>
			source.includes("gl_Position"),
		);
		expect(vertexSources).toHaveLength(2);
		for (const source of vertexSources) {
			expect(source).toContain(
				"(pixelOffset * 2.0 / uViewportSize) * uReferenceDistance",
			);
			expect(source).not.toContain("uViewportSize) * clip.w");
		}
		pass.draw(context, [
			{ anchor: Vec3.zero(), binding: binding("plate", 64, 16) },
		]);
		expect(fixture.referenceDistances).toEqual([context.referenceDistance]);
	});

	it("uploads all anchors once and coalesces adjacent matching textures", () => {
		const fixture = createFixture();
		const pass = new WebGL2NameplatePass(fixture.gl, fixture.sampler);
		const drudge = binding("drudge", 128, 32);
		const instances: NameplateDrawInstance[] = [
			{
				anchor: new Vec3(1, 2, 3),
				binding: drudge,
			},
			{
				anchor: new Vec3(4, 5, 6),
				binding: drudge,
			},
			{
				anchor: new Vec3(7, 8, 9),
				binding: binding("town-crier", 96, 48),
			},
		];

		pass.draw(context, instances);

		expect(fixture.uploadedFloatCounts).toEqual([9]);
		expect(fixture.draws).toEqual([2, 1]);
		expect(fixture.anchorOffsets.slice(-2)).toEqual([
			0,
			6 * Float32Array.BYTES_PER_ELEMENT,
		]);
		expect(fixture.plateSizes).toEqual([
			[128, 32],
			[96, 48],
		]);
		expect(fixture.samplerBindings).toEqual([fixture.sampler, null]);
		expect(pass.diagnostics()).toEqual({ drawCount: 2, instanceCount: 3 });
	});

	it("does no upload or draw work for an empty submission", () => {
		const fixture = createFixture();
		const pass = new WebGL2NameplatePass(fixture.gl, fixture.sampler);

		pass.draw(context, []);

		expect(fixture.uploadedFloatCounts).toEqual([]);
		expect(fixture.draws).toEqual([]);
		expect(fixture.samplerBindings).toEqual([]);
		expect(pass.diagnostics()).toEqual({ drawCount: 0, instanceCount: 0 });
	});

	it("coalesces only adjacent instances sharing both texture and portal domain", () => {
		const fixture = createFixture();
		const pass = new WebGL2NameplatePass(fixture.gl, fixture.sampler);
		const drudge = binding("drudge", 128, 32);
		const instances: NameplateScopedDrawInstance[] = [
			{
				anchor: new Vec3(1, 2, 3),
				binding: drudge,
				renderScopeKey: "env:one",
			},
			{
				anchor: new Vec3(4, 5, 6),
				binding: drudge,
				renderScopeKey: "env:one",
			},
			{
				anchor: new Vec3(7, 8, 9),
				binding: drudge,
				renderScopeKey: "outdoor",
			},
		];
		const routed: string[] = [];

		pass.drawScoped(context, instances, {
			routeDeferredSubmission: (renderScopeKey) => routed.push(renderScopeKey),
		});

		expect(routed).toEqual(["env:one", "outdoor"]);
		expect(fixture.draws).toEqual([2, 1]);
		expect(pass.diagnostics()).toEqual({ drawCount: 2, instanceCount: 3 });
	});

	it("does not reorder separated matching textures to improve batching", () => {
		const fixture = createFixture();
		const pass = new WebGL2NameplatePass(fixture.gl, fixture.sampler);
		const drudge = binding("drudge", 128, 32);
		const townCrier = binding("town-crier", 96, 48);

		pass.draw(context, [
			{ anchor: new Vec3(1, 2, 3), binding: drudge },
			{ anchor: new Vec3(4, 5, 6), binding: townCrier },
			{ anchor: new Vec3(7, 8, 9), binding: drudge },
		]);

		expect(fixture.draws).toEqual([1, 1, 1]);
		expect(fixture.plateSizes).toEqual([
			[128, 32],
			[96, 48],
			[128, 32],
		]);
	});

	it("owns and releases its complete GPU resource set", () => {
		const fixture = createFixture();
		const pass = new WebGL2NameplatePass(fixture.gl, fixture.sampler);

		pass.destroy();
		pass.destroy();

		expect(fixture.deleted).toEqual({
			buffers: 2,
			programs: 2,
			vertexArrays: 1,
		});
		expect(() => pass.draw(context, [])).toThrow("Nameplate pass is destroyed");
	});
});

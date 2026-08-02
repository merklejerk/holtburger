import { describe, expect, it } from "vitest";
import { WebGL2ObjectStateApplicator } from "./webgl2-object-state-applicator";

describe("WebGL2ObjectStateApplicator", () => {
	it("skips repeated program, cull, blend, texture, sampler, active-unit, and VAO calls", () => {
		const fixture = createFixture();
		const state = new WebGL2ObjectStateApplicator(fixture.gl);
		const binding = { sampler: fixture.samplerA, texture: fixture.textureA };

		expect(state.applyProgram(fixture.programA)).toBe(true);
		state.applyCullFace("back");
		state.applyBlend({ destination: "one", source: "src-alpha" });
		expect(state.applyTextureUnit(0, binding)).toBe(true);
		state.applyVertexArray(fixture.vertexArrayA);
		expect(state.applyProgram(fixture.programA)).toBe(false);
		state.applyCullFace("back");
		state.applyBlend({ destination: "one", source: "src-alpha" });
		expect(state.applyTextureUnit(0, binding)).toBe(false);
		state.applyVertexArray(fixture.vertexArrayA);

		expect(fixture.calls).toEqual([
			"useProgram:a",
			"enable:1",
			"cullFace:2",
			"enable:5",
			"blendFunc:7:6",
			"activeTexture:10",
			"bindTexture:9:a",
			"bindSampler:0:a",
			"bindVertexArray:a",
		]);
	});

	it("applies texture-only and sampler-only changes without redundant active-unit calls", () => {
		const fixture = createFixture();
		const state = new WebGL2ObjectStateApplicator(fixture.gl);

		state.applyTextureUnit(1, {
			sampler: fixture.samplerA,
			texture: fixture.textureA,
		});
		expect(
			state.applyTextureUnit(1, {
				sampler: fixture.samplerB,
				texture: fixture.textureA,
			}),
		).toBe(false);
		expect(
			state.applyTextureUnit(1, {
				sampler: fixture.samplerB,
				texture: fixture.textureB,
			}),
		).toBe(true);

		expect(fixture.calls).toEqual([
			"activeTexture:11",
			"bindTexture:9:a",
			"bindSampler:1:a",
			"bindSampler:1:b",
			"bindTexture:9:b",
		]);
	});

	it("reapplies every required value after invalidation", () => {
		const fixture = createFixture();
		const state = new WebGL2ObjectStateApplicator(fixture.gl);
		const apply = () => {
			state.applyProgram(fixture.programA);
			state.applyCullFace("front");
			state.applyBlend(null);
			state.applyTextureUnit(2, {
				sampler: fixture.samplerA,
				texture: fixture.textureA,
			});
			state.applyVertexArray(fixture.vertexArrayA);
		};

		apply();
		state.invalidate();
		apply();

		expect(fixture.calls.slice(0, 8)).toEqual(fixture.calls.slice(8));
	});
});

function createFixture() {
	const calls: string[] = [];
	const identities = {
		programA: { name: "a" } as WebGLProgram,
		samplerA: { name: "a" } as WebGLSampler,
		samplerB: { name: "b" } as WebGLSampler,
		textureA: { name: "a" } as WebGLTexture,
		textureB: { name: "b" } as WebGLTexture,
		vertexArrayA: { name: "a" } as WebGLVertexArrayObject,
	};
	const named = (
		value: WebGLProgram | WebGLSampler | WebGLTexture | WebGLVertexArrayObject,
	) => (value as unknown as { readonly name: string }).name;
	const gl = {
		BACK: 2,
		BLEND: 5,
		CULL_FACE: 1,
		FRONT: 3,
		ONE: 6,
		ONE_MINUS_SRC_ALPHA: 8,
		SRC_ALPHA: 7,
		TEXTURE0: 10,
		TEXTURE_2D: 9,
		activeTexture: (unit: number) => calls.push(`activeTexture:${unit}`),
		bindSampler: (unit: number, sampler: WebGLSampler) =>
			calls.push(`bindSampler:${unit}:${named(sampler)}`),
		bindTexture: (target: number, texture: WebGLTexture) =>
			calls.push(`bindTexture:${target}:${named(texture)}`),
		bindVertexArray: (vertexArray: WebGLVertexArrayObject) =>
			calls.push(`bindVertexArray:${named(vertexArray)}`),
		blendFunc: (source: number, destination: number) =>
			calls.push(`blendFunc:${source}:${destination}`),
		cullFace: (face: number) => calls.push(`cullFace:${face}`),
		disable: (capability: number) => calls.push(`disable:${capability}`),
		enable: (capability: number) => calls.push(`enable:${capability}`),
		useProgram: (program: WebGLProgram) =>
			calls.push(`useProgram:${named(program)}`),
	} as unknown as WebGL2RenderingContext;
	return { calls, gl, ...identities };
}

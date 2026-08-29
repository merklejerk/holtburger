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

	it("tracks array textures on the shared active-unit selector", () => {
		const fixture = createFixture();
		const state = new WebGL2ObjectStateApplicator(fixture.gl);

		expect(state.applyTextureArrayUnit(7, fixture.textureA)).toBe(true);
		expect(state.applyTextureArrayUnit(7, fixture.textureA)).toBe(false);
		expect(
			state.applyTextureUnit(0, {
				sampler: fixture.samplerA,
				texture: fixture.textureB,
			}),
		).toBe(true);

		expect(fixture.calls).toEqual([
			"activeTexture:17",
			"bindTexture:12:a",
			"bindSampler:7:null",
			"activeTexture:10",
			"bindTexture:9:b",
			"bindSampler:0:a",
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

	it("issues a uniform once and skips it while the value is unchanged", () => {
		const fixture = createFixture();
		const state = new WebGL2ObjectStateApplicator(fixture.gl);

		expect(state.applyUniform1i(fixture.locationA, 1)).toBe(true);
		expect(state.applyUniform1i(fixture.locationA, 1)).toBe(false);
		expect(state.applyUniform1i(fixture.locationA, 2)).toBe(true);
		expect(state.applyUniform4f(fixture.locationB, 1, 2, 3, 4)).toBe(true);
		expect(state.applyUniform4f(fixture.locationB, 1, 2, 3, 4)).toBe(false);
		// Only the last component differs, so a component-wise comparison must still upload.
		expect(state.applyUniform4f(fixture.locationB, 1, 2, 3, 5)).toBe(true);

		expect(fixture.calls).toEqual([
			"uniform1i:ua:1",
			"uniform1i:ua:2",
			"uniform4f:ub:1,2,3,4",
			"uniform4f:ub:1,2,3,5",
		]);
	});

	it("keeps uniform values across a program switch, because GL retains them per program", () => {
		const fixture = createFixture();
		const state = new WebGL2ObjectStateApplicator(fixture.gl);

		state.applyProgram(fixture.programA);
		expect(state.applyUniform1f(fixture.locationA, 0.5)).toBe(true);
		state.applyProgram(fixture.programB);
		state.applyProgram(fixture.programA);
		// Locations are per-program objects, so returning to a program must not re-upload a value
		// the driver still holds.
		expect(state.applyUniform1f(fixture.locationA, 0.5)).toBe(false);
	});

	it("treats an unseen location as changed and does not confuse zero with negative zero", () => {
		const fixture = createFixture();
		const state = new WebGL2ObjectStateApplicator(fixture.gl);

		expect(state.applyUniform1f(fixture.locationA, 0)).toBe(true);
		// -0 and 0 are the same uniform value; a NaN-seeded slot must not report them as different.
		expect(state.applyUniform1f(fixture.locationA, -0)).toBe(false);
	});

	it("compares every matrix component rather than the buffer identity", () => {
		const fixture = createFixture();
		const state = new WebGL2ObjectStateApplicator(fixture.gl);
		const scratch = new Float32Array(16);
		scratch[0] = 1;

		expect(state.applyUniformMatrix4fv(fixture.locationA, scratch)).toBe(true);
		// The renderer reuses one scratch buffer, so identity comparison would wrongly skip here.
		expect(state.applyUniformMatrix4fv(fixture.locationA, scratch)).toBe(false);
		scratch[15] = 2;
		expect(state.applyUniformMatrix4fv(fixture.locationA, scratch)).toBe(true);
	});

	it("compares the full configurable-width vec4 array", () => {
		const fixture = createFixture();
		const state = new WebGL2ObjectStateApplicator(fixture.gl);
		const records = new Float32Array(128);

		expect(state.applyUniform4fv(fixture.locationA, records)).toBe(true);
		expect(state.applyUniform4fv(fixture.locationA, records)).toBe(false);
		records[127] = 2;
		expect(state.applyUniform4fv(fixture.locationA, records)).toBe(true);
		expect(fixture.calls).toEqual(["uniform4fv:ua:0:0", "uniform4fv:ua:0:2"]);
	});
});

function createFixture() {
	const calls: string[] = [];
	const identities = {
		programA: { name: "a" } as WebGLProgram,
		programB: { name: "b" } as WebGLProgram,
		samplerA: { name: "a" } as WebGLSampler,
		samplerB: { name: "b" } as WebGLSampler,
		textureA: { name: "a" } as WebGLTexture,
		textureB: { name: "b" } as WebGLTexture,
		vertexArrayA: { name: "a" } as WebGLVertexArrayObject,
		locationA: { name: "ua" } as WebGLUniformLocation,
		locationB: { name: "ub" } as WebGLUniformLocation,
	};
	const named = (
		value:
			| null
			| WebGLProgram
			| WebGLSampler
			| WebGLTexture
			| WebGLUniformLocation
			| WebGLVertexArrayObject,
	) =>
		value === null
			? "null"
			: (value as unknown as { readonly name: string }).name;
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
		TEXTURE_2D_ARRAY: 12,
		activeTexture: (unit: number) => calls.push(`activeTexture:${unit}`),
		bindSampler: (unit: number, sampler: WebGLSampler | null) =>
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
		uniform1f: (location: WebGLUniformLocation, value: number) =>
			calls.push(`uniform1f:${named(location)}:${value}`),
		uniform1i: (location: WebGLUniformLocation, value: number) =>
			calls.push(`uniform1i:${named(location)}:${value}`),
		uniform3f: (location: WebGLUniformLocation, ...values: number[]) =>
			calls.push(`uniform3f:${named(location)}:${values.join(",")}`),
		uniform4f: (location: WebGLUniformLocation, ...values: number[]) =>
			calls.push(`uniform4f:${named(location)}:${values.join(",")}`),
		uniform4fv: (location: WebGLUniformLocation, values: Float32Array) =>
			calls.push(
				`uniform4fv:${named(location)}:${values[0]}:${values[values.length - 1]}`,
			),
		uniformMatrix4fv: (
			location: WebGLUniformLocation,
			_transpose: boolean,
			value: Float32Array,
		) => calls.push(`uniformMatrix4fv:${named(location)}:${value[0]}`),
	} as unknown as WebGL2RenderingContext;
	return { calls, gl, ...identities };
}

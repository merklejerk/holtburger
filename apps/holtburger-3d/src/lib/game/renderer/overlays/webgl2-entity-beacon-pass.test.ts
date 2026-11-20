import { describe, expect, it, vi } from "vitest";

import { SHARED_FRAME_SETTINGS } from "../../../frontend-frame-settings";
import { Vec3 } from "../../math/types";
import { PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES } from "../portal/portal-propagation-metadata";
import {
	BEACON_BASE_VERTEX_COUNT,
	BEACON_CYLINDER_VERTEX_COUNT,
	WebGL2EntityBeaconPass,
	type EntityBeaconDrawContext,
} from "./webgl2-entity-beacon-pass";

function createFakeGl() {
	let nextId = 1;
	const createdPrograms: WebGLProgram[] = [];
	const deletedPrograms: WebGLProgram[] = [];
	const deletedBuffers: WebGLBuffer[] = [];
	const deletedArrays: WebGLVertexArrayObject[] = [];
	const enabled: number[] = [];
	const depthMaskCalls: boolean[] = [];
	const drawCalls: Array<{
		first: number;
		count: number;
		instanceCount: number;
	}> = [];
	const uniformLocations = new Map<string, WebGLUniformLocation>();

	const gl = {
		ARRAY_BUFFER: 1,
		BLEND: 2,
		COMPILE_STATUS: 4,
		CULL_FACE: 5,
		DEPTH_TEST: 6,
		FLOAT: 7,
		FRAGMENT_SHADER: 8,
		INVALID_INDEX: 0xffffffff,
		LEQUAL: 9,
		LINK_STATUS: 11,
		ONE_MINUS_SRC_ALPHA: 12,
		SRC_ALPHA: 14,
		STATIC_DRAW: 15,
		STREAM_DRAW: 16,
		TRIANGLES: 23,
		UNIFORM_BLOCK_DATA_SIZE: 26,
		VERTEX_SHADER: 25,
		attachShader: vi.fn(),
		bindBuffer: vi.fn(),
		bindVertexArray: vi.fn(),
		blendFunc: vi.fn(),
		bufferData: vi.fn(),
		bufferSubData: vi.fn(),
		compileShader: vi.fn(),
		createBuffer: vi.fn(() => ({ id: nextId++ }) as unknown as WebGLBuffer),
		createProgram: vi.fn(() => {
			const program = { id: nextId++ } as unknown as WebGLProgram;
			createdPrograms.push(program);
			return program;
		}),
		createShader: vi.fn(() => ({ id: nextId++ }) as unknown as WebGLShader),
		createVertexArray: vi.fn(
			() => ({ id: nextId++ }) as unknown as WebGLVertexArrayObject,
		),
		deleteBuffer: vi.fn((buffer: WebGLBuffer) => deletedBuffers.push(buffer)),
		deleteProgram: vi.fn((program: WebGLProgram) =>
			deletedPrograms.push(program),
		),
		deleteShader: vi.fn(),
		deleteVertexArray: vi.fn((array: WebGLVertexArrayObject) =>
			deletedArrays.push(array),
		),
		depthFunc: vi.fn(),
		depthMask: vi.fn((flag: boolean) => depthMaskCalls.push(flag)),
		disable: vi.fn(),
		drawArraysInstanced: vi.fn(
			(_mode: number, first: number, count: number, instanceCount: number) => {
				drawCalls.push({ first, count, instanceCount });
			},
		),
		enable: vi.fn((cap: number) => enabled.push(cap)),
		enableVertexAttribArray: vi.fn(),
		getActiveUniformBlockParameter: vi.fn(
			() => PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		),
		getProgramInfoLog: vi.fn(() => ""),
		getProgramParameter: vi.fn(() => true),
		getShaderInfoLog: vi.fn(() => ""),
		getShaderParameter: vi.fn(() => true),
		getUniformBlockIndex: vi.fn(() => 0),
		getUniformLocation: vi.fn((_program: WebGLProgram, name: string) => {
			let location = uniformLocations.get(name);
			if (location === undefined) {
				location = { name } as unknown as WebGLUniformLocation;
				uniformLocations.set(name, location);
			}
			return location;
		}),
		linkProgram: vi.fn(),
		shaderSource: vi.fn(),
		uniform1f: vi.fn(),
		uniform1i: vi.fn(),
		uniform2f: vi.fn(),
		uniform3f: vi.fn(),
		uniform4f: vi.fn(),
		uniformBlockBinding: vi.fn(),
		uniformMatrix4fv: vi.fn(),
		useProgram: vi.fn(),
		vertexAttribDivisor: vi.fn(),
		vertexAttribPointer: vi.fn(),
	} as unknown as WebGL2RenderingContext;

	return {
		gl,
		createdPrograms,
		deletedPrograms,
		deletedBuffers,
		deletedArrays,
		enabled,
		depthMaskCalls,
		drawCalls,
	};
}

function makeContext(
	overrides: Partial<EntityBeaconDrawContext["settings"]> = {},
): EntityBeaconDrawContext {
	return {
		clipFromAnchor: new Float32Array(16),
		cameraPosition: new Vec3(0, 2, 10),
		cameraRight: [1, 0, 0],
		viewportWidth: 1280,
		viewportHeight: 720,
		renderScale: 1,
		timeSeconds: 1.25,
		settings: {
			...SHARED_FRAME_SETTINGS.entityBeacons,
			color: { red: 0.43, green: 0.94, blue: 1, alpha: 0.95 },
			sparkleColor: { red: 0.78, green: 0.98, blue: 1, alpha: 0.38 },
			...overrides,
		},
	};
}

describe("WebGL2EntityBeaconPass", () => {
	it("draws depth-tested base ring and hollow 3D cylinder batches and restores GL state", () => {
		const fake = createFakeGl();
		const pass = new WebGL2EntityBeaconPass(fake.gl);

		pass.draw(makeContext(), []);
		expect(fake.drawCalls).toHaveLength(0);

		pass.draw(makeContext(), [
			{ base: new Vec3(1, 0, -5), height: 80, radius: 1.2 },
			{ base: new Vec3(4, 1, -8), height: 3, radius: 0.45 },
		]);
		expect(fake.drawCalls).toEqual([
			{
				first: BEACON_CYLINDER_VERTEX_COUNT,
				count: BEACON_BASE_VERTEX_COUNT,
				instanceCount: 2,
			},
			{
				first: 0,
				count: BEACON_CYLINDER_VERTEX_COUNT,
				instanceCount: 2,
			},
		]);
		expect(fake.enabled).toContain(fake.gl.DEPTH_TEST);
		expect(fake.depthMaskCalls).toEqual([false, true]);

		pass.destroy();
		expect(fake.deletedPrograms).toHaveLength(fake.createdPrograms.length);
		expect(fake.deletedBuffers).toHaveLength(2);
		expect(fake.deletedArrays).toHaveLength(1);
	});

	it("routes portal-scoped instances and fails loudly when theme color is unresolved", () => {
		const fake = createFakeGl();
		const pass = new WebGL2EntityBeaconPass(fake.gl);

		expect(() =>
			pass.draw(makeContext({ color: null }), [
				{ base: new Vec3(0, 0, -4), height: 3, radius: 0.6 },
			]),
		).toThrow(/resolved theme colors/i);
		expect(() =>
			pass.draw(makeContext({ sparkleColor: null }), [
				{ base: new Vec3(0, 0, -4), height: 3, radius: 0.6 },
			]),
		).toThrow(/resolved theme colors/i);

		const deferredRenderDomainOrdinal = vi.fn(() => 2);
		pass.drawScoped(
			makeContext(),
			[
				{
					base: new Vec3(0, 0, -4),
					height: 3,
					radius: 0.6,
					renderScopeKey: "env:42",
				},
			],
			{ deferredRenderDomainOrdinal },
		);
		expect(deferredRenderDomainOrdinal).toHaveBeenCalledWith("env:42");
		expect(fake.drawCalls).toEqual([
			{
				first: BEACON_CYLINDER_VERTEX_COUNT,
				count: BEACON_BASE_VERTEX_COUNT,
				instanceCount: 1,
			},
			{
				first: 0,
				count: BEACON_CYLINDER_VERTEX_COUNT,
				instanceCount: 1,
			},
		]);
		pass.destroy();
	});
});

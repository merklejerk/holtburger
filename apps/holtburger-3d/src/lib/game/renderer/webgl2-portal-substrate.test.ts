import { describe, expect, it } from "vitest";
import {
	applyPortalPassState,
	type PortalPassStateCommand,
} from "./webgl2-portal-substrate";

describe("portal pass state", () => {
	it.each([
		{
			command: {
				extent: { height: 32, width: 64 },
				framebuffer: null,
				kind: "ordinary",
			},
			expected: {
				clearDepth: 1,
				clearStencil: 0,
				colorMask: [true, true, true, true],
				depthEnabled: true,
				depthFunction: 0x0203,
				depthMask: true,
				stencilEnabled: false,
				stencilWriteMask: 0xff,
				viewport: [0, 0, 64, 32],
			},
		},
		{
			command: {
				depthCompare: "less-or-equal",
				extent: { height: 32, width: 64 },
				framebuffer: {} as WebGLFramebuffer,
				kind: "mask-write",
				stencilPolicy: { kind: "replace", value: 4 },
			},
			expected: {
				colorMask: [false, false, false, false],
				depthEnabled: true,
				depthFunction: 0x0203,
				depthMask: false,
				stencilEnabled: true,
				stencilFunction: [0x0207, 4, 0xff],
				stencilOperation: [0x1e00, 0x1e00, 0x1e01],
				stencilWriteMask: 0xff,
				viewport: [0, 0, 64, 32],
			},
		},
		{
			command: {
				depthCompare: "less-or-equal-offset",
				extent: { height: 32, width: 64 },
				framebuffer: {} as WebGLFramebuffer,
				kind: "mask-write",
				stencilPolicy: { kind: "replace", value: 4 },
			},
			expected: {
				colorMask: [false, false, false, false],
				depthEnabled: true,
				depthFunction: 0x0203,
				depthMask: false,
				stencilEnabled: true,
				stencilFunction: [0x0207, 4, 0xff],
				stencilOperation: [0x1e00, 0x1e00, 0x1e01],
				stencilWriteMask: 0xff,
				viewport: [0, 0, 64, 32],
			},
		},
		{
			command: {
				depthCompare: "always",
				extent: { height: 32, width: 64 },
				framebuffer: {} as WebGLFramebuffer,
				kind: "mask-write",
				stencilPolicy: { kind: "replace", value: 4 },
			},
			expected: {
				colorMask: [false, false, false, false],
				depthEnabled: true,
				depthFunction: 0x0207,
				depthMask: false,
				stencilEnabled: true,
				stencilFunction: [0x0207, 4, 0xff],
				stencilOperation: [0x1e00, 0x1e00, 0x1e01],
				stencilWriteMask: 0xff,
				viewport: [0, 0, 64, 32],
			},
		},
		{
			command: {
				depthCompare: "less-or-equal",
				extent: { height: 32, width: 64 },
				framebuffer: {} as WebGLFramebuffer,
				kind: "mask-write",
				stencilPolicy: {
					from: 4,
					kind: "promote-if-equal",
					to: 5,
				},
			},
			expected: {
				colorMask: [false, false, false, false],
				depthEnabled: true,
				depthFunction: 0x0203,
				depthMask: false,
				stencilEnabled: true,
				stencilFunction: [0x0202, 4, 0xff],
				stencilOperation: [0x1e00, 0x1e00, 0x1e02],
				stencilWriteMask: 0xff,
				viewport: [0, 0, 64, 32],
			},
		},
		{
			command: {
				depth: 1,
				extent: { height: 32, width: 64 },
				framebuffer: {} as WebGLFramebuffer,
				kind: "masked-depth-reset",
				renderLayer: 7,
			},
			expected: {
				colorMask: [false, false, false, false],
				depthEnabled: true,
				depthFunction: 0x0207,
				depthMask: true,
				stencilEnabled: true,
				stencilFunction: [0x0202, 7, 0xff],
				stencilOperation: [0x1e00, 0x1e00, 0x1e00],
				stencilWriteMask: 0,
				viewport: [0, 0, 64, 32],
			},
		},
		{
			command: {
				depth: 1,
				extent: { height: 32, width: 64 },
				framebuffer: {} as WebGLFramebuffer,
				kind: "masked-scene-initialize",
				renderLayer: 7,
			},
			expected: {
				colorMask: [true, true, true, true],
				depthEnabled: true,
				depthFunction: 0x0207,
				depthMask: true,
				stencilEnabled: true,
				stencilFunction: [0x0202, 7, 0xff],
				stencilOperation: [0x1e00, 0x1e00, 0x1e00],
				stencilWriteMask: 0,
				viewport: [0, 0, 64, 32],
			},
		},
		{
			command: {
				extent: { height: 32, width: 64 },
				framebuffer: {} as WebGLFramebuffer,
				kind: "masked-ordinary",
				renderLayer: 7,
			},
			expected: {
				colorMask: [true, true, true, true],
				depthEnabled: true,
				depthFunction: 0x0203,
				depthMask: true,
				stencilEnabled: true,
				stencilFunction: [0x0202, 7, 0xff],
				stencilOperation: [0x1e00, 0x1e00, 0x1e00],
				stencilWriteMask: 0,
				viewport: [0, 0, 64, 32],
			},
		},
	] as const)(
		"establishes the complete $command.kind baseline",
		({ command, expected }) => {
			const state = createFakeState();
			applyPortalPassState(
				state.gl,
				command as unknown as PortalPassStateCommand,
			);

			expect(state.values).toMatchObject(expected);
			expect(state.values.blendEnabled).toBe(false);
			expect(state.values.cullEnabled).toBe(false);
			expect(state.values.polygonOffsetEnabled).toBe(
				command.kind === "mask-write" &&
					command.depthCompare === "less-or-equal-offset",
			);
			if (
				command.kind === "mask-write" &&
				command.depthCompare === "less-or-equal-offset"
			) {
				expect(state.values.polygonOffset).toEqual([1, 1]);
			}
			expect(state.values.scissorEnabled).toBe(false);
			expect(state.values.framebuffer).toBe(command.framebuffer);
		},
	);

	it("disables portal-mask polygon offset before returning to scene drawing", () => {
		const state = createFakeState();
		applyPortalPassState(state.gl, {
			depthCompare: "less-or-equal-offset",
			extent: { height: 32, width: 64 },
			framebuffer: {} as WebGLFramebuffer,
			kind: "mask-write",
			stencilPolicy: { kind: "replace", value: 4 },
		});
		expect(state.values.polygonOffsetEnabled).toBe(true);

		applyPortalPassState(state.gl, {
			extent: { height: 32, width: 64 },
			framebuffer: {} as WebGLFramebuffer,
			kind: "masked-ordinary",
			renderLayer: 4,
		});

		expect(state.values.polygonOffsetEnabled).toBe(false);
	});

	it("reserves zero for the base and accepts render-layer labels through 255", () => {
		const state = createFakeState();
		const command = (renderLayer: number): PortalPassStateCommand => ({
			depthCompare: "always",
			extent: { height: 1, width: 1 },
			framebuffer: {} as WebGLFramebuffer,
			kind: "mask-write",
			stencilPolicy: { kind: "replace", value: renderLayer },
		});

		expect(() => applyPortalPassState(state.gl, command(1))).not.toThrow();
		expect(() => applyPortalPassState(state.gl, command(255))).not.toThrow();
		expect(() => applyPortalPassState(state.gl, command(0))).toThrow(
			"base layer",
		);
		expect(() => applyPortalPassState(state.gl, command(256))).toThrow(
			"0 through 255",
		);
		expect(() =>
			applyPortalPassState(state.gl, {
				depthCompare: "always",
				extent: { height: 1, width: 1 },
				framebuffer: {} as WebGLFramebuffer,
				kind: "mask-write",
				stencilPolicy: {
					from: 255,
					kind: "promote-if-equal",
					to: 256,
				},
			}),
		).toThrow("0 through 255");
		expect(() =>
			applyPortalPassState(state.gl, {
				depthCompare: "always",
				extent: { height: 1, width: 1 },
				framebuffer: {} as WebGLFramebuffer,
				kind: "mask-write",
				stencilPolicy: {
					from: 3,
					kind: "promote-if-equal",
					to: 5,
				},
			}),
		).toThrow("adjacent label");
	});

	it("rejects invalid render extents before changing state", () => {
		const state = createFakeState();

		expect(() =>
			applyPortalPassState(state.gl, {
				extent: { height: 1, width: 0 },
				framebuffer: null,
				kind: "ordinary",
			}),
		).toThrow("positive integers");
		expect(state.values).toEqual({});
	});

	it("fails loudly when malformed runtime input bypasses the command union", () => {
		const state = createFakeState();

		expect(() =>
			applyPortalPassState(state.gl, {
				extent: { height: 1, width: 1 },
				framebuffer: null,
				kind: "malformed",
			} as unknown as PortalPassStateCommand),
		).toThrow("Unsupported portal pass-state command");
	});
});

interface FakeState {
	readonly gl: WebGL2RenderingContext;
	readonly values: Record<string, unknown>;
}

function createFakeState(): FakeState {
	const values: Record<string, unknown> = {};
	const constants = {
		ALWAYS: 0x0207,
		BLEND: 0x0be2,
		CULL_FACE: 0x0b44,
		DEPTH_TEST: 0x0b71,
		EQUAL: 0x0202,
		FRAMEBUFFER: 0x8d40,
		INCR: 0x1e02,
		KEEP: 0x1e00,
		LEQUAL: 0x0203,
		LESS: 0x0201,
		POLYGON_OFFSET_FILL: 0x8037,
		REPLACE: 0x1e01,
		SCISSOR_TEST: 0x0c11,
		STENCIL_TEST: 0x0b90,
	} as const;
	const enabled = new Set<number>();
	const gl = {
		...constants,
		bindFramebuffer: (
			_target: number,
			framebuffer: WebGLFramebuffer | null,
		) => {
			values.framebuffer = framebuffer;
		},
		clearDepth: (depth: number) => {
			values.clearDepth = depth;
		},
		clearStencil: (stencil: number) => {
			values.clearStencil = stencil;
		},
		colorMask: (...mask: boolean[]) => {
			values.colorMask = mask;
		},
		depthFunc: (func: number) => {
			values.depthFunction = func;
		},
		depthMask: (mask: boolean) => {
			values.depthMask = mask;
		},
		disable: (capability: number) => {
			enabled.delete(capability);
			recordCapabilities();
		},
		enable: (capability: number) => {
			enabled.add(capability);
			recordCapabilities();
		},
		polygonOffset: (factor: number, units: number) => {
			values.polygonOffset = [factor, units];
		},
		stencilFunc: (...args: number[]) => {
			values.stencilFunction = args;
		},
		stencilMask: (mask: number) => {
			values.stencilWriteMask = mask;
		},
		stencilOp: (...args: number[]) => {
			values.stencilOperation = args;
		},
		viewport: (...viewport: number[]) => {
			values.viewport = viewport;
		},
	} as unknown as WebGL2RenderingContext;
	return { gl, values };

	function recordCapabilities(): void {
		values.blendEnabled = enabled.has(constants.BLEND);
		values.cullEnabled = enabled.has(constants.CULL_FACE);
		values.depthEnabled = enabled.has(constants.DEPTH_TEST);
		values.polygonOffsetEnabled = enabled.has(constants.POLYGON_OFFSET_FILL);
		values.scissorEnabled = enabled.has(constants.SCISSOR_TEST);
		values.stencilEnabled = enabled.has(constants.STENCIL_TEST);
	}
}

import { describe, expect, it } from "vitest";
import type { ObjectGeometryKey } from "../geometry/types";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type { VisibleRigidDepthContribution } from "../systems/components";
import { DEFAULT_ENTITY_SHADOW_SETTINGS } from "./entity-shadow-policy";
import type { OutdoorPssmCasterWorld } from "./outdoor-pssm-casters";
import type { RenderContribution } from "./render-world";
import type { WebGL2PssmCasterProgram } from "./webgl2-pssm-caster-program";
import type { WebGL2PssmShadowTargetSet } from "./webgl2-pssm-shadow-targets";
import {
	hasOutdoorPssmLightAndInterval,
	WebGL2OutdoorPssmPass,
	type WebGL2OutdoorPssmPassInput,
} from "./webgl2-outdoor-pssm-pass";

const ANCHOR = "0x0101ffff";
const NODE = "scene-node:1" as SceneNodeId;

describe("WebGL2OutdoorPssmPass", () => {
	it("does no GPU, query, target, or shader work for zero sun", () => {
		const fixture = createFixture();
		const input = createInput(Vec3.zero());

		expect(fixture.pass.render(input, null)).toBeNull();

		expect(fixture.state.targetResizes).toBe(0);
		expect(fixture.state.queries).toBe(0);
		expect(fixture.state.programCreations).toBe(0);
		expect(fixture.state.glCalls).toEqual([]);
	});

	it("clears and submits every cascade with one lazy material-free program", () => {
		const fixture = createFixture(true);
		const input = createInput(new Vec3(0.2, 1, -0.3));
		const profileMetrics = {
			cascadeQueryCount: 0,
			cascadeSelectedRootCount: 0,
			compatibleDepthRunCount: 0,
			instanceUploadBytes: 0,
			instanceUploadCount: 0,
			retainedCasterRootCount: 0,
			selectedCasterPartCount: 0,
			uniqueSelectedRootCount: 0,
		};

		const active = fixture.pass.render(input, profileMetrics);

		expect(active?.cascades).toHaveLength(2);
		expect(active?.instanceUploads).toEqual({ bytes: 160, count: 2 });
		expect(active?.targets).toBe(fixture.targets);
		expect(fixture.state.targetResizes).toBe(1);
		expect(fixture.state.attachedLayers).toEqual([0, 1]);
		expect(fixture.state.queries).toBe(2);
		expect(fixture.state.programCreations).toBe(1);
		expect(fixture.state.preparedInstanceCounts).toEqual([1, 1]);
		expect(profileMetrics).toEqual({
			cascadeQueryCount: 2,
			cascadeSelectedRootCount: 2,
			compatibleDepthRunCount: 2,
			instanceUploadBytes: 160,
			instanceUploadCount: 2,
			retainedCasterRootCount: 1,
			selectedCasterPartCount: 2,
			uniqueSelectedRootCount: 1,
		});
		expect(fixture.state.expansions).toBe(1);
		expect(fixture.state.draws).toEqual([
			{ count: 6, instanceCount: 1, offset: 0 },
			{ count: 6, instanceCount: 1, offset: 0 },
		]);
		expect(input.selectedDynamicNodeIds).toEqual(new Set([NODE]));
		expect(fixture.state.glCalls.slice(-5)).toEqual([
			"framebuffer:null",
			"viewport:640x360",
			"colorMask:true",
			"disable:polygon-offset",
			"disable:cull",
		]);
	});

	it("clears empty cascades without compiling the caster program", () => {
		const fixture = createFixture(false);

		expect(
			fixture.pass.render(createInput(new Vec3(0, 1, 0)), null)
				?.instanceUploads,
		).toEqual({ bytes: 0, count: 0 });

		expect(fixture.state.attachedLayers).toEqual([0, 1]);
		expect(fixture.state.queries).toBe(2);
		expect(fixture.state.programCreations).toBe(0);
		expect(fixture.state.draws).toEqual([]);
	});

	it("forwards master disable and destroys a compiled program once", () => {
		const fixture = createFixture(true);
		fixture.pass.render(createInput(new Vec3(0, 1, 0)), null);

		fixture.pass.disable();
		fixture.pass.destroy();
		fixture.pass.destroy();

		expect(fixture.state.targetDisables).toBe(1);
		expect(fixture.state.targetDestroys).toBe(1);
		expect(fixture.state.deletedPrograms).toBe(1);
	});
});

describe("hasOutdoorPssmLightAndInterval", () => {
	it("requires both nonzero directional light and a nonempty covered interval", () => {
		const baseline = createInput(new Vec3(0, 1, 0));
		expect(hasOutdoorPssmLightAndInterval(baseline)).toBe(true);
		expect(
			hasOutdoorPssmLightAndInterval({ ...baseline, sunVector: Vec3.zero() }),
		).toBe(false);
		expect(
			hasOutdoorPssmLightAndInterval({
				...baseline,
				settings: {
					...baseline.settings,
					maximumDistance: baseline.camera.near,
				},
			}),
		).toBe(false);
	});
});

interface FixtureState {
	attachedLayers: number[];
	deletedPrograms: number;
	draws: Array<{ count: number; instanceCount: number; offset: number }>;
	expansions: number;
	glCalls: string[];
	preparedInstanceCounts: number[];
	programCreations: number;
	queries: number;
	targetDestroys: number;
	targetDisables: number;
	targetResizes: number;
}

function createFixture(withCaster = false): {
	pass: WebGL2OutdoorPssmPass;
	state: FixtureState;
	targets: WebGL2PssmShadowTargetSet;
} {
	const state: FixtureState = {
		attachedLayers: [],
		deletedPrograms: 0,
		draws: [],
		expansions: 0,
		glCalls: [],
		preparedInstanceCounts: [],
		programCreations: 0,
		queries: 0,
		targetDestroys: 0,
		targetDisables: 0,
		targetResizes: 0,
	};
	const gl = createFakeGl(state);
	const targets: WebGL2PssmShadowTargetSet = {
		cascadeCount: 2,
		depth: fakeResource<WebGLTexture>("depth"),
		framebuffer: fakeResource<WebGLFramebuffer>("framebuffer"),
		resolution: 256,
	};
	const contribution = dynamicContribution();
	const descriptor = dynamicDescriptor();
	const world: OutdoorPssmCasterWorld = {
		expandDynamicContributions: () => {
			state.expansions += 1;
			return {
				depth: withCaster ? [contribution] : [],
				kind: "visible",
				landblockId: ANCHOR,
				material: [],
				renderScopes: [{ kind: "outdoor" }],
			};
		},
		getRenderContributionDescriptor: () => descriptor,
		queryScopesScene: () => {
			state.queries += 1;
			return { entries: withCaster ? [NODE] : [] };
		},
		resolveGeometry: () => "geometry-resource:1" as const,
	};
	let populatedInstanceCount = 0;
	const frameInstances = {
		getRange(firstInstance: number, instanceCount: number) {
			return {
				binding: {
					buffer: fakeResource<WebGLBuffer>("instance-buffer"),
					capacity: populatedInstanceCount,
					populatedInstanceCount,
					strideBytes: 80,
				},
				firstInstance,
				instanceCount,
			};
		},
		prepareView(instances: readonly unknown[]) {
			populatedInstanceCount = instances.length;
			state.preparedInstanceCounts.push(instances.length);
		},
	};
	const resources = {
		getGeometry: () => ({
			indexCount: 6,
			indexElementBytes: 2,
			indexType: 0x1403,
			vertexArray: fakeResource<WebGLVertexArrayObject>("vao"),
		}),
	};
	const program: WebGL2PssmCasterProgram = {
		program: fakeResource<WebGLProgram>("program"),
		uniforms: {
			landblockOffset: fakeResource<WebGLUniformLocation>("landblock-uniform"),
			lightClip: fakeResource<WebGLUniformLocation>("matrix-uniform"),
		},
	};
	const pass = new WebGL2OutdoorPssmPass(gl, resources, world, frameInstances, {
		createProgram: () => {
			state.programCreations += 1;
			return program;
		},
		targets: {
			attachLayer(layer) {
				state.attachedLayers.push(layer);
				return targets;
			},
			destroy() {
				state.targetDestroys += 1;
			},
			disable() {
				state.targetDisables += 1;
			},
			getDiagnostics: () => ({
				activeBytes: 0,
				activeFramebufferCount: 0,
				activeTextureCount: 0,
				allocatedGenerationCount: 0,
				cascadeCount: null,
				disposedGenerationCount: 0,
				resolution: null,
			}),
			resize() {
				state.targetResizes += 1;
				return targets;
			},
		},
	});
	return { pass, state, targets };
}

function createInput(sunVector: Vec3): WebGL2OutdoorPssmPassInput {
	return {
		anchorCoordinates: { x: 1, y: 1 },
		anchorLandblockId: ANCHOR,
		aspectRatio: 16 / 9,
		camera: {
			far: 128,
			near: 0.1,
			position: new Vec3(96, 8, -96),
			rotation: Quat.identity(),
			verticalFovDegrees: 60,
		},
		frameHeight: 360,
		frameWidth: 640,
		selectedDynamicNodeIds: new Set(),
		showRetailHiddenGeometry: false,
		settings: {
			...DEFAULT_ENTITY_SHADOW_SETTINGS.pssm,
			cascadeCount: 2,
			mapResolution: 256,
			maximumDistance: 64,
		},
		sunVector,
	};
}

function createFakeGl(state: FixtureState): WebGL2RenderingContext {
	const constants = {
		ARRAY_BUFFER: 0x8892,
		BACK: 0x0405,
		BLEND: 0x0be2,
		CULL_FACE: 0x0b44,
		DEPTH_BUFFER_BIT: 0x0100,
		DEPTH_TEST: 0x0b71,
		FLOAT: 0x1406,
		FRAMEBUFFER: 0x8d40,
		FRONT: 0x0404,
		LEQUAL: 0x0203,
		POLYGON_OFFSET_FILL: 0x8037,
		SCISSOR_TEST: 0x0c11,
		STENCIL_TEST: 0x0b90,
		TRIANGLES: 0x0004,
	} as const;
	const capabilityName = (capability: GLenum): string => {
		switch (capability) {
			case constants.CULL_FACE:
				return "cull";
			case constants.POLYGON_OFFSET_FILL:
				return "polygon-offset";
			default:
				return String(capability);
		}
	};
	return {
		...constants,
		bindBuffer: () => undefined,
		bindFramebuffer: (_target: GLenum, framebuffer: WebGLFramebuffer | null) =>
			state.glCalls.push(`framebuffer:${framebuffer ? "target" : "null"}`),
		bindVertexArray: () => undefined,
		clear: () => state.glCalls.push("clear-depth"),
		clearDepth: () => undefined,
		colorMask: (red: boolean) => state.glCalls.push(`colorMask:${red}`),
		cullFace: () => undefined,
		deleteProgram: () => {
			state.deletedPrograms += 1;
		},
		depthFunc: () => undefined,
		depthMask: () => undefined,
		disable: (capability: GLenum) =>
			state.glCalls.push(`disable:${capabilityName(capability)}`),
		drawElementsInstanced: (
			_mode: GLenum,
			count: GLsizei,
			_type: GLenum,
			offset: GLintptr,
			instanceCount: GLsizei,
		) => state.draws.push({ count, instanceCount, offset }),
		enable: () => undefined,
		enableVertexAttribArray: () => undefined,
		polygonOffset: () => undefined,
		uniform3f: () => undefined,
		uniformMatrix4fv: () => undefined,
		useProgram: () => undefined,
		vertexAttribDivisor: () => undefined,
		vertexAttribPointer: () => undefined,
		viewport: (_x: GLint, _y: GLint, width: GLsizei, height: GLsizei) =>
			state.glCalls.push(`viewport:${width}x${height}`),
	} as unknown as WebGL2RenderingContext;
}

function dynamicDescriptor(): RenderContribution {
	return {
		category: "mob",
		footprint: {
			kind: "eligible",
			localBounds: AABB3.zero(),
			objectClass: "authored-dynamic",
			placement: {
				envCellId: null,
				landblockId: ANCHOR,
				localToLandblock: Mat4.identity(),
				scope: { kind: "outdoor" },
			},
		},
		kind: "dynamic",
	};
}

function dynamicContribution(): VisibleRigidDepthContribution {
	return {
		drawUnit: {
			cullFace: "back",
			geometry: "object-geometry:caster" as ObjectGeometryKey,
			indexCount: 6,
			indexStart: 0,
			retailVisibility: "normally-visible",
		},
		instance: {
			color: { a: 1, b: 1, g: 1, r: 1 },
			sourceToLandblock: Mat4.identity(),
		},
	};
}

function fakeResource<T>(name: string): T {
	return { name } as T;
}

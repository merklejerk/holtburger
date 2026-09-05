import { describe, expect, it } from "vitest";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import { createDynamicDepthTestFixture } from "./dynamic-depth-test-fixture";
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
	it("prepares independent views without GPU work and executes them without repeating selection", () => {
		const fixture = createFixture(true);
		fixture.pass.beginFrame();
		const input = createInput(new Vec3(0.2, 1, -0.3));
		const first = fixture.pass.prepare(input, null);
		if (first === null) throw new Error("Fixture requires directional light.");
		const firstMatrices = first.storage.cascades.map((cascade) => ({
			...cascade.lightClip,
		}));
		const batchCapacity = first.storage.batchPool.length;
		const casterArray = first.storage.batches[0]?.casters;
		const second = fixture.pass.prepare(
			{
				...input,
				camera: { ...input.camera, position: new Vec3(10, 2, 3) },
				casterBudget: { maximumMappedRoots: 0, maximumSelectedRoots: 1 },
			},
			null,
		);
		if (second === null) throw new Error("Fixture requires directional light.");
		expect(first.storage).not.toBe(second.storage);
		expect(first.storage.casterSelectionScratch).not.toBe(
			second.storage.casterSelectionScratch,
		);
		expect(
			first.storage.cascades.map((cascade) => ({ ...cascade.lightClip })),
		).toEqual(firstMatrices);
		expect(
			first.storage.batches.some((batch) => batch.casters.length > 0),
		).toBe(true);
		expect(
			second.storage.batches.every((batch) => batch.casters.length === 0),
		).toBe(true);
		expect(fixture.state.glCalls).toEqual([]);
		expect(fixture.state.poseReads).toEqual([]);
		expect(fixture.state.targetResizes).toBe(0);
		const queries = fixture.state.queries;
		fixture.pass.render(first, null);
		expect(fixture.state.draws).toHaveLength(input.settings.cascadeCount);
		fixture.pass.render(second, null);
		expect(second.storage.analyticCasters).toHaveLength(1);
		expect(fixture.state.queries).toBe(queries);
		fixture.pass.beginFrame();
		expect(
			first.storage.batches.every((batch) => batch.casters.length === 0),
		).toBe(true);
		expect(first.storage.batchPool).toHaveLength(batchCapacity);
		expect(casterArray).toHaveLength(0);
		expect(second.storage.analyticCasters).toHaveLength(0);
		const next = fixture.pass.prepare(input, null);
		expect(next?.storage).toBe(first.storage);
	});
	it("does no GPU, query, target, or shader work for zero sun", () => {
		const fixture = createFixture();
		const input = createInput(Vec3.zero());

		expect(
			fixture.pass.render(fixture.pass.prepare(input, null), null),
		).toBeNull();

		expect(fixture.state.targetResizes).toBe(0);
		expect(fixture.state.queries).toBe(0);
		expect(fixture.state.programCreations).toBe(0);
		expect(fixture.state.glCalls).toEqual([]);
	});

	it("clears and submits every cascade with one lazy material-free program", () => {
		const fixture = createFixture(true);
		const input = createInput(new Vec3(0.2, 1, -0.3));
		const profileMetrics = {
			analyticRootCount: 0,
			candidateRootCount: 0,
			cascadeCandidateMembershipCount: 0,
			cascadeQueryCount: 0,
			selectedDepthDrawCount: 0,
			emptyMappedViewCount: 0,
			mappedRootCount: 0,
			rejectedRootCount: 0,
			selectedRootCount: 0,
			selectedPartCascadeCount: 0,
		};

		const active = fixture.pass.render(
			fixture.pass.prepare(input, profileMetrics),
			profileMetrics,
		);

		expect(active?.cascades).toHaveLength(2);
		expect(active?.targets).toBe(fixture.targets);
		expect(fixture.state.targetResizes).toBe(1);
		expect(fixture.state.attachedLayers).toEqual([0, 1]);
		expect(fixture.state.queries).toBe(2);
		expect(fixture.state.programCreations).toBe(1);
		expect(fixture.state.poseReads).toEqual([NODE, NODE]);
		expect(profileMetrics).toEqual({
			analyticRootCount: 0,
			candidateRootCount: 1,
			cascadeCandidateMembershipCount: 2,
			cascadeQueryCount: 2,
			selectedDepthDrawCount: 2,
			emptyMappedViewCount: 0,
			mappedRootCount: 1,
			rejectedRootCount: 0,
			selectedRootCount: 1,
			selectedPartCascadeCount: 2,
		});
		expect(fixture.state.depthPreparations).toBe(1);
		expect(fixture.state.draws).toEqual([
			{ count: 6, type: 0x1405, offset: 0 },
			{ count: 6, type: 0x1405, offset: 0 },
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

	it("skips target allocation, clears, and program compilation for an empty mapped tier", () => {
		const fixture = createFixture(false);

		expect(
			fixture.pass.render(
				fixture.pass.prepare(createInput(new Vec3(0, 1, 0)), null),
				null,
			),
		).toBeNull();

		expect(fixture.state.targetResizes).toBe(0);
		expect(fixture.state.attachedLayers).toEqual([]);
		expect(fixture.state.queries).toBe(2);
		expect(fixture.state.programCreations).toBe(0);
		expect(fixture.state.draws).toEqual([]);
	});

	it("keeps M=0 casters analytic without depth preparation or mapped GPU work", () => {
		const fixture = createFixture(true);
		const input = {
			...createInput(new Vec3(0, 1, 0)),
			casterBudget: { maximumMappedRoots: 0, maximumSelectedRoots: 1 },
		};
		const prepared = fixture.pass.prepare(input, null);
		expect(prepared?.storage.analyticCasters).toHaveLength(1);
		expect(fixture.pass.render(prepared, null)).toBeNull();
		expect(input.selectedDynamicNodeIds).toEqual(new Set([NODE]));
		expect(fixture.state.depthPreparations).toBe(0);
		expect(fixture.state.targetResizes).toBe(0);
		expect(fixture.state.programCreations).toBe(0);
		expect(fixture.state.attachedLayers).toEqual([]);
	});

	it("forwards master disable and destroys a compiled program once", () => {
		const fixture = createFixture(true);
		fixture.pass.render(
			fixture.pass.prepare(createInput(new Vec3(0, 1, 0)), null),
			null,
		);

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
	draws: Array<{ count: number; type: number; offset: number }>;
	depthPreparations: number;
	glCalls: string[];
	poseReads: SceneNodeId[];
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
		depthPreparations: 0,
		glCalls: [],
		poseReads: [],
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
	const contribution = createDynamicDepthTestFixture(NODE, ANCHOR, 6);
	const descriptor = dynamicDescriptor();
	const world: OutdoorPssmCasterWorld = {
		getDynamicDepth: () => {
			state.depthPreparations += 1;
			return withCaster ? contribution : null;
		},
		getRenderContributionDescriptor: () => descriptor,
		getEntityShadowDynamicFacts: () => ({
			identity: NODE,
			rigidBounds: new AABB3(Vec3.zero(), new Vec3(1, 2, 1)),
			spatialMembership: { scopes: [{ kind: "outdoor" }] },
		}),
		queryScopesScene: () => {
			state.queries += 1;
			return { entries: withCaster ? [NODE] : [] };
		},
	};
	const resources = {
		getPose: (nodeId: SceneNodeId) => {
			state.poseReads.push(nodeId);
			return { texture: fakeResource<WebGLTexture>("pose-page"), firstRow: 9 };
		},
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
			poses: fakeResource<WebGLUniformLocation>("poses-uniform"),
			firstPoseRow: fakeResource<WebGLUniformLocation>("row-uniform"),
		},
	};
	const pass = new WebGL2OutdoorPssmPass(gl, resources, world, {
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
		cameraFrustum: { cameraPosition: new Vec3(96, 8, -96), planes: [] },
		casterBudget: DEFAULT_ENTITY_SHADOW_SETTINGS.casterBudget,
		frameHeight: 360,
		frameWidth: 640,
		projectionSettings: DEFAULT_ENTITY_SHADOW_SETTINGS.projection,
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
		UNSIGNED_INT: 0x1405,
		ELEMENT_ARRAY_BUFFER: 0x8893,
		TEXTURE0: 0x84c0,
		TEXTURE_2D: 0x0de1,
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
		activeTexture: () => undefined,
		bindTexture: () => undefined,
		bindSampler: () => undefined,
		uniform1i: () => undefined,
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
		drawElements: (
			_mode: GLenum,
			count: GLsizei,
			type: GLenum,
			offset: GLintptr,
		) => state.draws.push({ count, type, offset }),
		enable: () => undefined,
		polygonOffset: () => undefined,
		uniform3f: () => undefined,
		uniformMatrix4fv: () => undefined,
		useProgram: () => undefined,
		viewport: (_x: GLint, _y: GLint, width: GLsizei, height: GLsizei) =>
			state.glCalls.push(`viewport:${width}x${height}`),
	} as unknown as WebGL2RenderingContext;
}

function dynamicDescriptor(): RenderContribution {
	return {
		entityClass: "mob",
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

function fakeResource<T>(name: string): T {
	return { name } as T;
}

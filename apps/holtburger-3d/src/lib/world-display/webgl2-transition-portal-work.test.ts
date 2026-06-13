import { describe, expect, it } from "vitest";

import {
	deriveTransitionPortalRenderLevels,
	type WorldRenderBaseScene,
} from "./render-policy";
import type { TransitionPortalCandidate } from "./transition-portal-work-items";
import {
	deriveWebgl2BaseSceneDomain,
	deriveWebgl2BaseSceneDomainFromResidency,
	deriveWebgl2InitialPortalEnvCellId,
	planWebgl2TransitionPortalWork,
} from "./webgl2-transition-portal-work";
import type { Webgl2TransitionPortalMaskResource } from "./webgl2-world-resources";

describe("planWebgl2TransitionPortalWork", () => {
	it("builds visible portal work only from visible transition portal mask resources", () => {
		const candidate = createCandidate({
			id: "outdoor/1:portal/1",
			entryEnvCellId: 0x01020100,
		});

		const plan = planWebgl2TransitionPortalWork({
			transitionPortalModel: {
				candidates: [
					candidate,
					createCandidate({
						id: "outdoor/2:portal/2",
						entryEnvCellId: 0x01020200,
					}),
				],
				diagnostics: createCandidateDiagnostics(2),
			},
			visibleTransitionPortalMasks: [
				createPortalMaskResource("portal-mask/outdoor/1:portal/1"),
			],
			renderChunkTransforms: [createRenderChunkTransform()],
			cameraPosition: { x: 0, y: 0, z: 5 },
			viewProjectionMatrix: createIdentityMat4(),
			viewport: { width: 100, height: 80 },
			baseScene: "exterior",
			initialEnvCellId: null,
			levels: createLevels("exterior"),
		});

		expect(plan.visibleWorkItems.map((work) => work.workItem.id)).toEqual([
			"outdoor/1:portal/1",
		]);
		expect(plan.visibleWorkItems[0]).toMatchObject({
			maskResourceId: "portal-mask/outdoor/1:portal/1",
			direction: "outdoor-to-indoor",
			entryEnvCellId: 0x01020100,
			screenRect: { x: 0, y: 0, width: 100, height: 80 },
		});
		expect([...plan.batches.keys()]).toEqual(["outdoor-to-indoor:1"]);
		expect(plan.maskedInteriorCellIds).toEqual(new Set([0x01020100]));
	});

	it("uses interior base-scene frontier rules for indoor-to-outdoor portals", () => {
		const plan = planWebgl2TransitionPortalWork({
			transitionPortalModel: {
				candidates: [
					createCandidate({
						id: "reachable",
						entryEnvCellId: 0x01020100,
					}),
					createCandidate({
						id: "unreachable",
						entryEnvCellId: 0x01020200,
					}),
				],
				diagnostics: createCandidateDiagnostics(2),
			},
			visibleTransitionPortalMasks: [
				createPortalMaskResource("portal-mask/reachable"),
				createPortalMaskResource("portal-mask/unreachable"),
			],
			renderChunkTransforms: [createRenderChunkTransform()],
			cameraPosition: { x: 0, y: 0, z: -5 },
			viewProjectionMatrix: createIdentityMat4(),
			viewport: { width: 100, height: 80 },
			baseScene: "interior",
			initialEnvCellId: 0x01020100,
			levels: createLevels("interior"),
		});

		expect(plan.visibleWorkItems.map((work) => work.workItem.id)).toEqual([
			"reachable",
			"unreachable",
		]);
		expect(
			plan.batches.get("indoor-to-outdoor:1")?.map((work) => work.workItem.id),
		).toEqual(["reachable"]);
	});

	it("clips portal composite bounds against clip space instead of dropping near-plane vertices", () => {
		const candidate = createCandidate({
			id: "near-plane",
			entryEnvCellId: 0x01020100,
			points: [
				{ x: -1, y: -1, z: 0 },
				{ x: 1, y: -1, z: 0 },
				{ x: 1, y: 1, z: -2 },
				{ x: -1, y: 1, z: -2 },
			],
		});

		const plan = planWebgl2TransitionPortalWork({
			transitionPortalModel: {
				candidates: [candidate],
				diagnostics: createCandidateDiagnostics(1),
			},
			visibleTransitionPortalMasks: [
				createPortalMaskResource("portal-mask/near-plane"),
			],
			renderChunkTransforms: [createRenderChunkTransform()],
			cameraPosition: { x: 0, y: 0, z: 5 },
			viewProjectionMatrix: createIdentityMat4(),
			viewport: { width: 100, height: 80 },
			baseScene: "exterior",
			initialEnvCellId: null,
			levels: createLevels("exterior"),
		});

		expect(plan.visibleWorkItems).toHaveLength(1);
		expect(plan.visibleWorkItems[0]?.screenRect).toEqual({
			x: 0,
			y: 40,
			width: 100,
			height: 40,
		});
	});
});

describe("deriveWebgl2BaseSceneDomain", () => {
	it("selects the initial fallback scene from the render scene context", () => {
		expect(
			deriveWebgl2BaseSceneDomain({
				renderSceneContext: { kind: "dungeon", anchorLandblockId: null },
			}),
		).toBe("interior");
		expect(
			deriveWebgl2BaseSceneDomain({
				renderSceneContext: { kind: "outdoor", anchorLandblockId: null },
			}),
		).toBe("exterior");
	});
});

describe("deriveWebgl2BaseSceneDomainFromResidency", () => {
	it("selects base scene and initial env-cell from actual camera residency", () => {
		const envCellResidency = {
			kind: "env-cell" as const,
			landblockId: 0x0102ffff,
			envCellId: 0x01020100,
		};

		expect(deriveWebgl2BaseSceneDomainFromResidency(envCellResidency)).toBe(
			"interior",
		);
		expect(deriveWebgl2InitialPortalEnvCellId(envCellResidency)).toBe(
			0x01020100,
		);
		expect(
			deriveWebgl2BaseSceneDomainFromResidency({
				kind: "outdoor-landblock",
				landblockId: 0x0102ffff,
			}),
		).toBe("exterior");
		expect(
			deriveWebgl2BaseSceneDomainFromResidency({
				kind: "unknown",
				landblockId: 0x0102ffff,
			}),
		).toBe("exterior");
	});
});

function createLevels(baseScene: WorldRenderBaseScene) {
	return deriveTransitionPortalRenderLevels({
		baseScene,
		maxDepth: 2,
	});
}

function createCandidate(options: {
	id: string;
	entryEnvCellId: number;
	points?: TransitionPortalCandidate["aperture"]["points"];
}): TransitionPortalCandidate {
	return {
		id: options.id,
		source: "browser-free-camera",
		outdoorPortalId: options.id,
		aperture: {
			id: options.id,
			source: {
				envCellId: options.entryEnvCellId,
				sourceIndex: 0,
			},
			targetStatus: "outside",
			points: options.points ?? [
				{ x: -1, y: -1, z: 0 },
				{ x: 1, y: -1, z: 0 },
				{ x: 1, y: 1, z: 0 },
			],
			plane: {
				normal: { x: 0, y: 0, z: 1 },
				constant: 0,
				source: "derived-from-render-points",
			},
			visibleSide: "negative",
			renderChunk: {
				chunkKey: "landblock/0102ffff",
				chunkLandblockId: 0x0102ffff,
				worldOffset: { x: 0, y: 0, z: 0 },
				renderOffset: { x: 0, y: 0, z: 0 },
			},
			chunkLocalPlacement: {
				origin: { x: 0, y: 0, z: 0 },
				orientation: { w: 1, x: 0, y: 0, z: 0 },
			},
			outsideTransition: {
				targetLandblockId: 0x0102ffff,
			},
		},
		insideVisibleSide: "negative",
		outsideVisibleSide: "positive",
		renderChunk: {
			chunkKey: "landblock/0102ffff",
			chunkLandblockId: 0x0102ffff,
			worldOffset: { x: 0, y: 0, z: 0 },
			renderOffset: { x: 0, y: 0, z: 0 },
		},
		entryEnvCellId: options.entryEnvCellId,
		requestedInteriorEnvCellIds: [options.entryEnvCellId],
		targetStatus: "outside",
		stencilRef: 1,
	};
}

function createPortalMaskResource(
	id: string,
): Webgl2TransitionPortalMaskResource {
	return {
		id,
		kind: "transition-portal-mask",
		candidateId: id.replace(/^portal-mask\//, ""),
		geometrySignature: "portal-mask",
		vertexArray: {
			vertexArray: {} as WebGLVertexArrayObject,
			dispose() {
				return;
			},
		},
		vertexBuffer: createEmptyBuffer(),
		indexBuffer: createEmptyBuffer(),
		indexType: 5123,
		vertexCount: 3,
		triangleCount: 1,
		renderChunkKey: "landblock/0102ffff",
		chunkLocalPlacement: {
			origin: { x: 0, y: 0, z: 0 },
			orientation: { w: 1, x: 0, y: 0, z: 0 },
		},
		bvhItemKeys: [],
		bvhFallbackReason: null,
		portalCandidate:
			{} as Webgl2TransitionPortalMaskResource["portalCandidate"],
	};
}

function createRenderChunkTransform() {
	return {
		chunkKey: "landblock/0102ffff" as const,
		chunkLandblockId: 0x0102ffff,
		offset: { x: 0, y: 0, z: 0 },
	};
}

function createEmptyBuffer() {
	return {
		buffer: {} as WebGLBuffer,
		dispose() {
			return;
		},
	};
}

function createIdentityMat4(): Float32Array {
	return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function createCandidateDiagnostics(workItemCandidateCount: number) {
	return {
		loadedEnvCellPortalFactCount: 0,
		topologyPortalCount: workItemCandidateCount,
		linkedTopologyPortalCount: workItemCandidateCount,
		apertureCandidateCount: workItemCandidateCount,
		workItemCandidateCount,
		skippedMissingApertureCount: 0,
		skippedMissingPolygonCount: 0,
		truncatedInteriorGroupCount: 0,
	};
}

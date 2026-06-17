import { describe, expect, it } from "vitest";
import type {
	RenderPassPlan,
	SceneDomainTargetKind,
} from "./types";
import {
	createTransitionCompositeApertureBatchInput,
	planTransitionCompositeWork,
	type TransitionCompositeApertureBatchInput,
} from "./transition-composite-work-plan";
import type { TransitionApertureBatch } from "../static/contracts";

describe("V2 transition composite work planner", () => {
	it("does not plan composite work for single-surface rendering", () => {
		expect(
			planTransitionCompositeWork({
				apertureBatches: [createApertureBatchInput("batch-a")],
				renderPassPlan: { kind: "single-surface-resident" },
			}),
		).toEqual({ kind: "none", depthWork: [] });
	});

	it("alternates composite direction from an exterior base scene", () => {
		const workPlan = planTransitionCompositeWork({
			apertureBatches: [
				createApertureBatchInput("batch-a", { landblockId: 0xda55ffff }),
			],
			renderPassPlan: createPortalRenderPassPlan({
				baseTarget: "exterior",
				maxDepth: 4,
			}),
		});

		expect(workPlan).toMatchObject({
			kind: "transition-composite",
			apertureBatchIds: ["batch-a"],
			maxDepth: 4,
		});
		expect(workPlan.depthWork).toEqual([
			{
				apertureBatchIds: ["batch-a"],
				cullFace: "front",
				currentTarget: "exterior",
				direction: "outdoor-to-indoor",
				sourceTarget: "interior",
				transitionDepth: 0,
			},
			{
				apertureBatchIds: ["batch-a"],
				cullFace: "back",
				currentTarget: "interior",
				direction: "indoor-to-outdoor",
				sourceTarget: "exterior",
				transitionDepth: 1,
			},
			{
				apertureBatchIds: ["batch-a"],
				cullFace: "front",
				currentTarget: "exterior",
				direction: "outdoor-to-indoor",
				sourceTarget: "interior",
				transitionDepth: 2,
			},
			{
				apertureBatchIds: ["batch-a"],
				cullFace: "back",
				currentTarget: "interior",
				direction: "indoor-to-outdoor",
				sourceTarget: "exterior",
				transitionDepth: 3,
			},
		]);
	});

	it("alternates composite direction from an interior base scene", () => {
		const workPlan = planTransitionCompositeWork({
			apertureBatches: [
				createApertureBatchInput("batch-a", { landblockId: 0xda55ffff }),
			],
			renderPassPlan: createPortalRenderPassPlan({
				baseTarget: "interior",
				maxDepth: 3,
			}),
		});

		expect(workPlan).toMatchObject({
			baseScene: {
				envCellId: 0xda550100,
				kind: "interior",
				landblockId: 0xda55ffff,
			},
			kind: "transition-composite",
			maxDepth: 3,
		});
		expect(
			workPlan.depthWork.map((step) => ({
				cullFace: step.cullFace,
				currentTarget: step.currentTarget,
				direction: step.direction,
				sourceTarget: step.sourceTarget,
			})),
		).toEqual([
			{
				cullFace: "back",
				currentTarget: "interior",
				direction: "indoor-to-outdoor",
				sourceTarget: "exterior",
			},
			{
				cullFace: "front",
				currentTarget: "exterior",
				direction: "outdoor-to-indoor",
				sourceTarget: "interior",
			},
			{
				cullFace: "back",
				currentTarget: "interior",
				direction: "indoor-to-outdoor",
				sourceTarget: "exterior",
			},
		]);
	});

	it("preserves stable aperture batch order for the base landblock", () => {
		const workPlan = planTransitionCompositeWork({
			apertureBatches: [
				createApertureBatchInput("near-overlap", { landblockId: 0xda55ffff }),
				createApertureBatchInput("other-landblock", { landblockId: 0xdb55ffff }),
				createApertureBatchInput("far-overlap", { landblockId: 0xda55ffff }),
			],
			renderPassPlan: createPortalRenderPassPlan({
				baseTarget: "exterior",
				maxDepth: 2,
			}),
		});

		expect(workPlan).toMatchObject({
			apertureBatchIds: ["near-overlap", "far-overlap"],
			kind: "transition-composite",
		});
		expect(
			workPlan.depthWork.map((step) => step.apertureBatchIds),
		).toEqual([
			["near-overlap", "far-overlap"],
			["near-overlap", "far-overlap"],
		]);
	});

	it("omits non-renderable packed transition aperture metadata", () => {
		const workPlan = planTransitionCompositeWork({
			apertureBatches: [
				createApertureBatchInput("empty-indices", { indexCount: 0 }),
				createApertureBatchInput("empty-ranges", { rangeCount: 0 }),
				createApertureBatchInput("valid"),
			],
			renderPassPlan: createPortalRenderPassPlan({
				baseTarget: "exterior",
				maxDepth: 1,
			}),
		});

		expect(workPlan).toMatchObject({
			apertureBatchIds: ["valid"],
			kind: "transition-composite",
		});
		expect(workPlan.depthWork[0]?.apertureBatchIds).toEqual(["valid"]);
	});

	it("derives planner input from baked transition aperture batches", () => {
		expect(
			createTransitionCompositeApertureBatchInput({
				apertureBatchId: "batch-a",
				coordinateSpace: "landblock-render-local",
				frontFace: "indoor-visible",
				indices: [0, 1, 2],
				kind: "transition-aperture-batch",
				landblockId: 0xda55ffff,
				planes: [null],
				ranges: [
					{
						envCellId: 0xda550100,
						exterior: { kind: "outside", landblockId: 0xda55ffff },
						firstIndex: 0,
						indexCount: 3,
						portalId: "transition-portal-a",
					},
				],
				vertices: [
					{ x: 0, y: 0, z: 0 },
					{ x: 1, y: 0, z: 0 },
					{ x: 0, y: 1, z: 0 },
				],
			} satisfies TransitionApertureBatch),
		).toEqual({
			apertureBatchId: "batch-a",
			frontFace: "indoor-visible",
			indexCount: 3,
			landblockId: 0xda55ffff,
			rangeCount: 1,
		});
	});
});

function createPortalRenderPassPlan(options: {
	readonly baseTarget: SceneDomainTargetKind;
	readonly maxDepth: number;
}): RenderPassPlan {
	return {
		baseScene:
			options.baseTarget === "exterior"
				? { kind: "exterior", landblockId: 0xda55ffff }
				: {
						envCellId: 0xda550100,
						kind: "interior",
						landblockId: 0xda55ffff,
					},
		kind: "portal-scene-domains",
		transitionDepthPolicy: { maxDepth: options.maxDepth },
	};
}

function createApertureBatchInput(
	apertureBatchId: string,
	overrides: Partial<TransitionCompositeApertureBatchInput> = {},
): TransitionCompositeApertureBatchInput {
	return {
		apertureBatchId,
		frontFace: "indoor-visible",
		indexCount: 3,
		landblockId: 0xda55ffff,
		rangeCount: 1,
		...overrides,
	};
}
